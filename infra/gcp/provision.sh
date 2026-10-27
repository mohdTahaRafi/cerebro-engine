#!/usr/bin/env bash
# Provisions the single Compute Engine VM Cerebro runs on (docs/planning/v2/deployment-gcp.md
# §2). Run from your own machine with an authenticated gcloud; it touches nothing on the VM
# itself — infra/gcp/bootstrap-vm.sh does that.
#
#   PROJECT_ID=my-project ./infra/gcp/provision.sh
#
# Idempotent: every resource is created only if it does not exist yet, so a re-run after a
# partial failure picks up where the last one stopped. Prints the static IP at the end —
# that is the value both DNS A records point at.
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-south1}"          # Mumbai — lowest latency for users in India
ZONE="${ZONE:-asia-south1-a}"
VM="${VM:-cerebro}"
MACHINE_TYPE="${MACHINE_TYPE:-e2-standard-2}"   # 2 vCPU / 8 GB — deployment.md §0's recommended size
DISK_GB="${DISK_GB:-50}"                 # ~2.7 GB of images + build cache + data growth; 30 GB is the floor
NETWORK="${NETWORK:-default}"
TAG="cerebro-web"                        # the firewall rules below target this tag only
IP_NAME="${VM}-ip"
SNAPSHOT_POLICY="${VM}-daily"
IAP_RANGE="35.235.240.0/20"              # Google's fixed source range for IAP TCP forwarding

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[31mprovision: %s\033[0m\n' "$*" >&2; exit 1; }
exists() { "$@" >/dev/null 2>&1; }

[[ -n "$PROJECT_ID" ]] || die "no project — set PROJECT_ID or run: gcloud config set project <id>"
gcloud config set project "$PROJECT_ID" >/dev/null

# ── 1. Preflight ─────────────────────────────────────────────────────────────────────
# A project with no open billing account cannot create a VM, and the API error for it
# ("Consumer ... has been suspended") does not mention billing at all.
step "Preflight: billing for $PROJECT_ID"
[[ "$(gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)')" == "True" ]] \
  || die "billing is not enabled on $PROJECT_ID — link an OPEN billing account first (deployment-gcp.md §1)"

step "Enabling the Compute Engine and IAP APIs"
gcloud services enable compute.googleapis.com iap.googleapis.com

# ── 2. Network + firewall ────────────────────────────────────────────────────────────
step "Network '$NETWORK'"
exists gcloud compute networks describe "$NETWORK" \
  || gcloud compute networks create "$NETWORK" --subnet-mode=auto

# 80 for the ACME HTTP-01 challenge and the http→https redirect, 443 for the app. Nothing
# else is published: Caddy is the only container bound on all interfaces
# (docker-compose.prod.yml), and this rule is the network edge that enforces it.
step "Firewall: 80/443 from anywhere to tag $TAG"
exists gcloud compute firewall-rules describe cerebro-allow-web \
  || gcloud compute firewall-rules create cerebro-allow-web --network="$NETWORK" \
       --direction=INGRESS --action=ALLOW --rules=tcp:80,tcp:443 \
       --source-ranges=0.0.0.0/0 --target-tags="$TAG"

# SSH only through Identity-Aware Proxy: port 22 is never reachable from the internet, and
# `gcloud compute ssh --tunnel-through-iap` authenticates with your Google account first.
step "Firewall: SSH from IAP only"
exists gcloud compute firewall-rules describe cerebro-allow-iap-ssh \
  || gcloud compute firewall-rules create cerebro-allow-iap-ssh --network="$NETWORK" \
       --direction=INGRESS --action=ALLOW --rules=tcp:22 \
       --source-ranges="$IAP_RANGE" --target-tags="$TAG"

# The default network ships with default-allow-ssh / default-allow-rdp open to 0.0.0.0/0,
# which would make the IAP-only rule above meaningless. Delete them — but only when this VM
# is the project's only instance, since another VM may depend on them.
others="$(gcloud compute instances list --format='value(name)' | grep -vx "$VM" || true)"
if [[ "$NETWORK" == "default" && -z "$others" ]]; then
  for rule in default-allow-ssh default-allow-rdp; do
    if exists gcloud compute firewall-rules describe "$rule"; then
      step "Removing $rule (open to the whole internet)"
      gcloud compute firewall-rules delete "$rule" --quiet
    fi
  done
elif [[ -n "$others" ]]; then
  printf 'provision: other instances exist (%s) — leaving default-allow-ssh/rdp in place; review them by hand\n' "$others" >&2
fi

# ── 3. Static IP ─────────────────────────────────────────────────────────────────────
# Reserved, not ephemeral: an ephemeral IP changes on every stop/start, which would break
# both DNS records and the Let's Encrypt certificate's validation path.
step "Static external IP $IP_NAME"
exists gcloud compute addresses describe "$IP_NAME" --region="$REGION" \
  || gcloud compute addresses create "$IP_NAME" --region="$REGION" --network-tier=PREMIUM
IP="$(gcloud compute addresses describe "$IP_NAME" --region="$REGION" --format='value(address)')"

# ── 4. The VM ────────────────────────────────────────────────────────────────────────
# --no-service-account: nothing on the VM calls a Google Cloud API, so it gets no
# credentials at all — a compromised container cannot reach the project.
# --deletion-protection: `instances delete` refuses until it is lifted (§8 teardown).
step "VM $VM ($MACHINE_TYPE, ${DISK_GB} GB pd-balanced, Debian 12) in $ZONE"
if ! exists gcloud compute instances describe "$VM" --zone="$ZONE"; then
  gcloud compute instances create "$VM" --zone="$ZONE" \
    --machine-type="$MACHINE_TYPE" \
    --image-family=debian-12 --image-project=debian-cloud \
    --boot-disk-size="${DISK_GB}GB" --boot-disk-type=pd-balanced \
    --network="$NETWORK" --address="$IP" --tags="$TAG" \
    --no-service-account --no-scopes \
    --shielded-secure-boot --shielded-vtpm --shielded-integrity-monitoring \
    --metadata=enable-oslogin=TRUE \
    --deletion-protection
fi

# ── 5. Daily disk snapshots ──────────────────────────────────────────────────────────
# Every piece of state (Mongo, Qdrant, Redis AOF, MinIO page images, Caddy's certificates)
# lives in Docker volumes on this one disk, so a snapshot of it is a full backup. Snapshots
# are crash-consistent; Mongo's journal, Qdrant's WAL and Redis's AOF all recover from that.
# 21:00 UTC = 02:30 IST, the quietest hour (schedules only accept on-the-hour start times).
step "Snapshot schedule $SNAPSHOT_POLICY (daily, 7-day retention)"
exists gcloud compute resource-policies describe "$SNAPSHOT_POLICY" --region="$REGION" \
  || gcloud compute resource-policies create snapshot-schedule "$SNAPSHOT_POLICY" \
       --region="$REGION" --daily-schedule --start-time=21:00 \
       --max-retention-days=7 --on-source-disk-delete=keep-auto-snapshots
attached="$(gcloud compute disks describe "$VM" --zone="$ZONE" --format='value(resourcePolicies)')"
[[ "$attached" == *"$SNAPSHOT_POLICY"* ]] \
  || gcloud compute disks add-resource-policies "$VM" --zone="$ZONE" --resource-policies="$SNAPSHOT_POLICY"

cat <<EOF

$(printf '\033[32m')Provisioned.$(printf '\033[0m')  Static IP: $IP

Next (deployment-gcp.md §3–§5):
  1. At your domain registrar, create two A records → $IP
       @    A  $IP
       www  A  $IP
  2. Bootstrap the VM:
       gcloud compute ssh $VM --zone=$ZONE --tunnel-through-iap -- 'bash -s' < infra/gcp/bootstrap-vm.sh
EOF
