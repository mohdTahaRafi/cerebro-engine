// rerank — cross-encoder ranking plus the relevance floor (phase 5 §6). Owns emptiness
// classification for the graph: a candidates.length === 0 case (retrieval found nothing)
// distinguishes "no documents at all" from "documents exist but none matched," the same
// distinction /api/search's emptyResult already makes — see retrieval/search.js §5.2.
import * as vectorStore from '../../providers/vectorStore.js';
import { rerankOrDegrade } from '../../providers/reranker.js';
import { toPublicResult } from '../../retrieval/search.js';
import { RELEVANCE_FLOOR } from '../../retrieval/constants.js';

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
    const corpusEmpty = (await vectorStore.countPoints()) === 0;
    return { sources: [], emptyReason: corpusEmpty ? 'empty_corpus' : 'no_relevant_matches' };
  }

  const { ranked, skipped } = await rerankOrDegrade(query, state.candidates, TOP_N_SOURCES);
  const filtered = ranked.filter((r) => r.relevanceScore === null || r.relevanceScore >= RELEVANCE_FLOOR);
  // toPublicResult (retrieval/search.js) is the same projection /api/search returns —
  // the generation prompt (generate.js's buildUserMessage) and /api/ask's `sources` SSE
  // event both read this shape (kind, text, imageUri, ...), never the raw candidate.
  const sources = filtered.map(toPublicResult);

  return {
    sources,
    emptyReason: sources.length === 0 ? 'no_relevant_matches' : null,
    timings: { rerankMs: Math.round(performance.now() - t0) },
    warnings: skipped ? ['Reranking was unavailable; results are in fusion order.'] : [],
  };
}
