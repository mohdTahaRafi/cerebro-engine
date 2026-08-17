// retrieve — wraps the Phase 3/4 retrieval pipeline rather than reimplementing it (phase
// 5 §6). Its own node (separate from rerank) purely so the LangSmith trace shows
// retrieval and reranking as independent spans with independent latencies.
import { retrieveCandidates } from '../../retrieval/search.js';

export async function retrieveNode(state) {
  const query = state.condensedQuery ?? state.query;
  const t0 = performance.now();

  const { candidates, timings, candidatesRetrieved, candidatesAfterMerge } = await retrieveCandidates(query, {
    documentIds: state.scopeDocumentIds,
  });

  // Forwarded verbatim, including each stage's `*StartAt` absolute instant (phase 6 §2.2):
  // those are raw performance.now() values from this same process, so they stay directly
  // comparable against the request origin ask.js measured, and buildTelemetry converts them
  // to offsets there. retrieveCandidates' timer deliberately reports no `totalMs` of its
  // own — only the route that owns the whole request can measure that (see timer.js).
  return {
    candidates,
    timings: {
      ...timings,
      candidatesRetrieved,
      candidatesAfterMerge,
      retrieveTotalMs: Math.round(performance.now() - t0),
    },
  };
}
