<p align="center">
  <h1 align="center">🧠 Cerebro Engine</h1>
  <p align="center">
    <b>A fully offline Retrieval-Augmented Generation (RAG) engine with hardware-accelerated C++ vector search.</b>
    <br />
    <em>Zero data leaves your machine. Ever.</em>
  </p>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/C++-SIMD%20(AVX2%2FFMA)-00599C?style=flat-square&logo=cplusplus&logoColor=white" />
  <img src="https://img.shields.io/badge/Node.js-Express-339933?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/React-Vite-61DAFB?style=flat-square&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/MongoDB-Atlas%20%2B%20Local-47A248?style=flat-square&logo=mongodb&logoColor=white" />
  <img src="https://img.shields.io/badge/LLM-Ollama%20(Local)-FF6600?style=flat-square" />
  <img src="https://img.shields.io/badge/Privacy-100%25%20Offline-00FF41?style=flat-square" />
</p>

---

## What Is Cerebro?

Cerebro Engine is a **privacy-first, fully local RAG system** that lets you upload proprietary documents (PDF, DOCX, CSV, Excel, JSON, web pages), converts them into search-optimized mathematical embeddings **entirely on your machine**, and retrieves exact paragraphs using a **hybrid search pipeline fused with Reciprocal Rank Fusion (RRF)**. A local LLM then synthesizes answers grounded strictly in your documents — with zero external API calls.

### Why Cerebro?

| Problem | Cerebro's Answer |
|---|---|
| Corporate data sent to OpenAI/Pinecone APIs | **100% offline** — embeddings, search, and generation run locally |
| Vector search alone misses exact keywords | **Hybrid search** fuses semantic + lexical results via RRF |
| JavaScript is too slow for massive matrix math | **C++ SIMD addon** (AVX2/FMA) handles all vector operations natively |
| Embedding APIs add latency and cost | **Local HuggingFace model** (`all-MiniLM-L6-v2`) runs inside Node.js |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        Local Host Machine                        │
│                                                                   │
│  ┌───────────────────┐                 ┌──────────────────────┐  │
│  │   Frontend (SPA)   │◄──────────────►│    Node.js Backend   │  │
│  │  React + Vite      │      HTTP      │  Express.js REST API │  │
│  └───────────────────┘                 └──────┬────────┬──────┘  │
│                                               │        │          │
│  ┌───────────────────┐                 ┌──────▼────────▼──────┐  │
│  │   Local LLM        │                │  C++ SIMD Core       │  │
│  │  Ollama (llama3)   │◄──────────────►│  VectorSearch.cpp    │  │
│  └───────────────────┘                 │  (node-addon-api)    │  │
│                                        └──────────┬───────────┘  │
│  ┌───────────────────┐                 ┌──────────▼───────────┐  │
│  │  MongoDB           │◄──────────────►│ HuggingFace Models   │  │
│  │  Vector + Lexical  │      DB        │ @xenova/transformers │  │
│  └───────────────────┘                 └──────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
Upload → Parse → Sanitize → Semantic Chunk → Encode (Local HF) → Sink to MongoDB
                                                                        │
Query → Vectorize ──┬── Atlas $vectorSearch ──► C++ SIMD Rerank ──┐     │
                    └── MongoDB $text Search ─────────────────────┤     │
                                                                  ▼     │
                                                           RRF Fusion   │
                                                                  │     │
                                                          Top-K Results │
                                                                  │     │
                                                      Ollama LLM ◄┘     │
                                                          │              │
                                                   Streaming Answer      │
```

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Frontend** | React 18 + Vite + TailwindCSS | SPA with real-time streaming UI |
| **UI Primitives** | Radix UI + Lucide Icons + Framer Motion | Accessible components with micro-animations |
| **Backend** | Node.js + Express 5 | REST API with SSE streaming |
| **Vector Engine** | C++ `node-addon-api` (AVX2/FMA SIMD) | Hardware-accelerated similarity search via Min-Heap |
| **Embeddings** | `@huggingface/transformers` (`all-MiniLM-L6-v2`) | 384-dim local embeddings, no API calls |
| **Database** | MongoDB (Atlas Vector Search + `$text` indexes) | Dual-mode retrieval with automatic fallback |
| **LLM** | Ollama (llama3, configurable) | Local answer generation with SSE token streaming |
| **Document Parsers** | `pdf-parse` · `mammoth` · `cheerio` · `xlsx` | PDF, DOCX, HTML, CSV, Excel, JSON, plain text |

---

## Project Structure

```
cerebro/
├── backend/
│   ├── src/
│   │   ├── api/              # Express server, REST endpoints (/ingest, /search, /ask)
│   │   ├── cpp/              # C++ SIMD core (VectorMath, VectorSearch, N-API bridge)
│   │   ├── encoder/          # BatchEncoder (batched encoding + L2 normalization)
│   │   │                     # ModelLoader (Singleton HuggingFace pipeline)
│   │   ├── loaders/          # UniversalLoader (PDF, DOCX, CSV, Excel, JSON, Web)
│   │   ├── services/         # IngestionService, SearchService, DatabaseService,
│   │   │                     # EncoderService, GenerationService
│   │   └── utils/            # TextSanitizer, SemanticChunker
│   ├── binding.gyp           # node-gyp C++ compilation config (AVX2/FMA flags)
│   └── package.json
│
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── components/   # AnswerBox, ChatInput, GlobalDropzone, SourceChip,
│   │   │   │                 # ResultsTable, QueryConsole, Sidebar, TopHeader
│   │   │   ├── context/      # EngineContext (unified search + chat + upload state)
│   │   │   ├── hooks/        # useCerebroSearch, useCerebroChat (SSE stream parser)
│   │   │   └── pages/        # ConsumerDashboard, CoreEngine, IngestionEngine,
│   │   │                     # ReliabilityConsole, VectorDebugger
│   │   └── styles/
│   ├── vite.config.ts
│   └── package.json
│
└── docs/                     # Architecture docs and phase roadmaps
```

---

## Key Engineering Decisions

### 🔧 C++ SIMD Vector Engine

JavaScript's V8 engine cannot efficiently iterate over millions of floating-point values for similarity computation. Cerebro compiles a native C++ addon using `node-gyp` with **AVX2 and FMA intrinsics** enabled. The `SimdDotProduct` function processes **8 floats per CPU cycle** (256-bit registers), and a **Min-Heap priority queue** efficiently extracts Top-K results without sorting the entire dataset.

### 🔗 Zero-Copy Memory Bridge

Instead of serializing thousands of JavaScript objects across the V8 ↔ C++ boundary, the Node.js layer packs all vectors into a single contiguous `Float32Array`. This buffer's memory is shared directly with C++ via raw pointer references — **zero serialization, zero copying**.

### 🔀 Hybrid Search with Reciprocal Rank Fusion

Vector search excels at semantic similarity but fails on exact keyword matches (e.g., `"ID-49281"`). Lexical search does the opposite. Cerebro runs **both searches concurrently** and fuses results using RRF:

```
Score(doc) = Σ  1 / (k + rank_i)    where k = 60
```

This mathematically guarantees that documents appearing in both result sets surface to the top.

### 📐 Pre-Normalization Strategy

The `BatchEncoder` L2-normalizes all vectors **before** storage. This converts Cosine Similarity into a simple Dot Product at query time — eliminating expensive division operations during live searches.

### 🌊 SSE Streaming Generation

The `/api/ask` endpoint streams LLM tokens via **Server-Sent Events (SSE)**. The frontend's `useCerebroChat` hook parses the NDJSON stream in real-time, rendering tokens as they arrive for a responsive chat experience.

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 18
- **MongoDB** (local or Atlas)
- **C++ compiler** with AVX2 support (GCC 7+, Clang 5+, MSVC 2017+)
- **node-gyp** dependencies ([platform-specific requirements](https://github.com/nodejs/node-gyp#installation))
- **Ollama** (optional, for answer generation) — [Install Ollama](https://ollama.ai)

### 1. Clone

```bash
git clone https://github.com/mohdTahaRafi/cerebro-engine.git
cd cerebro-engine
```

### 2. Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Compile C++ native addon
npx node-gyp rebuild

# Configure environment
cp .env.example .env
# Edit .env with your MongoDB URI:
#   MONGO_URI=mongodb://localhost:27017/cerebro
#   PORT=5000
#   OLLAMA_API_URL=http://127.0.0.1:11434/api/generate  (optional)
#   OLLAMA_MODEL=llama3                                   (optional)

# Start backend
npm run dev
```

### 3. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server (proxies to backend on :5000)
npm run dev
```

### 4. (Optional) Ollama for Answer Generation

```bash
# Install and start Ollama
ollama pull llama3
ollama serve
```

The app is now live at **`http://localhost:5173`**.

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Service health check |
| `POST` | `/api/ingest` | Upload and ingest a document (multipart form, field: `document`) |
| `POST` | `/api/search` | Hybrid search with RRF fusion (body: `{ "query": "..." }`) |
| `POST` | `/api/ask` | RAG answer generation via SSE stream (body: `{ "query": "..." }`) |

### Ingestion Example

```bash
curl -X POST http://localhost:5000/api/ingest \
  -F "document=@./report.pdf"
```

### Search Example

```bash
curl -X POST http://localhost:5000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "quarterly revenue targets"}'
```

---

## Supported File Types

| Format | Parser | Notes |
|---|---|---|
| PDF | `pdf-parse` | Page-level chunking with boundary detection |
| DOCX | `mammoth` | Raw text extraction |
| CSV | `xlsx` | Row-level semantic context generation |
| Excel (.xlsx/.xls) | `xlsx` | Row-level semantic context generation |
| JSON | Native | Array or object flattening |
| Plain Text / Markdown | Native `fs` | Direct chunking |
| Web Pages | `cheerio` | HTML → text extraction via URL |

---

## Performance Targets

| Metric | Target |
|---|---|
| **Query Latency** | < 150ms (search-as-you-type) |
| **C++ Vector Compare** | < 5ms per 10k chunks |
| **Ingestion Speed** | ~100 pages/sec |
| **RAM Footprint** | < 1.5 GB |

---

## License

MIT

---

<p align="center">
  <sub>Built with obsessive attention to performance and privacy.</sub>
</p>
