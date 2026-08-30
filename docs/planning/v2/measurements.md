# Phase 8 §2 — Performance Budget Measurements

> Hardware: Intel Core Ultra 5 125H (18 logical cores), 15 GiB RAM, local dev machine — NOT the
> reference production host. Node v22.20.0. Measured 2026-08-29. A budget that fails is
> recorded as failing, with the real measurement, not adjusted to match reality (§2's own rule).

## Status summary

| # | Surface | Status |
|---|---|---|
| 1 | Tenant-filtered hybrid retrieval (hard gate 1) | **NOT MEASURED** — blocked, see §Blocker below |
| 2 | recall@3 regression (hard gate 2) | **NOT RE-RUN this session** — `npm run test:retrieval` needs the same Cohere key; pre-existing baseline unaffected, not re-verified here |
| 3 | Auth surfaces (session probe, argon2, login, enumeration) | **Partially measured** — real numbers below |
| 4 | Traces (list/detail/BSON size) | **Not run this session** — code complete (`bench/v2/traces.bench.js`), not executed for time; no Cohere dependency, safe to run standalone |
| 5 | Projection (fit duration, payload, decode) | **Measured** — via `runFit()` directly against synthetic (non-Cohere) vectors, see below |
| 6 | Projection (project-query end-to-end) | **NOT MEASURED** — needs a live query embedding call, blocked by the same Cohere constraint |
| 7 | Frontend bundle size | **Measured, FAILS** |
| 8 | Frontend Lighthouse | **NOT MEASURED** — `lighthouse`/`chrome-launcher` not installed in this environment |
| 9 | Full containerized deployment (Caddy/TLS/CSP/quotas/metrics/Redis durability) | **Measured live**, see §Deployment verification |

## The blocker: Cohere trial key

`COHERE_API_KEY` in this project's `.env` is **Cohere trial tier — hard-capped at 1,000 API
calls/month total**, not a burst/per-minute limit that pacing can work around. Confirmed live
running `bench/v2/seed.js` (backed off 5s→10s→20s→40s→60s×4 before Cohere's own error body
resolved the cause): *"You are using a Trial key, which is limited to 1000 API calls / month."*
Seeding the 100,000-chunk tenancy corpus alone needs ~1,100 embed calls — more than the entire
monthly allowance by itself, before anything else this project has used the key for this month.

This blocks, specifically: `bench/v2/seed.js` (and therefore `tenancy.bench.js`'s hard-gate
measurement), `auth.bench.js`'s login-end-to-end/enumeration sections (blocked here by a
*different*, session-local constraint — see below), `projection.bench.js`'s corpus seeding and
`project-query` measurement, and `test:security`'s `promptInjection.test.js` (correctly detects
this and reports **BLOCKED**, not a false pass or fail — see that file).

**To actually run these**: obtain a production Cohere key (dashboard.cohere.com/api-keys) or
wait for the trial key's monthly window to reset, then:

```bash
cd backend
npm run bench:v2                        # seed.js -> tenancy.bench.js -> auth.bench.js -> ...
npm run test:security                   # includes promptInjection.test.js
```

## Auth surfaces — real measurements

`bench/v2/auth.bench.js`, 20 samples, against the live dev backend:

| Metric | Measured | Budget | Verdict |
|---|---|---|---|
| `GET /api/auth/session` (session probe) | p50 5.8 ms, p95 9.9 ms | < 15 ms p95 | **PASS** |
| argon2id hash time | p50 44.0 ms, p95 62.8 ms | 250–500 ms | **FAIL — too fast.** The configured parameters (`memoryCost: 19456, timeCost: 2, parallelism: 1`, `auth/password.js`) do not land in the stated band on this hardware; they land 4–8x below it. This is a real discrepancy worth a follow-up decision (raise `timeCost`/`memoryCost`?), not a measurement error — the same 20-sample run's numbers are consistent (min 42.7 ms, max 64.1 ms). |
| Login end-to-end (real credentials) | NOT MEASURED | < ~300 ms informal | Blocked — `auth/limits.js`'s `signupPerIp` (10/hour) was exhausted by this session's own iterative test-writing (session.test.js, csrf.test.js, enumeration.test.js, otp.test.js each create real users; re-run several times while debugging). Environmental to this session, not the auth stack — see `test/security/enumeration.test.js`'s own real run below, which DID complete before the budget ran out. |

`test/security/enumeration.test.js`, 15 samples/condition, real run, live:

| Metric | Measured |
|---|---|
| Existing-email wrong-password median | 54.8 ms |
| Unknown-email median | 53.8 ms |
| Gap | 1.8% (threshold 15%) — **PASS** |
| Bodies byte-identical | **true — PASS** |

## Projection — fit duration, payload size, decode time

Measured via `projection/fit.js`'s `runFit()` directly, against synthetic 1024-dim vectors
(uniform random) rather than real Cohere embeddings — this isolates the **compute cost** of the
UMAP fit and the packed-payload size, which do not depend on embeddings being semantically
meaningful (unlike the tenancy retrieval gate, which specifically measures Qdrant's `is_tenant`
filter behavior and does need a real, populated collection). `project-query` end-to-end (which
DOES need a real query embedding) was not measured — see the blocker above.

| Size | Fit duration | Budget | Verdict | Payload size | Budget (5k row) | Verdict | Decode time |
|---|---|---|---|---|---|---|---|
| 5,000 nodes | **30,979 ms (~31 s)** | < 15 s | **FAIL — 2.1x over** | **109,200 bytes (~107 KB)** | ≤ 100 KB | **FAIL — 6% over** | 0.119 ms |
| 20,000 nodes (`MAX_NODES`) | **112,509 ms (~112.5 s)** | < 60 s p95 (`ProjectionFitSlow` alert) | **FAIL — 1.9x over** | 449,200 bytes (~439 KB) | — (no stated budget at 20k) | — | 1.731 ms |

Both fit-duration budgets fail on this hardware, and by a margin too large to attribute to
"local dev machine is slower than production reference hardware" alone — architecture §8's own
comment on `MAX_NODES` already assumes the 5k budget is tight ("above this the fit exceeds the
15s budget"), and this measurement shows the 5k case itself already 2x over. This is a genuine,
reportable finding: either `PROJECTION_PARAMS`/`MAX_NODES` need revisiting, or the 15s/60s
figures need to be re-derived against real reference hardware rather than carried forward
unchanged from the original estimate. Not fixed in this pass — recorded as failing, per §2's
own rule against quietly adjusting a budget to match reality.

## Frontend bundle size

`bench/v2/frontend.bench.js`'s chunk-size half, real `npm run build` output:

| File | Size | Budget | Verdict |
|---|---|---|---|
| `index-*.js` (main) | 1,443,876 bytes (~1,410 KB) | ≤ 250 KB gzip-equivalent | **FAIL — 5.6x over** |
| `VectorSpace-*.js` | 854,493 bytes (~834 KB) | ≤ 250 KB gzip-equivalent | **FAIL — 3.3x over** (this one IS lazy-loaded per-route already — architecture §8's own note that R3F/`three` should be `/admin/vectors`-only; the failure is that even the lazy chunk alone is over budget, not that it loads on every route) |

Lighthouse (`/login`, `/chat` performance/accessibility scores) was **not measured** —
`lighthouse` and `chrome-launcher` are not installed as devDependencies in this environment.
`frontend.bench.js` degrades gracefully (reports the reason, does not fail the chunk-size half)
per its own header comment. Install with `cd backend && npm install --save-dev lighthouse
chrome-launcher` and re-run to get real Lighthouse numbers.

## Deployment verification — measured live, full containerized stack

Unlike the sections above, this WAS run end-to-end: `docker compose -f docker-compose.prod.yml
-f docker-compose.prod.verify.yml up -d --build` (the `.verify` override swaps only real ACME
for Caddy's local CA — see that file's header comment; every other line is the real, shipped
`docker-compose.prod.yml`/`Caddyfile`), against a real containerized backend, Caddy, MinIO,
Mongo, Qdrant, Redis, and vision service.

| Check | Result |
|---|---|
| `docker compose config` resolves with a filled `.env` | **PASS** — `PUBLIC_URL` correctly derives to `https://<DOMAIN>`, quota env vars land on `backend`, Redis `command:` carries `--appendonly yes --maxmemory-policy noeviction` |
| `docker compose up -d --build` reaches all containers healthy | **PASS**, after fixing one real bug below |
| Canonical-host redirect, `www.{$DOMAIN}` → `{$DOMAIN}`, over HTTPS | **Found broken, then fixed and re-verified.** The Caddyfile originally declared the site address as `{$DOMAIN}` alone — Caddy's automatic HTTPS then only provisions/serves a certificate for that one hostname, so a request to `https://www.{$DOMAIN}` fails the TLS handshake itself (`tlsv1 alert internal error`) before the `@wrongHost` redirect logic ever runs; the redirect only worked over plain HTTP. Fixed by listing both hostnames on the site address line (`{$DOMAIN}, www.{$DOMAIN} {`), in both `Caddyfile` and `Caddyfile.verify`. Re-verified: `curl -sk --resolve www.cerebro.local:443:127.0.0.1 https://www.cerebro.local/some/path` now returns `301` with `location: https://cerebro.local/some/path`. |
| CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy on the SPA response | **PASS** — all five present on `GET /` through Caddy over TLS |
| `/admin/vectors` gets the widened `worker-src 'self' blob:` CSP; other routes don't | **PASS** |
| `/index.html` is `Cache-Control: no-store`; `/assets/*` is `public, max-age=31536000, immutable` | **PASS** |
| `/api/*` proxies correctly (`GET /api/health` → 200) | **PASS** |
| `/metrics` is unreachable through Caddy (falls through to the SPA shell, not the real Prometheus text) | **PASS** — `curl https://cerebro.local/metrics` returns `index.html`, confirmed by content, not just status code |
| `/metrics` reachable inside the Docker network, exposes the five new families, zero `userId` labels | **PASS** — checked from inside the `backend` container itself: `cerebro_active_tenants` present, 0 lines contain `userId` |
| Real signup against the containerized stack | **PASS** — `POST https://cerebro.local/api/auth/signup` → 202, session cookie set, `GET /api/auth/session` returns the user |
| **Redis restart — every signed-in browser stays signed in** | **PASS, verified live**: signed up, confirmed session valid, ran `docker restart cerebro-redis-1`, re-checked the SAME session cookie — still returns the authenticated user. AOF persistence holds exactly as claimed. |
| `noeviction` startup assertion | **PASS, verified live earlier** (against the dev stack, not re-run in prod): flipped Redis to `allkeys-lru`, restarted the backend, confirmed the exact hard-warning log line naming session eviction as the consequence; flipped back, confirmed silence. |

One environment-specific note, not a defect: the first `docker compose build` attempt for the
`vision` service hit a transient DNS failure resolving `registry-1.docker.io` in this sandbox; a
retry succeeded cleanly. An operator on a host with normal internet access will not see this.

## Not measured this session, with the exact command to run them

```bash
# Requires a production (non-trial) Cohere key:
cd backend && npm run bench:v2

# No Cohere dependency — safe to run any time, just not run this session for time:
node bench/v2/traces.bench.js

# Requires: npm install --save-dev lighthouse chrome-launcher
node bench/v2/frontend.bench.js   # re-run for the Lighthouse half specifically

# Full security suite — safe to run any time; this session's own repeated manual runs
# exhausted signupPerIp (10/hour) mid-suite on the FINAL file (promptInjection.test.js),
# which correctly reports BLOCKED rather than a false failure:
npm run test:security
```
