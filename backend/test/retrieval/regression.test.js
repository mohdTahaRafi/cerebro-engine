// Standalone verification script (this repo's test/ convention — see AGENTS.md, no
// unified test framework). Retrieval quality regression suite (phase 3 §9) — recall@3
// against the 8-query evaluation set, run against the isolated fixture corpus.
//
// REQUIRES `npm run test:corpus:setup` to have populated cerebro_chunks_test, and live
// Cohere embed/rerank credentials. Run via `npm run test:retrieval`, or directly with
// `QDRANT_CHUNKS_COLLECTION=cerebro_chunks_test node test/retrieval/regression.test.js`.
import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { search } from '../../src/retrieval/search.js';
import * as vectorStore from '../../src/providers/vectorStore.js';
import { config } from '../../src/config/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const QUERY_SET = JSON.parse(await fs.readFile(path.join(HERE, 'queries.json'), 'utf8'));

// Recall@3 is the metric, not exact rank. Requiring the expected chunk at rank 1 makes
// the suite brittle to harmless reranker drift between model versions; requiring it in
// the top 3 catches genuine regressions without false alarms (phase 3 §9.3).
const RECALL_AT_3_THRESHOLD = 0.85;   // 7 of 8 queries must pass

// Opt-in pacing between queries — 0 by default, matching architecture §6.1's production
// rate-limit assumptions (this suite fires 2 Cohere calls per query in a tight loop).
// Set only against a rate-limited trial key, e.g. `RETRIEVAL_TEST_PACE_MS=13000 npm run
// test:retrieval`; a paid key never needs this.
const PACE_MS = Number(process.env.RETRIEVAL_TEST_PACE_MS ?? 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Resolves a query-set entry's expected point id by scrolling the fixture collection for
// the payload whose text contains `matchText`, scoped to `documentId`. This avoids
// hardcoding UUIDs that would need regenerating every time a fixture's content changes —
// the point id is deterministic (uuidv5 of documentId:position) but that's an
// implementation detail of vectorStore.js, not something this suite should know about.
async function resolveExpectedPointId(testCase) {
  if (!testCase.documentId) return null;
  const { points } = await vectorStore.client().scroll(config.qdrant.chunksCollection, {
    filter: { must: [{ key: 'documentId', match: { value: testCase.documentId } }] },
    limit: 200,
    with_payload: true,
  });
  const hit = points.find((p) => p.payload.text.includes(testCase.matchText));
  assert.ok(
    hit,
    `fixture setup: no chunk in "${testCase.documentId}" contains "${testCase.matchText}" — run npm run test:corpus:setup`,
  );
  return String(hit.id);
}

async function main() {
  if (config.qdrant.chunksCollection === 'cerebro_chunks') {
    throw new Error('QDRANT_CHUNKS_COLLECTION resolves to the live collection — run via `npm run test:retrieval`.');
  }

  const rows = [];
  for (const testCase of QUERY_SET) {
    if (PACE_MS && rows.length > 0) await sleep(PACE_MS);
    const expectedPointId = await resolveExpectedPointId(testCase);
    const scope = testCase.scopeDocumentId ? [testCase.scopeDocumentId] : null;
    const { results } = await search(testCase.query, { documentIds: scope });
    const top3 = results.slice(0, 3).map((r) => r.pointId);
    const passed = testCase.expectEmpty ? results.length === 0 : top3.includes(expectedPointId);
    rows.push({ id: testCase.id, query: testCase.query, tests: testCase.tests, passed });
  }

  console.log('\n[retrieval.regression] per-query results:');
  console.log('  # | pass | query                                       | tests');
  console.log('  --|------|---------------------------------------------|---------------------------------------------');
  for (const r of rows) {
    console.log(`  ${String(r.id).padEnd(1)} | ${r.passed ? ' OK ' : 'FAIL'} | ${r.query.padEnd(43)} | ${r.tests}`);
  }

  const passRate = rows.filter((r) => r.passed).length / rows.length;
  console.log(`\n[retrieval.regression] recall@3 = ${(passRate * 100).toFixed(1)}% (${rows.filter((r) => r.passed).length}/${rows.length}, threshold ${(RECALL_AT_3_THRESHOLD * 100).toFixed(0)}%)`);
  assert.ok(passRate >= RECALL_AT_3_THRESHOLD, `recall@3 ${passRate} is below the ${RECALL_AT_3_THRESHOLD} threshold`);
  console.log('[retrieval.regression] PASS');
}

await main();
