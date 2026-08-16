// The hybrid retrieval pipeline (phase 3 §6): normalize -> encode -> fuse -> merge ->
// rerank -> floor. Written as a plain async function, not a graph node — Phase 5 wraps
// this in LangGraph, so it is unit-testable now without a graph runtime. Tracing (§7.3)
// is layered on via `traceable`, which does not change the function's shape: `search()`
// still returns a plain promise of the response envelope.
import { traceable } from 'langsmith/traceable';
import * as embeddings from '../providers/embeddings.js';
import * as vectorStore from '../providers/vectorStore.js';
import { rerankOrDegrade } from '../providers/reranker.js';
import { normalize } from '../ingestion/normalize.js';
import { getTracingClient } from '../telemetry/tracing.js';
import { mergeByProvenance } from './merge.js';
import { createTimer } from './timer.js';
import { FUSION_LIMIT, RELEVANCE_FLOOR, TOP_N_DEFAULT } from './constants.js';

const EMPTY_MESSAGES = {
  empty_query: 'Query is empty after normalization.',
  empty_corpus: 'No documents have been ingested yet.',
  no_relevant_matches: 'No content in your documents is relevant to this question.',
};

// FR-SRCH-06: an explicit report rather than weak matches presented as authoritative.
// `reason` distinguishes three genuinely different situations the console renders
// differently — see EMPTY_MESSAGES above (phase 3 §5.2).
function emptyResult(reason, t, extra = {}) {
  return {
    results: [],
    empty: { reason, message: EMPTY_MESSAGES[reason], ...extra },
    telemetry: t.report(),
  };
}

// The internal candidate carries fields the client has no use for (fusionScore,
// contentHash). The response is an explicit projection, so adding an internal field
// never leaks it into the API contract (phase 3 §6.1).
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
    imageUri: r.imageUri ?? null,                     // always null until Phase 4
  };
}

// ── Traced stage wrappers (phase 3 §7.3) ─────────────────────────────────────────────
// Each becomes a named child span under the root `search` run below, via langsmith's
// AsyncLocalStorage-based context propagation — no explicit parent wiring needed as long
// as they're called from inside the traced `runSearch`. Query text is left unredacted
// (it's the user's own input, essential for debugging retrieval); chunk text is redacted
// wherever it appears in inputs/outputs by the SENSITIVE key set on the shared client
// (telemetry/tracing.js, phase 1 §9.1).

const tracedEncode = traceable(
  async (query) => {
    const [dense, sparseVecs] = await Promise.all([
      embeddings.encodeQuery(query),
      embeddings.encodeSparse([query]),
    ]);
    return { dense, sparse: sparseVecs[0] };
  },
  { name: 'embed', run_type: 'embedding', client: getTracingClient() },
);

const tracedRetrieve = traceable(
  (args) => vectorStore.hybridQuery(args),
  { name: 'retrieve', run_type: 'retriever', client: getTracingClient() },
);

const tracedRerank = traceable(
  (query, candidates, topN) => rerankOrDegrade(query, candidates, topN),
  { name: 'rerank', run_type: 'chain', client: getTracingClient() },
);

async function runSearch(rawQuery, { documentIds = null, topN = TOP_N_DEFAULT } = {}) {
  const t = createTimer();

  const query = normalize(rawQuery);
  // normalize() trims and collapses whitespace but does not strip punctuation, so this
  // only fires for a whitespace-only (or empty) input — a punctuation-only query like
  // "..." survives normalization and is searched as real (if low-value) query text.
  if (!query) return emptyResult('empty_query', t);

  // 1. Encode query — dense (Cohere API) and sparse (local BM25) in parallel. Sparse is
  //    local and ~3ms; running them concurrently costs nothing and removes it from the
  //    critical path entirely.
  t.mark('embedStart');
  const { dense: denseRes, sparse: sparseVec } = await tracedEncode(query);
  t.mark('embedEnd');

  // 2. Hybrid retrieve with server-side RRF fusion.
  t.mark('retrieveStart');
  const candidates = await tracedRetrieve({
    denseVector: denseRes.vector,
    sparseVector: sparseVec,
    limit: FUSION_LIMIT,
    documentIds,
  });
  t.mark('retrieveEnd');

  if (candidates.length === 0) {
    const corpusSize = await vectorStore.countPoints(documentIds);
    return emptyResult(corpusSize === 0 ? 'empty_corpus' : 'no_relevant_matches', t, {
      candidatesConsidered: candidates.length,
    });
  }

  // 3. Merge visual page candidates by provenance. [Phase 4]
  //    Stubbed to identity now; Phase 4 replaces it with the real dedup in §5.5 of the
  //    architecture doc, so the seam exists before it is needed.
  const merged = mergeByProvenance(candidates, /* pageCandidates */ []);

  // 4. Rerank — the only signal the user's ordering comes from.
  t.mark('rerankStart');
  const { ranked, skipped } = await tracedRerank(query, merged, topN);
  // Amended during Phase 3 implementation: rerankOrDegrade() never throws — it catches
  // its own provider failure and returns normally with `skipped: true`. Marking
  // 'rerankEnd' unconditionally (as §7.1's reference timer code implies) therefore always
  // produces a real rerankMs number, even when degraded, which task 3.10's own acceptance
  // criterion contradicts ("with rerank degraded, telemetry.rerankMs === null, not 0") —
  // verified live against an invalidated rerank model. A degraded attempt's elapsed time
  // isn't real rerank latency anyway (it's however long the failed call took to reject),
  // so only mark the end when a real rerank actually completed.
  if (!skipped) t.mark('rerankEnd');

  // 5. Apply the relevance floor. `rerankSkipped` means every score is null, and the
  //    filter passes everything through — degraded ranking must not also trigger a
  //    spurious empty state.
  const results = ranked.filter((r) => r.relevanceScore === null || r.relevanceScore >= RELEVANCE_FLOOR);

  if (results.length === 0) {
    return emptyResult('no_relevant_matches', t, {
      candidatesConsidered: candidates.length,
      bestScore: ranked[0]?.relevanceScore ?? 0,
    });
  }

  return {
    results: results.map(toPublicResult),
    telemetry: t.report({
      rerankSkipped: skipped,
      candidatesRetrieved: candidates.length,
      candidatesAfterFloor: results.length,
    }),
  };
}

// Root trace: wraps the whole pipeline as one named run so the three stage spans above
// nest as its children, mirroring the pipeline shape in the LangSmith trace tree.
export const search = traceable(runSearch, { name: 'search', run_type: 'chain', client: getTracingClient() });
