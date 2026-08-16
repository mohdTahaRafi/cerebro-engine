// retrieve — wraps the Phase 3/4 retrieval pipeline rather than reimplementing it (phase
// 5 §6). Its own node (separate from rerank) purely so the LangSmith trace shows
// retrieval and reranking as independent spans with independent latencies.
import { retrieveCandidates } from '../../retrieval/search.js';

export async function retrieveNode(state) {
  const query = state.condensedQuery ?? state.query;
  const t0 = performance.now();

  const { candidates, timings } = await retrieveCandidates(query, {
    documentIds: state.scopeDocumentIds,
  });

  return { candidates, timings: { ...timings, retrieveTotalMs: Math.round(performance.now() - t0) } };
}
