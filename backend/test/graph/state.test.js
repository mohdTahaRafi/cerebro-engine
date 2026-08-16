// Standalone verification script (repo convention — see AGENTS.md, no unified test
// framework). Exercises phase 5 task 5.1's acceptance criterion: two nodes each
// returning a `timings` key must merge into one object holding both keys, not just the
// last node's. Pure reducer logic — no Mongo/Qdrant/LLM required.
//
// RagState.spec[name] is a live LangGraph channel instance (Annotation() resolves
// {reducer, default} straight into a BinaryOperatorAggregate — see
// @langchain/langgraph/dist/graph/annotation.js), not a plain {reducer, default}
// object. `.fromCheckpoint(undefined)` gives each assertion its own fresh instance
// (same operator + default factory, empty value) so tests don't share mutable state
// through the module-level RagState singleton.
import assert from 'assert';
import { RagState } from '../../src/graph/state.js';

function freshChannel(name) {
  return RagState.spec[name].fromCheckpoint(undefined);
}

// ── timings: accumulate, don't clobber ──────────────────────────────────────────────
const timings = freshChannel('timings');
timings.update([{ condenseMs: 120 }]);
assert.deepStrictEqual(timings.get(), { condenseMs: 120 }, 'first node seeds the object');

timings.update([{ retrieveMs: 340 }]);
assert.deepStrictEqual(
  timings.get(), { condenseMs: 120, retrieveMs: 340 },
  'a second node\'s timings key must merge in, not replace the object — this is the exact ' +
  'telemetry bug (last node\'s numbers only) the reducer exists to prevent',
);

timings.update([{ retrieveMs: 300 }]);
assert.deepStrictEqual(
  timings.get(), { condenseMs: 120, retrieveMs: 300 },
  'a repeated key must update in place; sibling keys must survive',
);
console.log('[state.test] PASS — timings accumulate across nodes: %o', timings.get());

// ── warnings: append, don't replace ─────────────────────────────────────────────────
const warnings = freshChannel('warnings');
warnings.update([['condense unavailable']]);
warnings.update([['reranking degraded']]);
assert.deepStrictEqual(
  warnings.get(), ['condense unavailable', 'reranking degraded'],
  'warnings must append across nodes, not replace the array',
);
console.log('[state.test] PASS — warnings append across nodes: %o', warnings.get());

// ── last-write-wins channels ────────────────────────────────────────────────────────
for (const name of ['query', 'threadId', 'condensedQuery', 'candidates', 'sources', 'answer', 'emptyReason']) {
  const ch = freshChannel(name);
  ch.update(['old']);
  ch.update(['new']);
  assert.strictEqual(ch.get(), 'new', `${name} must be last-write-wins`);
}
console.log('[state.test] PASS — last-write-wins channels replace rather than merge');

// ── defaults ─────────────────────────────────────────────────────────────────────────
const defaults = {
  history: [], candidates: [], sources: [], answer: '', timings: {}, warnings: [],
  condensedQuery: null, scopeDocumentIds: null, emptyReason: null,
};
for (const [name, expected] of Object.entries(defaults)) {
  assert.deepStrictEqual(freshChannel(name).get(), expected, `${name} must default to ${JSON.stringify(expected)}`);
}
console.log('[state.test] PASS — every derived/accumulated/control channel has the documented default');

console.log('[state.test] PASS — all assertions');
