// Standalone verification script (this repo's test/ convention — see AGENTS.md, no
// unified test framework). Exercises phase 3 tasks 3.7/3.8: the relevance floor and the
// three-way empty-state distinction.
//
// REQUIRES `npm run test:corpus:setup` to have populated cerebro_chunks_test, and live
// Cohere credentials. Run via `npm run test:retrieval`.
import assert from 'assert';
import { search } from '../../src/retrieval/search.js';
import { RELEVANCE_FLOOR } from '../../src/retrieval/constants.js';
import { config } from '../../src/config/index.js';

// Opt-in pacing — see regression.test.js's PACE_MS for why this defaults to 0.
const PACE_MS = Number(process.env.RETRIEVAL_TEST_PACE_MS ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (config.qdrant.chunksCollection === 'cerebro_chunks') {
    throw new Error('QDRANT_CHUNKS_COLLECTION resolves to the live collection — run via `npm run test:retrieval`.');
  }

  // empty_query — whitespace-only input normalizes to the empty string (normalize()
  // trims and collapses whitespace but does not strip punctuation, so "..." is a real
  // — if useless — query; only whitespace normalizes away entirely).
  const q1 = await search('   \n\t  ');
  assert.strictEqual(q1.empty?.reason, 'empty_query', `expected empty_query, got ${JSON.stringify(q1)}`);
  console.log('[floor.test] PASS — whitespace-only query reports empty_query');

  // empty_corpus — a documentIds scope that matches no ingested document (task 3.8).
  if (PACE_MS) await sleep(PACE_MS);
  const q2 = await search('what is EMEA revenue', { documentIds: ['does-not-exist'] });
  assert.strictEqual(q2.empty?.reason, 'empty_corpus', `expected empty_corpus, got ${JSON.stringify(q2)}`);
  console.log('[floor.test] PASS — scope with no ingested documents reports empty_corpus, not no_relevant_matches');

  // no_relevant_matches — task 3.7's exact acceptance criterion, unchanged in form. Only
  // the floor's *value* moved (0.15 -> 5e-5, see
  // docs/bugs/BUG-002-relevance-floor-absolute-threshold.md); an off-corpus query is still
  // rejected with every candidate's score below it.
  if (PACE_MS) await sleep(PACE_MS);
  const q3 = await search('what is the airspeed velocity of a swallow');
  assert.strictEqual(q3.empty?.reason, 'no_relevant_matches', `expected no_relevant_matches, got ${JSON.stringify(q3)}`);
  assert.ok(
    q3.empty.bestScore < RELEVANCE_FLOOR,
    `bestScore ${q3.empty.bestScore} should be below the floor ${RELEVANCE_FLOOR}`,
  );
  assert.ok(q3.empty.candidatesConsidered > 0, 'candidatesConsidered proves retrieval actually ran');
  console.log(`[floor.test] PASS — off-corpus query rejected, bestScore ${q3.empty.bestScore} < floor ${RELEVANCE_FLOOR}, candidatesConsidered=${q3.empty.candidatesConsidered}`);

  // BUG-002 regression: the inverse case, which the old absolute floor got wrong. A
  // natural-language question that quotes nothing from the corpus must still be answered
  // when the corpus contains the answer. Northwind's Q3 review is in the fixture corpus.
  if (PACE_MS) await sleep(PACE_MS);
  const q4 = await search('how much money did the company make last quarter');
  assert.ok(
    !q4.empty && q4.results.length > 0,
    `expected results for an unquoted but answerable question, got ${JSON.stringify(q4.empty)}`,
  );
  console.log(`[floor.test] PASS — unquoted answerable question returns ${q4.results.length} result(s), top score ${q4.results[0].score}`);
}

await main();
console.log('[floor.test] ALL PASS');
