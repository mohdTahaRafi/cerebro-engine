# 🧠 Cerebro Engine — Project Deep Dive

> *A privacy-first, fully offline RAG engine with a hardware-accelerated C++ vector search core.*

---

## 1. Setting the Background — Why This Project?

### The Problem I Observed

I was exploring the RAG (Retrieval-Augmented Generation) space and noticed a fundamental tension that nobody was solving cleanly:

**Every RAG tool on the market requires you to send your data to someone else's servers.**

- Want embeddings? Call OpenAI's API — your documents travel over the wire.
- Want vector search? Use Pinecone or Weaviate — your vectors live on their cloud.
- Want LLM answers? GPT-4 API — your queries and context are processed on OpenAI's infrastructure.

For a student or hobbyist, this is fine. But think about **corporate environments** — legal contracts, medical records, financial reports, proprietary codebases. The moment you pipe that through an external API, you've lost control of your data. Compliance teams (GDPR, HIPAA, SOC 2) would never sign off on it.

I thought: **what if the entire pipeline — parsing, embedding, searching, and generating answers — ran 100% on your local machine?** Zero network calls. Zero data exfiltration. The documents never leave the user's filesystem.

### The Technical Itch

But going fully local creates a second problem: **performance**. Cloud-hosted vector databases like Pinecone are fast because they run on specialized hardware (GPUs, custom indexes). If I'm running everything on a user's laptop CPU, I need the search to still feel instant. JavaScript alone can't do it — V8 is great for I/O-heavy web servers, but it chokes on tight numerical loops over hundreds of thousands of floating-point values.

This is where the idea crystallized:

> **What if I wrote the most performance-critical part — the vector similarity computation — in C++ with SIMD instructions, and bridged it directly into Node.js?**

That way I get the best of both worlds:
- **Node.js/Express** for the web server, file handling, and orchestration (what it's good at)
- **C++ with AVX2 SIMD** for the raw math (processing 8 floats per CPU cycle instead of 1)

### The Third Insight — Hybrid Search

While studying information retrieval, I realized that **pure vector search has a blind spot**. Semantic similarity is powerful — it understands that "automobile" and "car" are related. But it completely fails on exact keyword lookups. If someone searches for a specific invoice number like `"INV-49281"` or a person's name like `"Dr. Rajesh Kumar"`, vector search will return semantically similar but factually wrong results.

The fix? **Run both searches in parallel** — vector search for semantic understanding, text search for exact keyword matching — and **fuse the results using Reciprocal Rank Fusion (RRF)**, a score-agnostic algorithm from information retrieval research that merges ranked lists without needing to normalize their scores.

### What Made Me Commit to This Idea

Three things:

1. **It solves a real problem** — data privacy in enterprise RAG is not hypothetical; it's a deal-breaker for adoption.
2. **It forced me to go deep across the stack** — from C++ intrinsics and CPU architecture to React streaming UIs. It's not a CRUD app with a different skin.
3. **The C++ ↔ JavaScript bridge is genuinely unusual** — most Node.js developers never touch native addons. Building a zero-copy memory bridge between V8 and a C++ SIMD engine gave me something concrete and defensible to talk about.

---

## 2. Technologies Used and Why

### Architecture at a Glance

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

### Technology Breakdown

---

#### **Frontend: React 18 + Vite + TailwindCSS**

| Choice | Why |
|---|---|
| **React 18** | Component-based architecture with hooks for clean state management. The `useCerebroChat` hook uses the ReadableStream API to parse SSE tokens in real-time — React's state model (`setAnswer(prev => prev + token)`) makes incremental rendering trivial. |
| **Vite** | Near-instant HMR (Hot Module Replacement) during development. Unlike CRA's Webpack, Vite uses native ES modules and esbuild for transforms, so the dev server starts in milliseconds. The proxy config (`vite.config.ts`) routes `/api` calls to the Express backend seamlessly. |
| **TailwindCSS 4** | Utility-first CSS that eliminates stylesheet sprawl. For a project with 10+ components (AnswerBox, ChatInput, GlobalDropzone, SourceChip, ResultCard, Sidebar, etc.), Tailwind keeps styles co-located with markup instead of scattered across CSS files. |
| **Radix UI** | Headless, accessible UI primitives (dialogs, tooltips, dropdowns, accordions). Radix gives you WAI-ARIA compliant components without imposing any visual styling — I control the look entirely. |
| **Framer Motion** | Physics-based animations for the chat interface. The `ConsumerDashboard` uses `AnimatePresence` for enter/exit transitions — the header fades out as answers stream in, giving a polished, app-like feel. |
| **Lucide Icons** | Lightweight, tree-shakeable icon library. Only the icons actually used get bundled (unlike FontAwesome which ships everything). |
| **React Router 7** | Client-side routing between the dashboard pages (ConsumerDashboard, CoreEngine, IngestionEngine, VectorDebugger, ReliabilityConsole). |
| **Sonner** | Minimal toast notification library for ingestion success/failure feedback. |
| **React Markdown + remark-gfm** | Renders the LLM's streamed answer as rich markdown (tables, code blocks, lists) instead of raw text. |

**Why not Next.js?** — Cerebro is a fully local tool. There's no server-side rendering, no SEO requirement, no edge functions. A pure SPA with Vite is faster to develop, lighter to deploy, and doesn't carry the overhead of a meta-framework I don't need.

---

#### **Backend: Node.js + Express 5**

| Choice | Why |
|---|---|
| **Node.js** | The ecosystem has everything I need — `multer` for file uploads, `mongoose` for MongoDB, `@huggingface/transformers` for local embeddings. Node's event loop handles concurrent I/O (file parsing, DB queries, Ollama API calls) without threads. |
| **Express 5** | Minimal, unopinionated HTTP framework. Three endpoints is all Cerebro needs: `POST /api/ingest`, `POST /api/search`, `POST /api/ask`. Express 5's native async error handling (no more `try/catch` wrappers) made the SSE streaming endpoint clean. |
| **ES Modules** | The entire backend uses `"type": "module"` with `import/export`. This aligns with the HuggingFace transformers library which is ESM-only, and avoids the dual-module compatibility headaches of CommonJS. |

**Why not Python/FastAPI?** — The HuggingFace `transformers.js` library runs natively in Node.js, so I can do local embedding without spinning up a separate Python process. The entire stack (frontend + backend) shares one language and one runtime. The C++ addon bridges directly into Node.js via N-API — this wouldn't work with Python without a completely different FFI approach.

---

#### **C++ SIMD Core: node-addon-api (N-API) with AVX2/FMA**

This is the heart of the project. Here's why each piece exists:

| Choice | Why |
|---|---|
| **C++ (not Rust, not WASM)** | C++ compiles to a native `.node` binary via `node-gyp`. It runs at bare-metal speed with zero overhead — no WASM sandbox, no garbage collector, no runtime. Rust would give similar performance but adds a second build toolchain (Cargo) and the `neon` FFI is less mature than `node-addon-api`. |
| **AVX2 SIMD Intrinsics** | AVX2 gives access to 256-bit `__m256` registers that process **8 float32 values simultaneously** in a single CPU instruction. For a 384-dimensional dot product, this means 48 iterations instead of 384. Combined with **FMA (Fused Multiply-Add)**, each iteration does `sum += a[i] * b[i]` in one cycle instead of two. |
| **node-addon-api (N-API)** | N-API is ABI-stable across Node.js versions. Unlike raw V8 C++ APIs (which break every major Node release), a `.node` binary compiled with N-API on Node 18 works on Node 20, 22, etc. without recompilation. This was a deliberate choice for maintainability. |
| **Min-Heap Priority Queue** | Instead of sorting all 100K similarity scores (O(N log N)), the Min-Heap extracts Top-K results in O(N log K). For K=5 and N=100K, this is ~100K × log(5) ≈ 230K operations vs. ~100K × log(100K) ≈ 1.7M operations. The heap maintains a fixed-size window of the K best results seen so far, popping the smallest when a better candidate arrives. |
| **node-gyp + binding.gyp** | The `binding.gyp` file configures cross-platform compilation with the right SIMD flags: `-mavx2 -mfma` on Linux/GCC, `/arch:AVX2` on Windows/MSVC, and Xcode flags on macOS. This makes the native addon compile on all three platforms from a single config. |

**The Zero-Copy Bridge:** When JavaScript passes a `Float32Array` to C++, the `floatArray.Data()` call returns a raw `const float*` pointer directly into the ArrayBuffer's backing memory — the same bytes V8 allocated. There is no serialization, no JSON parsing, no copying. The C++ code reads the same memory the JavaScript created. This is what makes reranking 100K vectors feasible without memory overhead.

**Why not just use MongoDB's `$vectorSearch`?** — MongoDB's vector search uses an HNSW index for **approximate** nearest neighbors (ANN). It's fast (O(log N)) but can misrank results because it uses greedy traversal which can get stuck in local optima. The C++ SIMD engine does **exact** dot-product reranking on the top candidates that MongoDB returns. It's a two-phase pipeline: ANN for recall → SIMD for precision.

---

#### **Embeddings: @huggingface/transformers (all-MiniLM-L6-v2)**

| Choice | Why |
|---|---|
| **@huggingface/transformers** | This is the official JavaScript port of HuggingFace's transformers library. It runs transformer models **directly inside Node.js** using ONNX Runtime — no Python, no external API, no GPU required. |
| **all-MiniLM-L6-v2** | A 22M parameter sentence transformer that produces 384-dimensional embeddings. It's the sweet spot: small enough to load in ~2 seconds on a laptop (unlike the 110M parameter `all-mpnet-base-v2`), but accurate enough for production retrieval tasks. The 384 dimensions are also a perfect multiple of 8, which aligns exactly with AVX2's 256-bit registers (384 / 8 = 48 clean iterations). |
| **Singleton ModelLoader** | The model is loaded exactly once via a Singleton pattern with a tracked `loadPromise`. If two requests hit the server simultaneously during cold start, both await the same loading promise instead of loading the model twice (which would crash from OOM). |
| **L2 Pre-Normalization** | The `BatchEncoder` normalizes every vector to unit length at ingestion time (`V / ||V||`). This converts cosine similarity into a simple dot product at query time — because `cos(A, B) = dot(A, B)` when both vectors have magnitude 1. This eliminates 100K square root and division operations per query. The normalization cost is paid once per document at ingestion, amortized over all future queries. |
| **Batched Encoding** | Documents are encoded in batches of 50 chunks to prevent OOM on large files. Each batch runs through the model in parallel via `Promise.all()`, then results are packed into a single contiguous `Float32Array` — the exact format the C++ bridge expects. |

---

#### **Database: MongoDB (Atlas Vector Search + $text Indexes)**

| Choice | Why |
|---|---|
| **MongoDB** | A single database serves both storage AND retrieval. Chunks are stored as documents with a `text` field (for lexical search via `$text` index) and a `vector` field (for ANN search via Atlas `$vectorSearch`). No need for a separate vector DB like Pinecone alongside a document store. |
| **Atlas $vectorSearch** | MongoDB's native HNSW-based vector index. It handles the **recall stage** — quickly narrowing millions of documents down to ~100 approximate candidates using a graph-based nearest neighbor algorithm. This is the "wide net" phase. |
| **$text Index** | MongoDB's built-in full-text search with TF-IDF scoring. It handles exact keyword matching — catching results that vector search misses (specific IDs, names, technical terms). |
| **Mongoose** | ODM for connection management and schema validation. The `DatabaseService` uses raw `mongoose.connection.db.collection()` calls for direct access to aggregation pipelines (needed for `$vectorSearch`), while still benefiting from Mongoose's connection pooling. |

**Why not Pinecone/Weaviate/Qdrant?** — All three are cloud-hosted or require running a separate server process. Cerebro's design constraint is **zero external dependencies at runtime**. MongoDB can run locally (`mongod`) or on Atlas (for the vector index), and it serves as both the document store and the search index in one process.

---

#### **LLM: Ollama (llama3)**

| Choice | Why |
|---|---|
| **Ollama** | One-command local LLM server (`ollama serve`). It manages model downloads, quantization, and inference. The user doesn't need to worry about GGUF files, context windows, or GPU memory — Ollama handles it. |
| **llama3** | Meta's open-weight LLM. Strong instruction-following, good at grounded Q&A (answering from provided context without hallucinating). Configurable via `OLLAMA_MODEL` env var — users can swap in `mistral`, `phi3`, `gemma2`, etc. |
| **Streaming via NDJSON** | Ollama's `/api/generate` endpoint with `stream: true` returns newline-delimited JSON. The `GenerationService` parses each line, extracts the `response` token, and fires an `onToken` callback. The Express endpoint wraps this as SSE (`data: {token}\n\n`), which the frontend's `useCerebroChat` hook reads via the ReadableStream API. Result: tokens appear on screen as they're generated, not after a 10-second wait. |

**Why not OpenAI/Claude API?** — The entire point of Cerebro is zero data exfiltration. Calling an external LLM API defeats the purpose. Ollama runs the model on the user's CPU/GPU — the query and context never leave the machine.

---

#### **Document Parsing: UniversalLoader**

| Format | Library | Why This Library |
|---|---|---|
| **PDF** | `pdf-parse` | Extracts text page-by-page with boundary detection. Handles scanned PDFs poorly (no OCR), but works well for text-based PDFs which are the common case in corporate environments. |
| **DOCX** | `mammoth` | Extracts raw text from Word documents without requiring LibreOffice or a headless Office installation. Pure JavaScript, no system dependencies. |
| **CSV/Excel** | `xlsx` | Reads both `.csv` and `.xlsx/.xls` files. Each row is converted into a semantic sentence: `"Context: Name is John, Age is 30, Department is Engineering"` — this makes tabular data searchable via natural language. |
| **HTML/Web** | `cheerio` | Server-side jQuery. Fetches a URL, parses the HTML, extracts `body.text()`. Lightweight and doesn't require a headless browser (unlike Puppeteer). |
| **JSON** | Native `JSON.parse` | Arrays are split into per-item chunks. Objects are stringified as single chunks. |
| **Text/Markdown** | Native `fs` | Direct read → chunk pipeline. |

---

#### **Text Processing: TextSanitizer + SemanticChunker**

| Component | What It Does | Why It Matters |
|---|---|---|
| **TextSanitizer** | Unicode normalization (NFKD), HTML tag stripping, URL/email masking (`[URL]`, `[EMAIL]`), non-ASCII removal, whitespace collapse. | Raw document text is noisy. URLs, emails, and control characters add garbage tokens that pollute embeddings. Masking URLs (instead of removing them) preserves the sentence structure ("Visit [URL] for details" vs. "Visit for details"). |
| **SemanticChunker** | 4-level recursive splitting (paragraph → newline → sentence → word) with a 500-char target and 50-char sliding window overlap. | Fixed-size chunking breaks sentences mid-word. The recursive approach respects natural language boundaries — it tries paragraph breaks first, then sentences, then words as a last resort. The 50-char overlap ensures that context at chunk boundaries isn't lost (a fact split across two chunks is still retrievable from either one). |

---

#### **Supporting Libraries**

| Library | Purpose |
|---|---|
| **multer** | Multipart file upload handling for the `/api/ingest` endpoint. Stores uploaded files temporarily in `uploads/`, which are cleaned up after successful ingestion. |
| **cors** | Enables cross-origin requests from the Vite dev server (`:5173`) to the Express backend (`:5000`). |
| **dotenv** | Loads `MONGO_URI`, `PORT`, `OLLAMA_API_URL`, `OLLAMA_MODEL` from `.env`. Keeps secrets out of source code. |
| **axios** | HTTP client for calling Ollama's streaming API with `responseType: 'stream'`. Fetch API could work too, but axios's stream handling is more ergonomic in Node.js. |
| **opossum** | Circuit breaker library (in dependencies). Prevents cascading failures if Ollama or MongoDB goes down — after N failures, the circuit "opens" and returns a fallback response (HTTP 503) instead of hanging. The frontend's `useCerebroSearch` hook detects this with `isCircuitOpen` state. |

---

### Technology Decision Matrix

| Decision Point | Chosen | Rejected Alternative | Why |
|---|---|---|---|
| Vector math runtime | C++ SIMD (AVX2) | Pure JavaScript | JS processes 1 float/cycle. AVX2 processes 8. Benchmarked ~10× speedup on 100K vectors. |
| Vector math runtime | C++ SIMD (AVX2) | WebAssembly (WASM) | WASM runs in a sandbox with bounds checking. Native C++ has zero overhead. WASM also can't use AVX2 — it's limited to 128-bit SIMD. |
| Vector math runtime | C++ SIMD (AVX2) | Rust (neon crate) | Similar performance, but adds Cargo toolchain. `node-addon-api` is more mature and battle-tested for Node.js addons. |
| JS ↔ C++ bridge | N-API (node-addon-api) | Raw V8 API | V8 API breaks on every Node major version. N-API is ABI-stable — compile once, run on any Node version. |
| Embedding model | Local HuggingFace | OpenAI API | Zero data exfiltration. No API keys, no costs, no latency from network calls. |
| Vector database | MongoDB Atlas + local | Pinecone / Weaviate | Single DB for both storage and search. No separate vector DB process. Runs locally. |
| LLM | Ollama (local) | OpenAI GPT-4 API | Privacy-first. Documents and queries never leave the machine. |
| Search strategy | Hybrid (vector + lexical) | Vector-only | Vector search misses exact keywords. Hybrid with RRF catches both semantic and lexical matches. |
| Fusion algorithm | RRF (k=60) | Linear score combination | RRF is score-agnostic — it uses ranks, not raw scores. This means you can fuse results from systems with completely different scoring scales (cosine similarity vs. TF-IDF) without normalization. |
| Chunking strategy | Recursive + sliding window | Fixed-size split | Fixed-size breaks sentences. Recursive respects natural language boundaries. Overlap preserves cross-chunk context. |
| Frontend framework | React + Vite (SPA) | Next.js | No SSR/SEO needed. Pure SPA is lighter and faster for a local desktop tool. |

---

### Technologies I Didn't Use and Why

This section is just as important as the tech stack itself — every rejection was a deliberate architectural decision, not ignorance.

---

#### **Frontend — Rejected Alternatives**

| Rejected Tech | Why Not |
|---|---|
| **Next.js** | Cerebro is a fully local desktop tool. Next.js brings server-side rendering, edge functions, and file-based routing — none of which matter when there's no SEO, no server deployment, and no crawlers. It would add ~40MB of framework overhead and a build step for features I'd never use. Vite gives me instant HMR, a clean proxy config, and zero opinions about routing. |
| **Angular** | Angular's opinionated module system and dependency injection are designed for large enterprise teams with strict conventions. For a solo project with ~15 components, React hooks + Context provide equivalent state management with a fraction of the boilerplate. Angular's AOT compilation also adds build complexity I don't need. |
| **Vue.js** | Vue is excellent for rapid prototyping, but its ecosystem for complex streaming UIs (ReadableStream parsing, SSE hooks) is less mature than React's. The `useCerebroChat` hook relies heavily on React's `useState` callback pattern (`setAnswer(prev => prev + token)`) which maps naturally to token-by-token rendering. Vue's reactivity system could do this, but React's approach was more natural for the streaming use case. |
| **Svelte/SvelteKit** | Svelte compiles to vanilla JS (no virtual DOM), which is great for performance — but Cerebro's frontend bottleneck is network I/O (SSE streaming, API calls), not rendering. The virtual DOM overhead is negligible. Svelte's ecosystem of accessible UI primitives (comparable to Radix UI) is also less mature. |
| **Redux / Zustand** | Cerebro's state is simple — a results array, an answer string, loading booleans, and an error string. Redux would scatter this across action creators, reducers, middleware, and selectors for no benefit. Zustand is lighter but still an unnecessary dependency when React Context + two custom hooks (`useCerebroSearch`, `useCerebroChat`) handle everything cleanly. |
| **Chakra UI / Material UI** | Both are pre-styled component libraries that impose a visual identity. Cerebro has a custom dark-mode design language. Radix UI gives me the accessibility primitives (keyboard navigation, ARIA attributes, focus management) without any visual opinions — I control every pixel with Tailwind. |

---

#### **Backend — Rejected Alternatives**

| Rejected Tech | Why Not |
|---|---|
| **Python / FastAPI** | The strongest alternative. Python has the richest ML ecosystem (PyTorch, sentence-transformers, FAISS). But using Python would mean: (1) running a **separate process** for embeddings (the C++ addon can't bridge into Python via N-API), (2) a two-language stack (JS frontend + Python backend) with no shared types, (3) the HuggingFace `transformers.js` library already runs the same models natively in Node.js. By staying in Node.js, the entire stack is one language, one runtime, and the C++ addon shares memory directly with the web server. |
| **Go / Gin** | Go excels at concurrent network servers, but Cerebro's backend is I/O-bound (file parsing, DB queries, Ollama streaming), not CPU-bound at the server level. The CPU-bound work (vector math) is in C++, which Node.js bridges via N-API. Go doesn't have an equivalent to N-API — you'd need cgo, which has significant FFI overhead and complicates cross-compilation. |
| **Rust / Actix-web** | Similar argument to Go. Rust gives great performance but the entire Node.js ecosystem (multer, mongoose, cheerio, mammoth, xlsx) would need to be replaced with Rust equivalents — many of which don't exist at the same maturity level. The 10× speedup in Cerebro comes from the C++ SIMD core (150 lines), not the web server. Rewriting the server in Rust would give marginal improvement at massive development cost. |
| **Deno / Bun** | Both are modern JS runtimes, but native addon support (N-API) is less mature than Node.js. Cerebro's C++ core compiles via `node-gyp` which targets Node specifically. Porting to Deno's FFI or Bun's native plugin system would require reworking the build pipeline. Node.js is also where `@huggingface/transformers` is best tested. |
| **NestJS** | A TypeScript framework with decorators, dependency injection, and module architecture inspired by Angular. Cerebro has 3 endpoints and 5 services — NestJS's enterprise-grade scaffolding (controllers, providers, guards, interceptors, pipes) would add massive boilerplate for a project where a flat `express` app with clean imports is sufficient. |
| **GraphQL (Apollo)** | Cerebro's API is three simple POST endpoints. GraphQL's query language, schema definitions, resolvers, and type generation are designed for complex relational data with flexible client queries. Cerebro's data flow is fixed and linear — there's no scenario where the frontend needs to request different field combinations. REST is simpler and sufficient. |

---

#### **Vector Search — Rejected Alternatives**

| Rejected Tech | Why Not |
|---|---|
| **Pinecone** | Cloud-hosted vector database. Every vector you store lives on Pinecone's infrastructure. This directly violates Cerebro's core privacy constraint. Also adds network latency to every search query (~50-100ms round trip) that doesn't exist with a local C++ engine (~8ms). Pinecone charges per vector stored — Cerebro is free. |
| **Weaviate** | Can run locally via Docker, but adds a **separate server process** with its own resource consumption. Cerebro's architecture keeps everything in one Node.js process (with C++ bridged in). Adding Weaviate means managing Docker, ports, health checks, and an additional 500MB+ of container overhead on the user's machine. |
| **Qdrant** | Same issue as Weaviate — separate process. Qdrant is Rust-based and efficient, but still requires running a standalone server. For a single-machine tool, the operational overhead isn't justified when MongoDB (which we already need for document storage) provides vector search natively. |
| **FAISS (Facebook AI Similarity Search)** | The gold standard for vector search in Python. But FAISS is a C++/Python library — there's no official Node.js binding. I'd need to either: (a) run FAISS in a Python subprocess (adding inter-process communication latency), or (b) write custom N-API bindings for FAISS (massive undertaking). Building a focused 150-line SIMD engine was simpler and gave me exactly the functionality I needed — nothing more. |
| **Elasticsearch with kNN** | Elasticsearch supports approximate kNN search, but it's a 1GB+ Java application with significant memory overhead. Running it alongside MongoDB, Ollama, and the Node.js server on a laptop would compete for RAM. MongoDB does double duty (document store + vector search), eliminating the need for a separate search engine entirely. |
| **ChromaDB** | A lightweight Python-based vector store popular in LangChain tutorials. But it's Python-only (same FFI problem), stores data in SQLite (less scalable than MongoDB), and doesn't support lexical search natively — I'd lose the hybrid search capability. |

---

#### **Embedding Models — Rejected Alternatives**

| Rejected Tech | Why Not |
|---|---|
| **OpenAI Embeddings API** (`text-embedding-3-small`) | Sends your documents to OpenAI's servers for embedding. Violates the privacy guarantee. Also costs $0.02 per 1M tokens — Cerebro's local model is free and unlimited. |
| **Cohere Embed API** | Same cloud dependency issue. Also adds ~200ms of network latency per embedding call that doesn't exist with a local model. |
| **all-mpnet-base-v2** (110M params) | More accurate than `all-MiniLM-L6-v2`, but 5× larger. Takes ~10 seconds to load and ~3× longer to encode. For a laptop-first tool where cold start matters, the accuracy gain doesn't justify the latency cost. MiniLM is the sweet spot for Cerebro's use case. |
| **sentence-transformers (Python)** | The canonical Python library for sentence embeddings. But it requires a Python runtime, PyTorch (~2GB), and a separate process. `@huggingface/transformers` runs the exact same ONNX model inside Node.js — one runtime, no Python dependency. |
| **TensorFlow.js** | Supports running models in Node.js, but the HuggingFace ecosystem has standardized on ONNX Runtime for JavaScript inference. TF.js model availability for sentence transformers is limited compared to the HuggingFace model hub. |

---

#### **LLM — Rejected Alternatives**

| Rejected Tech | Why Not |
|---|---|
| **OpenAI GPT-4 / GPT-4o API** | Cloud-hosted. The query, the retrieved context, and the generated answer all pass through OpenAI's servers. Completely defeats Cerebro's privacy-first design. |
| **Anthropic Claude API** | Same cloud dependency. Also, Claude's API doesn't support NDJSON streaming in the same way Ollama does — the integration pattern would be different. |
| **llama.cpp directly** | Ollama is essentially a wrapper around llama.cpp. Using llama.cpp directly would give marginally more control but require me to manage model file paths, GGUF quantization, context window sizing, and KV cache management manually. Ollama abstracts all of this into `ollama pull llama3` + `ollama serve`. The developer experience tradeoff is overwhelmingly in Ollama's favor. |
| **vLLM** | High-throughput LLM serving engine with PagedAttention. Designed for multi-GPU servers handling hundreds of concurrent requests. Massive overkill for a single-user local tool. Also Python-only. |
| **LM Studio** | A desktop GUI for running local LLMs. It has an API mode, but it's an Electron app with its own resource footprint. Ollama is a lightweight CLI daemon — simpler to integrate and lighter on resources. |

---

#### **Search Strategy — Rejected Alternatives**

| Rejected Tech | Why Not |
|---|---|
| **Vector Search Only** | Misses exact keyword matches. A query for `"INV-49281"` returns semantically similar but factually wrong results. Hybrid search catches both semantic meaning and exact tokens. |
| **Lexical Search Only (Elasticsearch-style)** | Misses semantic relationships. A query for "revenue growth" won't match a chunk containing "sales increased" because the keywords are different. Vector search captures this semantic equivalence. |
| **Cross-Encoder Reranking** | A cross-encoder (e.g., `ms-marco-MiniLM-L-6-v2`) scores (query, document) pairs through a full transformer pass. More accurate than RRF, but adds ~50-100ms per query and requires loading a second ML model into memory (~200MB). For Cerebro's target latency (<150ms total), this budget doesn't exist. |
| **LangChain / LlamaIndex** | Orchestration frameworks that abstract RAG pipelines. But they're Python-only, opinionated about embedding/LLM providers (default to OpenAI), and add a thick abstraction layer over operations that are ~50 lines of code in Cerebro. I'd rather understand and control every step than delegate to a framework. |
| **Learned Sparse Retrieval (SPLADE)** | Uses a learned model to generate sparse token weights for retrieval. More accurate than TF-IDF but requires a separate model and produces high-dimensional sparse vectors. MongoDB's `$text` index with TF-IDF is simpler and sufficient for Cerebro's use case. |

---

#### **C++ Alternatives — Rejected Approaches**

| Rejected Approach | Why Not |
|---|---|
| **WebAssembly (WASM)** | WASM runs in a sandboxed virtual machine with bounds-checked memory access. This adds overhead on every array access. More critically, WASM SIMD is limited to 128-bit operations (4 floats) — equivalent to SSE, not AVX2 (8 floats). Native C++ with AVX2 is 2× wider. WASM also can't use FMA intrinsics. |
| **Rust via neon** | Rust's `neon` crate provides N-API bindings. Performance would be identical to C++. But `neon` is less mature — fewer examples, smaller community, and adds the Cargo build system alongside node-gyp. For 150 lines of numerical code with no manual memory management, Rust's safety guarantees provide negligible benefit over C++. |
| **GPU compute (CUDA / WebGPU)** | Would provide massive speedup for batch operations, but requires an NVIDIA GPU (CUDA) or a compatible GPU (WebGPU). Cerebro must run on any laptop, including those with integrated Intel graphics. CPU SIMD is universally available. GPU could be added as an optional acceleration path in the future. |
| **Node.js Worker Threads** | JavaScript running in a separate thread still has V8's type guards and bounds checking. It parallelizes across cores but doesn't make individual computations faster. The bottleneck is per-operation overhead, not core utilization. SIMD solves the right problem. |
| **AVX-512** | 512-bit registers (16 floats per instruction). 2× wider than AVX2. But AVX-512 is only available on server-grade Intel Xeons and some recent consumer CPUs (Alder Lake+). AVX2 has been standard on all x86 CPUs since 2013. Portability trumps peak performance. |
