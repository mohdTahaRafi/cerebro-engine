// Standalone verification script (repo convention — see AGENTS.md, no unified test
// framework). Exercises phase 5 task 5.2's acceptance criterion at the unit level: the
// two conditional-edge predicates route correctly against a plain state object, and the
// compiled graph's node topology matches the two-branch shape §3 describes. This is the
// offline half of task 5.2 — it proves the *decision* is correct without needing live
// Mongo/Qdrant/LLM calls or a LangSmith project. Confirming the resulting LangSmith trace
// literally omits/includes the `condense` span for turn 1 vs turn 2 is an integration
// check against a running stack with LANGCHAIN_TRACING_V2=true, not exercised here.
import assert from 'assert';
import { ragGraph, routeAfterRerank } from '../../src/graph/ragGraph.js';

// ── Every turn condenses (amended 2026-10-15): loadHistory -> condense, unconditionally ─
// First turns used to skip condense; a vague first question ("who is the person?") then
// reached retrieval verbatim. condenseNode now decides internally whether an LLM call is
// needed, so the edge itself is unconditional.
const edgesFromHistory = (await ragGraph.getGraphAsync()).edges.filter((e) => e.source === 'loadHistory').map((e) => e.target);
assert.deepStrictEqual(
  edgesFromHistory, ['condense'],
  `loadHistory must have exactly one outgoing edge, to condense; got ${JSON.stringify(edgesFromHistory)}`,
);
console.log('[routing.test] PASS — every turn (first or follow-up) routes loadHistory -> condense');

// ── Rerank produced nothing -> noContext, generation model is never called ─────────
assert.strictEqual(
  routeAfterRerank({ sources: [] }), 'noContext',
  'zero sources after the relevance floor must route to noContext, never to generate',
);
console.log('[routing.test] PASS — empty sources route to noContext (generate is skipped)');

// ── Rerank produced sources -> generate ─────────────────────────────────────────────
assert.strictEqual(
  routeAfterRerank({ sources: [{ pointId: 'p1' }] }), 'generate',
  'at least one source after the relevance floor must route to generate',
);
console.log('[routing.test] PASS — non-empty sources route to generate');

// ── Graph topology: exactly the six real nodes plus the two framework boundary nodes ─
const drawable = await ragGraph.getGraphAsync();
const nodeNames = Object.keys(drawable.nodes).sort();
assert.deepStrictEqual(
  nodeNames,
  ['__end__', '__start__', 'condense', 'generate', 'loadHistory', 'noContext', 'rerank', 'retrieve'].sort(),
  'the compiled graph must expose exactly the six phase-5 nodes named in the spec',
);
console.log('[routing.test] PASS — compiled graph exposes exactly the six named nodes');

console.log('[routing.test] PASS — all assertions');
