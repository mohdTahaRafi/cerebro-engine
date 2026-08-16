// Standalone verification script (this repo's test/ convention — see AGENTS.md, no
// unified test framework). Exercises phase 3 task 3.4: a documentIds filter applied
// inside both prefetch branches must isolate results across repeated trials.
//
// REQUIRES `npm run test:corpus:setup` to have populated cerebro_chunks_test, and live
// Cohere credentials. Run via `npm run test:retrieval`.
import assert from 'assert';
import { search } from '../../src/retrieval/search.js';
import { config } from '../../src/config/index.js';

// 20 broad queries, deliberately chosen to be plausible for MORE than one fixture
// document (revenue/price/identifiers/headers all appear in more than one fixture) — the
// queries most likely to surface cross-document leakage if scoping were broken.
const QUERIES = [
  'revenue', 'authentication', 'invoice', 'SKU', 'price', 'API', 'quarter', 'stock',
  'customer', 'header', 'webhook', 'region', 'segment', 'product', 'rate limit',
  'error', 'key', 'partner', 'signature', 'warehouse',
];
const SCOPE = 'fixture-spec';

// Opt-in pacing — see regression.test.js's PACE_MS for why this defaults to 0.
const PACE_MS = Number(process.env.RETRIEVAL_TEST_PACE_MS ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (config.qdrant.chunksCollection === 'cerebro_chunks') {
    throw new Error('QDRANT_CHUNKS_COLLECTION resolves to the live collection — run via `npm run test:retrieval`.');
  }
  assert.strictEqual(QUERIES.length, 20, "task 3.4's acceptance criterion is exactly 20 trials");

  let leaked = 0;
  for (const [i, query] of QUERIES.entries()) {
    if (PACE_MS && i > 0) await sleep(PACE_MS);
    const { results } = await search(query, { documentIds: [SCOPE] });
    const outOfScope = results.filter((r) => r.documentId !== SCOPE);
    leaked += outOfScope.length;
  }

  assert.strictEqual(leaked, 0, `${leaked} out-of-scope hit(s) leaked across ${QUERIES.length} scoped searches`);
  console.log(`[scoping.test] PASS — 0 out-of-scope hits across ${QUERIES.length} scoped searches`);
}

await main();
