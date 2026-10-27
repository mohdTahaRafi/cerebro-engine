#!/usr/bin/env bash
# One-time setup ON the VM (docs/planning/v2/deployment-gcp.md §4): Docker Engine + the
# Compose plugin, bounded container logs, swap, automatic security updates, and a clone of
# the repo. Run it from your machine over IAP — it needs nothing copied to the VM first:
#
#   gcloud compute ssh cerebro --zone=asia-south1-a --tunnel-through-iap -- 'bash -s' < infra/gcp/bootstrap-vm.sh
#
# Idempotent: safe to re-run; every step checks before it changes anything.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/mohdTahaRafi/cerebro-engine.git}"   # public — no credentials needed
APP_DIR="$HOME/cerebro"
SWAP_SIZE="2G"   # not for steady state (the stack idles at ~860 MB of 8 GB): a cushion so a
                 # PyTorch-sized image build or a UMAP fit spike swaps instead of OOM-killing

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

step "Base packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq ca-certificates curl gnupg git unattended-upgrades

# Debian's own docker.io lags Compose v2 features deploy.sh relies on (`up --wait`), so
# install Docker's upstream packages, per docs.docker.com/engine/install/debian.
if ! command -v docker >/dev/null; then
  step "Docker Engine + Compose plugin"
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update -qq
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
    docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

# Docker's default json-file driver keeps every log line forever; seven chatty containers
# fill a 50 GB disk eventually, and a full disk takes Mongo and Redis down with it.
# 5 × 10 MB per container is ~350 MB worst case. Applies to containers created after this.
if [[ ! -f /etc/docker/daemon.json ]]; then
  step "Container log rotation (10 MB × 5 per container)"
  echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "5" } }' \
    | sudo tee /etc/docker/daemon.json >/dev/null
  sudo systemctl restart docker
fi

if ! groups "$USER" | grep -qw docker; then
  step "Adding $USER to the docker group"
  sudo usermod -aG docker "$USER"
  NEEDS_RELOGIN=1
fi

# swapon lives in /sbin, which is not on a non-root user's PATH on Debian — hence sudo.
if ! sudo swapon --show | grep -q /swapfile; then
  step "Swap ($SWAP_SIZE)"
  sudo fallocate -l "$SWAP_SIZE" /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null
  sudo swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  # Swap only under real memory pressure, never as a substitute for page cache.
  echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-cerebro-swap.conf >/dev/null
  sudo sysctl -q -p /etc/sysctl.d/99-cerebro-swap.conf
fi

step "Automatic security updates"
sudo systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

if [[ ! -d "$APP_DIR/.git" ]]; then
  step "Cloning $REPO_URL → $APP_DIR"
  git clone -q "$REPO_URL" "$APP_DIR"
fi

cat <<EOF

$(printf '\033[32m')VM ready.$(printf '\033[0m')  $(docker --version 2>/dev/null || sudo docker --version), $(sudo docker compose version)

Next (deployment-gcp.md §5): SSH in${NEEDS_RELOGIN:+ (a NEW session — the docker group applies on next login)}, then
  cd ~/cerebro && cp .env.example .env && chmod 600 .env && nano .env
  ./deploy.sh
EOF
