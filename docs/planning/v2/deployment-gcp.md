# Cerebro v2 — Deploying on Google Cloud (Compute Engine)

> The GCP-specific front half of [deployment.md](deployment.md). That document is
> host-agnostic: it assumes "one Linux VM with Docker" already exists and DNS already points at
> it. This one creates that VM on Compute Engine, points a domain at it, and hands off to
> [`deploy.sh`](../../../deploy.sh). Everything after `deploy.sh` (OAuth apps, the bootstrap
> admin, the isolation check) is deployment.md §1 and §6–9, unchanged.

**Short version**, from the repo root on your machine:

```bash
PROJECT_ID=<project> ./infra/gcp/provision.sh                 # VM, static IP, firewall, snapshots
#   → add DNS A records for @ and www at your registrar (§3)
gcloud compute ssh cerebro --zone=asia-south1-a --tunnel-through-iap -- 'bash -s' < infra/gcp/bootstrap-vm.sh
gcloud compute ssh cerebro --zone=asia-south1-a --tunnel-through-iap
#   on the VM:  cd ~/cerebro && cp .env.example .env && chmod 600 .env && nano .env && ./deploy.sh
```

---

## 0. Topology

```
                    Internet
                       │  HTTPS :443 (HTTP :80 → redirect + ACME challenge)
                       ▼
  ┌──────────────── GCP VPC firewall ───────────────────────────────────┐
  │  cerebro-allow-web       tcp:80,443  from 0.0.0.0/0                  │
  │  cerebro-allow-iap-ssh   tcp:22      from 35.235.240.0/20 (IAP only) │
  └──────────────────────┬──────────────────────────────────────────────┘
                         │  static external IP (cerebro-ip, asia-south1)
  ┌──────────────────────▼─── VM "cerebro" — e2-standard-2, Debian 12, 50 GB pd-balanced ───┐
  │  Docker Compose (docker-compose.prod.yml)                                               │
  │   caddy :80/:443 ──/api/*──▶ backend :5000 ──▶ mongo · redis · qdrant · minio · vision  │
  │         └── static SPA (frontend/dist, read-only bind mount)                             │
  │  every volume (mongo, qdrant, redis AOF, minio, caddy certs) lives on the boot disk      │
  └─────────────────────────────────────────────────────────────────────────────────────────┘
         │ daily snapshot 21:00 UTC, 7-day retention (cerebro-daily)
         ▼
     Compute Engine snapshots

  Outbound from backend: Cohere, LlamaParse, the configured LLM provider, (optionally) SMTP/Twilio.
```

One VM, deliberately. The stack idles at ~860 MB (deployment.md §0) and its peaks are short
CPU bursts, so splitting it across managed services (Cloud SQL has no MongoDB, Memorystore
Redis starts around the cost of this whole VM, and there is no managed Qdrant on GCP) would cost
several times as much for availability a demo-to-small-team deployment does not need. The
accepted cost is no high availability: if the VM is down, the site is down (§7).

---

## 1. Before you start

### 1.1 An open billing account on the project

`provision.sh` refuses to run until `gcloud billing projects describe <project>` reports
`billingEnabled: True`, because Compute Engine cannot create anything without it — and the
error GCP returns when billing is missing (`Consumer 'projects/…' has been suspended`) does not
mention billing at all.

**The live deployment** (provisioned 2026-10-28) runs under Google account
`taharafi005@gmail.com`, project `project-59520b61-0065-4492-ae8`, billing account
`010386-5DD1C4-172E43` (free trial). The older account `taharafi05@gmail.com` has a suspended
project (`cerebro-506919`) and only closed billing accounts — it is **not** used. gcloud must be
logged in as the account that owns the project: `gcloud auth login`, pick that account, then
`gcloud config set project <id>`. A "does not have permission … (or it may not exist)" error
on a project you can see in the browser means the CLI is on the other account.

For a project without billing, in console.cloud.google.com:

1. **Billing → Manage billing accounts.** If a "Free trial" banner offers credit, activate it
   (it creates a new, open billing account). The $300 trial is once per customer; if a closed
   account already used it, reopen that account instead (**Billing → the account →
   Reactivate**), which requires upgrading it to a paid account.
2. **Billing → Account management → Linked projects**: link the project to the open account.
   Linking an open account lifts a billing-caused suspension. If the console shows a different
   suspension reason (a policy notice), that has to be appealed from the banner — linking
   billing will not clear it.
3. Confirm from your terminal: `gcloud billing projects describe <project>` →
   `billingEnabled: true`.

### 1.2 The free-trial clock

| Fact | Consequence for this deployment |
|---|---|
| The trial credit is $300 and **expires 90 days after activation**, whichever runs out first | At ~$65–70/month (§8) the credit outlasts the 90 days, so **the date, not the money, ends it** |
| The live deployment's trial was activated well before provisioning: on 2026-10-28 the console showed ₹28,663 credit and **35 days remaining** | The trial ends on or about **2026-12-02**. The console's "Free trial status" banner is the authority on the exact date |
| When the trial ends, Compute Engine resources are **stopped**; GCP deletes them if the account is not upgraded within 30 days | Upgrade to a paid account before the trial ends (remaining credit carries over) or the site goes down and, 30 days later, the disk and its snapshots are deleted |
| Trial accounts cannot use GPUs | ColPali stays off (`COLPALI_ENABLED=false`, the default) — scanned PDFs are still searchable through OCR |

Set a budget alert so the spend is never a surprise (Billing → Budgets & alerts → Create
budget, scoped to the project, thresholds at 50% / 90% / 100% of $300).

### 1.3 Accounts and keys

| Needed for | What | Notes |
|---|---|---|
| Embeddings + rerank | `COHERE_API_KEY` | The current key is **trial-tier, 1,000 calls/month total** (AGENTS.md). One ingest of a mid-size PDF plus a few dozen questions uses a large share of that — fine for a demo, not for real users (§9) |
| Text PDF/DOCX parsing | `LLAMA_CLOUD_API_KEY` | |
| Answers | one LLM key: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, or `GEMINI_API_KEY` | Set `LLM_PROVIDER` to match; deploy.sh's preflight checks the key for the chosen provider |
| The domain | access to the registrar's DNS panel | GitHub Student Pack domains are usually at Namecheap, name.com, or get.tech (.tech) |

---

## 2. Provision the VM — `infra/gcp/provision.sh`

```bash
gcloud config set project project-59520b61-0065-4492-ae8
PROJECT_ID=project-59520b61-0065-4492-ae8 ./infra/gcp/provision.sh
```

What it creates, each only if absent (re-running after a partial failure is safe):

| Resource | Setting | Why |
|---|---|---|
| APIs | `compute.googleapis.com`, `iap.googleapis.com` | Compute Engine, and SSH through Identity-Aware Proxy |
| Firewall `cerebro-allow-web` | tcp:80,443 from `0.0.0.0/0` to tag `cerebro-web` | 443 serves the app; 80 is required for Let's Encrypt's HTTP-01 challenge and the http→https redirect |
| Firewall `cerebro-allow-iap-ssh` | tcp:22 from `35.235.240.0/20` only | SSH is reachable only through IAP, which authenticates your Google account first. Port 22 is closed to the internet |
| Removes `default-allow-ssh`, `default-allow-rdp` | only when `cerebro` is the project's only VM | They open 22/3389 to the whole internet and would make the IAP-only rule pointless. With other VMs present the script leaves them and says so |
| Static IP `cerebro-ip` | regional, asia-south1, premium tier | An ephemeral IP changes on stop/start, which breaks DNS and certificate renewal |
| VM `cerebro` | e2-standard-2 (2 vCPU / 8 GB), asia-south1-a | deployment.md §0's recommended size: UMAP fits and OCR are CPU-bound, and the vision image build (PyTorch) needs the memory. Mumbai for users in India |
| | Debian 12, 50 GB pd-balanced | Matches the `node:22-bookworm` / `python:3.11-slim` (Debian) images; 50 GB holds ~2.7 GB of images, build cache, logs and years of a small corpus |
| | `--no-service-account --no-scopes` | Nothing on the VM calls a Google Cloud API, so it holds no Google credentials a compromised container could use |
| | Shielded VM, OS Login, deletion protection | Verified boot; SSH keys tied to your Google identity; `instances delete` refuses until protection is lifted (§8) |
| Snapshot schedule `cerebro-daily` | daily 21:00 UTC (02:30 IST), keep 7, keep snapshots if the disk is deleted | Every piece of state lives in Docker volumes on this one disk, so a disk snapshot is a full backup (§6.1) |

Overrides, all environment variables: `REGION`, `ZONE`, `VM`, `MACHINE_TYPE`, `DISK_GB`,
`NETWORK`. The script ends by printing the static IP.

---

## 3. Point the domain at the VM

At the registrar's DNS panel, create exactly these two records (TTL 300 s, so a mistake corrects
within five minutes):

| Type | Host | Value |
|---|---|---|
| A | `@` | the static IP from §2 |
| A | `www` | the static IP from §2 |

**Delete whatever the registrar put there by default** for `@` and `www` — Namecheap, for
example, adds a "URL Redirect Record" and a `www` CNAME to a parking page. A leftover record
either resolves to the wrong address or makes the A record ambiguous.

**The live deployment:** `cerebrodigital.tech` (GitHub Student Pack via get.tech; the registrar
of record is **Namify Domains Inc**, IANA 1913, `registrarcontact@namify.tech`; DNS on the
registrar's own `cont603385.*.orderbox-dns.com` nameservers) → static IP `34.14.164.192`. Before
the change, both `@` and `www` held the registrar's parking A record `104.198.156.20`; that
record is replaced, not kept alongside — two A records for one name make resolvers alternate
between the VM and the parking page. Edit the existing `@` and `www` A records in the
registrar's DNS panel.

Observed 2026-10-28: the Namify dashboard (`namify.get.tech`) briefly stopped listing the
domain, and its nameservers answered roughly 1 query in 4 with no A record. The registry
showed the domain active throughout. Moving DNS to Cloudflare (free; one nameserver change at
the registrar) removes this dependency and adds free Email Routing for `contact@`.

If the domain's DNS is on Cloudflare instead, set both records to **DNS only** (grey cloud):
Cloudflare's proxy terminates TLS itself and answers the ACME challenge in Caddy's place.

Check from your machine before going further. Both lines must print the static IP:

```bash
dig +short <domain> A
dig +short www.<domain> A
```

Do not run `deploy.sh` before both resolve. Let's Encrypt allows 5 failed validations per
hostname per hour; `deploy.sh`'s preflight refuses to start on wrong DNS precisely so a
mistake here costs nothing (deployment.md §0).

---

## 4. Bootstrap the VM — `infra/gcp/bootstrap-vm.sh`

```bash
gcloud compute ssh cerebro --zone=asia-south1-a --tunnel-through-iap -- 'bash -s' < infra/gcp/bootstrap-vm.sh
```

The first `gcloud compute ssh` registers your SSH key through OS Login; accept the prompt. The
script, idempotent like the provisioner:

| Step | Detail |
|---|---|
| Docker Engine + Compose v2 plugin | From Docker's own apt repository. Debian's `docker.io` lags the Compose features `deploy.sh` uses (`up --wait`) |
| Log rotation | `/etc/docker/daemon.json`: json-file, 10 MB × 5 per container (~350 MB worst case). Docker's default never rotates, and a full disk takes Mongo and Redis down |
| Swap | 2 GB `/swapfile`, `vm.swappiness=10`: a cushion for the PyTorch image build and fit spikes, not a steady-state resource |
| `unattended-upgrades` | Debian security updates install automatically |
| docker group | Your user can run `docker` without sudo; takes effect on the next SSH session |
| Repo | `git clone https://github.com/mohdTahaRafi/cerebro-engine.git ~/cerebro`. The repo is public, so no deploy key is needed |

---

## 5. Configure and deploy

Open a **new** SSH session (so the docker group applies), then:

```bash
gcloud compute ssh cerebro --zone=asia-south1-a --tunnel-through-iap
cd ~/cerebro
cp .env.example .env && chmod 600 .env
nano .env
```

The `.env` file is created on the VM and never leaves it: it holds every secret the stack has.
Values that differ from `.env.example`:

| Key | Value |
|---|---|
| `DOMAIN` | your domain, without `https://` or `www.` |
| `COHERE_API_KEY`, `LLAMA_CLOUD_API_KEY` | your keys (§1.3) |
| `LLM_PROVIDER` + its key | e.g. `LLM_PROVIDER=gemini` and `GEMINI_API_KEY=…` |
| `MINIO_ROOT_PASSWORD` | `openssl rand -base64 24` (MinIO requires ≥ 8 characters) |
| `SESSION_SECRET` | `openssl rand -base64 48` (≥ 32 characters, enforced at startup) |
| `ADMIN_EMAILS` | the address you will sign up with first; it gets `role=admin` |

OAuth (`GOOGLE_*`, `GITHUB_*`) and mail/SMS (`SMTP_*`, `TWILIO_*`) can stay blank: each
missing provider simply disappears from the login page (deployment.md §1–2).

Then:

```bash
./deploy.sh
```

It runs preflight (every required value, DNS for both names against this VM's public IP, ports
80/443 free), builds the frontend inside a `node:22` container (the VM has no Node), brings the
stack up and waits for every healthcheck, creates the Qdrant collections and tenant index, and
smoke-tests `https://<domain>/api/health` through Caddy. The first run builds the `vision` and
`backend` images and takes about 10–15 minutes; later runs reuse the build cache.

When it finishes, follow the steps it prints — they are deployment.md §1 and §6–9:

1. **OAuth callbacks** (optional). For Google, use this same GCP project: APIs & Services →
   OAuth consent screen (External; the `openid`/`email`/`profile` scopes need no Google
   verification), then Credentials → OAuth client ID → Web application, redirect URI
   `https://<domain>/api/auth/google/callback`. Put the ID and secret in `.env` and re-run
   `./deploy.sh`.
2. **Sign up** at `https://<domain>/signup` with the `ADMIN_EMAILS` address.
3. **Tenancy migration** — only for data carried over from a pre-v2 single-tenant install. A
   fresh deployment has none; the dry run reports zero documents and there is nothing to commit.
4. **Isolation check** — sign in as a second account and confirm it sees none of the first
   account's contexts.

---

## 6. Day-to-day operation

| Task | Command (from your machine unless noted) |
|---|---|
| SSH | `gcloud compute ssh cerebro --zone=asia-south1-a --tunnel-through-iap` |
| Deploy a new version | on the VM: `cd ~/cerebro && git pull && ./deploy.sh` |
| Logs | on the VM: `docker compose -f docker-compose.prod.yml logs -f backend` |
| Container status | on the VM: `docker compose -f docker-compose.prod.yml ps` |
| MinIO console | `gcloud compute ssh cerebro --zone=asia-south1-a --tunnel-through-iap -- -N -L 9001:127.0.0.1:9001`, then open http://localhost:9001 |
| Disk usage | on the VM: `df -h / && docker system df`; reclaim old build layers with `docker builder prune -f` |
| Stop billing for compute (keeps the disk and IP) | `gcloud compute instances stop cerebro --zone=asia-south1-a` — the site is down until `start` |

### 6.1 Restoring from a snapshot

```bash
gcloud compute snapshots list --filter="sourceDisk~cerebro" --sort-by=~creationTimestamp
gcloud compute instances stop cerebro --zone=asia-south1-a
gcloud compute disks create cerebro-restored --zone=asia-south1-a --source-snapshot=<snapshot> --type=pd-balanced
gcloud compute instances detach-disk cerebro --zone=asia-south1-a --disk=cerebro
gcloud compute instances attach-disk cerebro --zone=asia-south1-a --disk=cerebro-restored --boot
gcloud compute instances start cerebro --zone=asia-south1-a
```

The static IP stays attached to the instance, so DNS and the certificate need no change. Data
written after the snapshot is lost (at most 24 hours). Keep the old disk until the restored VM
is verified, then delete it.

---

## 7. What the deployment does and does not protect against

| Failure | What happens | What the user sees |
|---|---|---|
| A container crashes | `restart: unless-stopped` restarts it; Redis AOF, Mongo's journal and Qdrant's WAL recover their state | A few seconds of 502s from Caddy, then normal |
| VM reboot (host maintenance, `unattended-upgrades`) | Compute Engine live-migrates for host maintenance; after a reboot Docker starts and the compose services come back on their own | Up to a couple of minutes of downtime, no data loss |
| Disk fills | Log rotation and `docker builder prune` keep it from happening in practice; if it does, Mongo and Redis stop accepting writes | Uploads and sign-ins fail; `df -h` on the VM shows it |
| Cohere quota exhausted (trial key) | Embed/rerank calls return 429; the breaker opens | Questions and uploads fail with a "provider unavailable" message until the month resets |
| LLM provider down | Generation fails; retrieval still works | An error in place of the answer; sources still listed |
| Trial credit or the trial period runs out (2026-12-02 for the live deployment) | GCP stops the VM | The site is unreachable until the account is upgraded (§1.2) |
| A pinned image is withdrawn from its registry | Already-pulled images keep running; a fresh VM's `./deploy.sh` stops at that service with "pull access denied" (this is how the 2026-10-28 deploy found MinIO's images gone) | Nothing, on the running site. A rebuild from scratch blocks until the image line is replaced |
| The VM or zone is lost | No failover — single VM by design (§0) | Down until restored from the latest snapshot (§6.1), at most 24 h of data lost |

---

## 8. Cost and teardown

Approximate list prices in asia-south1. Verify in the GCP pricing calculator before relying on them:

| Item | ≈ per month |
|---|---|
| e2-standard-2, running 24/7 | $55–60 |
| 50 GB pd-balanced boot disk | $5–6 |
| Static IP, attached to a running VM | $3.6 |
| Snapshots (incremental; a few GB for a small corpus) | < $1 |
| Egress (a demo's traffic) | < $1 |
| **Total** | **≈ $65–70** |

Teardown (irreversible — snapshots are kept unless deleted separately):

```bash
gcloud compute instances update cerebro --zone=asia-south1-a --no-deletion-protection
gcloud compute instances delete cerebro --zone=asia-south1-a
gcloud compute addresses delete cerebro-ip --region=asia-south1
gcloud compute resource-policies delete cerebro-daily --region=asia-south1
gcloud compute firewall-rules delete cerebro-allow-web cerebro-allow-iap-ssh
```

---

## 9. Before opening it to real users

These do not block a deployment, but each one matters once people other than you depend on it:

| Item | Why |
|---|---|
| Upgrade the Cohere key from trial | 1,000 calls/month total is used up quickly by a handful of active users (§1.3) |
| Review the LLM provider's data terms | A free-tier Gemini key's terms have allowed Google to use submitted content to improve its products (v1 deployment.md §3.5). Users upload private documents |
| Watch the MinIO fork | MinIO Inc. withdrew its public images in 2026, so docker-compose.prod.yml runs `pgsty/minio` (community fork, pinned release). Bump the pinned tags deliberately; if the fork goes quiet, `cgr.dev/chainguard/minio` is the fallback (check it still ships `curl`, which the healthcheck needs) |
| Configure SMTP | Without it there is no email OTP, so no self-service password reset (deployment.md §2) |
| Upgrade the GCP account before the trial ends (2026-12-02) | §1.2 |
