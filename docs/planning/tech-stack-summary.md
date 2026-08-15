# Tech Stack — Replan

> Condensed reference. Authoritative choices, version floors, and justifications live in
> [architecture.md §3](architecture.md); rejected alternatives in §3.1.

| Component | Current | New |
|---|---|---|
| Backend runtime | Node.js + Express 5 | Node.js 22 LTS + Express 5 (unchanged) |
| Vision runtime | none | Python 3.11 + FastAPI 0.115 (`:8100`) — required, ColPali has no JS port |
| Document parsing (text) | pdf-parse, mammoth (raw text), cheerio, xlsx | LlamaParse (PDF/DOCX/PPTX) + LangChain.js loaders (TXT/MD/CSV/JSON); `xlsx` retained for spreadsheets |
| PDF routing | none — all PDFs treated as text | Per-page classifier (PyMuPDF): `charCount < 200` or `imageCoverage > 0.45` → visual |
| OCR | none | Tesseract 5 via `pytesseract`, LSTM engine, per-word confidence floor 40 |
| Page rendering | none | PyMuPDF 1.24+ → 150 dpi JPEG q85, rotation-normalized, deskewed |
| Visual retrieval | none | ColPali `vidore/colpali-v1.3` (~1030 patches × 128-d late interaction). Fallback: `vidore/colqwen2-v1.0` |
| Sanitization | hand-rolled ASCII-strip regex pipeline | Unicode **NFC** normalize + whitespace + de-hyphenation (no ASCII stripping, no tag regex) |
| Chunking | hand-rolled char-count recursive splitter | LangChain.js Markdown-header + recursive splitters, **token-aware**: 480 tokens / 60 overlap |
| Text embeddings | transformers.js, `all-MiniLM-L6-v2` (384-d) | Cohere `embed-multilingual-v3.0` (1024-d), asymmetric `search_document` / `search_query` |
| Sparse/lexical | MongoDB `$text` index | FastEmbed `Qdrant/bm25` sparse vectors, local, fused server-side |
| Vector store | MongoDB Atlas `$vectorSearch` (unversioned index) | Qdrant 1.12+ — `cerebro_chunks` (dense+sparse, RRF fusion) and `cerebro_pages` (multivector MAX_SIM, int8 quantized) |
| Fusion | hand-rolled RRF in JS | Qdrant native RRF via the Query API (one round trip) |
| Reranking | none | Cohere `rerank-multilingual-v3.0` cross-encoder, relevance floor 0.15 |
| Orchestration | manual Express route wiring | LangChain.js 0.3 + LangGraph.js 0.2 (`StateGraph`, 2 conditional edges) |
| Job queue | none (synchronous ingest) | BullMQ 5 + Redis 7, concurrency 2, 3 attempts w/ exponential backoff |
| Observability/tracing | hand-rolled telemetry object | LangSmith (per-node spans, payload redaction) + Prometheus `/metrics` |
| Generation (text + vision) | Ollama `llama3`, hardcoded, text-only | **Claude Sonnet 5** (`claude-sonnet-5`) primary; **Ollama `llama3.2-vision:11b`** fallback via `LLM_PROVIDER` |
| Page image storage | none | `StorageAdapter`: filesystem (dev) / MinIO S3 (prod) |
| App data (conversations, doc registry) | none | MongoDB 7 + Mongoose — repurposed from vector store to app/session store |
| Resilience | `opossum` on `/api/search` | `opossum` on every provider adapter, per-call timeouts, declared failure modes |
| Rate limiting | none | `express-rate-limit` + Redis store, per-route budgets |
| C++ SIMD engine | primary retrieval path | Benchmark artifact only — retained, compiled, tested; out of the serving path |
| Reverse proxy / TLS | none | Caddy 2 (auto-HTTPS, SSE passthrough via `flush_interval -1`) |
| Frontend | React 19 / Vite 6 / Tailwind 4 | unchanged |
