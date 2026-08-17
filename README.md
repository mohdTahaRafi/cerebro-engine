<p align="center">
  <h1 align="center">🧠 Cerebro Engine</h1>
  <p align="center">
    <b>A hybrid document RAG system: server-side dense+sparse fusion, ColPali visual retrieval for scanned pages, and a LangGraph-driven conversational pipeline with streaming, cited answers.</b>
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Retrieval-Qdrant%20Hybrid%20%2B%20RRF-DC244C?style=flat-square" />
  <img src="https://img.shields.io/badge/Visual%20RAG-ColPali-6E56CF?style=flat-square" />
  <img src="https://img.shields.io/badge/Orchestration-LangGraph-1C3C3C?style=flat-square" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/React-Vite-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/C%2B%2B-AVX2%2FFMA%20benchmark-00599C?style=flat-square&logo=cplusplus&logoColor=white" />
</p>

---

## What Is Cerebro?

Cerebro is a document RAG system: upload PDFs, DOCX, spreadsheets, or scanned/photographed
pages, and ask questions grounded strictly in what was ingested. Retrieval is hybrid —
dense (Cohere `embed-multilingual-v3.0`) and sparse (local BM25) vector search fused
**server-side** by Qdrant's Query API — plus a second, genuinely different retrieval
modality for scanned pages: ColPali late-interaction search over rendered page images, not
an OCR-text-only fallback. A LangGraph state machine drives the conversational loop
(condense → retrieve → rerank → generate), streaming cited, grounded answers over SSE.

### Why This Architecture?

| Problem | Cerebro's Answer |
|---|---|
| Vector search alone misses exact keywords ("INV-49281") | **Hybrid search** — dense + sparse, fused server-side via Qdrant's RRF |
| A symmetric embedding model treats a question and its answer the same | **Asymmetric Cohere embeddings** — `search_query` vs. `search_document` input types land a short question near the long passage answering it |
| Scanned documents have no extractable text | **ColPali visual retrieval** — late-interaction search directly over rendered page images, deduplicated against OCR-chunk hits by physical page |
| "It's fused" usually means "you can't tell why a result ranked where it did" | **Provenance recovered explicitly** — branch attribution (dense/sparse/both/colpali) and fusion-rank → final-rank movement, both shown in the advanced console |
| LLM cost scales with every message, condensed or not | **A graph, not a loop** — condensation and generation are each skippable named nodes, not unconditional calls |

---

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────────┐
│                              Docker network (prod) / localhost (dev)             │
│                                                                                   │
│  ┌──────────────┐   HTTPS    ┌──────────────┐  proxy (/api/*)  ┌─────────────┐  │
│  │   Browser    │◄──────────►│    Caddy     │◄────────────────►│   Backend   │  │
│  │  React SPA   │            │ TLS + static │                  │  Express 5  │  │
│  └──────────────┘            └──────────────┘                  └──────┬──────┘  │
│                                                                        │         │
│         ┌──────────────────────┬───────────────────┬─────────────────┼───────┐ │
│         ▼                      ▼                    ▼                 ▼        │
│  ┌─────────────┐       ┌──────────────┐     ┌──────────────┐  ┌─────────────┐  │
│  │   Qdrant     │       │   MongoDB    │     │    Redis     │  │   Vision    │  │
│  │ hybrid+ColPali│       │  documents,  │     │ BullMQ queue │  │  (FastAPI)  │  │
│  │   vectors     │       │  threads     │     │ + rate limit │  │ OCR+ColPali │  │
│  └─────────────┘       └──────────────┘     └──────────────┘  └─────────────┘  │
│                                                                        │         │
│                                                              ┌─────────▼───────┐ │
│                                                              │  MinIO (S3)     │ │
│                                                              │  page images    │ │
│                                                              └─────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────┘
         │                    │                     │
         ▼                    ▼                     ▼
     Cohere API          Anthropic Claude       LlamaParse API
   (embed + rerank)      (or local Ollama)      (text extraction)
```

See [`docs/planning/architecture.md`](docs/planning/architecture.md) for the full runtime
topology, data flow, and design decisions, and
[`docs/planning/phase_1_foundation.md`](docs/planning/phase_1_foundation.md) through
[`phase_6_polish_production.md`](docs/planning/phase_6_polish_production.md) for how it was
built.

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 19 + Vite + Tailwind v4 | SPA with real-time SSE streaming |
| **Backend** | Node.js + Express 5 | REST API + SSE, rate-limited and hardened for production |
| **Orchestration** | LangGraph | Conversational RAG state machine |
| **Vector DB** | Qdrant | Hybrid dense+sparse fusion, ColPali multivector (MAX_SIM) |
| **Embeddings** | Cohere `embed-multilingual-v3.0` | 1024-dim, asymmetric query/document encoding |
| **Reranking** | Cohere Rerank v3 | Cross-encoder, calibrated relevance scores |
| **Visual RAG** | ColPali + Tesseract OCR (Python/FastAPI) | Page classification, rendering, OCR, visual embedding |
| **Generation** | Claude (Anthropic) or Ollama | Streaming, grounded, cited answers |
| **Metadata store** | MongoDB | Documents, threads/messages, usage events |
| **Queue** | Redis + BullMQ | Async ingestion, rate-limit counters |
| **Object storage** | Filesystem (dev) / MinIO (prod) | Page images, behind one storage interface |
| **Monitoring** | Prometheus (`/metrics`) | 7 metric families — request/pipeline/ingest latency, provider calls/tokens, breaker state, queue depth |
| **Benchmark artifact** | C++ / node-addon-api, AVX2/FMA | Retired from serving (Phase 3); kept and benchmarked against Qdrant (`backend/bench/`) |

---

## Project Structure

```
cerebro/
├── backend/
│   ├── src/
│   │   ├── api/            # Express app, routes, rate-limit/CORS/helmet middleware
│   │   ├── ingestion/      # parse → normalize → chunk → embed → upsert (BullMQ job)
│   │   ├── providers/      # one adapter per external dependency (Cohere, Qdrant,
│   │   │                   # LlamaParse, vision service, LLM, storage, breaker)
│   │   ├── retrieval/      # hybrid search pipeline, provenance dedup, stage timing
│   │   ├── graph/          # LangGraph conversational RAG state machine
│   │   ├── telemetry/      # tracing, usage accounting, PipelineTelemetry, Prometheus
│   │   └── cpp/            # C++ AVX2/FMA addon — benchmark artifact, not serving path
│   ├── bench/               # bench/cppVsQdrant.js — the C++-vs-Qdrant benchmark
│   ├── scripts/             # setup-qdrant, check-providers, migrate-legacy
│   └── Dockerfile           # multi-stage: node-gyp build → slim runtime
│
├── frontend/
│   └── src/app/
│       ├── pages/           # ConsumerDashboard ("/"), CoreEngine ("/advanced")
│       ├── components/core/ # ExecutionPlan, ProvenancePanel, AnswerBox, ...
│       ├── context/         # EngineContext — the one shared conversation state
│       └── hooks/           # useCerebroChat (SSE), useThreads
│
├── vision/                  # Python/FastAPI: classify, render, OCR, ColPali embed
├── docker-compose.yml        # dev stack: Qdrant, MongoDB, Redis, vision
├── docker-compose.prod.yml   # + backend, MinIO, Caddy, resource limits
├── Caddyfile                 # TLS + SSE-safe reverse proxy
└── docs/planning/             # architecture.md + phase_1..6_*.md
```

---

## Getting Started (Development)

### Prerequisites

- Node.js 22+
- Docker (for Qdrant, MongoDB, Redis, and the vision service)
- A C++ compiler + node-gyp prerequisites, if you want to build/run the benchmark addon
  ([platform-specific requirements](https://github.com/nodejs/node-gyp#installation))
- API keys: Cohere, LlamaParse, and either Anthropic or a local Ollama install

### 1. Clone and start the dev stack

```bash
git clone <this repo>
cd cerebro
docker compose up -d       # Qdrant, MongoDB, Redis, vision service
```

### 2. Backend

```bash
cd backend
npm install
npx node-gyp rebuild
cp .env.example .env       # fill in COHERE_API_KEY, LLAMA_CLOUD_API_KEY, ANTHROPIC_API_KEY, ...
npm run setup:qdrant       # idempotent — creates cerebro_chunks / cerebro_pages
npm run dev
```

### 3. Frontend

```bash
cd frontend
npm install
npm run dev
```

The app is live at **`http://localhost:5173`** (`/` chat, `/advanced` the developer
console) — Vite proxies `/api/*` to the backend on `:5000`.

See [`AGENTS.md`](AGENTS.md) for the full check/test command list and coding conventions.

---

## Production Deployment

```bash
cd frontend && npm run build && cd ..
cp .env.example .env       # DOMAIN, provider keys, MinIO credentials
docker compose -f docker-compose.prod.yml up -d --wait
```

Brings up the full stack — Qdrant, MongoDB, Redis, the vision service, the backend, MinIO
(page-image object storage), and Caddy (automatic TLS + the SSE-safe reverse proxy) — with
per-service memory limits. See `docker-compose.prod.yml`'s and `Caddyfile`'s own comments
for what each piece does and why; `backend/bench/README.md` for the C++-vs-Qdrant benchmark;
`backend/scripts/migrate-legacy.js`'s header comment if you're carrying documents forward
from a pre-Phase-3 installation.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Dependency status, circuit breaker states, queue depth, collection counts |
| `GET` | `/metrics` | Prometheus exposition (internal-only — not routed through Caddy) |
| `POST` | `/api/documents` | Upload and enqueue a document for async ingestion (multipart, field: `document`) |
| `GET` | `/api/documents/:id/status` | Poll ingestion status/progress |
| `POST` | `/api/search` | Hybrid retrieval, no generation (body: `{ "query": "..." }`) |
| `POST` | `/api/ask` | Conversational RAG, SSE stream (body: `{ "query": "...", "threadId"?, "scopeDocumentIds"? }`) |
| `GET`/`PATCH`/`DELETE` | `/api/threads` | Conversation history |

### Example

```bash
curl -X POST http://localhost:5000/api/documents -F "document=@./report.pdf"

curl -X POST http://localhost:5000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "quarterly revenue targets"}'
```

---

## Supported File Types

| Format | Parser | Notes |
|---|---|---|
| PDF | LlamaParse (text) + vision service (scanned pages) | Per-page classification routes each page to the right path |
| DOCX | LlamaParse | |
| CSV / Excel | `xlsx` | Row-level semantic context |
| JSON | Native | Array or object flattening |
| Plain text / Markdown | Native | Direct chunking |

---

## License

MIT

---

<p align="center">
  <sub>Every performance and provenance claim in this repo is backed by a command you can run yourself — <code>npm run bench</code>, <code>/health</code>, <code>/metrics</code> — not a number frozen in a doc.</sub>
</p>
