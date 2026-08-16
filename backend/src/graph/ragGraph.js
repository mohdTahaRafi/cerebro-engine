// The conversational RAG graph (phase 5 §3). Two genuine branch points — skip
// condensation on a first turn, skip generation when nothing clears the relevance floor
// — expressed as named nodes rather than inline `if`s so both are visible in the
// LangSmith trace shape, not just in logs.
import { StateGraph, START, END } from '@langchain/langgraph';
import { RagState } from './state.js';
import { loadHistoryNode } from './nodes/loadHistory.js';
import { condenseNode } from './nodes/condense.js';
import { retrieveNode } from './nodes/retrieve.js';
import { rerankNode } from './nodes/rerank.js';
import { generateNode } from './nodes/generate.js';
import { noContextNode } from './nodes/noContext.js';

// Exported (not just inline lambdas) so backend/test/graph/routing.test.js can assert
// the branch decision directly against a plain state object, without running the full
// graph (and its live Mongo/Qdrant/LLM calls) just to prove a routing predicate.
export const routeAfterHistory = (s) => (s.history.length === 0 ? 'retrieve' : 'condense');
export const routeAfterRerank  = (s) => (s.sources.length === 0 ? 'noContext' : 'generate');

const graph = new StateGraph(RagState)
  .addNode('loadHistory', loadHistoryNode)
  .addNode('condense',    condenseNode)
  .addNode('retrieve',    retrieveNode)
  .addNode('rerank',      rerankNode)
  .addNode('generate',    generateNode)
  .addNode('noContext',   noContextNode)

  .addEdge(START, 'loadHistory')

  // Skip the condensation LLM call entirely on the first turn (architecture §5.6).
  .addConditionalEdges('loadHistory', routeAfterHistory, {
    condense: 'condense', retrieve: 'retrieve',
  })
  .addEdge('condense', 'retrieve')
  .addEdge('retrieve', 'rerank')

  // Nothing cleared the floor → never call the generation model at all.
  .addConditionalEdges('rerank', routeAfterRerank, {
    noContext: 'noContext', generate: 'generate',
  })
  .addEdge('generate',  END)
  .addEdge('noContext', END);

export const ragGraph = graph.compile();

// ── Why a graph rather than a function chain (phase 5 §3.1) ─────────────────────────
// The two conditional edges are the justification. Both are genuine branch points where
// a node is *skipped entirely*, not merely short-circuited inside — and both matter for
// cost: the condense branch avoids an LLM call on every first turn, and the noContext
// branch avoids the far more expensive generation call whenever the corpus has no
// answer. Expressing these as `if` statements inside one async function would work, but
// LangGraph makes each branch a named node in the LangSmith trace, so "why was this
// answer produced without retrieval context" is answerable by looking at the trace shape
// rather than by reading logs.
