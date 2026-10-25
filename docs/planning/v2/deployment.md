# Cerebro v2 — Production Deployment (Phase 8 §4.4)

> A v2 companion to [../deployment.md](../deployment.md), which remains the accurate record of
> the v1 (Phase 6) local production verification. This document adds what v2 changes: OAuth app
> registration, the mail relay, Redis's new durability requirement, and — the one genuinely new
> constraint — a **one-way ordering** between bringing the stack up and opening it to more than
> one person. Steps 1–9 below are phase_8 §4.4's own numbered list, each expanded to what an
> operator actually types and what they should see.

**Short version:** steps 2–5 are automated by [`deploy.sh`](../../../deploy.sh) at the repo
root (task 8.20) — preflight checks, frontend build, `compose config`, `up --wait`, the Qdrant
index, and a smoke test through Caddy, stopping by name at the first failure. Steps 1 and 6–9
need a person in a browser; the script prints them, with the real domain filled in, when it
finishes. `./deploy.sh --local` rehearses the identical stack on a dev box via
`Caddyfile.verify`'s `tls internal`.

---

## 0. Host, DNS, firewall

**Host.** One Linux VM with Docker Engine + the Compose v2 plugin. Sizing, measured on the
rehearsal stack (2026-10-15, ColPali off): the seven containers idle at ~860 MB combined, and
the images total ~2.7 GB. The load peaks are a UMAP projection fit (backend, 2 GB limit —
measurements.md: ~31 s for 5k nodes) and Tesseract OCR on a scanned PDF (vision). So:
**2 vCPU / 4 GB RAM / 30 GB disk minimum, 4 vCPU / 8 GB recommended.** The compose memory
limits (≈16 GB summed) are ceilings, not reservations — they do not need to fit in RAM at
once. ColPali (`COLPALI_ENABLED=true`) is the exception: it needs a GPU host and ~6 GB for the
vision container alone (phase 4 §11).

**DNS.** Before the first deploy, create A records for **both** `DOMAIN` and `www.DOMAIN`
pointing at the host's public IP. `deploy.sh` refuses to start if either is missing or points
elsewhere: Caddy would otherwise retry ACME against the wrong address, and Let's Encrypt
allows 5 failed validations per hostname per hour — wrong DNS burns that budget and then
blocks the deploy for an hour after DNS is fixed.

**Firewall.** Open exactly 22, 80, 443:

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp      # SSH
sudo ufw allow 80/tcp      # ACME HTTP-01 challenge + http→https redirect
sudo ufw allow 443/tcp     # the app
sudo ufw enable
```

Docker-published ports bypass ufw's INPUT chain entirely, so the firewall is not what keeps the
internal services private — `docker-compose.prod.yml` is. Only `caddy` publishes 80/443 on all
interfaces; MinIO's console publishes on `127.0.0.1:9001` only (reach it with
`ssh -L 9001:127.0.0.1:9001 <host>`); Qdrant, Mongo, Redis, vision, the MinIO S3 API, and the
backend publish nothing.

---

## 1. Register the OAuth apps

Callback URLs must be **exactly**:

```
${PUBLIC_URL}/api/auth/google/callback
${PUBLIC_URL}/api/auth/github/callback
```

`PUBLIC_URL` is not a value you set directly in `.env` — `docker-compose.prod.yml`'s `backend`
service derives it as `https://${DOMAIN}` (phase_8 §4.2's amendment; see that file's header
comment on why a separate `PUBLIC_URL` entry was removed from `.env.example` rather than kept as
a second value that could drift from `DOMAIN`). So: register against `https://<your-domain>/api/
auth/google/callback`, not against whatever value a template might suggest.

- **Google**: console.cloud.google.com → APIs & Services → Credentials → Create OAuth client ID
  → Web application → Authorized redirect URI = the URL above. Copy the client ID/secret into
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
- **GitHub**: github.com/settings/developers → New OAuth App → Authorization callback URL = the
  URL above. The `user:email` scope is requested at authorize time by
  `auth/strategies/github.js`, not configured on the GitHub app itself — nothing to set there
  beyond the callback URL.

Leaving either pair blank is a supported, deliberate state: `GET /api/auth/capabilities` omits
the provider and the frontend hides its button (routes/auth.js's own comment) — a partial OAuth
rollout (one provider, or neither) is not a broken deployment.

## 2. Fill `.env`

Copy `.env.example` (repo root) to `.env` in the same directory. The backend **fails fast and
names anything missing** — `config/index.js`'s `REQUIRED` list is checked before the process
binds a port, so a missing `SESSION_SECRET` or `DOMAIN` surfaces as a clear startup error in
`docker compose logs backend`, not a silent 500 on the first request. Generate `SESSION_SECRET`
with `openssl rand -base64 48` (≥32 chars required, enforced separately from the presence check
— `config/index.js`'s own comment on why).

Two more decisions land here that weren't in v1:

- **Mail relay** (OTP delivery). `SMTP_HOST` blank disables email OTP entirely — not a
  degraded mode, an intentional absence: `GET /api/auth/capabilities`'s `otpChannels` omits
  `'email'` and the frontend never offers it. Set `SMTP_HOST`/`PORT`/`USER`/`PASS`/`MAIL_FROM`
  to a real relay (Mailtrap, Resend, SendGrid, or Gmail with an app password) to enable it. No
  `smtp` service is added to `docker-compose.prod.yml` — running an MTA is a deliverability
  project, not a deployment step (phase_8 §4.2).
- **Redis durability.** No `.env` action needed — `docker-compose.prod.yml`'s `redis` service
  already sets `--appendonly yes --maxmemory-policy noeviction` unconditionally (§4.2). Sessions
  and OTP codes live in this Redis now, not just the ingest queue, so this is not optional the
  way it was in v1.

## 3. Build the frontend

```bash
cd frontend && npm run build
```

Caddy serves `./frontend/dist` from a **read-only bind mount** (`docker-compose.prod.yml`'s
`caddy` service); it does not build the SPA itself. Verified live during this phase: the build
succeeds and produces two JS chunks over the 250 KB route-chunk budget architecture §8 sets —
see [measurements.md](measurements.md) §Frontend. That is a recorded FAILING budget, not a
blocker to deployment; the app is fully functional at this bundle size, just slower to first
paint than the target.

## 4. Bring the stack up

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

`docker-compose.prod.yml config` (no `up`) is worth running first against a new `.env` — it
resolves every `${VAR:?message}` and fails immediately, by name, on anything missing, before any
image builds or container starts. Verified live this phase with a fully-populated `.env`: the
config resolves cleanly, `PUBLIC_URL` correctly derives to `https://<DOMAIN>`, the Phase 8 quota
env vars land on the `backend` service, and Redis's `command:` carries `--appendonly yes
--maxmemory-policy noeviction` — all four confirmed by inspecting the resolved YAML directly.

**Verified live, this phase, with one caveat:** bringing the full stack up in this sandboxed
verification environment hit a transient DNS failure pulling `python:3.11-slim` for the
`vision` service's build (`registry-1.docker.io` did not resolve) — a network condition of this
sandbox, not a defect in the compose file or Dockerfile. Every other service's image (Qdrant,
Mongo, Redis, MinIO) pulled and started without incident. An operator on a host with normal
internet access will not hit this; it is recorded here because §2's discipline is to report a
failure with its real cause, not omit it.

**Amended (task 8.20):** `up --wait` over the whole file exits **1** on Compose 2.40 even when
everything is healthy — the one-shot `minio-init` container exiting (status 0) is itself
reported as a failure. Verified live. Harmless by hand, but any script or CI step checking the
exit code reads every successful deploy as failed. `deploy.sh` runs `minio-init` via
`compose run --rm` (a meaningful exit code) and passes `up --wait` every other service by name.

## 5. `setup-qdrant`

```bash
docker compose -f docker-compose.prod.yml exec -T backend node scripts/setup-qdrant.js
```

**Amended (task 8.20):** this step originally read `cd backend && npm run setup:qdrant`, run on
the host. Against the production stack that cannot work: prod Qdrant publishes no host port,
and on the host `dotenv` loads `backend/.env` — the *development* config — so the script either
fails to connect or, on a dev box with the dev stack up, silently indexes the wrong Qdrant. It
runs inside the `backend` container, which carries the compose environment and `scripts/`.

**Must follow step 4 and precede any ingest.** This creates the `is_tenant` payload index on
`userId` for both `cerebro_chunks` and `cerebro_pages` (`providers/vectorStore.js`'s
`ensureCollections`). Without it, a tenant-filtered query falls back to a full collection scan —
correct results, silently wrong latency: the 550 ms hard gate (phase_8 §2.2) fails with no
error anywhere pointing at the missing index as the cause. `setup:qdrant` is idempotent
(`ensureCollection`'s own existence check) — safe to re-run on every deploy.

## 6. Sign up the bootstrap admin

Through the normal `/signup` flow, using the exact address listed in `ADMIN_EMAILS`. The
migration script in step 7 **refuses to create a user** (phase_6 §7.1) — it moves existing
documents to a Default context for an account that must already exist, on purpose: a migration
that can silently create the very account it's about to grant data ownership to is a privilege-
escalation shape, not a convenience.

## 7–8. Run the tenancy migration — dry run, then commit

```bash
docker compose -f docker-compose.prod.yml exec -T backend node scripts/migrate-to-tenancy.js --user <bootstrap admin address>            # dry run
docker compose -f docker-compose.prod.yml exec -T backend node scripts/migrate-to-tenancy.js --user <bootstrap admin address> --commit
```

Inside the container for the same reason as step 5: from the repo root on the host, `dotenv`
loads the root `.env`, which has no `MONGO_URI`, and the script exits at config load.

Dry run first, always — it reports exactly what would move (document count, chunk count) without
writing anything, so a wrong `--user` value is caught before it does anything irreversible.

## 9. Verify isolation

Sign in as a **second** person (a different email, or the same address's OAuth identity if it's
linked) and confirm the first user's pre-migration documents are invisible — absent from
`/contexts`, and a search for content known to be in them returns zero results, not a filtered-
down partial match. This is `npm run test:tenancy`'s live-traffic equivalent, run by hand once
against the real production data instead of the synthetic fixture the automated suite uses.

---

## Why the ordering is one-way

Step 5 must precede any ingest — a document uploaded before the payload index exists still
"works" (it's queryable), just slowly and without the index that makes the tenant filter cheap;
there is no user-visible error to notice, only a benchmark that silently regresses. Steps 6–8
must precede opening the instance to anyone but the operator — until the migration runs, every
pre-existing document (from whatever single-tenant use predates this deployment) is invisible to
**everyone**, including its original owner, because it carries no `userId` payload field at all
and every query is tenant-filtered by construction (`vectorStore.js`'s `assertTenant`). Running
step 9 before step 6 would "verify" isolation against a state where nothing is visible to
anyone — a false pass, not a real one.

---

## Redis durability — the one behavior that changed since v1

Under v1, a Redis restart cost nothing more than a resumable BullMQ queue redrawing its jobs.
Under v2, the same restart **signs out every user and voids every in-flight password reset**
unless AOF persistence held — which is why `docker-compose.prod.yml`'s `redis` service sets
`--appendonly yes` unconditionally now, not as an operator option. `--maxmemory-policy
noeviction` is set alongside it for a related but distinct reason: the *default* policy
(`allkeys-lru`) evicts keys under memory pressure to make room for new ones, which for a queue
job is invisible (BullMQ retries) but for a session key means a signed-in user is logged out at
random with no error anywhere — `backend/src/redis.js`'s `assertNoEvictionPolicy()`, called at
every backend startup, is the safety net for an operator who later edits this file and removes
the flag by mistake: it logs a hard, specific warning naming exactly this consequence rather
than staying silent.

## Mail relay

No `smtp` service exists in `docker-compose.prod.yml` by design (phase_8 §4.2) — point
`SMTP_HOST` at a real external relay. A free tier is enough to operate this deployment:
Mailtrap's sandbox for a demo instance nobody outside the operator uses, or a low-volume
transactional provider (Resend, SendGrid) for a real one. Leaving it unset is a supported,
non-degraded state (§2 above) — password reset over SMS still works if `TWILIO_*` is set, and if
neither channel is configured, `forgot-password` still returns its standard 202 (never revealing
account existence) with no code actually issued.
