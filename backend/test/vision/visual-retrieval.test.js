// Standalone verification script (this repo's test/ convention — see AGENTS.md, no unified
// test framework). End-to-end walk of phase 4's milestone (§9): ingest a fully scanned
// PDF with no text layer at all → it reaches 'ready' via the visual path → a query finds
// the right page ranked first → deleting the document purges both cerebro_pages and its
// stored images.
//
// REQUIRES the full stack up (`docker compose up -d`) AND the backend on :5000
// (`npm run dev`), with the vision container's ColPali weights already loaded — first
// boot downloads several GB and can take minutes; poll `GET :8100/health` for
// `modelLoaded: true` before running this. Uses live Cohere credits and writes/deletes
// real Mongo + Qdrant records, same as test/ingestion/lifecycle.test.js.
//
// Set TEST_VISION_OUTAGE=1 to additionally exercise task 4.13/4.18's degradation path.
// That leg runs `docker compose stop vision` / `start vision` against the shared stack —
// off by default so this script is safe to run alongside other work.
import assert from 'assert';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const BASE = process.env.TEST_BASE_URL ?? 'http://localhost:5000';
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const QDRANT = process.env.QDRANT_URL ?? 'http://localhost:6333';
const PAGES_COLLECTION = process.env.QDRANT_PAGES_COLLECTION ?? 'cerebro_pages';

async function pagesPointCount(documentId) {
  const res = await fetch(`${QDRANT}/collections/${PAGES_COLLECTION}/points/count`, {
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

async function waitForTerminal(documentId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await fetch(`${BASE}/api/documents/${documentId}`);
    last = await res.json();
    if (last.status === 'ready' || last.status === 'failed') return last;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`Document ${documentId} did not reach a terminal state within ${timeoutMs}ms (last: ${JSON.stringify(last)})`);
}

async function search(query, extra = {}) {
  const res = await fetch(`${BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, ...extra }),
  });
  assert.strictEqual(res.status, 200, `search must return 200, got ${res.status}`);
  return res.json();
}

async function deleteDocument(documentId) {
  const res = await fetch(`${BASE}/api/documents/${documentId}`, { method: 'DELETE' });
  return { status: res.status, body: await res.json() };
}

async function main() {
  // ── Ingest a fully scanned PDF — the file Phase 2 rejected outright ────────────────
  const up = await upload(path.join(FIXTURES, 'scanned-12pg.pdf'), 'invoice-batch-2024.pdf');
  assert.strictEqual(up.status, 202, `upload must return 202, got ${up.status}: ${JSON.stringify(up.body)}`);
  const documentId = up.body.documentId;

  const ready = await waitForTerminal(documentId);
  assert.strictEqual(ready.status, 'ready', `expected ready, got ${JSON.stringify(ready)}`);
  assert.strictEqual(ready.pageCount, 12);
  assert.strictEqual(ready.visualPageCount, 12, 'every page routed visual — no text layer at all');
  assert.strictEqual(ready.textPageCount, 0);
  assert.ok(ready.chunkCount > 0, `chunkCount must be positive (OCR text indexed as chunks), got ${ready.chunkCount}`);
  console.log(`[visual-retrieval.test] PASS — scanned-12pg.pdf reached ready: pageCount=12, visualPageCount=12, textPageCount=0, chunkCount=${ready.chunkCount}`);

  const pagePoints = await pagesPointCount(documentId);
  assert.strictEqual(pagePoints, 12, `cerebro_pages must hold 12 points, got ${pagePoints}`);
  console.log('[visual-retrieval.test] PASS — cerebro_pages holds 12 points');

  // ── Query finds the right scanned page, ranked first ───────────────────────────────
  const { results } = await search('what is the total on invoice 8871');
  assert.ok(results.length > 0, 'search must return at least one result');
  const top = results[0];
  assert.strictEqual(top.kind, 'page', `top result must be kind:"page", got ${top.kind}`);
  assert.strictEqual(top.documentId, documentId);
  assert.ok(top.imageUri, 'a page result carries an imageUri');
  console.log(`[visual-retrieval.test] PASS — top result is kind:"page", page ${top.page}, score ${top.score}, imageUri ${top.imageUri}`);

  // Results form one strictly-descending-score ordered list, whatever kinds appear in it.
  for (let i = 1; i < results.length; i++) {
    if (results[i - 1].score == null || results[i].score == null) continue;   // degraded rerank
    assert.ok(results[i - 1].score >= results[i].score, 'results must be strictly descending by score across kinds');
  }
  console.log('[visual-retrieval.test] PASS — results interleave kind:"page" and kind:"text" in one descending-score list');

  // The image is actually fetchable and is a real JPEG.
  const imgRes = await fetch(`${BASE}${top.imageUri}`);
  assert.strictEqual(imgRes.status, 200);
  assert.strictEqual(imgRes.headers.get('content-type'), 'image/jpeg');
  console.log('[visual-retrieval.test] PASS — imageUri serves a real image/jpeg');

  // ── Mixed document: routing is per-page, not per-document ──────────────────────────
  const upMixed = await upload(path.join(FIXTURES, 'mixed-40pg.pdf'), 'quarterly-report.pdf');
  assert.strictEqual(upMixed.status, 202);
  const mixedReady = await waitForTerminal(upMixed.body.documentId);
  assert.strictEqual(mixedReady.status, 'ready', `expected ready, got ${JSON.stringify(mixedReady)}`);
  assert.strictEqual(mixedReady.textPageCount, 37);
  assert.strictEqual(mixedReady.visualPageCount, 3);
  console.log('[visual-retrieval.test] PASS — mixed-40pg.pdf: textPageCount=37, visualPageCount=3 (per-page routing on one document)');

  // ── Vision-outage degradation (opt-in — manipulates the shared stack) ──────────────
  if (process.env.TEST_VISION_OUTAGE === '1') {
    console.log('[visual-retrieval.test] TEST_VISION_OUTAGE=1 — stopping the vision container');
    execSync('docker compose stop vision', { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'), stdio: 'inherit' });
    try {
      const degraded = await search('what is the total on invoice 8871');
      assert.ok(degraded.results.every((r) => r.kind === 'text'), 'with vision down, only text results are returned');
      console.log('[visual-retrieval.test] PASS — query search degrades to text-only with vision stopped, no error surfaced');

      const scanUp = await upload(path.join(FIXTURES, 'handwritten.pdf'), 'outage-test.pdf');
      const scanReady = await waitForTerminal(scanUp.body.documentId);
      assert.strictEqual(scanReady.status, 'ready', 'a scanned PDF still reaches ready during a vision outage');
      assert.ok(scanReady.warnings?.length > 0, 'the degraded document carries a populated warnings array');
      assert.strictEqual(await pagesPointCount(scanUp.body.documentId), 0, 'zero page points were written during the outage');
      console.log('[visual-retrieval.test] PASS — a scanned PDF ingested during a vision outage still reaches ready, with warnings and 0 page points');
      await deleteDocument(scanUp.body.documentId);
    } finally {
      console.log('[visual-retrieval.test] restarting the vision container');
      execSync('docker compose start vision', { cwd: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..'), stdio: 'inherit' });
    }
  } else {
    console.log('[visual-retrieval.test] SKIP — vision-outage leg (set TEST_VISION_OUTAGE=1 to run it)');
  }

  // ── Delete purges both pages and images ─────────────────────────────────────────────
  const del = await deleteDocument(documentId);
  assert.strictEqual(del.status, 200);
  assert.strictEqual(del.body.deleted, true);
  assert.strictEqual(await pagesPointCount(documentId), 0, 'cerebro_pages holds 0 points for the deleted document');

  const imgAfterDelete = await fetch(`${BASE}${top.imageUri}`);
  assert.strictEqual(imgAfterDelete.status, 404, 'the previously-working image URL now 404s');
  console.log('[visual-retrieval.test] PASS — delete purged cerebro_pages and the image route now 404s');

  await deleteDocument(upMixed.body.documentId);
}

// Every assertion below main() is about the ColPali branch specifically — points landing
// in cerebro_pages, a visual page outranking text, deletion purging that collection. With
// COLPALI_ENABLED=false (the default, see vision/app/colpali.py's enabled()) none of that
// exists by design: scanned pages are indexed as OCR chunks instead. Skipping is the
// honest outcome there — failing would report a defect where there is a configuration
// choice, and passing a gutted version would claim coverage this run did not have.
const visionHealth = await fetch(`${process.env.VISION_SERVICE_URL ?? 'http://localhost:8100'}/health`)
  .then((r) => r.json())
  .catch(() => null);

if (visionHealth && visionHealth.colpaliEnabled === false) {
  console.log(
    '[visual-retrieval.test] SKIP — COLPALI_ENABLED=false (OCR-only mode); '
    + 'this suite verifies the ColPali branch. Set COLPALI_ENABLED=true on a GPU host to run it.',
  );
  process.exit(0);
}

await main();
console.log('[visual-retrieval.test] ALL PASS');
