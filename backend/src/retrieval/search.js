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
// differently — see EMPTY_MESSAGES above (phase 3 §5.2).
function emptyResult(reason, t, extra = {}) {
  return {
    results: [],
    empty: { reason, message: EMPTY_MESSAGES[reason], ...extra },
    telemetry: t.report(),
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
function toPublicResult(r) {
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
  };
}

// ── Traced stage wrappers (phase 3 §7.3, extended phase 4 §7.1) ─────────────────────
// Each becomes a named child span under the root `search` run below, via langsmith's
// AsyncLocalStorage-based context propagation — no explicit parent wiring needed as long
// as they're called from inside the traced `runSearch`. Query text is left unredacted
// (it's the user's own input, essential for debugging retrieval); chunk/OCR text is
// redacted wherever it appears in inputs/outputs by the SENSITIVE key set on the shared
// client (telemetry/tracing.js, phase 1 §9.1).

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

async function runSearch(rawQuery, { documentIds = null, topN = TOP_N_DEFAULT } = {}) {
  const t = createTimer();

  const query = normalize(rawQuery);
  // normalize() trims and collapses whitespace but does not strip punctuation, so this
  // only fires for a whitespace-only (or empty) input — a punctuation-only query like
  // "..." survives normalization and is searched as real (if low-value) query text.
  if (!query) return emptyResult('empty_query', t);

  // 1. Encode query — dense (Cohere API), sparse (local BM25), and ColPali multivector
  //    (vision service) all run concurrently. All three are independent network/local
  //    calls; serializing any of them would only add its latency to the others' critical
  //    path for no benefit (phase 4 §7.1). Marks are taken inside each branch's own
  //    `.then()`, not after the outer `Promise.all` — the branches finish at different
  //    real times even though they start together.
  t.mark('embedStart');
  t.mark('colpaliStart');
  const [{ dense: denseRes, sparse: sparseVec }, colpaliVec] = await Promise.all([
    tracedEncode(query).then((r) => { t.mark('embedEnd'); return r; }),
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

  if (chunkCandidates.length === 0 && pageCandidates.length === 0) {
    const corpusSize = await vectorStore.countPoints(documentIds);
    return emptyResult(corpusSize === 0 ? 'empty_corpus' : 'no_relevant_matches', t, {
      candidatesConsidered: 0,
    });
  }

  // 3. Merge visual page candidates by provenance — a scanned page retrieved by both the
  //    OCR-chunk branch and the ColPali branch must not occupy two reranker slots and two
  //    result rows carrying the same evidence (architecture §5.5, phase 4 §7.2).
  const merged = mergeByProvenance(chunkCandidates, pageCandidates);

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

  // 5. Apply the relevance floor. `rerankSkipped` means every score is null, and the
  //    filter passes everything through — degraded ranking must not also trigger a
  //    spurious empty state.
  const results = ranked.filter((r) => r.relevanceScore === null || r.relevanceScore >= RELEVANCE_FLOOR);

  if (results.length === 0) {
    return emptyResult('no_relevant_matches', t, {
      candidatesConsidered: merged.length,
      bestScore: ranked[0]?.relevanceScore ?? 0,
    });
  }

  return {
    results: results.map(toPublicResult),
    telemetry: t.report({
      rerankSkipped: skipped,
      candidatesRetrieved: merged.length,   // combined, post-merge — what actually went into rerank
      candidatesAfterFloor: results.length,
    }),
  };
}

// Root trace: wraps the whole pipeline as one named run so the three stage spans above
// nest as its children, mirroring the pipeline shape in the LangSmith trace tree.
export const search = traceable(runSearch, { name: 'search', run_type: 'chain', client: getTracingClient() });
