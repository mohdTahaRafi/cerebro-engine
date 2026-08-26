# Phase 7: Observability Data Plane (backend)

> Depends on: Phase 6 (`req.tenant` exists and every store is scoped).
> This phase makes the consoles built in Phase 4 real. Nothing in the retrieval or generation
> path changes behavior; this is capture, storage, and read models.

## 1. Objective

At the end of this phase every answer writes a durable trace containing its telemetry, its
full pre-floor candidate set with ranks, the assembled prompt the model actually received, and
its token counts. Each context carries a cached 3D projection of its embeddings, and a live
query can be placed into that space among its real nearest neighbors. The admin queue and
error-stream endpoints go live.

By the end of this phase: a user asks a question, opens `/admin/traces` a day later, finds
that query in the list, and reads the exact `<source>` blocks the model was given — then opens
`/admin/vectors`, types the same question, and watches the beacon land among the same chunks
that trace cited.

**No new pipeline behavior.** The graph runs exactly as it does today; `generate` returns one
additional value instead of discarding it. The projection is an inspection artifact and is
never on the retrieval path.

---

## 2. Trace Capture

### 2.1 `backend/src/models/Trace.js`

```js
const PromptBlockSchema = new mongoose.Schema({
  role:         { type: String, enum: ['system', 'user'], required: true },
  kind:         { type: String, enum: ['text', 'image'], required: true },
  // For an image block this is the SERVED uri (/api/pages/<id>/<n>.jpg), never base64.
  // A base64 page is ~350 KB of unreadable text that would dominate the document and
  // blow the 256 KB cap on its own (architecture §8).
  content:      { type: String, required: true },
  approxTokens: { type: Number, default: null },
}, { _id: false });

const CandidateSchema = new mongoose.Schema({
  pointId:    { type: String, required: true },
  kind:       { type: String, enum: ['text', 'page'], required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  fileName:   { type: String, default: null },
  page:       { type: Number, default: null },
  headingPath:{ type: String, default: null },
  // Truncated at 1,200 characters. The full chunk is in Qdrant; this is a preview for
  // the console, and 18 untruncated candidates is most of the document cap.
  textPreview:{ type: String, default: null },
  branch:     { type: String, enum: ['dense', 'sparse', 'both', 'colpali'], default: null },
  fusionRank: { type: Number, default: null },
  // null when the reranker was skipped OR when this candidate fell below the floor and
  // was never assigned a final position. `belowFloor` distinguishes the two.
  finalRank:  { type: Number, default: null },
  score:      { type: Number, default: null },
  belowFloor: { type: Boolean, default: false },
  absorbedChunks: { type: [String], default: undefined },
}, { _id: false });

const TraceSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',         required: true },
  contextId: { type: mongoose.Schema.Types.ObjectId, ref: 'Context',      required: true },
  threadId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  // The assistant Message this trace explains. Unique: one answer, one trace.
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', required: true, unique: true },

  query:          { type: String, required: true, maxlength: 4000 },
  condensedQuery: { type: String, default: null, maxlength: 4000 },

  // The PipelineTelemetry object verbatim. Stored as a loose subdocument rather than a
  // typed schema because it is a wire contract owned by telemetry/pipelineTelemetry.js;
  // duplicating its 21 fields here would create a second definition to keep in sync.
  telemetry:  { type: mongoose.Schema.Types.Mixed, required: true },

  candidates: { type: [CandidateSchema], default: [] },
  prompt:     { type: [PromptBlockSchema], default: [] },

  tokens: {
    input:    { type: Number, default: null },   // null, not 0 — "not reported" is not "zero"
    output:   { type: Number, default: null },
    provider: { type: String, default: null },
    model:    { type: String, default: null },
  },

  runId:     { type: String, default: null },     // the LangSmith root run id
  truncated: { type: Boolean, default: false },   // the 256 KB cap fired
  refused:   { type: Boolean, default: false },   // the noContext branch ran
}, { timestamps: true });

TraceSchema.index({ userId: 1, createdAt: -1 });          // the list query
TraceSchema.index({ userId: 1, contextId: 1, createdAt: -1 });
// 30-day retention (architecture §8). Without this the collection grows without bound:
// 256 KB × 100 traces/user/day is ~768 MB per user per month.
TraceSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
```

### 2.2 Capture points

Three values are currently computed and thrown away. Each is returned instead of discarded;
none changes how the pipeline behaves.

| Value | Where it exists today | Change |
|---|---|---|
| The assembled prompt | `graph/nodes/generate.js`'s `buildUserMessage` builds `content[]` and hands it to the model | returns it on the node's state as `promptBlocks` |
| The pre-floor candidate set | `retrieval/search.js`'s `applyRelevanceGate` receives `ranked` and returns only the survivors | `rerank` node keeps `ranked` on state as `allCandidates` with `belowFloor` stamped |
| Token counts | `llm.js` reports usage to `recordUsage` | also returned to the graph state |

### 2.3 `backend/src/telemetry/traceCapture.js`

```js
const MAX_TRACE_BYTES = 256 * 1024;
const MAX_PREVIEW_CHARS = 1200;

export function buildTrace({ tenant, threadId, messageId, state, telemetry, runId, usage }) {
  const candidates = (state.allCandidates ?? []).map((c) => ({
    pointId: c.pointId, kind: c.kind, documentId: c.documentId, fileName: c.fileName,
    page: c.page ?? null, headingPath: c.headingPath ?? null,
    textPreview: c.text ? c.text.slice(0, MAX_PREVIEW_CHARS) : null,
    branch: c.branch ?? null, fusionRank: c.fusionRank ?? null,
    finalRank: c.finalRank ?? null, score: c.score ?? null,
    belowFloor: c.belowFloor === true,
    absorbedChunks: c.absorbedChunks ?? undefined,
  }));

  const doc = {
    userId: tenant.userId, contextId: tenant.contextId, threadId, messageId,
    query: state.query, condensedQuery: state.condensedQuery ?? null,
    telemetry, candidates, prompt: state.promptBlocks ?? [],
    tokens: {
      input: usage?.inputTokens ?? null, output: usage?.outputTokens ?? null,
      provider: usage?.provider ?? null, model: usage?.model ?? null,
    },
    runId: runId ?? null, refused: state.refused === true, truncated: false,
  };

  // Cap enforcement. Shed in order of least value: previews first (the full text is in
  // Qdrant), then prompt text bodies (the structure and token counts survive, which is
  // what the drawer's shape is built from). The document is never rejected outright —
  // a trace that exists and says it was truncated is worth far more than no trace.
  let size = Buffer.byteLength(JSON.stringify(doc));
  if (size > MAX_TRACE_BYTES) {
    for (const c of doc.candidates) c.textPreview = c.textPreview?.slice(0, 200) ?? null;
    doc.truncated = true;
    size = Buffer.byteLength(JSON.stringify(doc));
  }
  if (size > MAX_TRACE_BYTES) {
    for (const b of doc.prompt) {
      if (b.kind === 'text' && b.content.length > 2000) {
        b.content = `${b.content.slice(0, 2000)}\n…[truncated at the 256 KB trace cap]`;
      }
    }
  }
  return doc;
}
```

### 2.4 Where it is written

`conversation/persistTurn.js`, in the **same** call that writes the two `Message` rows, after
the assistant message has an `_id`. A failure to write the trace is **caught and logged**, and
the turn still persists — a trace is an inspection artifact and must never be able to lose a
user's conversation. The failure writes a `pipeline_errors` row with `kind: 'trace'`.

`ask.js` emits `traceId` in the `telemetry` SSE frame so Phase 3's provenance ribbon can link
directly. Ordering matters: the trace is written before the frame is emitted, so the id is
real by the time the client receives it.

### 2.5 Refusals are traced

The `noContext` branch writes a trace with `refused: true`, its real retrieval telemetry, and
its full candidate set — every one of them `belowFloor: true`. A refusal is one of the most
diagnostically valuable executions in the system (*what did it find, and how close did it
get?*) and v1 could show none of it.

---

## 3. Trace Routes

| Method | Path | Middleware | Behavior |
|---|---|---|---|
| `GET` | `/api/traces` | `requireAuth` | `{userId}` + optional `contextId`, `since`; **projection excludes `candidates` and `prompt`** — the list must never load 256 KB per row |
| `GET` | `/api/traces/:id` | `requireAuth` | full document; **404** on a foreign id |
| `GET` | `/api/traces/by-message/:messageId` | `requireAuth` | resolves a chat message to its trace |

The list projection is a performance property enforced in code, not a convention: without it,
a 50-row page is up to 12 MB and the `< 100 ms` budget is unreachable.

`langsmithUrl` is built server-side from `runId` + `config.tracing.orgId` when tracing is
enabled, and is `null` otherwise — the frontend never assembles a provider URL from parts.

---

## 4. Vector Projections

### 4.1 `backend/src/models/Projection.js`

```js
const ProjectionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contextId: { type: mongoose.Schema.Types.ObjectId, ref: 'Context', required: true, unique: true },

  status: { type: String, enum: ['fitting', 'fresh', 'failed'], required: true, index: true },
  reason: { type: String, default: null },       // populated on 'failed'

  nodeCount: { type: Number, default: 0 },
  pointIds:  { type: [String], default: [] },
  // Binary, not an array of numbers. 5,000 × 3 floats as a Mongo array of Doubles is
  // ~360 KB of BSON; as a Buffer it is exactly 60,000 bytes.
  positions: { type: Buffer, default: null },    // Float32Array, interleaved [x,y,z]
  docIndex:  { type: Buffer, default: null },    // Uint16Array, index into `documents`
  documents: [{ id: String, fileName: String, color: Number }],
  bounds:    { min: [Number], max: [Number] },

  params:    { nNeighbors: Number, minDist: Number, spread: Number, seed: Number },
  // The chunk count at fit time. The console reports "N new chunks aren't plotted yet"
  // by comparing this against the context's current count — a real number, not a guess.
  fittedChunkCount: { type: Number, default: 0 },
  fittedAt:  { type: Date, default: null },
}, { timestamps: true });
```

### 4.2 Fitting — `backend/src/projection/fit.js`

```js
import { UMAP } from 'umap-js';

export const PROJECTION_PARAMS = {
  nNeighbors: 15,   // UMAP's own default. Below ~5 the projection fragments into noise;
                    //   above ~50 local structure — the thing being inspected — is lost.
  minDist: 0.1,     // default. Tighter packs clusters into unreadable blobs; looser
                    //   spreads them until cluster membership stops being visible.
  spread: 1.0,
  nComponents: 3,
};

// Fixed seed. UMAP is stochastic: two fits on identical data produce two clouds that
// look equally reasonable and share no coordinate system. A fixed seed makes a rebuild
// on unchanged data reproduce the same picture, so a user who refreshes does not think
// their data moved.
export const PROJECTION_SEED = 42;

const MAX_NODES = 20_000;   // above this the fit exceeds the 15s budget and the payload
                            //   exceeds 100 KB. Larger contexts are DOWNSAMPLED, not
                            //   refused, and the response says so (§4.4).

export async function fitContext(tenant, { onProgress } = {}) {
  // Scroll the whole context WITH vectors. This is the only place in the system that
  // pulls dense vectors back out of Qdrant; every query path uses with_vector: false.
  const points = await scrollAllVectors(tenant);        // [{ id, vector, payload }]
  if (points.length < PROJECTION_PARAMS.nNeighbors + 1) {
    // UMAP cannot build a neighborhood graph with fewer points than nNeighbors. This is
    // a legitimate state (a new context with 4 chunks), not an error.
    return { status: 'failed', reason:
      `A projection needs at least ${PROJECTION_PARAMS.nNeighbors + 1} chunks; this context has ${points.length}.` };
  }

  const sample = points.length > MAX_NODES ? deterministicSample(points, MAX_NODES) : points;
  const umap = new UMAP({ ...PROJECTION_PARAMS, random: mulberry32(PROJECTION_SEED) });
  const embedding = await umap.fitAsync(sample.map((p) => p.vector),
                                        (epoch) => onProgress?.(epoch));
  return packProjection(sample, embedding);
}
```

`fitAsync` rather than `fit`: the synchronous version blocks the event loop for the full
duration, and this runs in the same process that serves SSE streams. `fitAsync` yields between
epochs.

### 4.3 The query beacon — nearest-neighbor placement, not UMAP transform

This is the phase's most consequential design decision and it deviates from the obvious
implementation.

**The obvious implementation** is `umap.transform([queryVector])`. It is rejected for two
reasons. First, `transform` requires the fitted model's full internal state *including the
training vectors* — 5,000 × 1024 floats, 20 MB — so serving one beacon means either holding
every context's training set in memory or re-scrolling 20 MB from Qdrant per request, against
a 400 ms budget. Second, and more seriously, it is fragile in exactly the way that produces a
*convincing wrong answer*: if the rehydrated state does not exactly reproduce the fit — a
different seed, a reordered training set, a version bump in `umap-js` — the beacon lands in a
subtly different coordinate space than the cloud it is drawn into. It looks fine. It means
nothing. [architecture.md §7.8](architecture.md) names this as the easiest thing to get wrong
in the feature, and the mitigation is to not depend on it.

**What is implemented instead** places the beacon at the neighbor-weighted centroid of its
real nearest neighbors:

```js
// backend/src/projection/transform.js

// Place a query vector into an existing projection by locating its true nearest
// neighbors in the ORIGINAL 1024-dimensional space — which Qdrant does natively in
// ~20ms — and averaging their known 3D coordinates, weighted by similarity.
//
// Why this is the right primitive rather than a compromise: UMAP's own objective is to
// place a point near its high-dimensional neighbors. This computes that placement
// directly from the neighbors the retrieval engine ACTUALLY returned, using the same
// index the answer was retrieved from. The beacon is therefore guaranteed to sit among
// the chunks the user's query really matched — which is the only claim the console
// makes about it — and it cannot drift into a different coordinate space, because it
// never leaves the one the cloud is in.
const BEACON_K = 12;          // enough neighbors to be robust to one outlier, few enough
                              //   that the centroid stays local rather than drifting to
                              //   the cloud's center of mass
const SOFTMAX_TEMPERATURE = 0.07;   // tuned so the top neighbor dominates without the
                                    //   centroid collapsing exactly onto it — at 0.02 the
                                    //   beacon sits on top of neighbor 1 and is invisible;
                                    //   at 0.3 it drifts toward the mean of all 12

export async function projectQuery(tenant, queryVector, projection) {
  const hits = await vectorStore.nearestDense(tenant, queryVector, BEACON_K);  // Qdrant ANN
  const index = new Map(projection.pointIds.map((id, i) => [id, i]));

  const usable = hits.filter((h) => index.has(h.pointId));
  if (usable.length === 0) {
    // Every neighbor is outside the projection — the context was ingested since the last
    // fit, or was downsampled past these points. An honest "cannot place" beats a beacon
    // at the origin, which would look like a real placement at a meaningless location.
    return { placed: false, reason: 'stale_projection' };
  }

  // Softmax over cosine similarity. Weighting by raw similarity would let twelve
  // mediocre neighbors outvote one excellent match; softmax concentrates weight on the
  // genuinely close ones while still smoothing over a single outlier.
  const sims = usable.map((h) => h.score);
  const max = Math.max(...sims);
  const exps = sims.map((s) => Math.exp((s - max) / SOFTMAX_TEMPERATURE));
  const total = exps.reduce((a, b) => a + b, 0);

  const beacon = [0, 0, 0];
  usable.forEach((h, i) => {
    const j = index.get(h.pointId) * 3;
    const w = exps[i] / total;
    beacon[0] += projection.positions[j]     * w;
    beacon[1] += projection.positions[j + 1] * w;
    beacon[2] += projection.positions[j + 2] * w;
  });

  return { placed: true, beacon, neighbors: usable.map((h, i) => ({
    pointId: h.pointId, index: index.get(h.pointId),
    distance: 1 - h.score, weight: exps[i] / total,
  })) };
}
```

The route then runs the same rerank the retrieval path uses over those neighbors, so the
response can mark which ones would have **survived the relevance floor** — the
retrieved-versus-kept distinction Phase 4 §4.6 renders as a ring vs. no ring, and the most
interesting thing the beacon can show.

### 4.4 Staleness

`GET /api/vectors/projection` compares `fittedChunkCount` against the context's current
`chunkCount` and reports:

| Condition | `staleness` | `reason` |
|---|---|---|
| no `Projection` row | `absent` | *"No projection has been computed for this context."* |
| `status: 'fitting'` | `rebuilding` | *"Rebuilding — {n} new chunks aren't plotted yet."* |
| `status: 'failed'` | `absent` | the stored reason verbatim |
| counts equal | `fresh` | `null` |
| counts differ, not fitting | `rebuilding` | *"{n} chunks were added since this was fitted."* + a rebuild is enqueued |
| downsampled at fit time | `fresh` | *"Showing 20,000 of 47,331 chunks."* |

### 4.5 The rebuild job

BullMQ queue `projection`, concurrency **1** across the whole process. Jobs are deduplicated
per context with `jobId: \`projection-${contextId}\`` and `removeOnComplete` — BullMQ drops a
duplicate id while one is pending, so a user re-uploading 50 documents produces one fit, not
fifty ([architecture.md §9](architecture.md)).

> **Amendment (implementation).** The dedup key uses a dash, not the colon this section
> originally specified: BullMQ's `Job` rejects any custom id containing `:` ("Custom Id
> cannot contain :"), verified live on first enqueue. `contexts/queue.js`'s own header
> comment already flags the identical restriction for queue *names*; this is the same
> restriction, discovered here for job ids.

Enqueued on: ingest completion, document delete, and an explicit *Rebuild* action. **Not** on
every chunk upsert.

### 4.6 `GET /api/vectors/node/:pointId`

Retrieves one point from Qdrant with its payload, tenant-filtered, and returns the full chunk
text plus metadata. This is why the projection payload carries no text: 5,000 chunks of text
is megabytes nobody reads, and the inspector needs exactly one at a time.

---

## 5. Admin Endpoints

### 5.1 `GET /api/admin/queue` — `requireAdmin`

```js
{
  depth: { waiting, active, failed, completed },   // BullMQ getJobCounts — already used by /health
  throughputPerMin,        // completed jobs in the last 60s, from a Redis sorted set the
                           //   worker appends a timestamp to on each completion. NOT
                           //   derived from the `completed` counter, which is cumulative
                           //   since the queue was created and says nothing about rate.
  workerConcurrency,       // the configured value (2)
  activeWorkers,           // getWorkers().length — real, not the configured number
  oldestWaitingAgeMs,      // now − the oldest waiting job's timestamp, or null when idle
}
```

`throughputPerMin` needs a real source. The worker `ZADD`s `queue:completions` with the
completion timestamp as both score and member on every finished job, and the endpoint
`ZCOUNT`s the last 60 seconds. A `ZREMRANGEBYSCORE` on each write trims anything older than
5 minutes, so the set is bounded.

### 5.2 `GET /api/admin/errors` — `requireAdmin`

Reads `PipelineError` (introduced in Phase 5 for notify failures, now written from every
subsystem):

```js
const PipelineErrorSchema = new mongoose.Schema({
  kind: { type: String, required: true, index: true,
          enum: ['parse', 'embed', 'vision', 'rerank', 'generate', 'queue', 'notify', 'trace', 'projection'] },
  message:    { type: String, required: true, maxlength: 2000 },
  stack:      { type: String, default: null, maxlength: 8000 },
  retryable:  { type: Boolean, default: false },
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  contextId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Context', default: null },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
  fileName:   { type: String, default: null },
}, { timestamps: true });

PipelineErrorSchema.index({ createdAt: -1 });
// 14 days. Long enough to investigate a weekend incident on Monday; short enough that
// the collection cannot become the largest thing in the database.
PipelineErrorSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });
```

Writes come from `ingestDocument.js`'s catch block (which already classifies), the cascade
job, the projection job, the notify layer, and the trace-capture catch. A single
`recordPipelineError(kind, err, ctx)` helper is the only writer.

**The stack trace is admin-only and never leaves this endpoint.** It is not attached to any
user-facing error response.

### 5.3 The real `stage` field

`Document` gains `stage: { type: String, enum: ['queued','parsing','chunking','embedding','ready','failed'], default: 'queued' }`,
written by `ingestDocument.js` at the same six points that already call `updateProgress`.

This retires Phase 2's interim client-side derivation. The 45–75 band that was coarsely
labeled *parsing* now reports its own truth: the enum gains no member, but the write at
progress 45 sets `stage: 'parsing'` with an accompanying `stageDetail` string
(`"OCR and page embedding, 40 pages"`) built from `visualPageCount` server-side, so the client
stops computing it.

**`frontend/src/app/components/documents/stage.ts` is deleted in this phase.** Its removal is
task 7.18 and its acceptance criterion is that the file does not exist.

---

## 6. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 7.1 | Implement the `Trace` model with all three indexes and the TTL | `db.traces.getIndexes()` shows `expireAfterSeconds: 2592000`; a second trace for one `messageId` fails the unique index |
| 7.2 | Return `promptBlocks` from `generate.js` | An answer's trace contains one `system` block and the `user` blocks in the order the model received them |
| 7.3 | Keep the pre-floor candidate set on state with `belowFloor` stamped | A query where 14 of 18 fall below the floor stores all 18, with 14 marked and 4 carrying a `finalRank` |
| 7.4 | Store image blocks as served URIs | `grep`ping a trace document for `base64` returns nothing; the block's `content` starts with `/api/pages/` |
| 7.5 | Implement `buildTrace` with two-stage cap shedding | A synthetic 400 KB prompt produces a stored document ≤ 256 KB with `truncated: true` and intact block structure |
| 7.6 | Write the trace inside `persistTurn`, failure-isolated | With the `traces` collection made unwritable, the turn still persists, the SSE stream still completes, and a `pipeline_errors` row with `kind: 'trace'` exists |
| 7.7 | Emit `traceId` in the SSE telemetry frame, after the write | Phase 3's ribbon link resolves; the id is present in the frame the client receives |
| 7.8 | Trace refusals with `refused: true` | An off-corpus question produces a trace whose candidates are all `belowFloor: true` and whose `tokens.output` is null |
| 7.9 | Implement the three trace routes with a list projection | `GET /api/traces` returns no `candidates` or `prompt` keys; 50 rows respond in < 100 ms; a foreign id returns 404 |
| 7.10 | Implement `Projection` with binary position storage | A 5,000-node projection document's `positions` buffer is exactly 60,000 bytes |
| 7.11 | Implement `fitContext` with the fixed seed and the minimum-points guard | A 10-chunk context returns `failed` naming the 16-chunk minimum; two fits of unchanged data produce identical coordinates |
| 7.12 | Implement downsampling above 20,000 nodes | A 47k-chunk context fits in < 15 s and reports *"Showing 20,000 of 47,331 chunks."* |
| 7.13 | Implement `projectQuery` per §4.3 | Unit test with a fixture projection: the beacon lies inside the convex hull of its top-3 neighbors; with all neighbors absent it returns `placed: false, reason: 'stale_projection'` |
| 7.14 | Rerank the beacon's neighbors and mark floor survivors | The response distinguishes retrieved-and-kept from retrieved-and-cut |
| 7.15 | Implement the projection queue with per-context deduplication | Uploading 10 documents to one context enqueues exactly **one** `projection:rebuild` job |
| 7.16 | Implement all six staleness states | Each returns its stated `staleness` and `reason`; a stale read enqueues a rebuild |
| 7.17 | Implement `GET /api/vectors/node/:pointId`, tenant-filtered | A foreign `pointId` returns 404; the response carries the full chunk text |
| 7.18 | Add the real `stage` field and delete the client derivation | `frontend/src/app/components/documents/stage.ts` does not exist; the table reads `doc.stage` directly |
| 7.19 | Implement `throughputPerMin` from a bounded sorted set | Completing 5 jobs in a minute reports 5; `ZCARD queue:completions` never exceeds 5 minutes' worth |
| 7.20 | Implement `PipelineError` + `recordPipelineError` as the single writer | Every listed subsystem writes through it; `grep -c "PipelineError.create" backend/src/` returns 1 |
| 7.21 | Implement `/api/admin/{queue,errors}` behind `requireAdmin` | As a non-admin both return 403 at the API level (the *route* is documented; only the UI hides it); stack traces appear in no other response |
| 7.22 | Un-mock every Phase 4 panel | `MOCKED_ENDPOINTS` is empty; `/admin/traces`, `/admin/vectors`, and `/admin/health` render real data in a production build |
| 7.23 | Write `npm run test:projection` | `fit.test.js` (determinism, minimum points, downsampling) and `transform.test.js` (centroid placement, empty-neighbor case) pass |

> **Note on 7.21.** `/api/admin/*` returns **403** for an authenticated non-admin, while
> `/api/contexts/:foreignId` returns **404**. The difference is deliberate: a 404 on a
> resource id prevents an existence oracle about *another tenant's data*. `/api/admin/queue`
> is not a per-tenant resource — its existence is public knowledge from this document — so a
> 403 leaks nothing and is the more honest status. The *UI* still hides the nav item rather
> than disabling it (phase_1 §7.3).

---

## 7. Milestone Definition

Phase 7 is **complete** when:

> A user asks *"what was EMEA revenue in Q3?"* and, the next day, opens `/admin/traces`. The
> query is in the list with its provenance ribbon at 2,480 ms and `3 sources`. They open it.
> The waterfall is drawn from stored telemetry rather than a live stream and is identical to
> what the chat ribbon showed. The delta matrix now shows **all eighteen** candidates — the
> four that survived and the fourteen struck through beneath the relevance floor rule,
> including a `colpali` page hit at 0.09 that no console before this could display.
>
> They open the payload drawer. The **Prompt** tab shows the system prompt verbatim, then the
> assembled user message with three `<source>` blocks exactly as the model received them, then
> an image block whose content reads `/api/pages/66f1c…/3.jpg` — a URI, with the thumbnail
> loading from it, and not one byte of base64 in the stored document. The **Usage** tab reports
> `anthropic · claude-sonnet-5 · 1,842 in · 291 out`, read from the `UsageEvent` row the
> pipeline already wrote.
>
> They ask an off-corpus question and get the fixed refusal. Its trace exists too, marked
> refused, showing that retrieval genuinely ran and returned eleven candidates whose best
> rerank score was 0.09 — the diagnostic that explains *why* it refused, which v1 discarded
> entirely.
>
> They open `/admin/vectors` with `Q3 Reports` selected. The first load returns
> `staleness: 'absent'` and enqueues a fit; the page shows *"Computing projection…"*. Eleven
> seconds later it resolves: 5,412 points in three visible clusters, colored by document, in a
> 63 KB response that decodes in under 4 ms. `redis-cli LLEN bull:projection:wait` shows one
> job was enqueued for the ten documents that triggered it, not ten.
>
> They type *"EMEA revenue"* into the beacon box. The response arrives in 260 ms: a blue
> sphere lands inside the cluster containing `q3-earnings.pdf`, with twelve links fanning out
> to its true nearest neighbors, four of them ringed because they cleared the relevance floor.
> They click the nearest one and the inspector shows the same chunk text the trace's first
> `<source>` block contained — the beacon and the citation agree, because both came from the
> same Qdrant index.
>
> They upload a new document. The status column reads **Parsing** with the sub-label *"OCR and
> page embedding, 12 pages"* — now served by the backend's own `stage` field, and
> `frontend/src/app/components/documents/stage.ts` no longer exists. When it finishes, the
> vectors page reports *"Rebuilding — 88 new chunks aren't plotted yet."* over the dimmed
> existing cloud, and any beacon on screen is discarded with a toast.
>
> Signed in as an admin, `/admin/health` now shows real throughput — *"4.2 jobs/min · 2 workers
> · oldest waiting 3s"* — beside the dependency cards, and the error stream lists the corrupt
> PDF from earlier with `kind: 'parse'`, its classified message, a link to the document, and an
> expandable stack trace. Signed in as a normal user, `/api/admin/queue` returns 403.
>
> `MOCKED_ENDPOINTS` is empty, `npm run build` produces a bundle with no fixture module in it,
> and every panel across all three consoles renders real data. `npm test` — including the new
> `test:projection` and the Phase 6 `test:tenancy` suites — is green.

---

## 8. Files to Create

```
backend/src/
├── models/{Trace,Projection,PipelineError}.js     # PipelineError extended from Phase 5
├── telemetry/
│   ├── traceCapture.js                # buildTrace + cap shedding (§2.3)
│   └── pipelineError.js               # recordPipelineError — the single writer
├── projection/
│   ├── fit.js                         # umap-js fit, seed, downsampling (§4.2)
│   ├── transform.js                   # neighbor-weighted beacon placement (§4.3)
│   ├── pack.js                        # Float32Array / Uint16Array packing + bounds
│   ├── scroll.js                      # scrollAllVectors — the only with_vector:true read
│   └── worker.js                      # BullMQ 'projection', concurrency 1, dedup by id
├── api/routes/
│   ├── traces.js                      # list (projected), detail, by-message
│   ├── vectors.js                     # projection, project-query, node
│   └── admin.js                       # queue, errors — requireAdmin
├── conversation/persistTurn.js        # [extend] write the Trace, failure-isolated
├── graph/nodes/{generate,rerank}.js   # [extend] return promptBlocks / allCandidates
├── ingestion/{queue,ingestDocument}.js# [extend] stage field, completion ZADD, projection enqueue
└── providers/vectorStore.js           # [extend] nearestDense(tenant, vector, k)

backend/test/projection/
├── fit.test.js                        # determinism, minimum points, downsampling
└── transform.test.js                  # centroid placement, stale-projection case

frontend/src/
├── api/mock/                          # DELETED — MOCKED_ENDPOINTS is now empty
└── app/components/documents/stage.ts  # DELETED — the backend reports stage (§5.3)
```

**New dependency:** `umap-js`.

---

## 9. Performance Validation

| Metric | How to Measure | Target |
|---|---|---|
| `GET /api/traces` (50 rows) | `autocannon` | < 100 ms p95 — depends on the list projection |
| `GET /api/traces/:id` | `autocannon` | < 150 ms p95 |
| Trace document size | `Object.bsonsize` over 100 real traces | p95 < 120 KB, max ≤ 256 KB |
| Trace write overhead in `persistTurn` | Compare `totalMs` before and after | < 20 ms added; not on the SSE critical path |
| UMAP fit, 5,000 × 1024 | Worker log timestamps | < 15 s |
| UMAP fit, 20,000 × 1024 (the cap) | Worker log timestamps | < 60 s; the job yields between epochs and SSE latency is unaffected |
| `GET /api/vectors/projection` | Network panel, 5,000 nodes | < 200 ms p95, ≤ 100 KB |
| `POST /api/vectors/project-query` | Network panel | < 400 ms p95 (Cohere embed ~200 ms + Qdrant k-NN ~20 ms + centroid < 1 ms + rerank ~150 ms) |
| Projection job dedup | `redis-cli LLEN bull:projection:wait` after 10 uploads | 1 |
| `GET /api/admin/queue` | `autocannon` | < 30 ms p95 (Redis only) |
| `queue:completions` set size | `ZCARD` under sustained ingest | bounded at 5 minutes of entries |
