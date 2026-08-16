// Standalone verification script (this repo's test/ convention — see AGENTS.md, no unified
// test framework). Pure-function test for mergeByProvenance (phase 4 task 4.16, §7.2) — no
// live services required.
import assert from 'assert';
import { mergeByProvenance } from '../../src/retrieval/merge.js';

function chunk(overrides) {
  return {
    pointId: 'chunk-default', sourceKind: 'text', documentId: 'doc-1', page: 1,
    text: 'default chunk text', ...overrides,
  };
}
function page(overrides) {
  return {
    pointId: 'page-default', sourceKind: 'page', documentId: 'doc-1', page: 1,
    ocrText: 'default page ocr text', ...overrides,
  };
}

function testAbsorbsMatchingOcrChunk() {
  const chunks = [chunk({ pointId: 'ocr-p7', sourceKind: 'ocr', page: 7 })];
  const pages = [page({ pointId: 'page-p7', page: 7 })];

  const merged = mergeByProvenance(chunks, pages);

  assert.strictEqual(merged.length, 1, 'the OCR chunk is absorbed, not returned separately');
  assert.strictEqual(merged[0].pointId, 'page-p7', 'the surviving entry is the page, not the chunk');
  assert.deepStrictEqual(merged[0].absorbedChunks, ['ocr-p7'], 'the page records which chunk it swallowed');
  console.log('[merge.test] PASS — a scanned page retrieved by both branches appears exactly once, with absorbedChunks populated');
}

function testTextChunksNeverAbsorbed() {
  const chunks = [
    chunk({ pointId: 'text-p1', sourceKind: 'text', page: 1 }),
    chunk({ pointId: 'text-p12', sourceKind: 'text', page: 12 }),
  ];
  const pages = [page({ pointId: 'page-p12', page: 12 })];   // same page number, different document content kind

  const merged = mergeByProvenance(chunks, pages);

  // architecture §5.5's edge case: a real text chunk from page 12 and a visual page 12 of
  // the SAME document do not merge — that combination means the page carries both enough
  // real text to route text AND enough visual weight to be indexed visually, which are
  // genuinely different evidence.
  const ids = merged.map((m) => m.pointId).sort();
  assert.deepStrictEqual(ids, ['page-p12', 'text-p1', 'text-p12'].sort(), 'sourceKind:"text" chunks are never absorbed, even on a page-number collision');
  console.log('[merge.test] PASS — sourceKind:"text" chunks are untouched, including on a same-page collision with a visual result');
}

function testUnmatchedOcrChunkSurvives() {
  // The OCR chunk's page (9) was never retrieved by the ColPali branch this query — no
  // page candidate exists to absorb it, so it must survive as an ordinary result.
  const chunks = [chunk({ pointId: 'ocr-p9', sourceKind: 'ocr', page: 9 })];
  const pages = [page({ pointId: 'page-p7', page: 7 })];

  const merged = mergeByProvenance(chunks, pages);

  assert.strictEqual(merged.length, 2, 'an OCR chunk with no matching page candidate is not dropped');
  assert.ok(merged.some((m) => m.pointId === 'ocr-p9'), 'the unmatched OCR chunk survives');
  console.log('[merge.test] PASS — an OCR chunk whose page was not retrieved by ColPali survives unmerged');
}

function testDocumentScopedKey() {
  // Same page number, different documents — must not cross-merge.
  const chunks = [chunk({ pointId: 'ocr-docA-p3', sourceKind: 'ocr', documentId: 'doc-A', page: 3 })];
  const pages = [page({ pointId: 'page-docB-p3', documentId: 'doc-B', page: 3 })];

  const merged = mergeByProvenance(chunks, pages);

  assert.strictEqual(merged.length, 2, 'a page-number match across different documents must not merge');
  console.log('[merge.test] PASS — the merge key is scoped by documentId, not page number alone');
}

function testEmptyPageCandidatesIsIdentity() {
  const chunks = [chunk({ pointId: 'text-1' }), chunk({ pointId: 'ocr-1', sourceKind: 'ocr', page: 5 })];
  const merged = mergeByProvenance(chunks, []);
  assert.deepStrictEqual(merged, chunks, 'with no page candidates, chunk candidates pass through unchanged');
  console.log('[merge.test] PASS — an empty page-candidate list changes nothing (matches the phase 3 stub contract)');
}

testAbsorbsMatchingOcrChunk();
testTextChunksNeverAbsorbed();
testUnmatchedOcrChunkSurvives();
testDocumentScopedKey();
testEmptyPageCandidatesIsIdentity();
console.log('[merge.test] ALL PASS');
