# Cerebro contributor guide

## Project overview

Cerebro is a local-first Retrieval-Augmented Generation (RAG) application. Documents are parsed, sanitized, chunked, embedded with `Xenova/all-MiniLM-L6-v2` (384 dimensions), stored in MongoDB, and retrieved through lexical plus vector search fused with Reciprocal Rank Fusion (RRF). A local Ollama model can stream grounded answers to the UI.

## Architecture and directories

- `backend/src/api/index.js` — Express server: `/health`, `/api/ingest`, `/api/search`, and SSE `/api/ask`.
- `backend/src/services/` — ingestion orchestration, MongoDB access, hybrid retrieval, embedding, and Ollama generation.
- `backend/src/loaders/` and `backend/src/utils/` — document extraction, text sanitization, and chunking.
- `backend/src/encoder/` — singleton Hugging Face model loader and batched, L2-normalized embeddings.
- `backend/src/cpp/` and `backend/binding.gyp` — Node-API C++ addon; AVX2/FMA Top-K vector search.
- `backend/test/` — standalone verification and benchmark scripts, not a unified test framework.
- `frontend/src/app/` — React routes, pages, components, context, and API/SSE hooks.
- `frontend/src/styles/` — global styling. `docs/` and `skywalker/` contain planning/reference material and may not match runtime behavior.

## Run locally

Prerequisites: Node.js, MongoDB, C++/node-gyp build prerequisites with AVX2/FMA CPU support, and Ollama for `/api/ask`.

```bash
cd backend
npm install
npx node-gyp rebuild
npm run dev
```

Set required backend configuration in your local, uncommitted `.env` (at minimum `MONGO_URI`; optional `PORT`, `OLLAMA_API_URL`, and `OLLAMA_MODEL`). Do not edit or expose `.env` files unless explicitly asked.

```bash
cd frontend
npm install
npm run dev
```

The frontend runs on port 5173 and proxies `/api` to backend port 5000. For generation, run a compatible local Ollama model (default: `llama3`).

## Checks

Run from `backend/`:

```bash
npm test                       # loader Phase 1/2 script
node test/verify_phase_3.js    # semantic chunking
node test/verify_phase_4.js    # CSV/JSON loading
node test/test-cpp-bridge.js   # compiled addon required
node test/test-batcher.js      # embedding pipeline; model may download/cache
node test/test-service.js      # encoding service
node test/verify-lexical.js    # MongoDB required
node test/test-hybrid.js       # MongoDB + compiled addon required
node test/benchmark-simd.js    # resource-intensive benchmark
```

New pipeline (Phases 1–2):

```bash
npm run setup:qdrant           # idempotent collection creation; safe to re-run
npm run check:providers        # ping every external provider, print up/down
npm run test:breaker           # circuit-breaker trip behavior (offline)
npm run test:ingestion         # Phase 2 suite: normalize + chunker + parser + lifecycle
```

`npm run test:ingestion` needs the Docker stack up (`docker compose up -d`) **and** the
backend running (`npm run dev`) for its lifecycle leg, and it spends live Cohere +
LlamaParse credits. Its offline-only subset is `SKIP_LLAMAPARSE=1 node
test/ingestion/parser.test.js` plus the normalize/chunker scripts, which need nothing
running. The lifecycle test writes and then deletes real Mongo rows and Qdrant points.

`npm test` and the phase scripts create temporary files; database scripts may insert/delete MongoDB data; the loader test may fetch a remote PDF. Run them only with permission and suitable local test data. The frontend has `npm run build`, but no configured unit-test, lint, or type-check script.

## Technical constraints

- Embedding vectors and native SIMD code are fixed at **384 dimensions**. Changing models requires coordinated backend and C++ changes.
- Rebuild `backend/build/Release/cerebro_core.node` after Node ABI/native-code changes. Do not commit generated `build/` output.
- Atlas `$vectorSearch` falls back to loading vectors into Node memory for local C++ reranking; treat this as a scalability limit.
- `DatabaseService` uses the `text` field, while `backend/scripts/setup-db-index.js` refers to legacy `text_content`; verify index changes against runtime code.
- The UI currently starts search and answer requests separately, so a single user query performs retrieval twice.
- “Offline” is local-first after setup, not absolute: first model use may download assets, URL loading fetches remote content, and MongoDB can point to Atlas.

## Coding and security rules

- Make the smallest focused change; preserve existing untracked files and unrelated work.
- Keep API contracts aligned across `backend/src/api`, services, frontend hooks, and UI components.
- Preserve SSE framing (`data: ...\n\n`) and the established 384-dimensional `Float32Array` bridge unless intentionally redesigning both sides.
- Treat uploaded documents and retrieved text as untrusted. Validate inputs, avoid logging sensitive contents, and do not weaken sanitization or error handling.
- Never add secrets, credentials, private documents, uploaded artifacts, or generated binaries to version control.
- Do not modify application source code or `.env` files unless the task explicitly authorizes it.

## Git rules

- Inspect `git status` before and after work; this repository may contain intentional untracked notes, samples, and uploads.
- Do not discard, reset, or overwrite unrelated changes.
- Do not commit, amend, push, create pull requests, or change branches unless explicitly asked.
