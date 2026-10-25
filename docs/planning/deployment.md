# Cerebro — Local Production Deployment Plan

> Runbook for bringing up the Phase 6 production stack (`docker-compose.prod.yml`, `Caddyfile`)
> on this machine. Companion to [phase_6_polish_production.md](phase_6_polish_production.md) §8,
> which specifies the stack; this document specifies *the deployment of it, here, today*, against
> the environment as it actually is.

---

## 1. Objective

Bring up the full production topology — Caddy terminating TLS on :443, serving the built React
bundle and reverse-proxying `/api/*` to a containerized Node backend, which talks to Qdrant,
MongoDB, Redis, MinIO, and the Python vision service over an internal Docker network — as a
**self-contained second stack that runs alongside the existing development stack without
disturbing it**.

By the end of this deployment: opening `https://$DOMAIN` in a browser loads the Cerebro chat UI
over HTTPS, a document uploaded through it is ingested by the containerized backend into the
production Qdrant, and a question asked about that document streams a grounded answer with
citations — with the dev stack (`docker compose up -d` + `npm run dev`) still running and still
working, untouched.

**This is not a public internet deployment.** No public DNS, no Let's Encrypt certificate, no
remote host, no CI/CD, no domain registration. The stack is production-*shaped* — real reverse
proxy, real TLS, real container isolation, real resource limits, real S3-API object storage —
running on localhost. Everything that differs from a real public deploy is named in §4.2 and §8.

---

## 2. Preflight — Environment As Verified

Every row below was checked live on 2026-08-17 before this plan was written. Nothing here is
assumed.

| Fact | Verified value | Command used |
|---|---|---|
| Ports 80, 443 | **Free** | `ss -tln` — no listener on either |
| Port 9001 (MinIO console) | **Free** | `ss -tln` |
| `frontend/dist/` | **Exists**, built 17:46 today, after the Ingestion/Reliability page deletions | `ls -la frontend/dist` |
| `DOMAIN` in `.env` | Set, an **mDNS `.local` name**, **does not resolve** on this host | `getent hosts $DOMAIN` → no entry |
| `COHERE_API_KEY`, `LLAMA_CLOUD_API_KEY` | Set | presence check, values not read |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | Set | presence check |
| `ANTHROPIC_API_KEY` | **Empty** | presence check |
| `LLM_PROVIDER` | `ollama` in `.env` today — **being switched to `groq`**, see §3.4 | `.env` |
| Host Ollama :11434 | Up, serving `llama3:latest` — moot once `LLM_PROVIDER=groq` (§3.4) | `curl localhost:11434/api/tags` |
| `GROQ_API_KEY` | **Not yet set** — operator must obtain one, see §3.4 | presence check |
| `@langchain/groq` | Added to `backend/package.json` this session; not yet in the built container image | `grep groq backend/package.json` |
| Compose project name, dev **and** prod file | Both resolve to **`cerebro`** | `docker compose -f <file> config \| grep '^name:'` |
| Existing volumes | `cerebro_qdrant_data`, `cerebro_mongo_data`, `cerebro_redis_data`, `cerebro_hf_cache` | `docker volume ls` |
| Dev stack right now | mongo, qdrant, redis, vision — all `Up (healthy)`, publishing 27017/6333-6334/6379/8100 | `docker compose ps` |
| Collection bootstrap in prod stack | **Absent** — no service runs `setup:qdrant` | `grep setup docker-compose.prod.yml` |
| `/metrics` route path | Bare `/metrics`, no `/api` prefix | `routes/metrics.js:14` |
| `/health` route paths | Both `/health` and `/api/health` | `routes/health.js:104-105` |

---

## 3. The Four Blockers, and the Decision on Each

A naive `docker compose -f docker-compose.prod.yml up -d --wait` fails or does damage for four
independent reasons. Each is decided below rather than discovered during the run.

### 3.1 Project-Name Collision Would Destroy the Running Dev Stack — Deploy Under `-p cerebro-prod`

Both `docker-compose.yml` and `docker-compose.prod.yml` live in the same directory, so Compose
derives the same project name — `cerebro` — for both. Service names collide too (`mongo`,
`qdrant`, `redis`, `vision` appear in both files). Running the prod file as-is does not create a
second stack; it **reconciles the existing one into the prod definition**: it recreates those four
running containers, and because the prod file publishes none of their host ports, the dev stack's
`27017 / 6333-6334 / 6379 / 8100` bindings disappear. The locally-running `npm run dev` backend on
:5000 reaches all of those over `localhost` and would break on the next request — as would the
Vite dev server proxying to it.

**Decision: deploy under an explicit separate project, `-p cerebro-prod`.** Compose then namespaces
containers, network, and volumes independently (`cerebro-prod_qdrant_data`, etc.), and since the
prod file publishes only 80/443/9001 — all free — the two stacks coexist with zero port contention.

The accepted cost is the deliberate half of this decision: **a separate project gets fresh, empty
volumes.** The prod stack starts with an empty MongoDB, an empty Qdrant with no collections, and an
empty MinIO bucket. The dev corpus (6 chunks, 18 completed jobs) does not carry over. For a
showcase deployment that is the correct default — the deployed instance demonstrates ingestion
working end-to-end rather than inheriting a half-populated dev database whose provenance nobody can
explain. §5 step 5 re-creates the collections; §5 step 7 ingests a document into it.

Rejected alternative: mapping the dev volumes into the prod project as `external: true`. It would
carry the data over, but it puts two independently-configured stacks on one Qdrant storage
directory, where a schema change or a `setup:qdrant` run in one silently rewrites the other's
index. The isolation is the entire point of the separate project; sharing the volumes gives it
back.

### 3.2 A `.local` Domain Cannot Get a Let's Encrypt Certificate — Use the `tls internal` Override

The shipped `Caddyfile` relies on Caddy's automatic HTTPS, which means ACME against Let's Encrypt.
That requires a publicly-resolvable DNS record pointing at a publicly-reachable IP, because both
the HTTP-01 and TLS-ALPN-01 challenges are inbound connections from Let's Encrypt's servers.
`$DOMAIN` here is an mDNS `.local` name that does not resolve even on this machine. Public issuance
is not slow or awkward in this environment — it is impossible.

**Decision: deploy with the repo's existing verification override**, `docker-compose.prod.verify.yml`,
which swaps in `Caddyfile.verify`. That file is byte-identical to the production `Caddyfile` except
for one added line, `tls internal`, which issues the certificate from Caddy's own local CA. The
`/api/*` routing, the non-stripping `handle` block, the `flush_interval -1` SSE behavior, and the
SPA catch-all are all exercised exactly as shipped. Only the certificate's issuer differs.

Both files carry header comments stating they exist for precisely this case, so this is using the
repo as designed, not working around it.

Consequence: browsers show an untrusted-certificate warning, and `curl` needs `-k`. That is the
correct and expected signal from a private CA — it is not a misconfiguration, and it must not be
"fixed" by disabling TLS.

### 3.3 Nothing Resolves `$DOMAIN` — Add a Hosts Entry

Caddy matches the request's `Host` header against `$DOMAIN`, so the browser must both resolve that
name and send it. `.local` resolution depends on an mDNS responder (Avahi) publishing it; nothing
publishes this name today, and `getent hosts` returns nothing.

**Decision: add one line to `/etc/hosts` mapping `$DOMAIN` to `127.0.0.1`.** This is the only step
in the entire deployment that needs `sudo` and the only one that writes outside the project
directory, so it is called out separately in §5 as an operator action rather than folded into a
script. Requesting a name from `/etc/hosts` bypasses mDNS entirely and is deterministic.

### 3.4 Ollama Makes Every Deployer Run Their Own Inference Host — Switch to Groq

`LLM_PROVIDER=ollama` in `.env` today, and `ANTHROPIC_API_KEY` is empty, so as found this
deployment had exactly one working generation path: the host's local Ollama. That is a real
architectural cost, not just a local inconvenience — `providers/llm.js` reaches Ollama over
`host.docker.internal`, meaning **the machine running the containers must also be a capable
inference host with the right model already pulled.** Anyone else who deploys this stack —
another machine, a teammate, a future cloud host — would need to separately install Ollama and
pull a multi-gigabyte model before generation works at all, and the model actually available here
(`llama3:latest`) doesn't even match the prod compose's default (`llama3.2-vision:11b`), so it
was already a step from failing outright (§8's `OLLAMA_MODEL` row records that specific failure
mode for anyone who *does* stay on this path).

**Decision: add Groq as a third `LLM_PROVIDER` and switch to it for this deployment.** Groq is a
hosted, OpenAI-compatible chat completions API with a genuine free tier — no card, 30,000
tokens/min, 14,400 requests/day on the models this project targets (verified live against Groq's
current published limits, 2026-08-17). That puts it in the same operational category as the
Anthropic path: an API key is the only host-specific setup, and the same key works from any
machine. `@langchain/groq`'s `ChatGroq` is a drop-in `BaseChatModel`, so it slots into the existing
single-factory pattern (`chatModel()` in `providers/llm.js`, architecture §5.8) as a third branch
next to `ChatAnthropic`/`ChatOllama` — small and mechanical, no new architecture, consistent with
this repo's CLAUDE.md exit condition for a scoped extension of an already-declared extensibility
point rather than a new subsystem needing its own spec.

Concretely, this session added:

| File | Change |
|---|---|
| `backend/package.json` | `@langchain/groq` dependency |
| `backend/src/config/index.js` | `config.llm.groq = { apiKey, model }`; fail-fast if `LLM_PROVIDER=groq` and the key is unset, mirroring the existing Anthropic check |
| `backend/src/providers/llm.js` | `chatModel()` gains a `groq` branch; `supportsVision()` recognizes Groq's vision-capable model names (`scout`/`maverick`) |
| `.env.example`, `backend/.env.example` | `GROQ_API_KEY=`, `GROQ_MODEL=openai/gpt-oss-120b` |
| `docker-compose.prod.yml` | backend service forwards `GROQ_API_KEY`/`GROQ_MODEL` |

**Decision on the default model, amended after live verification: `openai/gpt-oss-120b`, not
`llama-3.3-70b-versatile`.** The first pass of this plan defaulted to `llama-3.3-70b-versatile` on
the strength of Groq's public docs and third-party pricing pages describing it as a current
free-tier model. That was wrong for this project's actual key: `GET /openai/v1/models` against it
(verified live, 2026-08-17) lists no `llama-3.x` or `llama-4` model at all — the account's real
lineup is `groq/compound(-mini)` (agentic, does its own tool use/web search — wrong fit, see
below), `openai/gpt-oss-20b`/`120b`, `qwen/qwen3.6-27b`, `allam-2-7b`, plus audio/guard models. A
direct call to the assumed model name failed fast (`400 model_not_found`) — cheap to catch in
isolation, but the same misconfiguration inside the app didn't fail fast at all: `config/index.js`
had no independent way to know the name was wrong, so the app kept running against whatever
`LLM_PROVIDER` its already-loaded env actually held. In practice that meant a still-running dev
backend process kept serving from **Ollama** — a stale second `.env` copy that this whole `groq`
change had never reached (§8's `two .env files` row) — while every symptom (slow generation, a
real cited answer eventually arriving) looked consistent with "Groq is just slow," and would have
been reported as verified Groq behavior if the actual provider in use hadn't been checked
directly. The lesson generalizes past this one deployment: **treat a model name from documentation
as unverified until confirmed against the live account's own `/models` endpoint**, and when a
component's behavior looks plausible, confirm what's actually serving the request rather than
what's configured to.

`groq/compound`/`compound-mini` were considered and rejected: `usage_breakdown` on a real response
shows they're Groq's own agentic system, internally orchestrating tool calls (web search among
them) on top of an underlying model — the wrong shape for this app's grounding guarantee
(architecture §5.7: the model must answer only from the sources it's given, source content is
data never instructions, no tools). `openai/gpt-oss-120b` is a plain chat-completions model with
no built-in tool use, confirmed live to return correct, on-topic content once `maxTokens` clears
its reasoning-token overhead (see `providers/llm.js`'s `VISION_MODEL_PATTERN` comment) — the right
fit and the new default. It is also text-only, which was the point of the original (wrong-model)
decision and still holds: `supportsVision()` correctly reports no vision support for it, so
`generate.js` omits image blocks and falls back to OCR text — the same degraded-but-working
behavior this section originally accepted for `llama3` under Ollama, just via the right model this
time. `COLPALI_ENABLED=false` in the prod compose means this doesn't matter for this deployment
anyway — `cerebro_pages` stays empty regardless of which text model is configured.

Ollama is **not removed** — it remains a valid third option in the code, useful precisely when a
deployment *wants* the fully-offline property (no network dependency at all) and is willing to pay
for it in per-host setup. This deployment just isn't optimizing for that property.

**What the operator must still do, which I cannot do myself:** obtain a free key at
`console.groq.com` and set `GROQ_API_KEY` (and `LLM_PROVIDER=groq`) in `.env` — see §5 step 1. I do
not have the ability to sign up for third-party services or hold API keys on the user's behalf, and
`.env` is not edited without explicit instruction.


### 3.5 Gemini as a Fourth `LLM_PROVIDER` (amended 2026-10-15)

**Decision: add Google Gemini as a fourth provider, selected the same way as the others —
`LLM_PROVIDER=gemini` plus `GEMINI_API_KEY`.** Gemini has Groq's key-only shape (no local
model, no `host.docker.internal`), and adds what Groq's default lacks: every current Gemini
model takes images, so `supportsVision()` returns `true` and scanned-page sources are read
from the page JPEG rather than from OCR text alone (phase 5 §7.3). The model is
`GEMINI_MODEL`, default `gemini-2.5-flash` — chosen for free-tier availability, latency, and
native image input. As with Groq (§3.4), the reachable model list is per key: confirm with
`GET https://generativelanguage.googleapis.com/v1beta/models` (header `x-goog-api-key`)
before changing it.

| File | Change |
|---|---|
| `backend/package.json` | `@langchain/google-genai` `~2.2.0` — the newest release whose peer range (`@langchain/core ^1.2.0`) accepts the installed core 1.2.8; 2.3.x requires core ≥1.2.9 |
| `backend/src/config/index.js` | `config.llm.gemini = { apiKey, model }`; fail-fast if `LLM_PROVIDER=gemini` and the key is unset |
| `backend/src/providers/llm.js` | `chatModel()` gains a `gemini` branch; `maxOutputTokens = maxTokens + GEMINI_THINKING_HEADROOM (4096)`, because Gemini 2.5+ thinks inside the output budget — the failure mode that emptied every gpt-oss condense call at 150 tokens |
| `backend/src/graph/nodes/generate.js` | streams `chunk.text` instead of `chunk.content` (Gemini may stream an array of parts); trace `model` now read from the active provider's block (was "anthropic, else ollama", which mislabeled every Groq trace) |
| `.env.example`, `backend/.env.example` | `GEMINI_API_KEY=`, `GEMINI_MODEL=gemini-2.5-flash` |
| `docker-compose.prod.yml` | backend service forwards `GEMINI_API_KEY`/`GEMINI_MODEL` |

**Key.** Create one at `aistudio.google.com/apikey` (a key dedicated to Cerebro, so revoking
it never breaks another app sharing the AI Studio project). Set `LLM_PROVIDER=gemini` and
`GEMINI_API_KEY` in **both** `.env` files for the same reason §5 step 1 gives for Groq: the dev
backend reads `backend/.env`, the production stack reads the root `.env`.

**Free tier.** The AI Studio project this deployment's key lives in has billing disabled
(`gcloud billing projects describe` → `billingEnabled: false`), so requests are subject to
the Gemini free tier's per-model requests-per-minute and requests-per-day limits, shown in AI
Studio. Each question costs two calls (condense + generate). Google's terms for unpaid
Gemini API use have historically allowed submitted content to be used to improve Google's
products — review the current terms before pointing a multi-user deployment, whose users
upload private documents, at a free-tier key; a billing-enabled key is the alternative.

**Verification status.** Wiring verified without a key: the adapter constructs with the
configured model, `supportsVision()` reports `true`, and a call with a placeholder key reaches
`.../v1beta/models/gemini-2.5-flash:generateContent` and is rejected `400 API key not valid`.
A generation with a real key, and the thinking headroom against live usage metadata, are the
remaining checks once `GEMINI_API_KEY` is set.

---

## 4. What This Deployment Does and Does Not Prove

### 4.1 Genuinely exercised

| Capability | Why it is real here |
|---|---|
| Multi-stage container build | `backend/Dockerfile` compiles the C++ addon in a toolchain image and ships a slim runtime as an unprivileged `cerebro` user |
| Reverse-proxy routing | Caddy's `handle /api/*` non-stripping block — the exact bug Phase 6 §16.6 found and fixed — is in the request path for every API call |
| SSE through a proxy | `flush_interval -1` streams `/api/ask` token-by-token through Caddy, which local dev never tests because nothing proxies there |
| TLS termination | Real certificate, real handshake, real HTTPS — from a private CA rather than a public one |
| S3-API object storage | `STORAGE_DRIVER=s3` against MinIO; page images travel the vision → shared scratch volume → `syncPageImagesToStorage` → S3 path (§16.4) |
| Container health gating | `depends_on: service_healthy` across six services; `--wait` blocks until the whole graph is up |
| Resource limits | Per-service memory ceilings, so an OOM takes one container rather than the host |
| CORS allowlist | `CORS_ALLOWED_ORIGINS=https://$DOMAIN`, enforced by the backend against the real browser origin |
| Hosted, host-independent generation | Groq API over HTTPS with an API key — no local model, no `host.docker.internal` dependency (§3.4) |

### 4.2 Explicitly not proven

| Not proven | Why |
|---|---|
| Public ACME/Let's Encrypt issuance | No public DNS or reachable IP (§3.2) |
| Behavior under real network latency or loss | Everything is loopback |
| Multi-host or replicated operation | Single Docker host, single replica of each service |
| ColPali visual retrieval | `COLPALI_ENABLED=false` (§3.4) |
| Vision-model generation from page images | Default Groq model is text-only by deliberate choice (§3.4) |
| Ollama generation path | Superseded by Groq for this deployment; code path still exists (§3.4) |
| Anthropic generation path | No API key present |
| LangSmith tracing | `LANGCHAIN_TRACING_V2` defaults to `false`; `LANGCHAIN_API_KEY` empty |
| Load, concurrency, or sustained throughput | Out of scope; the benchmark harness (`bench/`) covers retrieval latency separately. Groq's free-tier ceiling (30k tokens/min, 14.4k requests/day) is also untested here — fine for a demo, a real constraint for anything busier |

---

## 5. Deployment Procedure

Run from the repo root, `/home/mightylord77/Documents/cerebro`, in order. Steps 1–2 are operator
actions requiring judgment or `sudo`; 3–8 are mechanical.

**Step 1 — Switch to Groq (operator edits `.env` — both of them, see the warning below).** Get a
free key at `console.groq.com` → API Keys, then set:

```
LLM_PROVIDER=groq
GROQ_API_KEY=<the key just created>
```

`GROQ_MODEL` needs no entry unless overriding the default — see §3.4's amendment for why it's
`openai/gpt-oss-120b`, not the originally-assumed `llama-3.3-70b-versatile`.

> **There are two `.env` files, and they silently diverge.** Root `.env` is what
> `docker-compose*.yml` interpolates `${VAR}` from — it's what this whole plan has otherwise been
> talking about. But `backend/.env` is a *separate* file, and it's the one `dotenv/config` actually
> loads when the backend runs locally via `cd backend && npm run dev` (dotenv resolves `.env`
> relative to `process.cwd()`, and that command's cwd is `backend/`). This deployment's own dry
> run hit this directly: root `.env` was updated first, `backend/.env` was not, and the running
> dev backend kept serving from `LLM_PROVIDER=ollama` — silently, successfully, and slowly (§8) —
> while every visible signal looked like verified Groq behavior. **Edit the LLM block in both
> files identically before testing anything.** This only matters for local `npm run dev`; the
> Docker Compose paths in this plan (§5 step 4 onward) read only root `.env` and are unaffected.

**Step 2 — Point the domain at loopback (operator, needs `sudo`).**

```bash
echo "127.0.0.1  $(grep -E '^DOMAIN=' .env | cut -d= -f2-)" | sudo tee -a /etc/hosts
```

Verify with `getent hosts <domain>` — it must now return `127.0.0.1`. Rationale in §3.3.

**Step 3 — Rebuild the frontend bundle.**

```bash
cd frontend && npm run build && cd ..
```

`frontend/dist/` is current as of 17:46 today, but Caddy bind-mounts this directory read-only and
serves whatever is in it — rebuilding costs ~4 s and removes any doubt that the deployed bundle is
the one without the deleted Ingestion/Reliability pages.

**Step 4 — Bring up the stack.**

```bash
docker compose -p cerebro-prod \
  -f docker-compose.prod.yml \
  -f docker-compose.prod.verify.yml \
  up -d --build --wait
```

`-p cerebro-prod` per §3.1; the second `-f` per §3.2. `--build` compiles the backend image
(C++ addon + `npm ci --legacy-peer-deps`) and the vision image; Docker's layer cache is **not**
warm for the backend's dependency layer this run specifically — `@langchain/groq` was added to
`package.json` this session (§3.4), which invalidates the cached `npm ci` layer regardless of
whether an image was built before. Expect the full few minutes on that layer; everything after is
near-instant reuse. `--wait` blocks until every service reports healthy and treats the
`minio-init` one-shot as satisfied when it exits 0.

**Step 5 — Create the Qdrant collections.**

```bash
docker compose -p cerebro-prod -f docker-compose.prod.yml \
  exec backend node scripts/setup-qdrant.js
```

The prod stack contains no bootstrap service (§2), and this project's Qdrant volume is new and
empty (§3.1). The script is idempotent — it creates `cerebro_chunks` and `cerebro_pages` if absent
and is safe to re-run. Without it, ingestion fails at the upsert with a collection-not-found error.

**Step 6 — Confirm the stack is healthy.** Run §6's acceptance table.

**Step 7 — Seed one document.** Through the browser at `https://$DOMAIN`, upload a PDF and wait for
`ready`. This is what makes step 8 meaningful; the corpus is empty until it happens (§3.1).

**Step 8 — Ask a question about it** and confirm a streamed, cited answer. Groq's hosted inference
means generation is no longer the slow leg — expect first token within a couple of seconds once
retrieval and rerank finish.

---

## 6. Acceptance Criteria

Each row is checkable in under a minute. `-k` throughout, because the certificate is from Caddy's
internal CA (§3.2).

| # | Check | Command | Pass condition |
|---|---|---|---|
| D.1 | All services healthy | `docker compose -p cerebro-prod -f docker-compose.prod.yml ps` | qdrant, mongo, redis, vision, backend, minio, caddy all `Up (healthy)`; `minio-init` `Exited (0)` |
| D.2 | Dev stack undisturbed | `docker compose ps` | The four dev containers still `Up (healthy)`, still publishing 27017/6333-6334/6379/8100 |
| D.3 | Domain resolves | `getent hosts $DOMAIN` | Returns `127.0.0.1` |
| D.4 | TLS handshake succeeds | `curl -kIs https://$DOMAIN/ \| head -1` | `HTTP/2 200` |
| D.5 | Certificate is from the internal CA | `curl -kv https://$DOMAIN/ 2>&1 \| grep -i issuer` | Issuer names Caddy's local authority, not Let's Encrypt |
| D.6 | SPA is served | `curl -ks https://$DOMAIN/ \| grep -c '<div id="root"'` | `1` |
| D.7 | SPA deep link falls through | `curl -kIs https://$DOMAIN/advanced \| head -1` | `HTTP/2 200` (the `try_files` catch-all, not a 404) |
| D.8 | API prefix reaches the backend intact | `curl -ks https://$DOMAIN/api/health \| head -c 120` | JSON with a `"status"` field — **not** `Cannot GET /health` (the §16.6 regression) |
| D.9 | Backend reports its dependencies up | `curl -ks https://$DOMAIN/api/health` | `dependencies` shows mongo, qdrant, redis, vision `up`; overall `status` is `up` or `degraded` |
| D.10 | Collections exist and are empty | `curl -ks https://$DOMAIN/api/health` | `collections` contains `cerebro_chunks: 0` and `cerebro_pages: 0` |
| D.11 | `/metrics` is not exposed publicly | `curl -ks https://$DOMAIN/metrics \| head -c 60` | HTML (the SPA), **not** Prometheus text — Caddy proxies only `/api/*`, and metrics is at bare `/metrics` |
| D.12 | MinIO console reachable, S3 API not | `curl -Is http://localhost:9001 \| head -1` then `curl -Is http://localhost:9000` | 9001 responds; 9000 refuses — it is unpublished by design |
| D.13 | Bucket was created | `docker compose -p cerebro-prod -f docker-compose.prod.yml logs minio-init` | Shows `cerebro-pages` created or already existing, exit 0 |
| D.14 | Ingestion works end to end | Upload a PDF at `https://$DOMAIN` | Document reaches `ready`; `/api/health`'s `cerebro_chunks` count rises above 0 |
| D.15 | Page images landed in S3 | MinIO console → `cerebro-pages` bucket | Objects present if the document had visual pages; empty bucket is correct for a pure-text PDF |
| D.16 | SSE streams through Caddy | Ask a question in the UI | Tokens appear incrementally, not as one block after a long pause — this is what `flush_interval -1` exists for |
| D.17 | Answer is grounded and cited | Same question | Source chips render and name the uploaded document |
| D.18 | Volumes are namespaced to this project | `docker volume ls \| grep cerebro-prod` | Eight `cerebro-prod_*` volumes exist, distinct from the four `cerebro_*` dev volumes |

---

## 7. Milestone Definition

Deployment is **complete** when:

> The operator adds one line to `/etc/hosts`, runs `npm run build` in `frontend/`, and issues a
> single `docker compose -p cerebro-prod ... up -d --build --wait`. Compose builds the backend
> image — compiling the AVX2 addon in a toolchain stage and shipping a slim runtime that runs as
> the unprivileged `cerebro` user — then starts eight services in dependency order, blocking until
> Qdrant, Mongo, Redis, MinIO, and the vision service each report healthy, MinIO's one-shot
> initializer creates the `cerebro-pages` bucket and exits 0, the backend passes its own `/health`
> probe, and finally Caddy comes up on :80 and :443. The operator runs `setup-qdrant.js` once
> inside the backend container; it creates `cerebro_chunks` and `cerebro_pages`. In another
> terminal, `docker compose ps` still shows the four development containers running and still
> publishing their ports — the dev backend on :5000 answers a request as it did before. The
> operator opens `https://$DOMAIN` in a browser, clicks through the certificate warning (Caddy's
> local CA, as intended), and lands on the Cerebro chat UI with a sidebar of exactly three
> entries — Consumer Chat, Advanced Trace, Vector Map. They drag a PDF onto the page; the
> ingestion zone moves from queued to processing to complete with a real chunk count, and the
> System Health panel on `/advanced` shows `cerebro_chunks` climbing from 0 and the ingest queue's
> `completed` count incrementing. They ask a question about the document. Retrieval, rerank, and
> the Groq API round trip land within a couple of seconds — no local CPU-bound generation in the
> path — and tokens begin arriving one at a time rather than in a single block, proving
> `flush_interval -1` is doing its job through the proxy, and source chips appear naming the file
> they just uploaded.

---

## 8. Failure Modes

| Symptom | Cause | Response |
|---|---|---|
| `up` recreates dev containers, dev backend breaks | `-p cerebro-prod` omitted (§3.1) | `docker compose -p cerebro-prod down`, then `docker compose up -d` to restore the dev stack from its own file. Volumes are unaffected either way |
| Caddy loops on ACME failures, never healthy | Deployed without `-f docker-compose.prod.verify.yml` (§3.2) | Bring the stack down and re-run with both `-f` flags |
| Browser cannot reach `$DOMAIN` at all | `/etc/hosts` entry missing (§3.3) | Add it; verify with `getent hosts` |
| Every API call returns `Cannot GET /health` | Caddy stripping the `/api` prefix — the §16.6 regression | Confirm the Caddyfile in use has `handle /api/*`, not `handle_path` |
| Backend exits at boot: `LLM_PROVIDER=groq requires GROQ_API_KEY` | `.env` still has `LLM_PROVIDER=groq` from a prior attempt but no key, or step 1 was skipped entirely | Set both `LLM_PROVIDER=groq` and a real `GROQ_API_KEY` together (§5 step 1) |
| Generation calls fail with a Groq 401/403 | Key invalid, revoked, or copied with whitespace | Regenerate the key at `console.groq.com` and reset `GROQ_API_KEY` |
| Generation calls fail with a Groq 429 | Free-tier rate ceiling hit (30k tokens/min or 14.4k requests/day, §4.2) | Expected only under sustained/bursty demo traffic, not a single Q&A session; wait out the window or reduce request volume |
| A raw `curl` to Groq 400s with `model_not_found` | Model name isn't on this account regardless of what's documented publicly | Check `GET https://api.groq.com/openai/v1/models` with the real key, pick a listed model, set `GROQ_MODEL` (§3.4's amendment) |
| Generation "works" but is suspiciously slow (tens of seconds+) for a hosted API | Almost certainly not actually hitting Groq — check `backend/.env` (local dev) still says `LLM_PROVIDER=ollama`/has no `GROQ_API_KEY` (§5 step 1's warning); the request silently succeeded via Ollama instead | Fix `backend/.env` to match root `.env`, then **restart the backend process** — `dotenv` only loads at startup, editing `.env` while it's running does nothing until it's relaunched |
| A local `npm run dev` backend answers with the old provider after editing `.env` | Same as above — edited the wrong file, or edited the right file but didn't restart | Confirm which `.env` the running process actually loaded (`backend/.env` for `npm run dev`) and restart it |
| Ingestion fails at upsert, collection not found | Step 5 skipped (§5) | Run `setup-qdrant.js` in the backend container |
| Backend container exits immediately at boot (other cause) | `config/index.js` fail-fast on some other missing required key | `docker compose -p cerebro-prod logs backend` — it names the missing variable explicitly |
| Vision container unhealthy for minutes on first boot | Its healthcheck allows a 120 s start period and 20 retries for a cold model load | Wait; `--wait` already accounts for it |

---

## 9. Rollback

The deployment is fully reversible and touches exactly one thing outside Docker and the project
directory (the `/etc/hosts` line).

```bash
# Stop and remove the prod stack, keeping its data volumes:
docker compose -p cerebro-prod -f docker-compose.prod.yml -f docker-compose.prod.verify.yml down

# Or remove its data as well — affects only cerebro-prod_* volumes, never the dev stack's:
docker compose -p cerebro-prod -f docker-compose.prod.yml -f docker-compose.prod.verify.yml down -v
```

Then remove the `/etc/hosts` line (`sudo`), and revert `LLM_PROVIDER`/`GROQ_API_KEY` in `.env` if
desired. The dev stack and its four `cerebro_*` volumes are untouched by any of this, which is the
property §3.1 was chosen to guarantee.

---

## 10. Estimated Effort

| Step | Time |
|---|---|
| `.env` edit + hosts entry (§5.1–5.2) | ~1 min |
| Frontend build (§5.3) | ~5 s |
| First `up --build` — backend `npm ci` + addon compile dominate, vision layers cached (§5.4) | 3–8 min |
| `setup-qdrant.js` (§5.5) | ~2 s |
| Acceptance table D.1–D.13 (§6) | ~3 min |
| Seed document + first question, D.14–D.18 | 1–2 min, ingestion-bound (LlamaParse), not generation-bound now that Groq is the provider |

Subsequent `up -d` runs with a warm cache: under 30 seconds.
