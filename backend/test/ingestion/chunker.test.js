// Standalone verification script (this repo's test/ convention — see AGENTS.md, no unified
// test framework). Exercises phase 2 tasks 2.10 and 2.11's acceptance criteria for
// chunker.js. Pure-function tests — no live backend or external API required.
import assert from 'assert';
import { chunkPages, tokenLength, CHUNK_TOKENS } from '../../src/ingestion/chunker.js';

async function testTokenBudget() {
  // A long markdown document with several sections, at least one deliberately oversized.
  const longSection = 'The quick brown fox jumps over the lazy dog. '.repeat(80);   // ~800 tokens
  const md = [
    '# Report',
    '',
    '## Small Section',
    'This section is short.',
    '',
    '## Large Section',
    longSection,
  ].join('\n');

  const chunks = await chunkPages(
    [{ text: md, metadata: { page: 1 } }],
    { documentId: 'doc-1', fileName: 'report.md', mimeType: 'text/markdown', contentHash: 'h1' },
  );

  assert.ok(chunks.length >= 2, 'a document with an oversized section must split into 2+ chunks');
  for (const c of chunks) {
    assert.ok(c.tokenCount <= CHUNK_TOKENS, `chunk exceeds ${CHUNK_TOKENS} tokens: ${c.tokenCount}`);
    assert.strictEqual(c.tokenCount, tokenLength(c.text), 'stored tokenCount must match tokenLength(text)');
  }
  console.log('[chunker.test] PASS — token budget respected across', chunks.length, 'chunks');
}

async function testNoWhitespaceRun() {
  const blob = 'A'.repeat(3000);   // no whitespace at all
  const chunks = await chunkPages(
    [{ text: blob, metadata: { page: 1 } }],
    { documentId: 'doc-2', fileName: 'blob.txt', mimeType: 'text/plain', contentHash: 'h2' },
  );

  assert.ok(chunks.length >= 2, 'a 3000-char run with no whitespace must produce >= 2 chunks');
  const totalChars = chunks.reduce((sum, c) => sum + c.charCount, 0);
  assert.ok(totalChars >= blob.length, 'no characters may be lost across the split');
  console.log('[chunker.test] PASS — no-whitespace run split into', chunks.length, 'chunks, 0 chars lost');
}

async function testHeadingPathAndTableRepair() {
  const bigTable = [
    '| Region | Revenue | Quarter | Notes |',
    '|---|---|---|---|',
    ...Array.from({ length: 60 }, (_, i) => `| Region${i} | ${i * 1000} | Q${(i % 4) + 1} | Row number ${i} of a long table meant to force a split across chunks so the header-repair logic has something to repair |`),
  ].join('\n');

  const md = [
    '# Annual Report',
    '',
    '## Q3 Results',
    '',
    '### EMEA',
    '',
    'Some prose describing EMEA performance.',
    '',
    bigTable,
  ].join('\n');

  const chunks = await chunkPages(
    [{ text: md, metadata: { page: 12 } }],
    { documentId: 'doc-3', fileName: 'annual.pdf', mimeType: 'application/pdf', contentHash: 'h3' },
  );

  // The deepest section must carry the full three-level trail. Note the shallower chunks
  // legitimately carry shorter paths ('Annual Report', 'Annual Report > Q3 Results') —
  // asserting on the *first* chunk containing ' > ' would match the two-level one and say
  // nothing about nesting depth.
  const deepest = chunks.filter((c) => c.headingPath.split(' > ').length === 3);
  assert.ok(deepest.length > 0, 'at least one chunk must carry a three-level heading path');
  for (const c of deepest) {
    assert.strictEqual(c.headingPath, 'Annual Report > Q3 Results > EMEA');
  }
  // And the shallower levels must still be present, in order, on the earlier chunks.
  assert.strictEqual(chunks[0].headingPath, 'Annual Report');
  assert.strictEqual(chunks[1].headingPath, 'Annual Report > Q3 Results');

  const tableChunks = chunks.filter((c) => /^\s*\|/.test(c.text));
  assert.ok(tableChunks.length >= 2, 'the long table must have split into 2+ chunks');
  for (const c of tableChunks) {
    const [first, second] = c.text.split('\n');
    assert.ok(
      /^\|\s*Region\s*\|\s*Revenue\s*\|/.test(first),
      `every table chunk must start with the repaired header row, got: ${c.text.slice(0, 60)}`,
    );
    assert.ok(
      /^\|[\s|-]+\|\s*$/.test(second),
      `every table chunk's second line must be the separator row, got: ${second}`,
    );
    // The repair must not push a chunk past the embedding budget.
    assert.ok(c.tokenCount <= CHUNK_TOKENS, `repaired table chunk exceeds budget: ${c.tokenCount}`);
  }
  console.log('[chunker.test] PASS — heading path nesting and table-header carry-over across', tableChunks.length, 'table chunks');
}

// A header wide enough that naive prepending would breach CHUNK_TOKENS — the repair must
// re-split against a reduced budget instead of emitting an oversized chunk.
async function testWideTableHeaderStaysInBudget() {
  const cols = 14;
  const header = `| ${Array.from({ length: cols }, (_, c) => `ColumnHeaderNumber${c}`).join(' | ')} |`;
  const separator = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`;
  const rows = Array.from({ length: 60 }, (_, i) =>
    `| ${Array.from({ length: cols }, (_, c) => `cell${i}_${c} some filler text here`).join(' | ')} |`);

  const chunks = await chunkPages(
    [{ text: ['# Doc', '', '## Sec', '', header, separator, ...rows].join('\n'), metadata: { page: 1 } }],
    { documentId: 'doc-4', fileName: 'wide.md', mimeType: 'text/markdown', contentHash: 'h4' },
  );

  const tableChunks = chunks.filter((c) => /^\s*\|/.test(c.text));
  assert.ok(tableChunks.length >= 2, 'the wide table must split into 2+ chunks');
  for (const c of chunks) {
    assert.ok(c.tokenCount <= CHUNK_TOKENS, `chunk exceeds budget after wide-header repair: ${c.tokenCount}`);
  }
  for (const c of tableChunks) {
    assert.ok(c.text.startsWith(header), 'every wide-table chunk must still carry its header');
  }
  console.log('[chunker.test] PASS — wide header repaired across', tableChunks.length, 'chunks, all within budget');
}

// Regression: when the structural splitter packs several headings into ONE section (the
// common case, since it merges small sections up to the token budget), the chunk's
// heading path must reflect the deepest heading governing its content — not just the
// first heading in the section. Real ingested chunks once contained `# Operating Review`
// AND `## Regional Detail` while carrying only "Operating Review".
async function testMultipleHeadingsInOneSection() {
  const md = [
    '# Operating Review', '',
    '## Regional Detail', '',
    'Paragraph body text describing the region in detail. '.repeat(30), '',
  ].join('\n');

  const chunks = await chunkPages(
    [{ text: md, metadata: { page: 4 } }],
    { documentId: 'doc-5', fileName: 'report.pdf', mimeType: 'application/pdf', contentHash: 'h5' },
  );

  assert.ok(chunks.length > 0, 'the section produces at least one chunk');
  assert.strictEqual(
    chunks[0].headingPath, 'Operating Review > Regional Detail',
    'a chunk containing both headings must carry the full nested path',
  );
  console.log('[chunker.test] PASS — multi-heading section resolves to the deepest path');
}

await testTokenBudget();
await testNoWhitespaceRun();
await testHeadingPathAndTableRepair();
await testWideTableHeaderStaysInBudget();
await testMultipleHeadingsInOneSection();
console.log('[chunker.test] ALL PASS');
