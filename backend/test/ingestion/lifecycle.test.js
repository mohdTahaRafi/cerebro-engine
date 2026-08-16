// Standalone verification script (this repo's test/ convention — see AGENTS.md, no unified
// test framework). End-to-end lifecycle for phase 2 tasks 2.3, 2.4, 2.14, 2.15, 2.17:
// upload → ready → re-ingest is idempotent → delete leaves zero points.
//
// REQUIRES a running stack (docker compose up) AND the backend on :5000 (npm run dev).
// Uses the live Cohere + LlamaParse APIs, and writes/deletes real Mongo + Qdrant records.
import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:5000';
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const QDRANT = process.env.QDRANT_URL ?? 'http://localhost:6333';
const COLLECTION = process.env.QDRANT_CHUNKS_COLLECTION ?? 'cerebro_chunks';

async function pointCount(documentId) {
  const res = await fetch(`${QDRANT}/collections/${COLLECTION}/points/count`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
      exact: true,
    }),
  });
  const body = await res.json();
  return body.result.count;
}

async function upload(filePath, fileName) {
  const form = new FormData();
  form.append('document', new Blob([await fs.readFile(filePath)]), fileName);
  const res = await fetch(`${BASE}/api/documents`, { method: 'POST', body: form });
  return { status: res.status, body: await res.json() };
}

async function waitForTerminal(documentId, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/documents/${documentId}/status`);
    last = await res.json();
    if (last.status === 'ready' || last.status === 'failed') return last;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Document ${documentId} did not reach a terminal state within ${timeoutMs}ms (last: ${JSON.stringify(last)})`);
}

// A unique body per run, so each run is a genuinely new document rather than a duplicate
// of the previous run's leftovers.
const unique = `lifecycle test run ${Date.now()}-${Math.random().toString(36).slice(2)}\n`;
const tmpPath = path.join(FIXTURES, '.lifecycle-tmp.md');

async function main() {
  await fs.writeFile(tmpPath, [
    '# Lifecycle Fixture', '',
    unique, '',
    '## Results', '',
    '| Region | Revenue |', '|---|---|', '| EMEA | 4.2M |', '',
  ].join('\n'));

  // ── Upload ────────────────────────────────────────────────────────────────
  const started = Date.now();
  const up = await upload(tmpPath, 'lifecycle.md');
  const elapsed = Date.now() - started;
  assert.strictEqual(up.status, 202, `upload must return 202, got ${up.status}: ${JSON.stringify(up.body)}`);
  assert.ok(up.body.documentId, 'response carries a documentId');
  assert.strictEqual(up.body.status, 'queued');
  assert.ok(elapsed < 500, `upload must respond in <500ms (hash+rename only), took ${elapsed}ms`);
  const documentId = up.body.documentId;
  console.log(`[lifecycle.test] PASS — upload 202 in ${elapsed}ms, documentId ${documentId}`);

  // ── Ingest to ready ───────────────────────────────────────────────────────
  const ready = await waitForTerminal(documentId);
  assert.strictEqual(ready.status, 'ready', `expected ready, got ${JSON.stringify(ready)}`);
  assert.strictEqual(ready.progress, 100);
  assert.ok(ready.chunkCount > 0, 'a ready document reports a positive chunkCount');
  const chunkCount = ready.chunkCount;
  console.log(`[lifecycle.test] PASS — reached ready with ${chunkCount} chunk(s)`);

  // ── Points actually landed, with both vectors ─────────────────────────────
  const count = await pointCount(documentId);
  assert.strictEqual(count, chunkCount, 'Qdrant point count matches the reported chunkCount');

  const scrollRes = await fetch(`${QDRANT}/collections/${COLLECTION}/points/scroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
      limit: 100, with_payload: true, with_vector: true,
    }),
  });
  const points = (await scrollRes.json()).result.points;
  for (const p of points) {
    assert.strictEqual(p.vector.dense.length, 1024, 'every dense vector is 1024-d');
    assert.ok(p.vector.sparse.indices.length > 0, 'every sparse vector is non-empty');
    assert.strictEqual(
      p.vector.sparse.indices.length, p.vector.sparse.values.length,
      'sparse indices and values are the same length',
    );
    assert.ok(p.payload.tokenCount <= 480, `payload tokenCount within budget, got ${p.payload.tokenCount}`);
    assert.strictEqual(p.payload.documentId, documentId);
    assert.strictEqual(p.payload.sourceKind, 'text');
  }
  console.log(`[lifecycle.test] PASS — ${points.length} point(s) carry 1024-d dense + non-empty sparse vectors`);

  // ── Duplicate upload is rejected without adding points ────────────────────
  const dup = await upload(tmpPath, 'lifecycle.md');
  assert.strictEqual(dup.status, 200, 'a duplicate upload returns 200, not 202');
  assert.strictEqual(dup.body.status, 'duplicate');
  assert.strictEqual(String(dup.body.duplicateOf), String(documentId), 'duplicate points at the original');
  assert.strictEqual(await pointCount(documentId), chunkCount, 'a duplicate adds no points');
  console.log('[lifecycle.test] PASS — duplicate detected, point count unchanged');

  // ── Re-ingest is idempotent (deterministic point ids) ─────────────────────
  const re = await fetch(`${BASE}/api/documents/${documentId}/reingest`, { method: 'POST' });
  assert.strictEqual(re.status, 202, 're-ingest returns 202');
  await waitForTerminal(documentId);
  assert.strictEqual(
    await pointCount(documentId), chunkCount,
    're-ingesting an unchanged document must overwrite, not duplicate, its points',
  );
  console.log('[lifecycle.test] PASS — re-ingest left the point count identical');

  // ── Delete removes every point ────────────────────────────────────────────
  const delRes = await fetch(`${BASE}/api/documents/${documentId}`, { method: 'DELETE' });
  const delBody = await delRes.json();
  assert.strictEqual(delRes.status, 200);
  assert.strictEqual(delBody.deleted, true);
  assert.ok(delBody.deletedPoints > 0, `delete reports deletedPoints > 0, got ${delBody.deletedPoints}`);
  assert.strictEqual(await pointCount(documentId), 0, 'zero points survive the delete');

  const gone = await fetch(`${BASE}/api/documents/${documentId}`);
  assert.strictEqual(gone.status, 404, 'the document is gone from the registry');
  console.log(`[lifecycle.test] PASS — delete removed ${delBody.deletedPoints} point(s), registry row gone`);

  // The duplicate row must have been re-marked rather than left dangling.
  const dupAfter = await (await fetch(`${BASE}/api/documents/${dup.body.documentId}`)).json();
  assert.strictEqual(dupAfter.duplicateOf, null, 'the dangling duplicateOf reference was cleared');
  assert.strictEqual(dupAfter.status, 'failed');
  console.log('[lifecycle.test] PASS — orphaned duplicate row re-marked, not left dangling');

  // Clean up the duplicate row this test created.
  await fetch(`${BASE}/api/documents/${dup.body.documentId}`, { method: 'DELETE' });
}

try {
  await main();
  console.log('[lifecycle.test] ALL PASS');
} finally {
  await fs.unlink(tmpPath).catch(() => {});
}
