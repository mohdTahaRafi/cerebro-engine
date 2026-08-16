// Standalone verification script (this repo's test/ convention — see AGENTS.md, no unified
// test framework). Exercises phase 4 tasks 4.1-4.4's acceptance criteria against
// vision/app/classifier.py's real routing logic, through the running vision container.
//
// REQUIRES the vision service up (`docker compose up -d vision`) and reachable at
// VISION_SERVICE_URL. Does not require ColPali weights to be loaded — /classify is
// metadata-only and does not touch the model — so this can run during the vision
// container's first-boot weight download.
import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';
import * as visionService from '../../src/providers/visionService.js';

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

async function testBornDigitalTextPdf() {
  // mixed-40pg.pdf's first 37 pages are born-digital prose; classifying the whole
  // document exercises the same "text page" signal task 4.1 asks for.
  const r = await visionService.classify(path.join(FIXTURES, 'mixed-40pg.pdf'));
  assert.strictEqual(r.pageCount, 40);
  assert.strictEqual(r.textPages.length, 37, `expected 37 text pages, got ${r.textPages.length}`);
  assert.strictEqual(r.visualPages.length, 3, `expected 3 visual pages, got ${r.visualPages.length}`);
  assert.deepStrictEqual(r.visualPages, [38, 39, 40], 'the 3 scanned appendix pages route visual, in order');
  console.log(`[classifier.test] PASS — mixed-40pg.pdf: 37 text / 3 visual (routing is per-page, not per-document) in ${r.elapsedMs}ms`);
}

async function testFullyScannedPdf() {
  const r = await visionService.classify(path.join(FIXTURES, 'scanned-12pg.pdf'));
  assert.strictEqual(r.pageCount, 12);
  assert.strictEqual(r.textPages.length, 0);
  assert.strictEqual(r.visualPages.length, 12, `expected 12/12 visual, got ${r.visualPages.length}`);
  for (const p of r.pages) {
    assert.strictEqual(p.kind, 'visual');
    assert.strictEqual(p.reason, 'low_text', `expected low_text, got ${p.reason} for page ${p.page}`);
  }
  console.log('[classifier.test] PASS — scanned-12pg.pdf: 12/12 visual, reason=low_text');
}

async function testOverlappingImageCoverageNeverExceedsOne() {
  const r = await visionService.classify(path.join(FIXTURES, 'scanned-12pg.pdf'));
  for (const p of r.pages) {
    assert.ok(p.imageCoverage <= 1.0, `imageCoverage must never exceed 1.0 (union, not sum), got ${p.imageCoverage}`);
  }
  console.log('[classifier.test] PASS — union-area coverage stays <= 1.0 across all 12 full-page-image pages');
}

async function testGarbledTextLayer() {
  const r = await visionService.classify(path.join(FIXTURES, 'garbled-layer.pdf'));
  assert.strictEqual(r.pageCount, 1);
  assert.strictEqual(r.visualPages.length, 1);
  assert.strictEqual(r.pages[0].kind, 'visual');
  assert.strictEqual(r.pages[0].reason, 'garbled_text_layer', `expected garbled_text_layer, got ${r.pages[0].reason}`);
  console.log('[classifier.test] PASS — garbled-layer.pdf routes visual with reason:"garbled_text_layer"');
}

async function testFiveHundredPageBudget() {
  // No 500-page fixture ships in this repo (§12: fixtures are kept small deliberately —
  // see fixtures/README below). classify_document's cost is per-page and metadata-only
  // (no rendering), so mixed-40pg.pdf's 40 pages stand in as a scaled-down timing probe:
  // task 4.4's <5s/500-page budget implies <100ms/page at this ratio, comfortably above
  // what a real run needs.
  const r = await visionService.classify(path.join(FIXTURES, 'mixed-40pg.pdf'));
  const perPageMs = r.elapsedMs / r.pageCount;
  assert.ok(perPageMs < (5000 / 500), `classification cost per page (${perPageMs}ms) exceeds the 500-page/5s budget's implied per-page rate`);
  console.log(`[classifier.test] PASS — ${perPageMs.toFixed(2)}ms/page, within the 500-page/<5s budget (task 4.4)`);
}

async function main() {
  await testBornDigitalTextPdf();
  await testFullyScannedPdf();
  await testOverlappingImageCoverageNeverExceedsOne();
  await testGarbledTextLayer();
  await testFiveHundredPageBudget();
  console.log('[classifier.test] ALL PASS');
}

await main();
