# Cerebro contributor guide

## Project overview

Cerebro is a Retrieval-Augmented Generation (RAG) application with two runtimes: a Node.js
backend and a Python vision service. Documents are parsed (LlamaParse for text; PyMuPDF +
Tesseract OCR + ColPali for scanned pages), chunked, embedded with Cohere's
`embed-multilingual-v3.0` (1024 dimensions), and stored in Qdrant. Retrieval fuses dense +
sparse (local BM25) vector search server-side via Qdrant's RRF, adds ColPali multivector
retrieval for scanned pages, and reranks everything with Cohere Rerank v3. A LangGraph
state machine (condense → retrieve → rerank → generate) drives conversational, streaming,
grounded answers via Claude (or a local Ollama model) over SSE. See
`docs/planning/architecture.md` for the full design and `docs/planning/phase_1..6_*.md` for
how it was built, phase by phase.

## Architecture and directories

- `backend/src/api/index.js` — Express server: mounts every router, rate limiting, CORS,
  helmet, graceful shutdown.
- `backend/src/api/routes/` — `/health`, `/metrics`, `/api/documents` (async ingestion
  lifecycle), `/api/search` (hybrid retrieval), `/api/ask` (SSE conversational RAG),
  `/api/pages`, `/api/threads`.
- `backend/src/ingestion/` — parse → normalize → chunk → embed → upsert, run as a BullMQ
  job (`ingestDocument.js`), plus rollback and error classification.
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
- `frontend/src/app/` — React routes, pages, components, context, and API/SSE hooks. `/` is
  the consumer chat dashboard; `/advanced` is the developer console — a live per-query trace
  of the same pipeline `/` uses (`ExecutionPlan.tsx`, `ProvenancePanel.tsx`).
- `frontend/src/styles/` — global styling. `docs/` and `skywalker/` contain planning/
  reference material and may not match runtime behavior; `skywalker/` in particular is an
  unrelated reference example of the planning methodology, not part of this app.
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
`COHERE_API_KEY`, `LLAMA_CLOUD_API_KEY`, and (for `LLM_PROVIDER=anthropic`, the default)
`ANTHROPIC_API_KEY`. Do not edit or expose `.env` files unless explicitly asked.

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
npm run bench                  # bench/cppVsQdrant.js — see bench/README.md
npm run migrate:legacy         # dry-run by default; see the script's own header comment
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
data. Run them only with permission and suitable local test data. The frontend has `npm run
build`, but no configured unit-test, lint, or type-check script.

## Technical constraints

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
  only inside the Docker network or on `localhost` in dev.
- "Offline" is not absolute: Cohere, LlamaParse, Anthropic (or a remote Ollama), and
  LangSmith tracing are all live network dependencies by default; only the vector index
  (Qdrant), the document/metadata store (MongoDB), the queue (Redis), and OCR/ColPali
  (the vision service) run locally.

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
