# Phase 1: Foundation & Provider Skeleton

## 1. Objective

Stand up every piece of infrastructure the new pipeline depends on, and prove each one is reachable from the Node backend through a single adapter layer. Docker Compose brings up Qdrant, MongoDB, Redis, and the Python vision service; `GET /health` probes all four plus the three external APIs and reports each independently; a trivial two-node LangGraph chain executes end to end and its trace appears in the LangSmith UI. By the end of this phase: a developer runs `docker compose up`, hits `GET /health`, and sees every dependency reporting `up` with a measured latency — then hits `POST /api/graph/ping` and watches the run appear in LangSmith seconds later.

**No ingestion, no parsing, no chunking, no embedding of real documents, no retrieval, no generation, no frontend changes.** The existing `/api/ingest`, `/api/search`, and `/api/ask` routes keep running untouched on the legacy pipeline — they are not migrated until Phases 2, 3, and 5 respectively. This phase produces the skeleton those phases hang from.

---

## 2. Infrastructure — `docker-compose.yml`

All four backing services run as containers. The Node backend runs on the host during development (`npm run dev`, for `--watch`), and is containerized in Phase 6.

```yaml
services:
  qdrant:
    image: qdrant/qdrant:v1.12.4
    ports:
      - "6333:6333"   # HTTP/REST + dashboard at /dashboard
      - "6334:6334"   # gRPC — exposed for tooling; the Node client uses :6333 (REST) — see architecture §5.11
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      QDRANT__SERVICE__GRPC_PORT: 6334
      QDRANT__STORAGE__QUANTIZATION__ALWAYS_RAM: "true"
    healthcheck:
      # Qdrant has no curl/wget in the image; use its own TCP readiness via bash
      test: ["CMD-SHELL", "bash -c ':> /dev/tcp/127.0.0.1/6333' || exit 1"]
      interval: 5s
      timeout: 3s
      retries: 10

  mongo:
    image: mongo:7.0
    ports:
      - "27017:27017"
    volumes:
      - mongo_data:/data/db
    healthcheck:
      test: ["CMD", "mongosh", "--quiet", "--eval", "db.adminCommand('ping').ok"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7.4-alpine
    ports:
      - "6379:6379"
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction"]
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  vision:
    build: ./vision
    ports:
      - "8100:8100"
    volumes:
      - hf_cache:/root/.cache/huggingface   # persist ColPali weights across rebuilds
      - ./storage/pages:/storage/pages       # page images written here, read by Node
    environment:
      COLPALI_MODEL: vidore/colpali-v1.3
      COLPALI_DEVICE: cpu
      PAGE_STORAGE_DIR: /storage/pages
      OMP_NUM_THREADS: "4"
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8100/health')"]
      interval: 15s
      timeout: 10s
      retries: 20          # 20 × 15s = 5 min; first boot downloads ~3 GB of ColPali weights
      start_period: 120s

volumes:
  qdrant_data:
  mongo_data:
  redis_data:
  hf_cache:
```

**`maxmemory-policy noeviction`** is deliberate: Redis holds BullMQ job state from Phase 2 onward. An eviction policy that discards keys under pressure would silently drop queued ingestion jobs. Failing writes loudly is correct here.

**`retries: 20` with `start_period: 120s`** on the vision service accounts for the ColPali weight download on first boot (~3 GB from the HF Hub). Subsequent boots hit the `hf_cache` volume and are ready in ~25 s.

---

## 3. Configuration — `backend/src/config/index.js`

Every environment variable is parsed and validated once at startup. Missing required keys crash the process immediately with a list of what is absent — never a `undefined` propagating into a provider call three layers down.

```js
import 'dotenv/config';

const REQUIRED = [
  'MONGO_URI',
  'QDRANT_URL',
  'REDIS_URL',
  'VISION_SERVICE_URL',
  'COHERE_API_KEY',
  'LLAMA_CLOUD_API_KEY',
];

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') return null;
  return value.trim();
}

const missing = REQUIRED.filter((k) => required(k) === null);
if (missing.length > 0) {
  console.error(`[config] Missing required environment variables:\n  ${missing.join('\n  ')}`);
  console.error('[config] Copy .env.example to .env and fill these in.');
  process.exit(1);
}

export const config = {
  port: Number(process.env.PORT ?? 5000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  mongo: { uri: required('MONGO_URI') },

  qdrant: {
    url: required('QDRANT_URL'),                       // http://localhost:6333 (REST — architecture §5.11)
    apiKey: process.env.QDRANT_API_KEY ?? undefined,   // unset locally, set for Qdrant Cloud
    chunksCollection: process.env.QDRANT_CHUNKS_COLLECTION ?? 'cerebro_chunks',
    pagesCollection: process.env.QDRANT_PAGES_COLLECTION ?? 'cerebro_pages',
  },

  redis: { url: required('REDIS_URL') },

  vision: {
    url: required('VISION_SERVICE_URL'),               // http://localhost:8100
    timeoutMs: Number(process.env.VISION_TIMEOUT_MS ?? 120_000), // 20 pages × ~6s
  },

  cohere: {
    apiKey: required('COHERE_API_KEY'),
    embedModel: process.env.COHERE_EMBED_MODEL ?? 'embed-multilingual-v3.0',
    rerankModel: process.env.COHERE_RERANK_MODEL ?? 'rerank-multilingual-v3.0',
    embedDimensions: 1024,                             // fixed by embed-multilingual-v3.0
  },

  llamaParse: { apiKey: required('LLAMA_CLOUD_API_KEY') },

  llm: {
    provider: process.env.LLM_PROVIDER ?? 'anthropic', // 'anthropic' | 'ollama'
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
    },
    ollama: {
      baseUrl: process.env.OLLAMA_API_URL ?? 'http://127.0.0.1:11434',
      model: process.env.OLLAMA_MODEL ?? 'llama3.2-vision:11b',
    },
  },

  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'filesystem', // 'filesystem' | 's3'
    pagesDir: process.env.PAGE_STORAGE_DIR ?? './storage/pages',
    uploadsDir: process.env.UPLOAD_STORAGE_DIR ?? './storage/uploads',
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  },

  tracing: {
    enabled: process.env.LANGCHAIN_TRACING_V2 === 'true',
    project: process.env.LANGCHAIN_PROJECT ?? 'cerebro',
  },
};

// Provider-conditional validation: the primary LLM path needs its key.
if (config.llm.provider === 'anthropic' && !config.llm.anthropic.apiKey) {
  console.error('[config] LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY.');
  process.exit(1);
}
```

### 3.1 `.env.example`

Committed with key names and empty values. Never live credentials.

```bash
PORT=5000
NODE_ENV=development

MONGO_URI=mongodb://localhost:27017/cerebro
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
REDIS_URL=redis://localhost:6379
VISION_SERVICE_URL=http://localhost:8100

COHERE_API_KEY=
LLAMA_CLOUD_API_KEY=

LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5
OLLAMA_API_URL=http://127.0.0.1:11434
OLLAMA_MODEL=llama3.2-vision:11b

STORAGE_DRIVER=filesystem
PAGE_STORAGE_DIR=./storage/pages
UPLOAD_STORAGE_DIR=./storage/uploads
# S3/MinIO — only read when STORAGE_DRIVER=s3 (Phase 6). Listed here (empty) because
# config/index.js's s3 sub-object is live from Phase 1, even though unused until then.
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=

LANGCHAIN_TRACING_V2=true
LANGCHAIN_PROJECT=cerebro
LANGCHAIN_API_KEY=
```

---

## 4. Qdrant Collections — `backend/scripts/setup-qdrant.js`

Both collections are created by an idempotent script, checked into the repo. This is the direct fix for the audit finding that the Atlas vector index existed only in a web UI with no versioned definition.

### 4.1 `cerebro_chunks` — text units

```js
await client.createCollection(config.qdrant.chunksCollection, {
  vectors: {
    dense: {
      size: 1024,                    // embed-multilingual-v3.0 output width
      distance: 'Cosine',            // Cohere v3 vectors are not unit-normalized; Cosine, not Dot
      on_disk: false,                // 100k × 1024 × 4B = 410 MB — fits RAM, keep it hot
    },
  },
  sparse_vectors: {
    // modifier: 'idf' — Amended during Phase 2 implementation (architecture §5.12): Qdrant
    // computes real BM25 (IDF + length normalization) server-side from raw term-frequency
    // counts when this is set; the client only ever sends counts, never weights.
    sparse: { index: { on_disk: false }, modifier: 'idf' },
  },
  optimizers_config: {
    default_segment_number: 2,       // 2 segments on a dev-scale corpus; more adds merge overhead
  },
  hnsw_config: {
    m: 16,                           // Qdrant default; recall ≈0.97 at this corpus size
    ef_construct: 128,               // build-time candidate width; 128 balances build time vs recall
  },
});
```

`distance: 'Cosine'` is a correctness requirement, not a preference. The legacy pipeline L2-normalized in JS and then used a raw dot product in C++, which only coincidentally equalled cosine. Cohere v3 embeddings arrive un-normalized, so Dot would rank by magnitude as well as direction. Cosine removes the implicit coupling entirely.

### 4.2 `cerebro_pages` — visual units

Created in Phase 1 so the schema is versioned from the start; **not written to until Phase 4**.

```js
await client.createCollection(config.qdrant.pagesCollection, {
  vectors: {
    colpali: {
      size: 128,                     // ColPali v1.3 per-patch vector width
      distance: 'Cosine',
      multivector_config: { comparator: 'max_sim' },   // late interaction — mandatory for ColPali
      quantization_config: {
        scalar: { type: 'int8', quantile: 0.99, always_ram: true },
      },
      on_disk: true,                 // raw fp32 multivectors to disk; int8 copies stay in RAM
    },
  },
});
```

`quantile: 0.99` clips the top 1% of magnitudes when computing the int8 scale, which prevents a single outlier dimension from compressing the useful range. `always_ram: true` on the quantized copy is what keeps MAX_SIM inside the 400 ms budget — the rescoring pass reads int8 from memory and only touches disk for the final top candidates.

### 4.3 Payload Indexes

Created on both collections so `scopeDocumentIds` filtering (Phase 3) is index-backed rather than a full scan:

```js
for (const collection of [chunksCollection, pagesCollection]) {
  await client.createPayloadIndex(collection, { field_name: 'documentId', field_schema: 'keyword' });
  await client.createPayloadIndex(collection, { field_name: 'contentHash', field_schema: 'keyword' });
}
```

The script re-reads existing collections first and skips creation when the vector config already matches, so re-running it is safe. If a collection exists with a *mismatched* config (e.g. left over from a different embedding model), it exits non-zero with the diff rather than silently serving wrong-dimension results.

---

## 5. Mongoose Models

MongoDB stops holding vectors and becomes the application store. Four schemas; all four are created in this phase, though only `Document` is written to before Phase 2.

### 5.1 `backend/src/models/Document.js`

```js
const DocumentSchema = new mongoose.Schema({
  fileName:     { type: String, required: true },
  mimeType:     { type: String, required: true },
  sizeBytes:    { type: Number, required: true },
  contentHash:  { type: String, required: true, index: true },  // sha256 of raw bytes
  storagePath:  { type: String, required: true },
  status: {
    type: String,
    required: true,
    enum: ['queued', 'processing', 'ready', 'failed', 'duplicate'],
    default: 'queued',
    index: true,
  },
  error:        { type: String, default: null },        // human-readable failure reason
  pageCount:    { type: Number, default: 0 },
  textPageCount:   { type: Number, default: 0 },        // populated Phase 4
  visualPageCount: { type: Number, default: 0 },        // populated Phase 4
  chunkCount:   { type: Number, default: 0 },
  progress:     { type: Number, default: 0, min: 0, max: 100 },
  duplicateOf:  { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
}, { timestamps: true });

DocumentSchema.index({ createdAt: -1 });
DocumentSchema.index({ fileName: 'text' });   // powers FR-DOC-04 list filtering
```

`contentHash` is indexed but **not unique** — a re-upload of identical bytes creates a row marked `duplicate` pointing at the original via `duplicateOf`, rather than erroring. This preserves the audit trail of what the user attempted while satisfying FR-ING-09.

### 5.2 `Conversation.js`, `Message.js`, `UsageEvent.js`

```js
const ConversationSchema = new mongoose.Schema({
  title:        { type: String, default: 'New conversation' },
  lastMessageAt:{ type: Date, default: Date.now, index: true },
}, { timestamps: true });

const MessageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  role:           { type: String, required: true, enum: ['user', 'assistant'] },
  content:        { type: String, required: true },
  condensedQuery: { type: String, default: null },   // what retrieval actually ran on
  sources: [{                                         // the units actually cited
    kind:       { type: String, enum: ['chunk', 'page'], required: true },
    pointId:    { type: String, required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
    page:       { type: Number, default: null },
    score:      { type: Number, required: true },
  }],
}, { timestamps: true });
MessageSchema.index({ conversationId: 1, createdAt: 1 });

const UsageEventSchema = new mongoose.Schema({
  provider:   { type: String, required: true },   // 'cohere' | 'anthropic' | 'llamaparse' | 'ollama'
  operation:  { type: String, required: true },   // 'embed' | 'rerank' | 'generate' | 'parse'
  requestId:  { type: String, default: null },
  inputTokens:  { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  callCount:  { type: Number, default: 1 },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
}, { timestamps: true });
UsageEventSchema.index({ createdAt: -1, provider: 1 });
```

---

## 6. Provider Adapters — `backend/src/providers/`

Every external dependency sits behind exactly one module exposing a narrow interface. This is what makes NFR-MAINT-01 mechanically true rather than aspirational: swapping Cohere for Voyage touches one file. Phase 1 implements the adapters with real connectivity but only the operations `/health` needs; the domain operations land in the phase that first uses them.

| Adapter | Phase 1 implements | Deferred |
|---|---|---|
| `vectorStore.js` | `client()`, `ping()`, `ensureCollections()` | `upsertChunks` [Phase 2], `hybridQuery` [Phase 3], `deleteByDocument` [Phase 2], `multivectorQuery` [Phase 4] |
| `embeddings.js` | `ping()` (1-token embed of `"ping"`) | `encodeDocuments` [Phase 2], `encodeQuery` [Phase 3] |
| `reranker.js` | `ping()` (2-doc rerank) | `rerank` [Phase 3] |
| `llm.js` | `chatModel()` factory, `ping()` | streaming generation [Phase 5] |
| `parser.js` | `ping()` (LlamaParse account check) | `parseDocument` [Phase 2] |
| `visionService.js` | `health()` | `classify`, `embedPages` [Phase 4] |
| `storage.js` | `put`, `get`, `delete`, `exists` (filesystem driver) | S3 driver [Phase 6] |

### 6.1 Circuit Breaker Wrapping

Every adapter's outbound call is wrapped in one shared `opossum` factory rather than each file configuring its own:

```js
// backend/src/providers/breaker.js
import CircuitBreaker from 'opossum';

const DEFAULTS = {
  errorThresholdPercentage: 50,
  volumeThreshold: 3,       // need 3 requests in the window before tripping
  resetTimeout: 10_000,     // 10s before a half-open trial request
};

const registry = new Map();

export function wrap(name, fn, { timeout }) {
  if (registry.has(name)) return registry.get(name);
  const breaker = new CircuitBreaker(fn, { ...DEFAULTS, timeout, name });
  breaker.on('open',     () => console.warn(`[breaker] ${name} OPEN`));
  breaker.on('halfOpen', () => console.info(`[breaker] ${name} HALF-OPEN`));
  breaker.on('close',    () => console.info(`[breaker] ${name} CLOSED`));
  registry.set(name, breaker);
  return breaker;
}

export function breakerStates() {
  return Object.fromEntries(
    [...registry.entries()].map(([name, b]) => [
      name, b.opened ? 'open' : b.halfOpen ? 'half-open' : 'closed',
    ]),
  );
}
```

Per-adapter timeouts, each justified:

| Breaker | Timeout | Justification |
|---|---|---|
| `cohere.embed` | 10 s | A 96-text batch returns in ~800 ms p95; 10 s is >10× headroom without holding a worker |
| `cohere.rerank` | 5 s | 50 short documents return in ~250 ms p95; this stage is inside the interactive query budget |
| `llamaparse` | 180 s | A 100-page PDF takes 60–120 s. This runs in a BullMQ worker, not a request |
| `vision.classify` | 30 s | PyMuPDF metadata-only pass over 500 pages is ~2 s; 30 s covers a pathological file |
| `vision.embedPages` | 120 s | 20 pages × ~6 s/page = 120 s, matching `config.vision.timeoutMs` |
| `qdrant` | 5 s | ANN query is ~20 ms; a 5 s breach means the node is unhealthy, not slow |
| `llm.generate` | 120 s | A long grounded answer streams for up to ~90 s; the breaker guards a hung socket, not slowness |

### 6.2 Failure Modes — Declared Per Adapter

| Adapter down | What happens | What the user sees |
|---|---|---|
| **Qdrant** | Breaker opens. Ingestion jobs fail and retry with backoff; retrieval returns 503 | "Search is temporarily unavailable." Existing conversations still load from Mongo |
| **Cohere embed** | Ingestion jobs retry (3 attempts); query path returns 503 | Upload sits in `processing` then flips to `failed` with the provider message. Search returns the 503 banner |
| **Cohere rerank** | Retrieval degrades to fusion order without reranking, logs a warning, sets `telemetry.rerankSkipped: true` | Results still return, slightly worse ordered. No error — degradation beats failure here |
| **LlamaParse** | Job retries 3× then marks the document `failed`; the uploaded file is retained for retry | Document row shows `failed` with the reason, and a Retry action |
| **Vision service** | Visual pages are skipped; text pages still ingest; document completes as `ready` with `visualPageCount: 0` and a warning recorded | Document ingests, and the UI notes that scanned pages were skipped |
| **Redis** | BullMQ cannot enqueue. Upload returns 503 *before* writing the Document row, so no orphan `queued` row is created | "Upload is temporarily unavailable." No half-created document |
| **Mongo** | Process cannot start; if it drops at runtime, all routes 503 | Full outage — this is the one non-degradable dependency |
| **Anthropic** | `llm.js` does **not** auto-fall back to Ollama; it returns 503 | "Answer generation is unavailable." Search still works (NFR-REL-01) |

The Anthropic decision is deliberate: silently swapping to a weaker local model mid-session would change answer quality with no signal to the user, which is worse than an explicit failure. Provider choice is an operator decision made via `LLM_PROVIDER`, not an automatic runtime one.

---

## 7. Python Vision Service — `vision/`

Phase 1 builds the container, loads the ColPali model at startup, and serves `/health`. The `/classify` and `/embed_pages` endpoints are stubbed to `501 Not Implemented` and land in Phase 4.

### 7.1 `vision/requirements.txt`

```
fastapi==0.115.6
uvicorn[standard]==0.34.0
pydantic==2.10.4
PyMuPDF==1.25.1
pytesseract==0.3.13
Pillow==10.4.0
torch==2.5.1
colpali-engine==0.3.5
transformers==4.46.3
```

**Amended during Phase 1 implementation**: the original pins (`Pillow==11.1.0`, `transformers==4.47.1`) are `ResolutionImpossible` against `colpali-engine==0.3.5`'s actual constraints (`pillow<11.0.0,>=9.2.0`, `transformers<4.47.0,>=4.46.1` — verified against PyPI metadata after a live build failure). Pinned to the latest patch versions inside colpali-engine's allowed ranges instead.

`torch` is pinned to the CPU wheel in the Dockerfile (`--index-url https://download.pytorch.org/whl/cpu`) — the CUDA build is ~2.5 GB larger and the reference deployment has no GPU. `COLPALI_DEVICE=cuda` plus a CUDA base image is the documented upgrade path when a GPU is available.

### 7.2 `vision/Dockerfile`

```dockerfile
FROM python:3.11-slim

# tesseract-ocr-eng is the base language pack; osd enables orientation/script detection,
# which is what handles the rotated-scan edge case in Phase 4.
RUN apt-get update && apt-get install -y --no-install-recommends \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-osd \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir torch==2.5.1 --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/
EXPOSE 8100
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100", "--workers", "1"]
```

**`--workers 1` is required, not a default.** ColPali occupies ~4.5 GB of RAM in fp32. Each uvicorn worker is a separate process that would load its own copy of the model. Concurrency is handled by batching inside the single process (Phase 4), not by process replication.

### 7.3 `vision/app/colpali.py` — Model Singleton

```python
import os, threading, torch
from colpali_engine.models import ColPali, ColPaliProcessor

_model = None
_processor = None
_lock = threading.Lock()

def load() -> tuple:
    """Idempotent, thread-safe model load. Called once at FastAPI startup."""
    global _model, _processor
    if _model is not None:
        return _model, _processor
    with _lock:
        if _model is not None:
            return _model, _processor
        name = os.environ.get("COLPALI_MODEL", "vidore/colpali-v1.3")
        device = os.environ.get("COLPALI_DEVICE", "cpu")
        dtype = torch.bfloat16
        _model = ColPali.from_pretrained(
            name, torch_dtype=dtype, device_map=device, low_cpu_mem_usage=True,
        ).eval()
        _processor = ColPaliProcessor.from_pretrained(name)
        return _model, _processor

def is_ready() -> bool:
    return _model is not None
```

**Amended during Phase 1 implementation**: the original `float32` on CPU had a stated rationale ("bfloat16 is ~2x slower on CPUs without AMX and offers no memory benefit that matters at `--workers 1`") that assumed memory headroom this reference deployment does not have. Verified live: the container was OOM-killed (exit 137) while loading checkpoint shards — fp32 needs ~12GB for the ~3B-parameter base model's weights alone, which does not fit a 15GB-RAM host running everything else in this stack alongside it. `bfloat16` halves that to ~6GB, which does fit; torch 2.5.1's CPU bf16 kernel coverage is broad enough that this is no longer the numerically fragile choice it would have been in earlier torch versions. `low_cpu_mem_usage=True` is added alongside it — `from_pretrained` without this flag materializes a full-precision model instance before loading the checkpoint on top of it, roughly doubling *peak* RAM during the load itself (distinct from the final resident size), which is the exact phase that was OOM-killed.

Loading happens in a FastAPI `lifespan` startup hook so the container is not marked healthy until weights are resident — this is why `/health` is a meaningful readiness signal and not merely a liveness ping.

### 7.4 `GET /health` (vision service)

```json
{
  "status": "up",
  "model": "vidore/colpali-v1.3",
  "device": "cpu",
  "modelLoaded": true,
  "tesseractVersion": "5.3.4",
  "uptimeSeconds": 412
}
```

Returns `503` with `modelLoaded: false` while weights are still downloading, which is exactly what the Compose healthcheck's `start_period` waits out.

---

## 8. Health Endpoint — `backend/src/api/routes/health.js`

`GET /health` probes every dependency **concurrently** and reports each independently. A single aggregate boolean would be useless for the failure modes in §6.2, where the correct behavior is partial degradation.

```js
const PROBES = {
  mongo:      () => mongoose.connection.db.admin().ping(),
  qdrant:     () => vectorStore.ping(),
  redis:      () => redisClient.ping(),
  vision:     () => visionService.health(),
  cohere:     () => embeddings.ping(),
  llamaparse: () => parser.ping(),
  llm:        () => llm.ping(),
};

async function probe(name, fn) {
  const start = performance.now();
  try {
    await fn();
    return { name, status: 'up', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { name, status: 'down', latencyMs: Math.round(performance.now() - start), error: err.message };
  }
}

router.get('/health', async (req, res) => {
  const results = await Promise.all(Object.entries(PROBES).map(([n, f]) => probe(n, f)));
  const dependencies = Object.fromEntries(results.map((r) => [r.name, r]));

  // Mongo and Qdrant are non-degradable; anything else down is 'degraded', not 'down'.
  const critical = ['mongo', 'qdrant'];
  const criticalDown = critical.some((n) => dependencies[n].status === 'down');
  const anyDown = results.some((r) => r.status === 'down');
  const status = criticalDown ? 'down' : anyDown ? 'degraded' : 'up';

  res.status(status === 'down' ? 503 : 200).json({
    status,
    version: pkg.version,
    breakers: breakerStates(),
    dependencies,
    timestamp: new Date().toISOString(),
  });
});
```

The three-state result (`up` / `degraded` / `down`) is what lets a load balancer keep serving traffic when only the reranker is unreachable — the system genuinely still works, per §6.2.

---

## 9. LangSmith Tracing & the Ping Graph

### 9.1 `backend/src/telemetry/tracing.js`

LangChain.js reads `LANGCHAIN_TRACING_V2`, `LANGCHAIN_API_KEY`, and `LANGCHAIN_PROJECT` from the environment automatically. This module's job is redaction and explicit opt-out, not wiring.

```js
import { Client } from 'langsmith';

let client = null;

export function initTracing() {
  if (!config.tracing.enabled) {
    console.info('[tracing] LANGCHAIN_TRACING_V2 is not "true" — tracing disabled');
    return null;
  }
  if (!process.env.LANGCHAIN_API_KEY) {
    console.warn('[tracing] tracing enabled but LANGCHAIN_API_KEY is unset — disabling');
    process.env.LANGCHAIN_TRACING_V2 = 'false';
    return null;
  }
  // NFR-SEC-01: hide document text from traces. Structure, timing, and scores
  // are preserved; the payloads that would mirror private content are not.
  client = new Client({
    hideInputs:  (inputs)  => redact(inputs),
    hideOutputs: (outputs) => redact(outputs),
  });
  return client;
}

const SENSITIVE = new Set(['text', 'content', 'pageContent', 'ocrText', 'sources', 'documents']);

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) =>
      SENSITIVE.has(k)
        ? [k, typeof v === 'string' ? `[redacted ${v.length} chars]` : `[redacted ${Array.isArray(v) ? v.length : 1} items]`]
        : [k, redact(v)],
    ));
  }
  return value;
}
```

### 9.2 The Ping Graph — `backend/src/graph/pingGraph.js`

A two-node LangGraph whose only purpose is to prove the graph runtime and the tracing pipeline both work before Phase 5 depends on them. It is **throwaway code — Phase 5 replaces this file with `ragGraph.js`.**

```js
import { StateGraph, Annotation, END, START } from '@langchain/langgraph';

const PingState = Annotation.Root({
  input:  Annotation({ reducer: (_, next) => next }),
  steps:  Annotation({ reducer: (prev = [], next) => [...prev, ...next] }),
  output: Annotation({ reducer: (_, next) => next }),
});

const graph = new StateGraph(PingState)
  .addNode('normalize', async (state) => ({
    steps: ['normalize'],
    input: state.input.trim().toLowerCase(),
  }))
  .addNode('respond', async (state) => ({
    steps: ['respond'],
    output: `pong: ${state.input}`,
  }))
  .addEdge(START, 'normalize')
  .addEdge('normalize', 'respond')
  .addEdge('respond', END);

export const pingGraph = graph.compile();
```

Exposed at `POST /api/graph/ping` with `{ "input": "  Hello  " }` → `{ "output": "pong: hello", "steps": ["normalize","respond"], "runId": "..." }`. The `runId` is the LangSmith run identifier, which is what makes acceptance criterion 1.12 checkable without leaving the terminal.

---

## 10. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 1.1 | Write `docker-compose.yml` with qdrant, mongo, redis, vision | `docker compose up -d` then `docker compose ps` shows all 4 services `healthy` within 6 minutes on first run |
| 1.2 | Add new backend dependencies | `npm install` completes with 0 errors; `npm ls @langchain/langgraph @qdrant/js-client-rest cohere-ai bullmq` resolves all four |
| 1.3 | Implement `config/index.js` with fail-fast validation | Running `node src/api/index.js` with `COHERE_API_KEY` unset exits with code 1 and prints exactly which variables are missing |
| 1.4 | Commit `.env.example` with all keys, no values | `grep -c '=$' .env.example` returns ≥ 8; `git check-ignore .env` exits 0 |
| 1.5 | Implement `scripts/setup-qdrant.js` | `node scripts/setup-qdrant.js` creates both collections; re-running it prints "already exists, config matches" and exits 0 |
| 1.6 | Verify Qdrant collection configs | `curl localhost:6333/collections/cerebro_pages` shows `"multivector_config":{"comparator":"max_sim"}` and `"scalar"` quantization |
| 1.7 | Implement 4 Mongoose models | `node -e "import('./src/models/Document.js')"` loads without error; creating a Document with `status:'bogus'` throws a ValidationError |
| 1.8 | Implement `providers/breaker.js` shared factory | Unit test: a wrapped fn failing 3× consecutively leaves `breaker.opened === true` |
| 1.9 | Implement 7 provider adapters with `ping()` only | Each adapter module exports `ping`; `node scripts/check-providers.js` prints an up/down line per provider |
| 1.10 | Build the Python vision service (Dockerfile, health, model load) | `curl localhost:8100/health` returns `{"modelLoaded":true}` and HTTP 200 after the container reports healthy |
| 1.11 | Implement `GET /health` with concurrent probes | Response contains a `dependencies` key with all 7 names; stopping `docker compose stop redis` flips overall `status` to `"degraded"` while still returning HTTP 200 |
| 1.12 | Implement tracing init + ping graph + route | `curl -XPOST localhost:5000/api/graph/ping -d '{"input":"  Hello  "}'` returns `{"output":"pong: hello"}`, and a run named `pingGraph` appears in the LangSmith project within 30 s |
| 1.13 | Verify trace redaction | A ping run whose input key is `text` shows `[redacted N chars]` in the LangSmith UI, not the literal text |
| 1.14 | Confirm legacy pipeline still runs | `POST /api/search` against the old pipeline still returns results; no Phase 1 change altered its behavior |

---

## 11. Milestone Definition

Phase 1 is **complete** when:

> A developer clones the repo on a machine with Docker and Node 22, copies `.env.example` to `.env`, fills in the Cohere, LlamaParse, Anthropic, and LangSmith keys, and runs `docker compose up -d`. After about four minutes — most of it spent downloading ColPali's weights on first boot — `docker compose ps` reports qdrant, mongo, redis, and vision all `healthy`. They run `node backend/scripts/setup-qdrant.js`, which prints that it created `cerebro_chunks` and `cerebro_pages`; running it a second time prints that both already exist with matching configs and exits 0. They start the backend with `npm run dev` and open `http://localhost:5000/health`, which returns HTTP 200 with `"status":"up"` and seven named dependencies, each with its own `up` verdict and a measured `latencyMs` — Mongo at 2 ms, Qdrant at 4 ms, Cohere at 210 ms. They then run `docker compose stop redis` and reload `/health`: the response is still HTTP 200, but `"status"` now reads `"degraded"` and only the `redis` entry shows `"status":"down"` with a connection error, proving the probes are independent. After `docker compose start redis`, the endpoint returns to `up`. Finally they `curl -XPOST localhost:5000/api/graph/ping -H 'Content-Type: application/json' -d '{"input":"  Hello  "}'` and receive `{"output":"pong: hello","steps":["normalize","respond"],"runId":"3f2a…"}`. Opening LangSmith and filtering the `cerebro` project by that run id shows a `pingGraph` trace with two child spans, `normalize` and `respond`, with per-node latencies — and no document text anywhere in the payloads.

---

## 12. Files to Create

```
docker-compose.yml
.env.example

backend/
├── scripts/
│   ├── setup-qdrant.js               # Idempotent collection + payload-index creation
│   └── check-providers.js            # CLI: ping every provider, print up/down table
├── src/
│   ├── config/index.js               # Env parse + fail-fast validation
│   ├── models/
│   │   ├── Document.js
│   │   ├── Conversation.js
│   │   ├── Message.js
│   │   └── UsageEvent.js
│   ├── providers/
│   │   ├── breaker.js                # Shared opossum factory + state registry
│   │   ├── vectorStore.js            # Qdrant client + ping + ensureCollections
│   │   ├── embeddings.js             # Cohere embed adapter (ping only this phase)
│   │   ├── reranker.js               # Cohere rerank adapter (ping only this phase)
│   │   ├── llm.js                    # Chat model factory: anthropic | ollama
│   │   ├── parser.js                 # LlamaParse adapter (ping only this phase)
│   │   ├── visionService.js          # HTTP client for the Python service
│   │   └── storage.js                # StorageAdapter, filesystem driver
│   ├── graph/
│   │   └── pingGraph.js              # THROWAWAY — Phase 5 replaces with ragGraph.js
│   ├── telemetry/
│   │   └── tracing.js                # LangSmith init + payload redaction
│   └── api/routes/
│       └── health.js                 # GET /health concurrent dependency probes
└── test/
    └── providers/breaker.test.js     # Circuit-breaker trip behavior

vision/
├── app/
│   ├── main.py                       # FastAPI app + lifespan model load
│   ├── routes.py                     # /health now; /classify + /embed_pages stubbed 501
│   ├── colpali.py                    # Thread-safe model singleton
│   └── schemas.py                    # Pydantic models
├── requirements.txt
└── Dockerfile
```

---

## 13. Performance Validation

| Metric | How to Measure | Target |
|---|---|---|
| Cold `docker compose up` to all-healthy | `time docker compose up -d --wait` on a clean volume set | < 6 min (dominated by the ~3 GB ColPali download) |
| Warm `docker compose up` to all-healthy | Same command with `hf_cache` populated | < 45 s |
| `/health` total response time | `curl -w '%{time_total}' localhost:5000/health` | < 800 ms (probes run concurrently; bounded by the slowest external API) |
| Qdrant ping latency | `dependencies.qdrant.latencyMs` in the `/health` body | < 20 ms |
| Vision service RSS after model load | `docker stats cerebro-vision-1 --no-stream` | < 6 GB |
| Ping graph round trip | `curl -w '%{time_total}'` on `/api/graph/ping` | < 50 ms (no external calls in the graph) |

---

## 14. Estimated Complexity

- **Node backend**: ~850 LOC across 16 new files (config 110, models 130, providers 380, health 70, graph 40, tracing 60, scripts 120)
- **Python vision service**: ~180 LOC across 5 files
- **Infrastructure**: ~90 lines of YAML + ~25 lines of Dockerfile
- **Tests**: ~80 LOC (breaker behavior only; real pipeline tests begin Phase 2)
- **New npm dependencies**: 10 — `@langchain/core`, `@langchain/langgraph`, `@langchain/anthropic`, `@langchain/ollama`, `@langchain/community`, `@qdrant/js-client-rest`, `cohere-ai`, `bullmq`, `ioredis`, `langsmith`. `@langchain/community` is deprecated as of the version resolved at implementation time (still installed for Phase 2's `CheerioWebBaseLoader`); `ChatOllama` — originally specced to come from `@langchain/community` — is imported from the new dedicated `@langchain/ollama` package instead, same interface, no behavior change.
- **New Python dependencies**: 8
- **Removed**: nothing. The legacy pipeline is untouched and stays functional until Phase 6 decommissions it

This phase writes almost no business logic on purpose. Its value is that every subsequent phase can assume a validated config object, a reachable vector store with a versioned schema, a circuit-broken adapter for every external call, and a working trace pipeline — none of which the current codebase has.
