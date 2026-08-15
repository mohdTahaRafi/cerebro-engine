# Phase 6: Observability Console, Migration Cutover & Production

## 1. Objective

Finish the system: make the pipeline visible, make the legacy pipeline gone, and make the whole thing deployable. The advanced console renders a live per-query trace of every stage including the visual branch; the C++ SIMD engine gets an honest benchmark against Qdrant; existing MongoDB-vector documents are migrated to the new pipeline; the superseded loader/sanitizer/chunker/encoder/search modules are deleted; and rate limiting, monitoring, and a production Compose stack ship. By the end of this phase: a developer runs `docker compose -f docker-compose.prod.yml up -d`, opens the app behind Caddy on HTTPS, asks a question, and watches the `/advanced` console draw the real execution plan — condense, dense, sparse, ColPali, fusion, rerank, generate — with measured milliseconds on every bar.

**No new retrieval or generation capability.** Nothing in this phase changes what an answer contains; it changes what you can see, what remains in the tree, and how it runs in production. Anything proposing new pipeline behavior belongs in §14, explicitly out of scope.

---

## 2. The Advanced Console

### 2.1 What Replaces the Hand-Rolled Telemetry

The legacy `ExecutionPlan.tsx` gated its entire panel on a `telemetry` object with four fields, one of which (`cacheWaitMs`) described a cache that never existed. The Phase 5 graph already emits real per-stage timings via the SSE `telemetry` event and the `/api/search` response. The console consumes those directly.

```ts
export interface PipelineTelemetry {
  condenseMs:      number | null;   // null ⇒ skipped (first turn) — not zero
  embedMs:         number;          // Cohere query embedding
  sparseMs:        number;          // local BM25, typically 2-4ms
  colpaliMs:       number | null;   // null ⇒ vision unavailable or no visual corpus
  chunkRetrieveMs: number;          // Qdrant hybrid query incl. server-side RRF
  pageRetrieveMs:  number | null;   // Qdrant MAX_SIM
  mergeMs:         number;          // provenance dedup
  rerankMs:        number | null;   // null ⇒ reranker degraded
  firstTokenMs:    number | null;   // generation only
  generateMs:      number | null;
  totalMs:         number;
  candidatesRetrieved: number;
  candidatesAfterMerge: number;
  candidatesAfterFloor: number;
  rerankSkipped: boolean;
  warnings: string[];
}
```

Every `| null` is load-bearing. A skipped stage rendering as `0ms` is indistinguishable from an instantaneous one, which is precisely the confusion the legacy panel created. The console renders `null` stages as a greyed, hatched bar labeled *skipped* with a tooltip naming the reason.

### 2.2 Execution Plan Rendering

A horizontal waterfall, one row per stage, widths proportional to measured duration:

```
condense    ████                                    412ms
embed           ██                                  187ms
sparse          ▏                                     3ms   ┐ parallel
colpali         ██                                  164ms   ┘
chunk-retr        ▎                                  23ms   ┐ parallel
page-retr         ███                               287ms   ┘
merge                ▏                                1ms
rerank               ███                            241ms
generate                ████████████████████       2140ms   (first token 1180ms)
                    ─────────────────────────────────────
total                                               3458ms
```

Concurrent stages are drawn on a shared timeline with a brace, because rendering `embed + sparse + colpali` as sequential rows summing to 354 ms would misrepresent a fan-out that actually cost 187 ms wall-clock. The waterfall's x-axis is real elapsed time from request start, not a stacked sum.

### 2.3 Source Provenance Panel

Each result row shows which branch produced it, which is only knowable because Phase 3/4 preserved that metadata:

| Column | Source |
|---|---|
| Rank, score | `relevanceScore` from the reranker |
| Branch | `dense` / `sparse` / `both` / `colpali`, derived from prefetch membership |
| Fusion rank → final rank | Shows how far reranking moved each candidate |
| Absorbed | `absorbedChunks.length` — how many OCR chunks the page swallowed |
| Kind | `text` / `page`, with a thumbnail for pages |

The fusion-rank-to-final-rank delta is the single most informative column for a reviewer: it makes the reranker's contribution visible as movement rather than asserting it in prose.

### 2.4 LangSmith Deep Link

Each query row links to its LangSmith run. The `runId` is already returned by the graph invocation; the console renders `https://smith.langchain.com/o/{org}/projects/p/{project}/r/{runId}` so a developer moves from the in-app view to the full trace in one click, rather than the console attempting to reimplement trace inspection.

---

## 3. The C++ vs Qdrant Benchmark

### 3.1 What It Actually Measures

`bench/cppVsQdrant.js` runs three engines over an identical corpus and query set:

| Engine | What it is |
|---|---|
| `js-scalar` | Pure JavaScript dot-product loop, JIT-warmed |
| `cpp-scalar` | The C++ addon with AVX2 dispatch forced off (`CEREBRO_FORCE_SCALAR=1`) |
| `cpp-avx2` | The C++ addon with runtime AVX2/FMA dispatch active |
| `qdrant-hnsw` | Production ANN query against a copy of the same vectors |

Isolating `cpp-scalar` is what makes the result honest. A single JS-vs-AVX2 number conflates two independent effects — leaving the JS runtime, and using SIMD — and reports their product as if it were the SIMD win. Three engines decompose it: *language* buys one factor, *SIMD* buys another.

### 3.2 Methodology Fixes

The existing `benchmark-simd.js` has two defects that must be corrected, not carried forward:

```js
// 1. JIT warm-up. The legacy script timed the JS loop cold, so V8's compilation
//    cost landed inside the measurement. That makes JS look slower than its steady
//    state and inflates the reported speedup — the error favors us, which is worse.
for (let i = 0; i < WARMUP_ITERATIONS; i++) jsDotProduct(query, dataset, dim);

// 2. Repeated trials, median reported. A single run varies 15-25% between
//    invocations from scheduler noise and thermal state.
const samples = [];
for (let i = 0; i < TRIALS; i++) samples.push(time(() => engine.run()));
const median = samples.sort((a, b) => a - b)[Math.floor(TRIALS / 2)];
```

`WARMUP_ITERATIONS = 20`, `TRIALS = 11` (odd, so the median is a real sample rather than an interpolation).

### 3.3 Sweep and Recall

The benchmark sweeps corpus size — 1k, 10k, 100k, 1M vectors at 1024 dims — because a single N hides the crossover. Brute-force SIMD beats HNSW at small N (no index traversal overhead) and loses badly at large N; showing the crossover point is more interesting and more honest than reporting whichever N flatters one engine.

Latency alone would also be misleading, since HNSW is approximate and brute force is exact. Both are reported:

```js
// Recall@10 against the exact brute-force result, which is ground truth by definition.
const exact = new Set(cppAvx2Results.slice(0, 10).map((r) => r.index));
const recall = qdrantResults.slice(0, 10).filter((r) => exact.has(r.index)).length / 10;
```

Output is a markdown table plus a JSON artifact so CI can compare against a baseline and the README can embed the numbers without hand-copying them.

### 3.4 The Honest Framing

`bench/README.md` states plainly what the numbers mean: the C++ engine is exact and fast at small scale but has no index, no persistence, and no filtering; Qdrant is approximate, persistent, filterable, and scales past memory. The benchmark exists to quantify that trade, not to argue the hand-written kernel should have stayed on the serving path.

---

## 4. Data Migration

### 4.1 The Problem

Existing installations have documents in MongoDB's `chunks` collection with 384-dimension MiniLM vectors. Those vectors are unusable — different model, different dimensionality, different semantic space. Only the **source files** carry forward.

### 4.2 `backend/scripts/migrate-legacy.js`

```js
// Legacy chunks are NOT re-embedded. A 384-d MiniLM vector cannot be converted to a
// 1024-d Cohere vector by any transformation; the text must be re-encoded from source.
// Where the source file survives we re-ingest it; where it does not, we report the loss
// rather than silently dropping documents.

const legacy = await mongoose.connection.db.collection('chunks')
  .aggregate([{ $group: {
    _id: '$metadata.source',
    fileName: { $first: '$metadata.fileName' },
    chunkCount: { $sum: 1 },
  }}]).toArray();

const report = { migrated: [], missingSource: [], failed: [] };

for (const doc of legacy) {
  const sourcePath = resolveLegacySource(doc._id, doc.fileName);
  if (!sourcePath || !(await exists(sourcePath))) {
    report.missingSource.push({ fileName: doc.fileName, chunkCount: doc.chunkCount });
    continue;
  }
  try {
    const created = await enqueueIngestion(sourcePath, doc.fileName);
    report.migrated.push({ fileName: doc.fileName, documentId: created._id });
  } catch (err) {
    report.failed.push({ fileName: doc.fileName, error: err.message });
  }
}
```

The script is **dry-run by default**. `--apply` is required to enqueue anything, and `--drop-legacy` (a separate, third flag) is required to remove the old `chunks` collection — which the script refuses to do unless every document either migrated successfully or was explicitly acknowledged with `--accept-losses`. Deleting the old collection is irreversible and gated accordingly.

---

## 5. Legacy Decommission

### 5.1 What Is Deleted

| Path | Superseded by | Verified unreferenced |
|---|---|---|
| `src/loaders/UniversalLoader.js` | `providers/parser.js` (Phase 2) | grep for `UniversalLoader` |
| `src/loaders/index.js` | — (was a manual test script) | grep for `runLoader` |
| `src/utils/TextSanitizer.js` | `ingestion/normalize.js` (Phase 2) | grep for `TextSanitizer` |
| `src/utils/SemanticChunker.js` | `ingestion/chunker.js` (Phase 2) | grep for `SemanticChunker` |
| `src/encoder/ModelLoader.js` | `providers/embeddings.js` (Phase 2) | grep for `ModelLoader` |
| `src/encoder/BatchEncoder.js` | `providers/embeddings.js` (Phase 2) | grep for `BatchEncoder` |
| `src/services/EncoderService.js` | `providers/embeddings.js` | grep for `EncoderService` |
| `src/services/IngestionService.js` | `ingestion/ingestDocument.js` (Phase 2) | grep for `ingestDocument`⁠ from services |
| `src/services/SearchService.js` | `retrieval/search.js` (Phase 3) | grep for `hybridSearch` |
| `src/services/DatabaseService.js` | `providers/vectorStore.js` + Mongoose models | grep for `sinkChunks` |
| `src/services/GenerationService.js` | `graph/nodes/generate.js` (Phase 5) | grep for `GenerationService` |
| `scripts/setup-db-index.js` | `scripts/setup-qdrant.js` (Phase 1) | not referenced by npm scripts |
| `test/verify_phase_*.js`, `test/test-{batcher,service,hybrid,search-fallback}.js` | Phase 2–5 test suites | superseded coverage |

### 5.2 What Is Kept

- **`src/cpp/**` and `binding.gyp`** — the addon still compiles, its tests still run, and `bench/cppVsQdrant.js` is its consumer. Removing it would destroy the benchmark that justifies the architectural decision to retire it from serving.
- **`test/test-cpp-bridge.js`, `test/test-vector-search-validation.js`** — they exercise the retained addon.
- **`@huggingface/transformers`** — *removed* from `package.json`, since nothing imports it once `ModelLoader` is gone. `pdf-parse`, `mammoth`, `cheerio` follow it out; `xlsx` **stays**, because Phase 2's spreadsheet parser uses it.

### 5.3 Ordering

Deletion happens **after** tasks 6.1–6.10 pass, not before. The rule is that no module is deleted until its replacement has a green acceptance criterion in an earlier phase and a grep proves nothing imports it. Each deletion is a separate commit so a bisect can isolate one.

---

## 6. Rate Limiting & Hardening

### 6.1 Per-Route Budgets

```js
const limiter = (windowMs, max, name) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  store: new RedisStore({ sendCommand: (...args) => redis.call(...args), prefix: `rl:${name}:` }),
  message: { error: 'Too many requests. Please slow down.' },
});

app.use('/api/ask',        limiter(60_000,      20, 'ask'));    // costliest: condense+embed+rerank+generate
app.use('/api/search',     limiter(60_000,      60, 'search')); // no generation
app.use('/api/documents',  limiter(3_600_000,   10, 'upload')); // ingestion is the exhaustion vector
app.use('/api',            limiter(60_000,     300, 'global')); // catch-all backstop
```

A Redis-backed store rather than the default in-memory one, because the in-memory store resets on restart and is per-process — meaning it would silently stop limiting the moment the API scales past one instance (NFR-SCALE-02).

### 6.2 Additional Hardening

- **`helmet`** for standard security headers, with `contentSecurityPolicy` configured to permit the page-image route's `img-src`.
- **Request body cap** — `express.json({ limit: '256kb' })`. Only `/api/documents` legitimately carries large payloads, and that goes through multer, not the JSON parser.
- **CORS narrowed** — from the current permissive `cors()` to an explicit origin allowlist from config.
- **Graceful shutdown** — `SIGTERM` stops accepting connections, waits for in-flight SSE streams up to 30 s, closes the BullMQ worker so in-flight jobs finish or requeue cleanly, then exits.

---

## 7. Monitoring

### 7.1 `/health` Extension

Phase 1's endpoint gains queue depth and index counts, so a single request answers "is anything backing up":

```json
{
  "status": "up",
  "dependencies": { "...": "..." },
  "breakers": { "cohere.embed": "closed", "vision.embedPages": "closed" },
  "queue": { "waiting": 0, "active": 1, "failed": 3, "completed": 412 },
  "collections": { "cerebro_chunks": 84213, "cerebro_pages": 1902 }
}
```

### 7.2 `/metrics`

Prometheus text format via `prom-client`, exposing what the budgets in each phase were written against:

| Metric | Type | Why |
|---|---|---|
| `cerebro_request_duration_seconds{route,status}` | histogram | Validates NFR-PERF-01/03 in production, not just in tests |
| `cerebro_pipeline_stage_seconds{stage}` | histogram | Per-stage p95 — the console's numbers, aggregated |
| `cerebro_ingest_job_duration_seconds{outcome}` | histogram | Validates the 30 s text / 6 s-per-page visual budgets |
| `cerebro_provider_calls_total{provider,operation,outcome}` | counter | Cost tracking and failure-rate alerting |
| `cerebro_provider_tokens_total{provider,direction}` | counter | NFR-COST-01 |
| `cerebro_breaker_state{name}` | gauge | 0 closed / 1 half-open / 2 open |
| `cerebro_queue_depth{state}` | gauge | Ingestion backlog |

`/metrics` binds to the internal network only and is not exposed through Caddy — it carries operational detail that does not belong on the public interface.

---

## 8. Production Deployment

### 8.1 `docker-compose.prod.yml`

Adds to the dev stack: the Node backend as a container, MinIO for page images, Caddy for TLS termination, and resource limits.

```yaml
  backend:
    build: ./backend
    environment:
      NODE_ENV: production
      STORAGE_DRIVER: s3
      S3_ENDPOINT: http://minio:9000
    depends_on:
      qdrant:  { condition: service_healthy }
      mongo:   { condition: service_healthy }
      redis:   { condition: service_healthy }
      vision:  { condition: service_healthy }
    deploy:
      resources:
        limits: { memory: 2G }

  vision:
    deploy:
      resources:
        # Hard ceiling above the 6 GB measured peak from Phase 4 §11. Without a limit,
        # an OOM here takes the host down instead of just the container.
        limits: { memory: 8G }

  minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    volumes: [minio_data:/data]

  caddy:
    image: caddy:2-alpine
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
```

### 8.2 `Caddyfile`

```
cerebro.example.com {
    encode gzip

    # SSE must not be buffered or compressed, or tokens arrive in bursts at the end
    # instead of streaming. flush_interval -1 disables response buffering entirely.
    @sse path /api/ask
    reverse_proxy @sse backend:5000 {
        flush_interval -1
    }

    handle_path /api/* {
        reverse_proxy backend:5000
    }

    handle {
        root * /srv/frontend
        try_files {path} /index.html
        file_server
    }
}
```

`flush_interval -1` on the SSE route is the single most important line in this file. Without it Caddy buffers the response and the entire streaming experience collapses to a long pause followed by the complete answer — the failure mode is invisible in development, where no proxy sits in the path.

### 8.3 Frontend Build

`npm run build` in `frontend/`, output copied into the Caddy container at `/srv/frontend`. The Vite dev proxy is development-only; in production Caddy performs the `/api` routing.

---

## 9. Documentation Sync

NFR-MAINT-03 requires docs to track behavior. Four documents currently describe a system that will no longer exist:

| Document | Required change |
|---|---|
| `AGENTS.md` | Rewrite the architecture, run commands, and constraints sections. The "384 dimensions" and "Atlas fallback loads vectors into Node memory" constraints are obsolete; the two-runtime topology and Qdrant collections replace them |
| `cerebro_architecture.md` | Superseded by `docs/planning/architecture.md`. Replaced by a stub pointing there rather than left to rot |
| `cerebro_interview_strategy.md` | Its headline claims — "100K vectors in 8ms", "10× faster", "no AVX2 fallback exists" — are stale or contradicted by the code. Rewritten against the Phase 6 benchmark's *measured* numbers, and reframed around the architectural decision (why a hand-written kernel was retired in favor of a production index) rather than the raw speedup |
| `frontend/README.md` | Describes Redis cache hit rates and RRF scores from the C++ bridge, neither of which will exist. Updated to the real console |
| `README.md` | Setup section rewritten for the Compose stack and the required API keys |

The interview-strategy rewrite is called out specifically because the current version's performance claims do not match what the current code produces — a benchmark run mid-project measured 6.9× against a documented 10×, with no warm-up in the harness. Publishing numbers a reviewer can disprove by running the repo is worse than publishing none.

---

## 10. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 6.1 | Define `PipelineTelemetry` and thread it through SSE + `/api/search` | A query response contains every field in §2.1; skipped stages are `null`, never `0` |
| 6.2 | Rebuild `ExecutionPlan.tsx` as a real-time waterfall | Asking a question draws bars whose widths match the reported ms; concurrent stages share a timeline with a brace |
| 6.3 | Render skipped stages distinctly | A first-turn query shows `condense` hatched and labeled *skipped*, not a zero-width bar |
| 6.4 | Build the source provenance panel | Each row shows branch (`dense`/`sparse`/`both`/`colpali`) and fusion→final rank movement |
| 6.5 | Add the LangSmith deep link | Clicking a query row opens the matching run in LangSmith |
| 6.6 | Rewrite the benchmark with warm-up, 11 trials, median | `npm run bench` reports a median and a min/max spread; consecutive runs vary < 10% |
| 6.7 | Add `cpp-scalar` as a separate engine | Output distinguishes the language win from the SIMD win as two separate factors |
| 6.8 | Sweep 1k/10k/100k/1M and report Recall@10 | The markdown table shows the N at which Qdrant overtakes brute force, plus recall per row |
| 6.9 | Write `bench/README.md` with the honest framing | States exactness/index/filtering trade-offs, not just the speed number |
| 6.10 | Implement `migrate-legacy.js` with dry-run default | Running with no flags mutates nothing and prints a migration plan with counts |
| 6.11 | Gate destructive migration behind explicit flags | `--drop-legacy` without `--accept-losses` refuses when any document has a missing source |
| 6.12 | Delete the 13 superseded modules | `grep -r "SemanticChunker\|TextSanitizer\|UniversalLoader\|SearchService\|GenerationService" backend/src` returns 0 hits; `npm start` boots clean |
| 6.13 | Remove obsolete npm dependencies | `@huggingface/transformers`, `pdf-parse`, `mammoth`, `cheerio` gone from `package.json`; `xlsx` retained; `npm ls` resolves |
| 6.14 | Confirm the C++ addon survives decommission | `npx node-gyp rebuild` succeeds and `node test/test-cpp-bridge.js` passes after the deletions |
| 6.15 | Implement per-route rate limiting with the Redis store | The 21st `/api/ask` in a minute returns HTTP 429; limits persist across a backend restart |
| 6.16 | Add helmet, body cap, CORS allowlist, graceful shutdown | `SIGTERM` during an active SSE stream lets it finish (≤ 30 s) before exit; a cross-origin request from an unlisted origin is rejected |
| 6.17 | Extend `/health` with queue depth and collection counts | Response includes `queue` and `collections`; enqueuing 5 documents raises `queue.waiting` |
| 6.18 | Implement `/metrics` in Prometheus format | `curl localhost:5000/metrics` returns all 7 metric families; the route is unreachable through Caddy |
| 6.19 | Write `docker-compose.prod.yml` with MinIO, Caddy, limits | `docker compose -f docker-compose.prod.yml up -d --wait` reaches all-healthy; the app loads over HTTPS |
| 6.20 | Configure Caddy SSE passthrough | With Caddy in the path, tokens arrive incrementally — verified by `curl -N` showing frames over time, not one burst |
| 6.21 | Migrate page storage to the S3 driver | With `STORAGE_DRIVER=s3`, a scanned ingest writes objects to MinIO and `/api/pages/...` serves them |
| 6.22 | Sync all five documents | No document references 384 dimensions, `$vectorSearch`, MiniLM, or the C++ engine as the serving path; the interview doc's numbers match `npm run bench` output |

---

## 11. Milestone Definition

Phase 6 is **complete** when:

> A developer on a clean host clones the repo, fills in `.env`, and runs `docker compose -f docker-compose.prod.yml up -d --wait`. After a few minutes every container reports healthy, and `https://cerebro.example.com` serves the app over TLS that Caddy provisioned itself. They upload the annual report and the scanned invoice batch, then ask `"what was EMEA revenue in Q3?"` — tokens stream in visibly one at a time through Caddy, not as a single burst at the end, confirming `flush_interval -1` is doing its job. They switch to `/advanced` and watch the execution plan draw itself: `condense` hatched and labeled *skipped* because it was a first turn, then `embed` at 187 ms, `sparse` at 3 ms, and `colpali` at 164 ms drawn on a shared timeline under a brace rather than stacked, then `chunk-retrieve` 23 ms, `page-retrieve` 287 ms, `merge` 1 ms, `rerank` 241 ms, and `generate` 2140 ms with a first-token marker at 1180 ms. The provenance panel shows the top result was retrieved by `both` branches and moved from fusion rank 4 to final rank 1 — the reranker's contribution rendered as movement. Clicking the row opens the full trace in LangSmith. They run `npm run bench`, which sweeps 1k through 1M vectors and prints a table showing `cpp-avx2` beating `qdrant-hnsw` on latency below about 50k vectors and losing above it, with Qdrant holding Recall@10 of 0.98 throughout — and `cpp-scalar` sitting between `js-scalar` and `cpp-avx2`, decomposing the old single "10× faster" claim into a language factor and a SIMD factor, with consecutive runs varying under 10%. They run `node scripts/migrate-legacy.js` with no flags and get a dry-run plan naming 12 legacy documents, 10 with recoverable source files and 2 without; adding `--apply` enqueues the 10, and `--drop-legacy` alone refuses to proceed until `--accept-losses` acknowledges the 2. Then `grep -r "SemanticChunker\|TextSanitizer\|UniversalLoader\|SearchService\|GenerationService" backend/src` returns nothing, `npm start` boots clean, and `npx node-gyp rebuild && node test/test-cpp-bridge.js` still passes — the C++ engine survives as the benchmark artifact it was reframed into. They fire 21 questions in a minute and the 21st returns HTTP 429; restarting the backend and firing again still returns 429, proving the limit lives in Redis. Finally they open `AGENTS.md` and `cerebro_interview_strategy.md` and find no mention of 384 dimensions, `$vectorSearch`, or the C++ engine as the serving path — and the performance numbers in the interview document match, digit for digit, what `npm run bench` just printed.

---

## 12. Files to Create

```
docker-compose.prod.yml               # backend, minio, caddy, resource limits
Caddyfile                             # TLS, SSE passthrough with flush_interval -1
backend/Dockerfile                    # Multi-stage: node-gyp build → slim runtime

backend/
├── bench/
│   ├── cppVsQdrant.js                # 4 engines, warm-up, 11 trials, size sweep, Recall@10
│   └── README.md                     # Honest framing of the trade-off
├── scripts/migrate-legacy.js         # Dry-run default; --apply / --drop-legacy / --accept-losses
└── src/
    ├── api/
    │   ├── middleware/rateLimit.js   # Per-route Redis-backed limits
    │   └── routes/metrics.js         # Prometheus exposition, internal-only
    ├── telemetry/metrics.js          # prom-client registry + the 7 metric families
    └── shutdown.js                   # SIGTERM: drain SSE, close worker, exit

frontend/src/app/
├── components/core/
│   ├── ExecutionPlan.tsx             # [rewrite] Real-time waterfall with parallel-stage timeline
│   ├── ProvenancePanel.tsx           # Branch attribution, fusion→final rank movement
│   └── TelemetryTypes.ts             # PipelineTelemetry interface
└── pages/CoreEngine.tsx              # [extend] Wire the new panels + LangSmith deep link

DELETED (13 modules, §5.1)
```

---

## 13. Performance Validation

| Metric | How to Measure | Target |
|---|---|---|
| Console render lag behind the stream | Wall-clock between the `telemetry` frame and the waterfall painting | < 100 ms |
| SSE streaming through Caddy | `curl -N https://…/api/ask` frame arrival spread | Frames arrive incrementally; first token < 5 s |
| Benchmark reproducibility | 3 consecutive `npm run bench` medians | Spread < 10% |
| Rate limit enforcement | 25 requests in 60 s to `/api/ask` | Exactly 20 succeed, 5 return 429 |
| Graceful shutdown | `SIGTERM` during an active stream | Stream completes; process exits < 30 s |
| Production cold start | `docker compose -f docker-compose.prod.yml up -d --wait` | All-healthy < 6 min cold, < 60 s warm |
| Memory ceiling under load | `docker stats` during 5 concurrent visual ingests | vision < 8 G, backend < 2 G |
| `/metrics` scrape | `curl -w '%{time_total}' localhost:5000/metrics` | < 50 ms |

---

## 14. Future Considerations (Post-Launch)

**Explicitly NOT in scope for this phase or this migration.** Recorded so they are not smuggled into Phase 6 as "small additions":

- **Authentication and multi-tenancy.** The system currently has one shared knowledge base and no user model. Per-user document isolation would touch every Qdrant filter and every Mongo query.
- **Agentic multi-hop retrieval.** LangGraph makes a `retrieve → assess → re-retrieve` loop straightforward, and the graph is already the right shape for it, but it changes answer semantics and belongs behind its own evaluation set.
- **Streaming ingestion progress over WebSocket.** Currently the client polls `/api/documents/:id/status`. Fine at this scale; worth revisiting above ~50 concurrent ingests.
- **GPU inference for ColPali.** `COLPALI_DEVICE=cuda` plus a CUDA base image would cut visual ingestion from ~6 s/page to well under 1 s. Deferred because the reference deployment has no GPU.
- **Answer-quality evaluation harness.** Phase 3's retrieval regression suite measures Recall@3; it says nothing about whether generated answers are correct. A RAGAS-style faithfulness/relevance eval is the natural next measurement layer.
- **Incremental re-ingestion.** Re-ingesting a changed document currently reprocesses it wholly. Diffing at page granularity would help large documents with small edits.
- **Cross-encoder alternatives to Cohere Rerank.** A self-hosted `bge-reranker-v2-m3` would remove one external dependency and one per-query cost, at the price of another model in the vision container.

---

## 15. Estimated Complexity

- **Node backend**: ~780 LOC (benchmark 260, migration script 180, metrics 130, rate limiting 60, shutdown 70, health extension 80)
- **Frontend**: ~620 LOC (ExecutionPlan rewrite 310, ProvenancePanel 220, types + wiring 90)
- **Infrastructure**: ~180 lines (prod Compose 90, Caddyfile 35, backend Dockerfile 55)
- **Documentation**: 5 documents rewritten or stubbed
- **New npm dependencies**: 4 — `express-rate-limit`, `rate-limit-redis`, `helmet`, `prom-client`
- **Removed npm dependencies**: 4 — `@huggingface/transformers`, `pdf-parse`, `mammoth`, `cheerio`
- **Deleted source modules**: 13 (§5.1), each in its own commit
- **Net LOC change**: roughly −1,900 across the backend once the legacy pipeline is removed

The migration ends with less code than it started with. That is the point: roughly 2,400 lines of hand-rolled loaders, sanitizers, chunkers, encoders, fusion math, and in-memory fallback scanning are replaced by roughly 500 lines of adapter and orchestration code plus a set of libraries built for the job — and the one piece of genuinely differentiating hand-written code, the AVX2 kernel, survives with an honest benchmark explaining exactly what it is and is not good for.
