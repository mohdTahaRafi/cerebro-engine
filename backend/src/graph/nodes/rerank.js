// rerank — cross-encoder ranking plus the relevance floor (phase 5 §6). Owns emptiness
// classification for the graph: a candidates.length === 0 case (retrieval found nothing)
// distinguishes "no documents at all" from "documents exist but none matched," the same
// distinction /api/search's emptyResult already makes — see retrieval/search.js §5.2.
import * as vectorStore from '../../providers/vectorStore.js';
import { rerankOrDegrade } from '../../providers/reranker.js';
import { toPublicResult, applyRelevanceGate } from '../../retrieval/search.js';

// Set by the generation context budget, not retrieval quality (phase 5 §6). Eight chunks
// at ~480 tokens each is ~3,800 tokens of context; with up to 3 page images attached
// (~1,600 tokens each for Claude's vision encoder) the worst case is ~8,600 tokens —
// comfortable for a 200k-token model while keeping the model's attention concentrated.
// More sources measurably dilute answer quality before they add coverage.
export const TOP_N_SOURCES = 8;

export async function rerankNode(state) {
  const query = state.condensedQuery ?? state.query;
  const t0 = performance.now();

  if (state.candidates.length === 0) {
    const corpusEmpty = (await vectorStore.countPoints(state.tenant)) === 0;
    return {
      sources: [],
      allCandidates: [],
      emptyReason: corpusEmpty ? 'empty_corpus' : 'no_relevant_matches',
      timings: { candidatesAfterFloor: 0, rerankSkipped: false },
    };
  }

  const { ranked, skipped } = await rerankOrDegrade(query, state.candidates, TOP_N_SOURCES);
  // BUG-002's two-step gate (retrieval/search.js's applyRelevanceGate), reused here so the
  // live /api/ask path applies the same accept/reject-then-retain logic /api/search does —
  // a bare `relevanceScore >= RELEVANCE_FLOOR` filter would admit nearly everything now
  // that RELEVANCE_FLOOR is 5e-5, not the old 0.15.
  const { results: filtered } = applyRelevanceGate(ranked);
  // toPublicResult (retrieval/search.js) is the same projection /api/search returns —
  // the generation prompt (generate.js's buildUserMessage) and /api/ask's `sources` SSE
  // event both read this shape (kind, text, imageUri, branch, fusionRank, finalRank, ...),
  // never the raw candidate. finalRank is stamped here (phase 6 §2.3) from the post-rerank,
  // post-floor position — the same "how far reranking moved each candidate" signal
  // /api/search reports.
  const sources = filtered.map((r, i) => toPublicResult({ ...r, finalRank: i + 1 }));

  // Phase 7 §2.2, task 7.3: the FULL pre-floor candidate set, kept on state and normalized
  // to Trace.js's CandidateSchema shape (kind/text, not search.js's internal
  // sourceKind/ocrText split) — a trace-only projection, independent of `sources` above.
  // `survivorRank` reuses the exact 1-based position `sources` was just assigned, so a
  // candidate's finalRank here is identical to its finalRank in the live SSE `sources`
  // frame, not a second, possibly-drifting computation of the same thing.
  const survivorRank = new Map(filtered.map((r, i) => [r.pointId, i + 1]));
  const allCandidates = ranked.map((r) => ({
    pointId: r.pointId,
    kind: r.sourceKind === 'page' ? 'page' : 'text',
    documentId: r.documentId,
    fileName: r.fileName,
    page: r.page ?? null,
    headingPath: r.headingPath ?? null,
    text: r.sourceKind === 'page' ? r.ocrText : r.text,
    branch: r.sourceKind === 'page' ? 'colpali' : (r.branch ?? null),
    fusionRank: r.fusionRank ?? null,
    finalRank: survivorRank.get(r.pointId) ?? null,
    score: r.relevanceScore,
    belowFloor: !survivorRank.has(r.pointId),
    absorbedChunks: r.absorbedChunks ?? undefined,
  }));

  return {
    sources,
    allCandidates,
    emptyReason: sources.length === 0 ? 'no_relevant_matches' : null,
    timings: {
      rerankMs: Math.round(performance.now() - t0),
      rerankStartAt: t0,                      // phase 6 §2.2 — see pipelineTelemetry.js
      candidatesAfterFloor: sources.length,
      rerankSkipped: skipped,
    },
    warnings: skipped ? ['Reranking was unavailable; results are in fusion order.'] : [],
  };
}
