#!/usr/bin/env bash
# One-command production deploy (phase_8 task 8.20). Runs docs/planning/v2/deployment.md's
# steps 2–5 in order and stops at the first one that fails, naming it. Steps 1 (OAuth app
# registration) and 6–9 (bootstrap admin signup, tenancy migration, isolation check) need a
# human in a browser, so this script prints them at the end instead of guessing at them.
#
#   ./deploy.sh            real deploy on the target host — Caddy obtains a Let's Encrypt cert
#                          for $DOMAIN, so DNS for $DOMAIN and www.$DOMAIN must already point here
#   ./deploy.sh --local    the same stack on a dev box, with Caddyfile.verify's `tls internal`
#                          in place of real ACME (docker-compose.prod.verify.yml) — for
#                          rehearsing a deploy where no public DNS exists
#
# Idempotent: re-running it is how you deploy a new version (`git pull && ./deploy.sh`).
set -euo pipefail

cd "$(dirname "$0")"

LOCAL=0
[[ "${1:-}" == "--local" ]] && LOCAL=1

COMPOSE=(docker compose -f docker-compose.prod.yml)
(( LOCAL )) && COMPOSE+=(-f docker-compose.prod.verify.yml)

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die()  { printf '\033[31mdeploy: %s\033[0m\n' "$*" >&2; exit 1; }
warn() { printf '\033[33mdeploy: %s\033[0m\n' "$*" >&2; }

# ── 1. Preflight ─────────────────────────────────────────────────────────────────────
step "Preflight"

command -v docker >/dev/null || die "docker is not installed"
docker compose version >/dev/null 2>&1 || die "the docker compose v2 plugin is not installed"
[[ -f .env ]] || die ".env not found — cp .env.example .env and fill it in (deployment.md §2)"

# Read a value from .env without sourcing it — sourcing would execute anything in the file
# and choke on the unquoted "Cerebro <no-reply@…>" form .env.example suggests for MAIL_FROM.
env_get() { grep -E "^$1=" .env | tail -1 | cut -d= -f2- | sed -E 's/[[:space:]]+#.*$//; s/^"(.*)"$/\1/'; }

missing=()
for k in DOMAIN COHERE_API_KEY LLAMA_CLOUD_API_KEY MINIO_ROOT_USER MINIO_ROOT_PASSWORD SESSION_SECRET; do
  [[ -n "$(env_get "$k")" ]] || missing+=("$k")
done
(( ${#missing[@]} == 0 )) || die "required .env values are empty: ${missing[*]}"

secret="$(env_get SESSION_SECRET)"
(( ${#secret} >= 32 )) || die "SESSION_SECRET is ${#secret} chars; config/index.js requires ≥32 (openssl rand -base64 48)"

# MinIO refuses to start with a root password under 8 chars, and the failure surfaces only
# as an unhealthy container several minutes into `--wait`.
minio_pw="$(env_get MINIO_ROOT_PASSWORD)"
(( ${#minio_pw} >= 8 )) || die "MINIO_ROOT_PASSWORD must be ≥8 chars (MinIO's own minimum)"

provider="$(env_get LLM_PROVIDER)"; provider="${provider:-anthropic}"
case "$provider" in
  anthropic) [[ -n "$(env_get ANTHROPIC_API_KEY)" ]] || die "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty" ;;
  groq)      [[ -n "$(env_get GROQ_API_KEY)" ]]      || die "LLM_PROVIDER=groq but GROQ_API_KEY is empty" ;;
  gemini)    [[ -n "$(env_get GEMINI_API_KEY)" ]]    || die "LLM_PROVIDER=gemini but GEMINI_API_KEY is empty" ;;
  ollama)    warn "LLM_PROVIDER=ollama — Ollama must be running on this host at $(env_get OLLAMA_API_URL)" ;;
  *)         die "unknown LLM_PROVIDER '$provider' (anthropic | groq | gemini | ollama)" ;;
esac

DOMAIN="$(env_get DOMAIN)"
[[ -n "$(env_get ADMIN_EMAILS)" ]] || warn "ADMIN_EMAILS is empty — nobody will get role=admin, and /admin/* stays unreachable"

if (( LOCAL )); then
  getent hosts "$DOMAIN" >/dev/null || warn "$DOMAIN does not resolve here; curl checks use --resolve, but a browser needs '127.0.0.1 $DOMAIN www.$DOMAIN' in /etc/hosts"
else
  case "$DOMAIN" in
    *example.com|*.local|localhost) die "DOMAIN=$DOMAIN is a placeholder — set the real public domain, or use --local to rehearse" ;;
  esac
  # Caddy's ACME challenge is answered on this host, so both names must resolve to it.
  # A mismatch is fatal, not a warning: Let's Encrypt rate-limits failed validations
  # (5 per hostname per hour), so letting Caddy retry against wrong DNS burns that budget.
  public_ip="$(curl -fsS --max-time 5 https://api.ipify.org || true)"
  for host in "$DOMAIN" "www.$DOMAIN"; do
    resolved="$(getent ahostsv4 "$host" | awk 'NR==1{print $1}')"
    [[ -n "$resolved" ]] || die "$host has no A record — point it at this host (${public_ip:-its public IP}) first"
    if [[ -n "$public_ip" && "$resolved" != "$public_ip" ]]; then
      die "$host resolves to $resolved but this host's public IP is $public_ip"
    fi
  done
fi

# Anything already on 80/443 that isn't this stack's own Caddy will make the caddy container
# fail to bind — detected here so the error names the port, not a container exit code.
for port in 80 443; do
  holder="$(docker ps --filter "publish=$port" --format '{{.Names}}' | grep -v caddy || true)"
  [[ -z "$holder" ]] || die "port $port is already published by container(s): $holder"
done

echo "domain:   $DOMAIN"
echo "provider: $provider"
echo "mode:     $( (( LOCAL )) && echo 'local rehearsal (tls internal)' || echo 'production (Let'"'"'s Encrypt)')"

# ── 2. Frontend bundle (deployment.md §3) ────────────────────────────────────────────
# Caddy serves ./frontend/dist from a read-only bind mount and never builds it itself.
step "Building the frontend bundle"
node_major="$(node -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' || true)"
if [[ -n "$node_major" ]] && (( node_major >= 22 )); then
  (cd frontend && npm ci --no-audit --no-fund && npm run build)
else
  # A bare VPS has no Node toolchain; build inside the same image the backend uses rather
  # than make the operator install one. --user keeps dist/ and node_modules/ owned by the
  # invoking user instead of root.
  docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD/frontend:/app" -w /app \
    node:22-bookworm-slim sh -c 'npm ci --no-audit --no-fund && npm run build'
fi
[[ -f frontend/dist/index.html ]] || die "frontend build produced no dist/index.html"

# ── 3. Resolve the compose config (deployment.md §4, first half) ─────────────────────
# Fails by name on any ${VAR:?} that is unset, before a single image builds.
step "Validating docker-compose.prod.yml against .env"
"${COMPOSE[@]}" config -q

# ── 4. Bring the stack up (deployment.md §4) ─────────────────────────────────────────
# minio-init is a one-shot and is run on its own, never under `up --wait`: verified live
# on Compose 2.40, `up --wait` exits 1 the moment any one-shot container exits — even with
# status 0 — so including it would report every successful deploy as a failure. `run --rm`
# gives the bucket creation an exit code that actually means something.
step "Starting MinIO and creating the page-image bucket"
"${COMPOSE[@]}" up -d --wait --wait-timeout 120 minio
"${COMPOSE[@]}" run --rm minio-init

# 600s: the vision service's healthcheck alone allows 120s start + 20×15s retries.
step "Building images and starting the stack (waits for every healthcheck)"
mapfile -t services < <("${COMPOSE[@]}" config --services | grep -vx minio-init)
"${COMPOSE[@]}" up -d --build --wait --wait-timeout 600 "${services[@]}"

# ── 5. Qdrant collections + tenant payload index (deployment.md §5) ──────────────────
# Run INSIDE the backend container: prod Qdrant publishes no host port, and on the host
# dotenv would load backend/.env (the dev config) instead of the compose environment.
step "Ensuring Qdrant collections and the userId tenant index"
"${COMPOSE[@]}" exec -T backend node scripts/setup-qdrant.js

# ── 6. Smoke test through Caddy ──────────────────────────────────────────────────────
step "Smoke test through Caddy"
CURL=(curl -fsS --max-time 15)
(( LOCAL )) && CURL+=(-k --resolve "$DOMAIN:443:127.0.0.1")

# Real ACME issuance can take a few seconds after Caddy reports healthy.
for i in {1..12}; do
  if health="$("${CURL[@]}" "https://$DOMAIN/api/health" 2>/dev/null)"; then break; fi
  (( i == 12 )) && die "https://$DOMAIN/api/health did not answer after 60s — check: ${COMPOSE[*]} logs caddy backend"
  sleep 5
done
echo "health:       $health"
echo "capabilities: $("${CURL[@]}" "https://$DOMAIN/api/auth/capabilities")"

index_cc="$("${CURL[@]}" -o /dev/null -D - "https://$DOMAIN/" | grep -i '^cache-control' | tr -d '\r' || true)"
[[ "$index_cc" == *no-store* ]] || warn "index.html is not served with Cache-Control: no-store (got '$index_cc')"

# ── Done — the steps that need a human ───────────────────────────────────────────────
admins="$(env_get ADMIN_EMAILS)"
first_admin="${admins%%,*}"
cat <<EOF

$(printf '\033[32m')Stack is up at https://$DOMAIN$(printf '\033[0m')

Remaining one-time steps (deployment.md §1, §6–9):

  1. OAuth callback URLs — add these to the Google / GitHub OAuth apps if not done yet:
       https://$DOMAIN/api/auth/google/callback
       https://$DOMAIN/api/auth/github/callback

  2. Sign up at https://$DOMAIN/signup as ${first_admin:-<an ADMIN_EMAILS address>}.

  3. Migrate any pre-tenancy documents to that account (dry run, then commit):
       ${COMPOSE[*]} exec -T backend node scripts/migrate-to-tenancy.js --user ${first_admin:-<email>}
       ${COMPOSE[*]} exec -T backend node scripts/migrate-to-tenancy.js --user ${first_admin:-<email>} --commit

  4. Sign in as a second account and confirm the first account's documents are invisible.

MinIO console (loopback only):  ssh -L 9001:127.0.0.1:9001 <this host>  →  http://localhost:9001
Logs:                           ${COMPOSE[*]} logs -f backend
EOF
