// Standalone verification script (repo convention — see AGENTS.md, no unified test
// framework). Exercises phase 5 task 5.5's acceptance criteria for condenseNode:
// pronoun resolution, the topic-switch edge case (§5.1), the guardrail, and the
// failure-fallback path. Needs a live, correctly configured LLM_PROVIDER — same
// live-credentials convention as `npm run test:retrieval` — and spends real generation
// tokens on the first two assertions. Run with:
//
//   node test/graph/condense.test.js
import assert from 'assert';
import { condenseNode } from '../../src/graph/nodes/condense.js';
import { config } from '../../src/config/index.js';

const REVENUE_HISTORY = [
  { role: 'user', content: 'what was EMEA revenue in Q3?' },
  { role: 'assistant', content: 'EMEA revenue in Q3 2024 was 4.2M [1], up from 3.8M in Q2 [1].' },
];

// ── 1. Pronoun resolution ────────────────────────────────────────────────────────────
const followUp = { query: 'and how does that compare to APAC?', history: REVENUE_HISTORY };
const resolved = await condenseNode(followUp, {});
assert.ok(/APAC/i.test(resolved.condensedQuery), `condensed query must still name APAC, got: "${resolved.condensedQuery}"`);
assert.ok(
  /EMEA|4\.2/i.test(resolved.condensedQuery),
  `condensed query must carry the prior EMEA figure/topic forward, not just repeat "that", got: "${resolved.condensedQuery}"`,
);
assert.strictEqual(resolved.warnings.length, 0, 'a successful condensation must not warn');
console.log('[condense.test] PASS — pronoun resolved:', resolved.condensedQuery);

// ── 2. Topic switch (§5.1): an unrelated follow-up stays standalone ────────────────
const topicSwitch = { query: 'what is our parental leave policy?', history: REVENUE_HISTORY };
const switched = await condenseNode(topicSwitch, {});
assert.ok(
  !/revenue|EMEA|APAC/i.test(switched.condensedQuery),
  `an abrupt topic change must not drag the prior topic into the rewrite, got: "${switched.condensedQuery}"`,
);
console.log('[condense.test] PASS — topic switch stayed standalone:', switched.condensedQuery);

// ── 3. Vague reference + one listed document (amended 2026-10-15) ──────────────────
// The live failure this case pins: "who is the person?" in a context holding a single
// proposal came back from condense verbatim, so retrieval searched the raw words and never
// reached the title page carrying the author's name. It must now name the document — on a
// first turn (no history at all), which used to skip condense entirely, and as a follow-up
// whose history no longer mentions the file.
const ONE_DOC = ['New_Users_Anti_Spammer_System_meet_jain.pdf'];
const NAMES_THE_DOC = /anti[\s_-]*spam/i;
for (const [label, history] of [
  ['first turn', []],
  ['follow-up', [
    { role: 'user', content: 'it is about whom?' },
    { role: 'assistant', content: 'The sources do not identify a specific person.' },
  ]],
]) {
  const vague = await condenseNode({ query: 'who is the person?', history, documentNames: ONE_DOC }, {});
  assert.ok(
    NAMES_THE_DOC.test(vague.condensedQuery),
    `${label}: a vague reference in a one-document context must name that document, got: "${vague.condensedQuery}"`,
  );
  assert.strictEqual(vague.warnings.length, 0, `${label}: a successful condensation must not warn`);
  console.log(`[condense.test] PASS — vague ${label} resolved to the document:`, vague.condensedQuery);
}

// ── 4. Nothing to resolve against: no history, no documents -> no LLM call ─────────
const bare = await condenseNode({ query: 'who is the person?', history: [], documentNames: [] }, {});
assert.strictEqual(bare.condensedQuery, 'who is the person?', 'with no history and no documents the query passes through');
assert.strictEqual(bare.timings, undefined, 'no LLM call is made, so no condense timing is reported (the stage shows as skipped)');
console.log('[condense.test] PASS — no history and no documents: passed through without an LLM call');

// ── 5. Failure fallback: an invalid key must not fail the request ──────────────────
if (config.llm.provider === 'anthropic') {
  const savedKey = config.llm.anthropic.apiKey;
  config.llm.anthropic.apiKey = 'sk-ant-invalid-test-key';
  try {
    const failed = await condenseNode(followUp, {});
    assert.strictEqual(
      failed.condensedQuery, followUp.query,
      'a failed condense call must fall back to the raw query, not throw or return empty',
    );
    assert.strictEqual(failed.warnings.length, 1, 'a failed condense call must emit exactly one warning');
    assert.ok(/unavailable/i.test(failed.warnings[0]), 'the warning must say condensation was unavailable');
    console.log('[condense.test] PASS — invalid key falls back to the raw query with a warning:', failed.warnings[0]);
  } finally {
    config.llm.anthropic.apiKey = savedKey;
  }
} else {
  console.log('[condense.test] SKIP — failure-fallback case is written for LLM_PROVIDER=anthropic (invalid API key); '
    + 'LLM_PROVIDER=ollama has no key to invalidate the same way.');
}

console.log('[condense.test] PASS — all assertions');
