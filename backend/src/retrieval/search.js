// The hybrid retrieval pipeline (phase 3 §6, extended phase 4 §7): normalize -> encode ->
// fuse -> merge -> rerank -> floor. Written as a plain async function, not a graph node —
// Phase 5 wraps this in LangGraph, so it is unit-testable now without a graph runtime.
// Tracing (§7.3) is layered on via `traceable`, which does not change the function's
// shape: `search()` still returns a plain promise of the response envelope.
import { traceable } from 'langsmith/traceable';
import * as embeddings from '../providers/embeddings.js';
import * as vectorStore from '../providers/vectorStore.js';
import * as visionService from '../providers/visionService.js';
import { rerankOrDegrade } from '../providers/reranker.js';
import { normalize } from '../ingestion/normalize.js';
import { getTracingClient } from '../telemetry/tracing.js';
import { buildTelemetry } from '../telemetry/pipelineTelemetry.js';
import { recordPipelineTelemetry } from '../telemetry/metrics.js';
import { mergeByProvenance } from './merge.js';
import { createTimer } from './timer.js';
import { FUSION_LIMIT, PAGE_FUSION_LIMIT, RELEVANCE_FLOOR, TOP_N_DEFAULT } from './constants.js';

const EMPTY_MESSAGES = {
  empty_query: 'Query is empty after normalization.',
  empty_corpus: 'No documents have been ingested yet.',
  no_relevant_matches: 'No content in your documents is relevant to this question.',
};

// FR-SRCH-06: an explicit report rather than weak matches presented as authoritative.
// `reason` distinguishes three genuinely different situations the console renders
// differently — see EMPTY_MESSAGES above (phase 3 §5.2). `extra` mixes two different
// audiences — fields PipelineTelemetry defines (candidatesRetrieved, candidatesAfterMerge,
// candidatesAfterFloor, rerankSkipped, warnings) and fields only the `empty` block cares
// about (candidatesConsidered, bestScore) — split here rather than dumped into one object,
// because a first attempt at this that spread `extra` only into `empty` silently left every
// empty-result response reporting `telemetry.candidatesRetrieved: 0` even when retrieval
// had genuinely found and merged 50 candidates that the relevance floor then rejected —
// caught live against a real query, not by inspection.
const TELEMETRY_EXTRA_KEYS = ['candidatesRetrieved', 'candidatesAfterMerge', 'candidatesAfterFloor', 'rerankSkipped', 'warnings'];

function emptyResult(reason, t, extra = {}) {
  const telemetryExtra = {};
  const emptyExtra = {};
  for (const [key, value] of Object.entries(extra)) {
    (TELEMETRY_EXTRA_KEYS.includes(key) ? telemetryExtra : emptyExtra)[key] = value;
  }
  // t.startedAt() is the request origin here: runSearch's timer is created as the very
  // first thing the request does, so its start instant IS the request start (phase 6 §2.2).
  const telemetry = buildTelemetry({ ...t.report(), totalMs: t.elapsedMs(), ...telemetryExtra }, t.startedAt());
  recordPipelineTelemetry(telemetry);
  return {
    results: [],
    empty: { reason, message: EMPTY_MESSAGES[reason], ...emptyExtra },
    telemetry,
  };
}

// The internal candidate carries fields the client has no use for (fusionScore,
// maxSimScore, contentHash). The response is an explicit projection, so adding an
// internal field never leaks it into the API contract (phase 3 §6.1, extended phase 4
// §7.4).
//
// `kind` and `text` are keyed on `sourceKind === 'page'` — a literal page/multivector hit
// from cerebro_pages — not on `sourceKind === 'ocr'`, which is a text *chunk* derived from
// OCR that merge.js may or may not have absorbed into a page this query. An OCR chunk that
// survives merge.js unabsorbed (its page wasn't itself retrieved by the ColPali branch)
// has no image to show and correctly displays as an ordinary text result.
//
// Exported (phase 5 §6, §7.2): the graph's rerank node reuses this exact projection to
// populate RagState.sources, so the objects the generation prompt is built from and the
// objects /api/search returns are the same shape — one place decides what a "source"
// looks like to anything outside the retrieval pipeline.
export function toPublicResult(r) {
  const isPage = r.sourceKind === 'page';
  return {
    pointId: r.pointId,
    kind: isPage ? 'page' : 'text',
    text: isPage ? r.ocrText : r.text,
    score: r.relevanceScore,
    documentId: r.documentId,
    fileName: r.fileName,
    page: r.page ?? null,
    headingPath: r.headingPath ?? null,
    position: r.position ?? null,
    // The served route (§7.5), not the internal storage key r.imageUri carries
    // (`pages/<id>/<page>.jpg`) — always null for a text result.
    imageUri: isPage ? `/api/pages/${r.documentId}/${r.page}.jpg` : null,
    ocrQuality: isPage ? r.ocrQuality : null,
    // Non-empty only when merge.js actually absorbed one or more OCR chunks into this
    // page this query (§7.2) — null rather than [] so the client can tell "nothing was
    // absorbed" apart from "this field doesn't apply" the same way imageUri does.
    absorbedChunks: r.absorbedChunks ?? null,
    // Phase 6 §2.3 provenance panel: which retrieval branch(es) produced this candidate
    // (vectorStore.js's hybridQuery/multivectorQuery) and its rank within that branch's
    // own pre-rerank ordering. `finalRank` is stamped by the caller (runSearch / rerankNode)
    // once the post-rerank, post-floor order is known — null until then.
    branch: isPage ? 'colpali' : (r.branch ?? null),
    fusionRank: r.fusionRank ?? null,
    finalRank: r.finalRank ?? null,
  };
}

// ── Traced stage wrappers (phase 3 §7.3, extended phase 4 §7.1) ─────────────────────
// Each becomes a named child span under the root `search` run below, via langsmith's
// AsyncLocalStorage-based context propagation — no explicit parent wiring needed as long
// as they're called from inside the traced `runSearch`. Query text is left unredacted
// (it's the user's own input, essential for debugging retrieval); chunk/OCR text is
// redacted wherever it appears in inputs/outputs by the SENSITIVE key set on the shared
// client (telemetry/tracing.js, phase 1 §9.1).

// Phase 6 §2.1: dense (Cohere API) and sparse (local BM25) get their own timer marks —
// see retrieveStage below — because they are genuinely different-cost operations (a
// network round trip vs. a synchronous local tokenizer pass) that used to be folded into
// one `embedMs` number under a single traced span, which hid the fact that sparse costs
// ~2-4ms while dense costs ~150-250ms. Split into two traceable spans for the same reason.
const tracedEncode = traceable(
  (query) => embeddings.encodeQuery(query),
  { name: 'embed', run_type: 'embedding', client: getTracingClient() },
);

const tracedSparseEncode = traceable(
  async (query) => (await embeddings.encodeSparse([query]))[0],
  { name: 'sparse', run_type: 'embedding', client: getTracingClient() },
);

// Its own span, separate from tracedEncode, because it runs concurrently with it (§7.1)
// rather than nested inside it — the two are independent network calls to different
// services, not stages of one pipeline step. Catches its own failure and returns null:
// visual retrieval degrades independently of the text path, exactly like rerankOrDegrade
// degrades independently of retrieval.
const tracedColpaliEmbed = traceable(
  async (query) => {
    try {
      return await visionService.embedQuery(query);
    } catch (err) {
      console.warn('[search] ColPali query embedding failed, text-only:', err.message);
      return null;
    }
  },
  { name: 'embedColpali', run_type: 'embedding', client: getTracingClient() },
);

const tracedRetrieve = traceable(
  (args) => vectorStore.hybridQuery(args),
  { name: 'retrieve', run_type: 'retriever', client: getTracingClient() },
);

const tracedPageRetrieve = traceable(
  (args) => vectorStore.multivectorQuery(args),
  { name: 'retrievePages', run_type: 'retriever', client: getTracingClient() },
);

const tracedRerank = traceable(
  (query, candidates, topN) => rerankOrDegrade(query, candidates, topN),
  { name: 'rerank', run_type: 'chain', client: getTracingClient() },
);

// Steps 1-3 of the pipeline (encode -> retrieve -> merge), factored out so the graph's
// retrieveNode (phase 5 §6) can share the exact same encode/retrieve logic instead of
// reimplementing the concurrent dense+sparse+ColPali calls. Takes the caller's timer
// rather than owning one, so runSearch below keeps reporting one continuous set of marks
// across the whole pipeline (retrieval + rerank) the way it always has.
async function retrieveStage(query, documentIds, t) {
  // 1. Encode query — dense (Cohere API), sparse (local BM25), and ColPali multivector
  //    (vision service) all run concurrently. All three are independent network/local
  //    calls; serializing any of them would only add its latency to the others' critical
  //    path for no benefit (phase 4 §7.1). Marks are taken inside each branch's own
  //    `.then()`, not after the outer `Promise.all` — the branches finish at different
  //    real times even though they start together.
  t.mark('embedStart');
  t.mark('sparseStart');
  t.mark('colpaliStart');
  const [denseRes, sparseVec, colpaliVec] = await Promise.all([
    tracedEncode(query).then((r) => { t.mark('embedEnd'); return r; }),
    tracedSparseEncode(query).then((r) => { t.mark('sparseEnd'); return r; }),
    tracedColpaliEmbed(query).then((v) => { t.mark('colpaliEnd'); return v; }),
  ]);

  // 2. Retrieve — hybrid (dense+sparse, server-side RRF) and, if the ColPali embed
  //    succeeded, MAX_SIM over visual pages. `limit: 10` for pages against 50 for chunks
  //    reflects granularity, not importance: a page is roughly 5-8 chunks' worth of
  //    content (phase 4 §7.1). The page branch's mark is only taken when it actually ran —
  //    same convention as rerankMs below: a mark for a branch that never attempted a real
  //    call would misreport 0ms as if it were a real, instantaneous retrieval.
  t.mark('retrieveStart');
  const [chunkCandidates, pageCandidates] = await Promise.all([
    tracedRetrieve({
      denseVector: denseRes.vector, sparseVector: sparseVec, limit: FUSION_LIMIT, documentIds,
    }).then((r) => { t.mark('retrieveEnd'); return r; }),
    colpaliVec
      ? tracedPageRetrieve({ queryMultivector: colpaliVec, limit: PAGE_FUSION_LIMIT, documentIds })
          .then((r) => { t.mark('pageRetrieveEnd'); return r; })
          .catch((err) => {
            // Degrades independently, same as the ColPali embed call above — a Qdrant
            // qdrant.pages breaker trip or transient error here must not fail the whole
            // search when the text branch (a separate breaker, qdrant.chunks) is healthy.
            console.warn('[search] visual page retrieval failed, text-only:', err.message);
            t.mark('pageRetrieveEnd');
            return [];
          })
      : Promise.resolve([]),
  ]);

  return { chunkCandidates, pageCandidates };
}

// 3. Merge visual page candidates by provenance — timed on its own (phase 6 §2.1) even
// though it is a synchronous, sub-millisecond Map/loop, because "assumed free" is exactly
// the class of unmeasured number this timer exists to eliminate.
function mergeStage(chunkCandidates, pageCandidates, t) {
  t.mark('mergeStart');
  const merged = mergeByProvenance(chunkCandidates, pageCandidates);
  t.mark('mergeEnd');
  return merged;
}

// Phase 5 §6: the graph's retrieveNode calls this directly. Owns its own timer (the graph
// tracks its own per-node timing separately via performance.now() in retrieveNode) and
// returns exactly `{ candidates, timings }` — no rerank, no relevance floor, no empty-state
// classification. rerankNode owns emptiness (a candidates.length === 0 check plus its own
// countPoints call) so this function's contract stays a plain "give me ranked-by-fusion
// candidates," reusable outside the /api/search response envelope.
export const retrieveCandidates = traceable(
  async function retrieveCandidates(rawQuery, { documentIds = null } = {}) {
    const t = createTimer();
    const query = normalize(rawQuery);
    const { chunkCandidates, pageCandidates } = await retrieveStage(query, documentIds, t);
    const candidates = mergeStage(chunkCandidates, pageCandidates, t);
    return {
      candidates,
      timings: t.report(),
      // Phase 6 §2.1: pre-merge (what retrieval actually returned) vs. post-merge (what
      // survived dedup) — two different, both meaningful, counts. The caller (retrieveNode)
      // forwards both into RagState.timings; rerankNode later adds candidatesAfterFloor.
      candidatesRetrieved: chunkCandidates.length + pageCandidates.length,
      candidatesAfterMerge: candidates.length,
    };
  },
  { name: 'retrieveCandidates', run_type: 'chain', client: getTracingClient() },
);

async function runSearch(rawQuery, { documentIds = null, topN = TOP_N_DEFAULT } = {}) {
  const t = createTimer();

  const query = normalize(rawQuery);
  // normalize() trims and collapses whitespace but does not strip punctuation, so this
  // only fires for a whitespace-only (or empty) input — a punctuation-only query like
  // "..." survives normalization and is searched as real (if low-value) query text.
  if (!query) return emptyResult('empty_query', t);

  const { chunkCandidates, pageCandidates } = await retrieveStage(query, documentIds, t);
  const candidatesRetrieved = chunkCandidates.length + pageCandidates.length;

  if (chunkCandidates.length === 0 && pageCandidates.length === 0) {
    const corpusSize = await vectorStore.countPoints(documentIds);
    return emptyResult(corpusSize === 0 ? 'empty_corpus' : 'no_relevant_matches', t, {
      candidatesConsidered: 0,
    });
  }

  // 3. Merge visual page candidates by provenance — a scanned page retrieved by both the
  //    OCR-chunk branch and the ColPali branch must not occupy two reranker slots and two
  //    result rows carrying the same evidence (architecture §5.5, phase 4 §7.2).
  const merged = mergeStage(chunkCandidates, pageCandidates, t);

  // 4. Rerank — the only signal the user's ordering comes from, across both kinds
  //    (phase 4 §7.3): after this stage a page and a chunk carry a `relevanceScore` from
  //    the same model on the same scale, so ordering is simply that score descending. No
  //    cross-modality score normalization is needed because fusionScore and maxSimScore
  //    are both discarded at this boundary — neither is ever compared to the other.
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

  const warnings = skipped ? ['Reranking was unavailable; results are in fusion order.'] : [];

  // 5. Apply the relevance floor. `rerankSkipped` means every score is null, and the
  //    filter passes everything through — degraded ranking must not also trigger a
  //    spurious empty state.
  const results = ranked.filter((r) => r.relevanceScore === null || r.relevanceScore >= RELEVANCE_FLOOR);

  if (results.length === 0) {
    return emptyResult('no_relevant_matches', t, {
      candidatesConsidered: merged.length,
      bestScore: ranked[0]?.relevanceScore ?? 0,
      // Verified live (task 6.1): omitting these here left them at buildTelemetry's 0
      // default even though retrieval genuinely found and merged candidates — every
      // relevance-floor rejection is a real "N candidates, 0 survived" story the console
      // should be able to show, not indistinguishable from an empty corpus.
      rerankSkipped: skipped,
      candidatesRetrieved,
      candidatesAfterMerge: merged.length,
      candidatesAfterFloor: 0,
      warnings,
    });
  }

  const telemetry = buildTelemetry({
    ...t.report(),
    totalMs: t.elapsedMs(),
    rerankSkipped: skipped,
    candidatesRetrieved,
    candidatesAfterMerge: merged.length,
    candidatesAfterFloor: results.length,
    warnings,
  }, t.startedAt());
  recordPipelineTelemetry(telemetry);

  return {
    results: results.map((r, i) => toPublicResult({ ...r, finalRank: i + 1 })),
    telemetry,
  };
}

// Root trace: wraps the whole pipeline as one named run so the three stage spans above
// nest as its children, mirroring the pipeline shape in the LangSmith trace tree.
export const search = traceable(runSearch, { name: 'search', run_type: 'chain', client: getTracingClient() });
