# Phase 3: Hybrid Retrieval & Reranking

## 1. Objective

Make the chunks written in Phase 2 searchable at production quality. A query is embedded as a *query* (not a document), run simultaneously against the dense and BM25 sparse vectors, fused server-side by Qdrant's native RRF, then reranked by a cross-encoder that reads the query against each candidate's actual text. Results below a relevance floor are discarded rather than returned as weak matches. Every stage reports its own latency. By the end of this phase: a developer posts `"What was EMEA revenue in Q3?"` to `POST /api/search` and gets back a relevance-ordered list whose top hit is the revenue table chunk — then posts `"INV-2024-8871"` and gets the exact invoice line, proving both the semantic and lexical halves work.

**No generation, no LLM calls, no conversation, no SSE, no visual/page retrieval, no frontend changes.** This phase returns ranked JSON and nothing else. The `retrieve` and `rerank` logic written here becomes LangGraph nodes in Phase 5 — it is built as plain functions now, deliberately, so it is testable without a graph runtime. Visual page retrieval joins this pipeline in Phase 4; the candidate-merging seam is stubbed but not implemented.

---

## 2. Query Encoding — `backend/src/providers/embeddings.js`

### 2.1 The Asymmetry

```js
export async function encodeQuery(text) {
  const res = await embedBreaker.fire({
    model: config.cohere.embedModel,
    texts: [text],
    inputType: 'search_query',     // NOT 'search_document' — see below
    embeddingTypes: ['float'],
  });
  return {
    vector: res.embeddings.float[0],
    tokens: res.meta?.billedUnits?.inputTokens ?? 0,
  };
}
```

Cohere embed v3 is trained asymmetrically: `search_document` and `search_query` project into deliberately different regions of the same space, so a short question and the long passage answering it land near each other despite having little lexical overlap. Using `search_document` for both sides — which is effectively what the legacy MiniLM path did, since it had no notion of input type — costs measurable recall on exactly the short-query case that dominates real usage. This one parameter is the largest single-line quality difference between the old pipeline and the new one.

### 2.2 Query Normalization

The same `normalize()` from Phase 2 runs on the query before encoding, for one reason: a query and a chunk must be normalized identically or their vectors are computed over subtly different text. Whitespace collapsing and NFC composition applied to documents but not queries would mean `"café"` typed with a decomposed `e + ́ ` never matches the composed `é` stored in the payload.

```js
const cleaned = normalize(rawQuery);
if (cleaned.length === 0) {
  return { results: [], reason: 'empty_query' };   // covers the punctuation-only edge case
}
```

---

## 3. Hybrid Retrieval — `backend/src/providers/vectorStore.js`

### 3.1 Server-Side Fusion via the Query API

Qdrant 1.10+ accepts multiple prefetch branches and fuses them in one round trip. This deletes the hand-rolled RRF loop in the legacy `SearchService.js` entirely.

```js
export async function hybridQuery({ denseVector, sparseVector, limit = 50, documentIds = null }) {
  const filter = documentIds?.length
    ? { must: [{ key: 'documentId', match: { any: documentIds } }] }
    : undefined;

  const res = await qdrantBreaker.fire('query', config.qdrant.chunksCollection, {
    prefetch: [
      { query: denseVector,  using: 'dense',  limit: PREFETCH_LIMIT, filter },
      { query: sparseVector, using: 'sparse', limit: PREFETCH_LIMIT, filter },
    ],
    query: { fusion: 'rrf' },     // Qdrant computes Reciprocal Rank Fusion server-side
    limit,
    filter,
    with_payload: true,
    with_vector: false,           // never ship 1024 floats per hit back to Node
  });

  return res.points.map((p) => ({
    pointId: String(p.id),
    fusionScore: p.score,         // RRF score — a rank artifact, NOT a relevance measure
    ...p.payload,
  }));
}
```

| Constant | Value | Justification |
|---|---|---|
| `PREFETCH_LIMIT` | 100 per branch | Each branch must overfetch so fusion has material to work with. 100 is 2× the fused limit — below ~1.5× the branches barely overlap and RRF degenerates toward whichever branch ranked first |
| `limit` (fused) | 50 | Matches the reranker's cost ceiling (§4.2). Larger candidate sets raise rerank latency linearly with negligible top-8 gain |
| `with_vector` | `false` | 50 hits × 1024 floats × 4 B = 205 KB of pure waste per query if left on |

`filter` is applied **inside each prefetch branch and again at the top level**. Applying it only at the top level would let each branch fill its 100 slots with out-of-scope documents that then get discarded, leaving far fewer than 100 in-scope candidates — scoping would silently reduce recall instead of just narrowing it.

### 3.2 Why RRF Is Kept for Fusion but Not for Ranking

RRF combines *ranks*, which is exactly right for merging two incomparable score scales (cosine similarity in [-1,1] and unbounded BM25 term weights). It is exactly wrong as a final relevance signal, because a document ranked #1 by both branches scores identically whether it is a perfect answer or the best of fifty bad ones. RRF's output is therefore treated as a **candidate set**, never as an ordering the user sees. The ordering comes from §4.

Qdrant's RRF uses the standard `1/(k + rank)` with `k = 60`, the value from the original Cormack et al. formulation; it is not configurable in the Query API and does not need to be, since its output is discarded after reranking.

---

## 4. Reranking — `backend/src/providers/reranker.js`

### 4.1 The Call

```js
export async function rerank(query, candidates, topN = 8) {
  if (candidates.length === 0) return [];

  const documents = candidates.map((c) => buildRerankText(c));

  const res = await rerankBreaker.fire({
    model: config.cohere.rerankModel,
    query,
    documents,
    topN: Math.min(topN, documents.length),
    returnDocuments: false,         // we already hold the payloads; index mapping is enough
  });

  return res.results.map((r) => ({
    ...candidates[r.index],
    relevanceScore: r.relevanceScore,   // [0,1], calibrated — this IS a relevance measure
  }));
}

// The reranker sees heading context, because a bare table row is unrankable without
// knowing what section it came from. Truncated at 4000 chars: rerank v3 caps input
// per document and a chunk is ~1300 chars, so this only bites on Phase 4 OCR pages.
function buildRerankText(c) {
  const prefix = c.headingPath ? `${c.headingPath}\n\n` : '';
  return `${prefix}${c.text}`.slice(0, 4000);
}
```

A cross-encoder reads the query and the passage *together* through one transformer, so it can judge whether the passage actually answers the question. Bi-encoder retrieval (§3) embeds them independently and can only measure proximity in a fixed space. This is why reranking is the highest-precision lever in the pipeline and why it runs on 50 candidates rather than on the whole corpus — it is far too expensive to be the retrieval step, and far too accurate to skip as the ranking step.

### 4.2 Cost Ceiling

Rerank latency scales roughly linearly with candidate count. At 50 short documents Cohere returns in ~250 ms p95; at 200 it is ~900 ms, which alone would consume the entire 500 ms retrieval budget. 50 is chosen as the point where added recall from a wider candidate set stops changing the top 8.

### 4.3 Graceful Degradation

Per architecture §6.2, a reranker outage degrades rather than fails:

```js
try {
  ranked = await reranker.rerank(query, candidates, TOP_N);
  telemetry.rerankSkipped = false;
} catch (err) {
  console.warn('[rerank] unavailable, falling back to fusion order:', err.message);
  ranked = candidates.slice(0, TOP_N).map((c) => ({ ...c, relevanceScore: null }));
  telemetry.rerankSkipped = true;   // surfaced in the response so the console can flag it
}
```

`relevanceScore: null` rather than a fabricated number is the important detail — the score floor in §5 must not run against invented values, and the advanced console must be able to show that ranking was degraded rather than silently presenting worse results as normal.

---

## 5. The Relevance Floor & Empty State

### 5.1 The Threshold

```js
export const RELEVANCE_FLOOR = 0.15;

const surviving = ranked.filter((r) => r.relevanceScore === null || r.relevanceScore >= RELEVANCE_FLOOR);
```

Cohere rerank v3 returns a calibrated `relevanceScore` in `[0,1]`. Empirically on this corpus shape: a passage that directly answers the query scores 0.7–0.99; a passage from the right section but not answering scores 0.2–0.5; an unrelated passage scores below 0.05. **0.15** sits in the gap between "wrong but topically adjacent" and "unrelated", chosen low rather than high because the cost asymmetry favors recall — a marginal chunk shown to the user is a minor annoyance, whereas discarding the only chunk containing the answer produces a confident "I don't know" about a document the user can see in their library.

When `rerankSkipped` is true, every score is `null` and the filter passes everything through — degraded ranking must not also trigger a spurious empty state.

### 5.2 The Empty Response

FR-SRCH-06 requires an explicit report rather than weak matches presented as authoritative. The response distinguishes three genuinely different situations:

```js
{
  results: [],
  empty: {
    reason: 'no_relevant_matches',   // | 'empty_corpus' | 'empty_query'
    message: 'No content in your documents is relevant to this question.',
    candidatesConsidered: 50,        // proves retrieval ran; the corpus was searched
    bestScore: 0.04                  // the highest score seen, so the floor is auditable
  },
  telemetry: { ... }
}
```

`empty_corpus` is checked first and separately, because "you have no documents" and "your documents don't cover this" require completely different UI responses:

```js
if ((await vectorStore.countPoints()) === 0) {
  return { results: [], empty: { reason: 'empty_corpus', message: 'No documents have been ingested yet.' } };
}
```

---

## 6. The Search Pipeline — `backend/src/retrieval/search.js`

Written as a plain async function, not a graph node. Phase 5 wraps this in LangGraph; keeping it standalone here means it is unit-testable and the graph adds orchestration without owning the logic.

```js
export async function search(rawQuery, { documentIds = null, topN = 8 } = {}) {
  const t = createTimer();

  const query = normalize(rawQuery);
  if (!query) return emptyResult('empty_query', t);

  // 1. Encode query — dense (Cohere API) and sparse (local BM25) in parallel.
  //    Sparse is local and ~3ms; running them concurrently costs nothing and
  //    removes it from the critical path entirely.
  t.mark('embedStart');
  const [denseRes, sparseVecs] = await Promise.all([
    embeddings.encodeQuery(query),
    embeddings.encodeSparse([query]),
  ]);
  t.mark('embedEnd');

  // 2. Hybrid retrieve with server-side RRF fusion.
  t.mark('retrieveStart');
  const candidates = await vectorStore.hybridQuery({
    denseVector: denseRes.vector,
    sparseVector: sparseVecs[0],
    limit: FUSION_LIMIT,
    documentIds,
  });
  t.mark('retrieveEnd');

  if (candidates.length === 0) {
    const corpusSize = await vectorStore.countPoints(documentIds);
    return emptyResult(corpusSize === 0 ? 'empty_corpus' : 'no_relevant_matches', t);
  }

  // 3. Merge visual page candidates by provenance.  [Phase 4]
  //    Stubbed to identity now; Phase 4 replaces it with the real dedup in §5.5
  //    of the architecture doc, so the seam exists before it is needed.
  const merged = mergeByProvenance(candidates, /* pageCandidates */ []);

  // 4. Rerank — the only signal the user's ordering comes from.
  t.mark('rerankStart');
  const { ranked, skipped } = await rerankOrDegrade(query, merged, topN);
  t.mark('rerankEnd');

  // 5. Apply the relevance floor.
  const results = ranked.filter((r) => r.relevanceScore === null || r.relevanceScore >= RELEVANCE_FLOOR);

  if (results.length === 0) {
    return emptyResult('no_relevant_matches', t, {
      candidatesConsidered: candidates.length,
      bestScore: ranked[0]?.relevanceScore ?? 0,
    });
  }

  return { results: results.map(toPublicResult), telemetry: t.report({ rerankSkipped: skipped }) };
}
```

### 6.1 Public Result Shape

The internal candidate carries fields the client has no use for (`fusionScore`, `contentHash`). The response is an explicit projection, so adding an internal field never leaks it into the API contract:

```js
function toPublicResult(r) {
  return {
    pointId: r.pointId,
    kind: r.sourceKind === 'ocr' ? 'page' : 'text',   // 'page' begins appearing in Phase 4
    text: r.text,
    score: r.relevanceScore,
    documentId: r.documentId,
    fileName: r.fileName,
    page: r.page ?? null,
    headingPath: r.headingPath ?? null,
    position: r.position,
    imageUri: r.imageUri ?? null,                      // always null until Phase 4
  };
}
```

---

## 7. Telemetry

### 7.1 The Timer

Every stage is measured with real elapsed time. The legacy pipeline reported a `cacheWaitMs: 0` for a cache that did not exist; nothing here reports a number it did not measure.

```js
function createTimer() {
  const marks = { start: performance.now() };
  return {
    mark: (name) => { marks[name] = performance.now(); },
    report: (extra = {}) => ({
      embedMs:    round(marks.embedEnd    - marks.embedStart),
      retrieveMs: round(marks.retrieveEnd - marks.retrieveStart),
      rerankMs:   marks.rerankEnd ? round(marks.rerankEnd - marks.rerankStart) : null,
      totalMs:    round(performance.now() - marks.start),
      ...extra,
    }),
  };
}
```

`rerankMs` is `null`, not `0`, when the stage did not run. A zero would be indistinguishable from an instantaneous rerank in the console.

### 7.2 Response Envelope

```json
{
  "query": "What was EMEA revenue in Q3?",
  "results": [ { "pointId": "…", "kind": "text", "score": 0.94, "page": 12, "…": "…" } ],
  "telemetry": {
    "embedMs": 187,
    "retrieveMs": 23,
    "rerankMs": 241,
    "totalMs": 458,
    "rerankSkipped": false,
    "candidatesRetrieved": 50,
    "candidatesAfterFloor": 6
  }
}
```

`candidatesRetrieved` versus `candidatesAfterFloor` is what makes the floor's behavior visible: a query returning 6 results from 50 candidates is working correctly, while 50 → 50 suggests the floor is too permissive and 50 → 0 suggests it is too strict. Both are tuning signals that a bare result list hides.

### 7.3 LangSmith Spans

Each stage is wrapped in a traced runnable so the trace tree mirrors the pipeline. Query text is *not* redacted (it is the user's own input and is essential for debugging retrieval), but chunk text is, per the `SENSITIVE` set from Phase 1 §9.1.

---

## 8. `POST /api/search`

```js
router.post('/api/search', async (req, res, next) => {
  const { query, documentIds, topN } = req.body ?? {};

  if (typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Query text is required.' });
  }
  if (query.length > MAX_QUERY_CHARS) {
    return res.status(400).json({ error: `Query exceeds ${MAX_QUERY_CHARS} characters.` });
  }
  if (documentIds !== undefined && !isArrayOfObjectIds(documentIds)) {
    return res.status(400).json({ error: 'documentIds must be an array of document ids.' });
  }

  try {
    const result = await search(query, {
      documentIds: documentIds ?? null,
      topN: clamp(topN ?? 8, 1, 25),
    });
    res.json({ query, ...result });
  } catch (err) {
    if (err.code === 'EOPENBREAKER') {
      return res.status(503).json({ status: 'Circuit Open', error: 'Search is temporarily unavailable.' });
    }
    next(err);
  }
});
```

| Guard | Value | Justification |
|---|---|---|
| `MAX_QUERY_CHARS` | 4,000 | Cohere embed v3 truncates at 512 tokens ≈ 2,000 chars; 4,000 accepts pasted paragraphs while bounding the request body. Beyond this the query is a document, not a question |
| `topN` clamp | 1–25 | Above 25 the reranker's `topN` exceeds the 50-candidate pool's useful depth |
| `documentIds` validation | ObjectId array | Rejected server-side before reaching Qdrant, so a malformed filter cannot widen scope |

The route mounts at the **same path** the legacy pipeline serves. This is the first cutover point: `/api/search` now reads Qdrant instead of MongoDB. The legacy `SearchService.js` remains on disk but is no longer routed to; it is deleted in Phase 6 once the new path has been exercised.

---

## 9. Retrieval Regression Tests

Retrieval quality cannot be asserted by unit tests over mocked vectors — it needs a real corpus and known-good answers. `backend/test/retrieval/` holds a fixed evaluation set.

### 9.1 The Fixture Corpus

Four documents ingested into a dedicated `cerebro_chunks_test` collection by a setup script: a 20-page annual report (tables, headings), a 3-sheet product spreadsheet, a markdown technical spec, and a plain-text invoice list containing IDs like `INV-2024-8871`.

### 9.2 The Query Set

| # | Query | Expected top-3 contains | Tests |
|---|---|---|---|
| 1 | `What was EMEA revenue in Q3?` | Report chunk, page 12 | Dense semantic match against a table |
| 2 | `INV-2024-8871` | Invoice chunk with that exact ID | Sparse/BM25 exact-identifier match (FR-SRCH-02) |
| 3 | `how do I authenticate` | Spec chunk under `Authentication` heading | Semantic match with zero lexical overlap |
| 4 | `revenu EMEA Q3` (typo, mixed lang) | Same chunk as #1 | Typo + cross-language tolerance |
| 5 | `SKU-99` | Spreadsheet row chunk | Identifier inside a markdown table |
| 6 | `what is the airspeed velocity of a swallow` | *empty* | Floor correctly rejects an off-corpus query |
| 7 | `the` | *empty or low* | Stopword-only query does not return arbitrary content |
| 8 | `authentication` scoped to spec docId | Spec chunks only | Scoping filter excludes other documents |

### 9.3 The Assertion

```js
// Recall@3 is the metric, not exact rank. Requiring the expected chunk at rank 1
// makes the suite brittle to harmless reranker drift between model versions;
// requiring it in the top 3 catches genuine regressions without false alarms.
const RECALL_AT_3_THRESHOLD = 0.85;   // 7 of 8 queries must pass

for (const testCase of QUERY_SET) {
  const { results } = await search(testCase.query, { documentIds: testCase.scope ?? null });
  const top3 = results.slice(0, 3).map((r) => r.pointId);
  const passed = testCase.expectEmpty ? results.length === 0 : top3.includes(testCase.expectedPointId);
  record(testCase, passed);
}
assert(passRate >= RECALL_AT_3_THRESHOLD);
```

---

## 10. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 3.1 | Implement `encodeQuery` with `search_query` input type | Unit test asserts the Cohere call receives `inputType: 'search_query'`; returned vector length is 1024 |
| 3.2 | Apply `normalize()` to queries before encoding | A query with decomposed `e + combining acute` retrieves the same chunk as the composed `é` form |
| 3.3 | Implement `hybridQuery` with Qdrant prefetch + RRF fusion | Qdrant receives exactly **one** HTTP request per search (verified by request log), not two |
| 3.4 | Apply `documentIds` filter inside both prefetch branches | Scoped search to one document returns 0 results from any other document across 20 trials |
| 3.5 | Implement `rerank` with Cohere cross-encoder | Every result carries a `score` in `[0,1]`; scores are monotonically non-increasing down the list |
| 3.6 | Implement rerank degradation on provider failure | With the Cohere rerank key invalidated, search still returns results and `telemetry.rerankSkipped === true` |
| 3.7 | Implement the relevance floor | Query #6 (`airspeed velocity of a swallow`) returns `results: []` with `empty.reason === 'no_relevant_matches'` and a `bestScore` below 0.15 |
| 3.8 | Distinguish `empty_corpus` from `no_relevant_matches` | Searching an empty collection returns `empty.reason === 'empty_corpus'`, not `no_relevant_matches` |
| 3.9 | Implement the stage timer | Response `telemetry` has non-null `embedMs`, `retrieveMs`, `rerankMs`, `totalMs`; `totalMs` ≥ the sum of the three |
| 3.10 | Report `rerankMs: null` when the stage is skipped | With rerank degraded, `telemetry.rerankMs === null`, not `0` |
| 3.11 | Implement `POST /api/search` with input validation | A 5,000-char query returns HTTP 400; `documentIds: "abc"` returns HTTP 400; a valid query returns HTTP 200 |
| 3.12 | Wire the circuit breaker to a 503 response | Stopping Qdrant and issuing 4 searches returns `{"status":"Circuit Open"}` with HTTP 503 on the 4th |
| 3.13 | Add the `mergeByProvenance` seam | Function exists, is called, is identity for an empty page-candidate list, and has a unit test asserting pass-through |
| 3.14 | Build the retrieval fixture corpus + setup script | `npm run test:corpus:setup` ingests 4 fixtures and reports the point count |
| 3.15 | Implement the 8-query regression suite | `npm run test:retrieval` passes ≥ 7 of 8 queries (Recall@3 ≥ 0.85) and prints a per-query pass/fail table |
| 3.16 | Emit LangSmith spans per stage | A search produces a trace with 3 named child spans (`embed`, `retrieve`, `rerank`) and chunk text redacted |

---

## 11. Milestone Definition

Phase 3 is **complete** when:

> A developer with the four fixture documents already ingested runs `curl -XPOST localhost:5000/api/search -H 'Content-Type: application/json' -d '{"query":"What was EMEA revenue in Q3?"}'`. The response returns in about 460 ms with six results. The first has `"score":0.94`, `"page":12`, `"headingPath":"Annual Report > Q3 Results > EMEA"`, and its `text` is the markdown revenue table — and `telemetry` shows `embedMs:187, retrieveMs:23, rerankMs:241, totalMs:458`, with `candidatesRetrieved:50` and `candidatesAfterFloor:6`. They then search `{"query":"INV-2024-8871"}` — a string with no semantic content whatsoever — and the top hit is the invoice line containing that exact identifier, proving the BM25 branch is contributing and not being drowned out by the dense branch. Searching `{"query":"how do I authenticate"}`, which shares no words with the target text, returns the spec's `Authentication` section at rank 1, proving the dense branch. They search `{"query":"what is the airspeed velocity of a swallow"}` and get `{"results":[],"empty":{"reason":"no_relevant_matches","candidatesConsidered":50,"bestScore":0.04}}` — the corpus was searched, 50 candidates were considered, and every one fell below the floor. Adding `"documentIds":["<spec-id>"]` to the authentication query returns only spec chunks across twenty repeated runs. They then invalidate the Cohere rerank model name in `.env` and restart: search still returns results, now ordered by fusion rank, with `"rerankSkipped":true` and `"rerankMs":null` in the telemetry — degraded, honest about it, and not an error. Finally `npm run test:retrieval` prints a per-query table with 8 of 8 passing and exits 0, and the LangSmith trace for the last search shows three child spans with chunk text replaced by `[redacted 1284 chars]`.

---

## 12. Files to Create

```
backend/src/
├── retrieval/
│   ├── search.js                     # The pipeline: normalize→encode→fuse→merge→rerank→floor
│   ├── merge.js                      # mergeByProvenance — identity now, real dedup in Phase 4
│   ├── timer.js                      # Stage timing with null-not-zero for skipped stages
│   └── constants.js                  # FUSION_LIMIT, PREFETCH_LIMIT, RELEVANCE_FLOOR, MAX_QUERY_CHARS
├── providers/
│   ├── embeddings.js                 # [extend] encodeQuery with search_query input type
│   ├── reranker.js                   # [extend] rerank + degradation wrapper
│   └── vectorStore.js                # [extend] hybridQuery, countPoints
└── api/routes/search.js              # POST /api/search — replaces the legacy route at the same path

backend/test/retrieval/
├── corpus/                           # 4 fixture documents
├── setup-corpus.js                   # Ingests fixtures into cerebro_chunks_test
├── queries.json                      # The 8-query evaluation set with expected point ids
├── regression.test.js                # Recall@3 assertion + per-query report table
├── floor.test.js                     # Empty-state reasons, floor boundary behavior
└── scoping.test.js                   # documentIds filter isolation across 20 trials
```

---

## 13. Performance Validation

| Metric | How to Measure | Target |
|---|---|---|
| End-to-end search latency | `telemetry.totalMs` p95 over 100 queries | < 500 ms (architecture §6) |
| Query embedding | `telemetry.embedMs` p95 | < 250 ms (one Cohere round trip) |
| Qdrant hybrid retrieve | `telemetry.retrieveMs` p95 @ 100k chunks | < 50 ms |
| Rerank stage | `telemetry.rerankMs` p95 @ 50 candidates | < 300 ms |
| Qdrant round trips per search | Qdrant request log count | Exactly 1 |
| Recall@3 on the evaluation set | `npm run test:retrieval` | ≥ 0.85 (7 of 8) |
| Scoping isolation | 20 scoped searches, count out-of-scope hits | Exactly 0 |
| Response payload size | `curl -w '%{size_download}'` for 8 results | < 60 KB (no vectors returned) |

---

## 14. Estimated Complexity

- **Node backend**: ~620 LOC across 7 files (search pipeline 190, vectorStore extension 120, reranker 90, route 80, timer 45, constants 25, embeddings extension 70)
- **Tests**: ~380 LOC plus 4 corpus fixtures and the query-set JSON
- **New npm dependencies**: 0 — `cohere-ai` and `@qdrant/js-client-rest` both arrived in Phase 1
- **Deleted**: nothing on disk. `/api/search` is re-pointed at the new pipeline; `SearchService.js` and the C++ addon call site go dark but are removed in Phase 6 after the new path has soaked

This is the phase where the hand-rolled RRF implementation, the in-memory fallback scan, and the C++ rerank call all leave the serving path — replaced by a single Qdrant round trip and one cross-encoder call. The C++ addon still compiles and its tests still pass; it simply is not called by anything the user can reach.
