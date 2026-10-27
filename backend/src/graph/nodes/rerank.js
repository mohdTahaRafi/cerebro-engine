// rerank — cross-encoder ranking plus the relevance floor (phase 5 §6). Owns emptiness
// classification for the graph: a candidates.length === 0 case (retrieval found nothing)
// distinguishes "no documents at all" from "documents exist but none matched," the same
// distinction /api/search's emptyResult already makes — see retrieval/search.js §5.2.
import * as vectorStore from '../../providers/vectorStore.js';
import { rerankOrDegrade } from '../../providers/reranker.js';
import { toPublicResult } from '../../retrieval/search.js';
import { selectSources } from '../../retrieval/selectSources.js';

// Amended 2026-10-28 (BUG-004, docs/bugs/BUG-004-fixed-source-cap.md): there is no fixed
// source count any more. Phase 5 §6 set TOP_N_SOURCES = 8 from the generation context
// budget; measured on the live corpus, that cap dropped passages that cleared the
// relevance gate and let an overview question see 2 of 3 documents. Every candidate is
// now reranked (one Cohere call either way — the set stays <= 100, one search unit), and
// selectSources picks by relevance, per-document coverage and a character budget.

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

  const { ranked, skipped } = await rerankOrDegrade(query, state.candidates, state.candidates.length);
  // selectSources keeps BUG-002's accept/reject floor and retention step, adds per-document
  // coverage, and bounds the result by size instead of count.
  const filtered = selectSources(ranked);
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
