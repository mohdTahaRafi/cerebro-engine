# Cerebro contributor guide

## Project overview

Cerebro is a Retrieval-Augmented Generation (RAG) application with two runtimes: a Node.js
backend and a Python vision service. Documents are parsed (LlamaParse for text; PyMuPDF +
Tesseract OCR + ColPali for scanned pages), chunked, embedded with Cohere's
`embed-multilingual-v3.0` (1024 dimensions), and stored in Qdrant. Retrieval fuses dense +
sparse (local BM25) vector search server-side via Qdrant's RRF, adds ColPali multivector
retrieval for scanned pages, and reranks everything with Cohere Rerank v3. A LangGraph
state machine (condense → retrieve → rerank → generate) drives conversational, streaming,
grounded answers via Claude, Groq, Gemini, or a local Ollama model over SSE.

**v2** turns this from a single-tenant tool into a multi-user platform: every user signs in
(local password or Google/GitHub OAuth), owns their own contexts (folders of documents,
each with its own conversations and vector-space projection), and is invisible to every
other user at the Qdrant, Mongo, and API layers alike. See `docs/planning/architecture.md`
+ `docs/planning/phase_1..6_*.md` for how the v1 retrieval engine underneath this was
built, and `docs/planning/v2/architecture.md` + `docs/planning/v2/phase_1..8_*.md` for the
tenancy/auth/observability platform layered on top of it.

## Architecture and directories

- `backend/src/api/index.js` — Express server: mounts every router, sessions, CSRF, rate
  limiting, CORS, helmet/CSP, graceful shutdown.
- `backend/src/api/routes/` — `/health`, `/metrics`, `/api/contexts` (+ nested
  `/api/contexts/:id/documents`), `/api/documents/:id` (single-document lifecycle),
  `/api/search` (hybrid retrieval), `/api/ask` (SSE conversational RAG), `/api/pages`,
  `/api/threads`, `/api/auth` + `/api/auth/password` (identity), `/api/traces` +
  `/api/vectors` (observability/projection consoles), `/api/admin` (operator-only).
- `backend/src/api/middleware/` — `requireAuth`, `requireContext` (resolves + owns-checks
  a `:contextId`), `requireAdmin`, `csrf.js` (double-submit token), `quotas.js` (the four
  per-tenant resource limits), `rateLimit.js`, `upload.js`, `errorHandler.js` (the
  catch-all, registered last; never serializes `err.stack`).
- `backend/src/auth/` — sessions (`session.js`, Redis-backed via connect-redis),
  Passport strategies (`strategies/local.js`, `google.js`, `github.js`), account linking
  (`linking.js`), password hashing (`password.js`, argon2id), OTP (`otp.js`), rate limits
  (`limits.js`), and the session lifecycle (`sessionLifecycle.js` — regenerate/logout/
  logout-all).
- `backend/src/contexts/` — the context-delete cascade (`cascade.js`, its own BullMQ
  queue in `queue.js`) and denormalized counter maintenance (`counters.js`).
- `backend/src/notify/` — outbound email (`email.js`, nodemailer) and SMS (`sms.js`,
  Twilio) for OTP delivery, both no-op/absent from capabilities when unconfigured.
- `backend/src/projection/` — the UMAP fit (`fit.js`), its own BullMQ worker
  (`worker.js`), binary payload packing (`pack.js`), the Qdrant vector scroll
  (`scroll.js`), and query-time beacon placement (`transform.js`).
- `backend/src/ingestion/` — parse → normalize → chunk → embed → upsert, run as a BullMQ
  job (`ingestDocument.js`), plus rollback, error classification, and the upload-abuse
  guards (`verifyType.js`'s magic-byte check, `zipGuard.js`'s zip-bomb size/ratio check).
- `backend/src/providers/` — one adapter per external dependency: Cohere (`embeddings.js`,
  `reranker.js`), Qdrant (`vectorStore.js`), LlamaParse (`parser.js`), the vision service
  (`visionService.js`), the LLM (`llm.js`), local BM25 (`bm25.js`), storage (`storage.js`,
  filesystem or S3/MinIO behind one interface), and the shared circuit breaker (`breaker.js`).
- `backend/src/retrieval/` — the hybrid search pipeline (`search.js`), provenance dedup
  (`merge.js`), stage timing (`timer.js`), tuning constants.
- `backend/src/graph/` — the LangGraph conversational RAG state machine: `ragGraph.js`
  wires the nodes in `graph/nodes/`, `state.js` defines the channel set. `graph/prompts.js`
  holds the system/condense prompts and the fixed no-context refusal string.
- `backend/src/telemetry/` — LangSmith tracing setup, per-provider usage accounting
  (`usage.js`), the canonical `PipelineTelemetry` shape (`pipelineTelemetry.js`), and the
  Prometheus registry (`metrics.js`).
- `backend/src/cpp/` and `backend/binding.gyp` — Node-API C++ addon; AVX2/FMA Top-K vector
  search. Not on the query serving path since Phase 3 — it survives as the benchmark
  artifact `backend/bench/cppVsQdrant.js` measures against Qdrant.
- `backend/scripts/` — `setup-qdrant.js` (idempotent collection creation),
  `check-providers.js`, `migrate-legacy.js` (one-time carry-forward from the pre-Phase-3
  MongoDB-vector pipeline).
- `backend/test/` — standalone verification scripts per phase/subsystem, not a unified test
  framework (see Checks below for the ones with `npm run` scripts).
- `frontend/src/app/` — React routes (`routes.tsx`), pages, components, context, and
  API/SSE hooks. `/login`, `/signup`, `/forgot-password`, `/reset-password` are public;
  everything else sits behind `AppShell` (guarded — `guards/`) at `/chat`, `/contexts` +
  `/contexts/:id`, and the admin-only `/admin/traces` (+ `:id`), `/admin/vectors`, and
  `/admin/health`. `/advanced` and `/vector` (v1 paths) redirect to their v2 equivalents.
- `backend/src/models/` — Mongoose schemas: `User` (+ embedded OAuth `identities`),
  `Context`, `Document`, `Conversation`, `Message`, `Trace`, `Projection`, `UsageEvent`,
  `PipelineError`.
- `frontend/src/styles/` — global styling. `docs/` contains planning/reference material
  and may not match runtime behavior.
- `vision/app/` — the Python (FastAPI) vision service: PDF page classification
  (text vs. scanned), rendering, OCR, and ColPali embedding.

## Run locally

Prerequisites: Node.js 22+, Docker (for MongoDB, Qdrant, Redis, and the vision service —
`docker compose up -d` from the repo root), C++/node-gyp build prerequisites with AVX2/FMA
CPU support, and either an Anthropic API key or a local Ollama model for `/api/ask`.

```bash
docker compose up -d          # MongoDB, Qdrant, Redis, vision service
cd backend
npm install
npx node-gyp rebuild
npm run setup:qdrant          # idempotent — creates cerebro_chunks / cerebro_pages if absent
npm run dev
```

Set required backend configuration in your local, uncommitted `.env` (copy from
`.env.example`) — at minimum `MONGO_URI`, `QDRANT_URL`, `REDIS_URL`, `VISION_SERVICE_URL`,
`COHERE_API_KEY`, `LLAMA_CLOUD_API_KEY`, `SESSION_SECRET` (≥32 chars — `openssl rand -base64
32`), `PUBLIC_URL` (e.g. `http://localhost:5000`), and (for `LLM_PROVIDER=anthropic`, the
default) `ANTHROPIC_API_KEY`. The backend fails fast and names anything missing
(`config/index.js`). OAuth (`GOOGLE_CLIENT_ID`/`SECRET`, `GITHUB_CLIENT_ID`/`SECRET`) and
mail/SMS (`SMTP_*`, `TWILIO_*`) are optional — each provider's absence just removes it
from `GET /api/auth/capabilities` rather than breaking anything. Do not edit or expose
`.env` files unless explicitly asked.

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on port 5173 and proxies `/api` to backend port 5000.

## Checks

Run from `backend/`:

```bash
npm run check:providers        # ping every external provider, print up/down
npm run test:breaker           # circuit-breaker trip behavior (offline)
npm run test:ingestion         # normalize + chunker + parser + lifecycle
npm run test:encode-query      # asserts the Cohere embed call carries inputType: 'search_query'
npm run test:corpus:setup      # ingests the fixture corpus into cerebro_chunks_test
npm run test:retrieval         # recall@3 regression + relevance-floor + scoping isolation
npm run test:vision            # merge / classifier / visual-retrieval
npm run test:graph             # state / routing / condense / SSE framing
npm run test:cpp-bridge        # compiled addon required
npm run test:auth              # user / password / otp / linking / session — mostly offline
npm run test:tenancy           # filter-injection (offline) + live cross-tenant isolation
npm run test:projection        # UMAP fit determinism + downsampling (offline, synthetic vectors)
npm run test:security          # phase 8 §3.4 — CSRF, session fixation/revocation, enumeration,
                                #   OTP brute force, upload abuse, stack-trace leakage, etc.
                                #   against a LIVE backend (npm run dev in another shell) —
                                #   see test/security/*.test.js's own header comments for what
                                #   each needs (several create real users via HTTP signup and
                                #   share auth/limits.js's signupPerIp budget, 10/hour)
npm run bench                  # bench/cppVsQdrant.js — see bench/README.md
npm run bench:v2               # phase 8 §2 — seeds 20 users x 5k chunks each into a
                                #   DEDICATED cerebro_chunks_bench collection, then measures
                                #   tenancy/auth/traces/projection/frontend surfaces against
                                #   architecture §8's v2 budgets. Spends real Cohere embed
                                #   calls (~1,100 for the seed alone) — a trial-tier key's
                                #   1,000-call/month cap will not cover a single run; see
                                #   docs/planning/v2/measurements.md's own note on this.
npm run migrate:legacy         # dry-run by default; the pre-Phase-3 pipeline carry-forward
node scripts/migrate-to-tenancy.js --user <email> [--commit]   # phase_6's per-user tenancy
                                #   migration — dry-run without --commit; REFUSES to create
                                #   the user, it must already exist (phase_6 §7.1)
```

`npm run test:ingestion` needs the Docker stack up **and** the backend running (`npm run
dev`) for its lifecycle leg, and it spends live Cohere + LlamaParse credits. Its
offline-only subset is `SKIP_LLAMAPARSE=1 node test/ingestion/parser.test.js` plus the
normalize/chunker scripts, which need nothing running. The lifecycle test writes and then
deletes real Mongo rows and Qdrant points.

`npm run test:retrieval` reads `test/retrieval/queries.json` against the isolated
`cerebro_chunks_test` Qdrant collection populated by `test:corpus:setup` — never against the
live `cerebro_chunks` collection real documents live in. On a rate-limited (trial-tier)
Cohere key, pace the live calls with `RETRIEVAL_TEST_PACE_MS=8000 npm run test:retrieval`; a
production key needs no pacing.

If a sandboxed/automated environment reaps background processes between commands, start the
server and run whichever test needs a live backend in a single shell invocation rather than
expecting a previously-launched server to persist.

These test/check scripts create temporary files and may insert/delete real MongoDB/Qdrant
data. Run them only with permission and suitable local test data.

Run from `frontend/` — all offline, nothing needs to be running:

```bash
npm run typecheck              # tsc --noEmit
npm test                       # every test:* script (render, contrast, markdown, waterfall, ...)
npm run build                  # production bundle → dist/
```

There is no lint script on either side.

## Technical constraints

- **Every `vectorStore.js` query/write function takes a required `tenant` argument
  (`{ userId, contextId }`); the filter is never applied at a call site.** `assertTenant()`
  throws a `TypeError` — not a silently-empty result — if it's missing, on purpose: a
  missing tenant is a programming defect, and a defect that returns "no matches" instead
  of an error looks like correct behavior and ships. This is the single property Phase 6
  built tenant isolation on, and every subsequent phase (traces, projection, quotas)
  depends on it holding for every new call site, not just the ones that existed when it
  was written. Before adding any new `vectorStore.js` function, or any new caller of an
  existing one, read `vectorStore.js`'s own header comment on tenancy (§2 there) and
  `docs/planning/v2/phase_6_tenancy_and_contexts.md` §2 — do not thread `userId`/
  `contextId` through as optional, and do not build a filter object anywhere outside this
  file.
- Embedding vectors are fixed at **1024 dimensions** (Cohere `embed-multilingual-v3.0`).
  Changing the embed model requires re-ingesting every document — vectors from two different
  models are never interchangeable, regardless of dimension — see
  `backend/scripts/migrate-legacy.js` for the one-time carry-forward this project already
  went through off an earlier, since-retired local embedding model.
- Rebuild `backend/build/Release/cerebro_core.node` after Node ABI/native-code changes. Do
  not commit generated `build/` output.
- `STORAGE_DRIVER` (`filesystem` | `s3`) selects where page images live —
  `backend/src/providers/storage.js` is the only place that needs to know which. The vision
  service itself has no S3 awareness; in production it writes to a scratch volume shared
  with the backend container, which syncs each page into the real storage backend after
  embedding (`ingestDocument.js`'s `syncPageImagesToStorage`).
- `/metrics` (Prometheus exposition) is intentionally unreachable through the production
  Caddy proxy — see the Caddyfile. It is still bound on the backend's own port, reachable
  only inside the Docker network or on `localhost` in dev. `userId` is never a metric
  label (`telemetry/metrics.js`'s own header comment) — an unbounded label creates one
  time series per user per metric family, which is how a Prometheus instance dies. A
  per-user number belongs in the `traces` or `usage_events` Mongo collections instead,
  both already indexed by `userId`.
- Sessions (`cerebro.sid`, Redis-backed) and the CSRF double-submit token (`cerebro.csrf`)
  are both cookie-based. The CSRF cookie is minted only once a session carries a
  `userId` (`api/middleware/csrf.js`'s `issueCsrfToken`) — NOT on every request — so an
  anonymous visit never gets a `cerebro.sid` either (verified live during Phase 8: the
  literal "every request" guard the phase doc originally specified defeated that
  anonymous-no-cookie property; see that file's own comment on the fix). Every
  state-changing route needs `X-CSRF-Token` except `/api/auth/{login,signup,google,
  github}` and their OAuth callbacks (no session exists yet to hold a token).
- `redis.js`'s `assertNoEvictionPolicy()` runs at every backend startup and logs a hard
  warning — never exits — if Redis's `maxmemory-policy` isn't `noeviction`. Sessions and
  OTP codes live in Redis now; the default `allkeys-lru` evicts them under memory
  pressure with no error anywhere, which reads as users being randomly signed out.
- "Offline" is not absolute: Cohere, LlamaParse, Anthropic/Groq/Gemini (or a remote Ollama), and
  LangSmith tracing are all live network dependencies by default; only the vector index
  (Qdrant), the document/metadata store (MongoDB), the queue (Redis), and OCR/ColPali
  (the vision service) run locally. **This project's `COHERE_API_KEY` is trial-tier,
  capped at 1,000 API calls/month total** (not a burst limit — confirmed live via
  Cohere's own 429 body during Phase 8), which one `bench/v2/seed.js` run alone exceeds.
  Budget real embed/rerank calls accordingly before running anything that ingests or
  queries at volume; `test:retrieval`'s own `RETRIEVAL_TEST_PACE_MS` pacing helps with
  burst limits but does nothing for this monthly cap.

## Coding and security rules

- Make the smallest focused change; preserve existing untracked files and unrelated work.
- Keep API contracts aligned across `backend/src/api`, services, frontend hooks, and UI
  components — in particular, `PipelineTelemetry` (`backend/src/telemetry/pipelineTelemetry.js`,
  mirrored in `frontend/src/app/components/core/TelemetryTypes.ts`) is the wire contract for
  both `/api/search`'s response and `/api/ask`'s SSE `telemetry` event; keep both in sync.
- Preserve SSE framing (`data: ...\n\n`, the `[DONE]` sentinel, the event-discriminated
  envelope) unless intentionally redesigning the streaming contract on both sides.
- Treat uploaded documents and retrieved text as untrusted. Validate inputs, avoid logging
  sensitive contents, and do not weaken sanitization or error handling.
- Never add secrets, credentials, private documents, uploaded artifacts, or generated
  binaries to version control.
- Do not modify application source code or `.env` files unless the task explicitly
  authorizes it.

## Git rules

- Inspect `git status` before and after work; this repository may contain intentional
  untracked notes, samples, and uploads.
- Do not discard, reset, or overwrite unrelated changes.
- Do not commit, amend, push, create pull requests, or change branches unless explicitly
  asked.
