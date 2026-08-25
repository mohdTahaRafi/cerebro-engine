// Server-renders the real Waterfall and RerankMatrix components (phase_4 §3.2, §3.3) against
// fixture telemetry/candidates and asserts on the resulting DOM. Ports frontend/test's old
// renderConsole.test.mjs (phase 6 tasks 6.2-6.5), which tested ExecutionPlan.tsx and
// ProvenancePanel.tsx — both deleted this phase, superseded by these two components (§8's
// "Deleted this phase" list). Why this exists, unchanged from the original: the console's
// correctness is mostly *geometry* — where each bar starts, how wide it is, whether a
// skipped stage is visually distinct — and `vite build` succeeding proves none of that.
//
// What it does NOT cover, stated plainly: applied CSS, fonts, colors, anything requiring
// layout or paint. Tailwind class names are asserted as *present*, not as producing any
// particular visual result. A human still has to look at it once.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Mirrors backend/src/telemetry/pipelineTelemetry.js's output for a first-turn text-only
// query: condense skipped (no history), colpali + pageRetrieve skipped (no visual corpus),
// generate present. Offsets are real values captured from a live /api/ask run — same fixture
// the original test used, so the geometry assertions below carry over unchanged.
const TELEMETRY = {
  condenseMs: null, condenseStartMs: null,
  embedMs: 400.86, embedStartMs: 58.06,
  sparseMs: 5.21, sparseStartMs: 58.06,
  colpaliMs: null, colpaliStartMs: null,
  chunkRetrieveMs: 28.49, chunkRetrieveStartMs: 459.55,
  pageRetrieveMs: null, pageRetrieveStartMs: null,
  mergeMs: 0.01, mergeStartMs: 488.21,
  rerankMs: 356, rerankStartMs: 495.77,
  generateMs: 30723, generateStartMs: 859.71,
  firstTokenMs: 26606,
  totalMs: 31606,
  candidatesRetrieved: 12, candidatesAfterMerge: 12, candidatesAfterFloor: 3,
  rerankSkipped: false,
  warnings: [],
};

const CANDIDATES = [
  {
    pointId: 'p1', kind: 'text', text: 'EMEA revenue reached 42.4 million dollars.',
    score: 0.9934, documentId: 'd1', fileName: 'report.txt', page: 1,
    headingPath: null, position: 0, imageUri: null, ocrQuality: null, absorbedChunks: null,
    branch: 'both', fusionRank: 4, finalRank: 1, belowFloor: false,
  },
  {
    pointId: 'p2', kind: 'page', text: 'scanned page OCR text',
    score: 0.61, documentId: 'd2', fileName: 'invoice.pdf', page: 7,
    headingPath: null, position: 1, imageUri: '/api/pages/d2/7.jpg', ocrQuality: '0.8',
    absorbedChunks: ['c1', 'c2'], branch: 'colpali', fusionRank: 2, finalRank: 2, belowFloor: false,
  },
  {
    pointId: 'p3', kind: 'text', text: 'unrelated passage', score: 0.09,
    documentId: 'd3', fileName: 'notes.md', page: null, headingPath: '§2', position: 2,
    imageUri: null, ocrQuality: null, absorbedChunks: null,
    branch: 'sparse', fusionRank: 3, finalRank: null, belowFloor: true,
  },
];
const RELEVANCE_FLOOR = 0.15;

const ENTRY = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Waterfall } from ${JSON.stringify(path.join(ROOT, 'src/app/components/trace/Waterfall.tsx'))};
import { RerankMatrix } from ${JSON.stringify(path.join(ROOT, 'src/app/components/trace/RerankMatrix.tsx'))};

export function renderAll(telemetry, candidates, relevanceFloor) {
  return {
    waterfall: renderToStaticMarkup(React.createElement(Waterfall, { telemetry })),
    matrix: renderToStaticMarkup(React.createElement(RerankMatrix, { candidates, relevanceFloor, rerankSkipped: false })),
    matrixSkipped: renderToStaticMarkup(React.createElement(RerankMatrix, { candidates, relevanceFloor, rerankSkipped: true })),
  };
}
`;

async function renderComponents() {
  // Output lands under node_modules/.cache (gitignored, never shipped) rather than /tmp —
  // react-dom/server is CommonJS and must stay EXTERNAL, or bundling rewrites its internal
  // require('stream') into a stub that throws; left external, Node resolves it by walking up
  // from the bundle's own location, which only finds frontend/node_modules from inside the
  // project tree.
  const dir = await mkdtemp(path.join(ROOT, 'node_modules', '.cache', 'cerebro-render-'));
  const outPath = path.join(dir, 'bundle.cjs');

  await build({
    stdin: { contents: ENTRY, resolveDir: ROOT, sourcefile: 'render-entry.jsx', loader: 'jsx' },
    outfile: outPath,
    bundle: true,
    format: 'cjs',
    platform: 'node',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react-dom/server'],
    loader: { '.tsx': 'tsx', '.ts': 'ts', '.jsx': 'jsx' },
    absWorkingDir: ROOT,
    logLevel: 'silent',
  });

  const out = createRequire(import.meta.url)(outPath).renderAll(TELEMETRY, CANDIDATES, RELEVANCE_FLOOR);
  await rm(dir, { recursive: true, force: true });
  return out;
}

// Bars carry inline `left:` / `width:` percentages; pull them out in document order.
function extractBars(html) {
  const bars = [];
  const re = /style="left:\s*([\d.]+)%;\s*width:\s*([\d.]+)%"/g;
  let m;
  while ((m = re.exec(html)) !== null) bars.push({ left: Number(m[1]), width: Number(m[2]) });
  return bars;
}

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    return false;
  }
}

const { waterfall, matrix, matrixSkipped } = await renderComponents();
let ok = true;
const pct = (ms) => (ms / TELEMETRY.totalMs) * 100;

console.log('\n=== Waterfall (task 4.5 — measured-offset waterfall) ===');

ok &= test('renders one row per pipeline stage', () => {
  for (const label of ['condense', 'embed', 'sparse', 'colpali', 'chunk-retrieve', 'page-retrieve', 'merge', 'rerank', 'generate']) {
    assert.ok(waterfall.includes(`>${label}<`), `missing stage row "${label}"`);
  }
});

ok &= test('bar offsets match MEASURED start offsets, not a stacked sum', () => {
  const bars = extractBars(waterfall);
  assert.equal(bars.length, 9, `expected 9 bars, got ${bars.length}`);
  const [condense, embed, sparse, colpali, chunkR, pageR, merge, rerank, generate] = bars;

  // Assertions run in MILLISECOND space, not percentage space — with a 31.6s total, a
  // positioning error of tens of ms is a fraction of a percent of the track, too small for
  // a %-space comparison to distinguish a measured offset from a stacked one.
  const toMs = (leftPct) => (leftPct / 100) * TELEMETRY.totalMs;

  assert.ok(Math.abs(toMs(embed.left) - 58.06) < 0.5, `embed starts at ${toMs(embed.left).toFixed(2)}ms, expected 58.06ms`);
  assert.ok(Math.abs(toMs(sparse.left) - 58.06) < 0.5, 'sparse must start with embed, not after it');
  assert.ok(sparse.width < embed.width, 'sparse (5ms) must be narrower than embed (401ms)');

  assert.ok(Math.abs(toMs(chunkR.left) - 459.55) < 0.5, 'chunk-retrieve offset must be measured');
  assert.ok(Math.abs(toMs(rerank.left) - 495.77) < 0.5, 'rerank offset must be measured');
  assert.ok(Math.abs(toMs(generate.left) - 859.71) < 0.5, 'generate offset must be measured');

  const stackedMs = 400.86 + 5.21 + 28.49 + 0.01;
  assert.ok(
    Math.abs(toMs(rerank.left) - stackedMs) > 10,
    `rerank must NOT be positioned by stacking durations (measured ${toMs(rerank.left).toFixed(2)}ms vs stacked ${stackedMs.toFixed(2)}ms)`,
  );

  for (const [n, b] of [['condense', condense], ['colpali', colpali], ['page-retrieve', pageR]]) {
    assert.equal(b.left, 0, `${n} (skipped) must not claim a timeline position`);
    assert.equal(b.width, 100, `${n} (skipped) must render as a full-width hatch`);
  }
  assert.ok(merge.width >= 0.4, 'sub-millisecond merge must still floor to a visible sliver');
});

ok &= test('every row shares one column grid', () => {
  const rowOpens = waterfall.match(/<span class="w-28 shrink-0 text-right text-\[11px\] font-medium uppercase tracking-wide text-graphite">/g) ?? [];
  assert.equal(rowOpens.length, 9, `expected 9 identically-classed label cells, got ${rowOpens.length}`);
  const gutters = waterfall.match(/<span class="relative w-3 shrink-0 self-stretch">/g) ?? [];
  assert.equal(gutters.length, 9, `expected a bracket gutter on all 9 rows, got ${gutters.length}`);
});

ok &= test('parallel groups get bracket decoration in the gutter', () => {
  const ticks = waterfall.match(/absolute left-1 top-1\/2 h-px w-2 bg-line-strong/g) ?? [];
  // encode group (embed/sparse/colpali) + retrieve group (chunk/page) = 5 bracketed rows.
  assert.equal(ticks.length, 5, `expected 5 bracketed rows, got ${ticks.length}`);
});

console.log('\n=== Skipped-stage rendering ===');

ok &= test('skipped stages are hatched, labeled "skipped", and name their reason', () => {
  assert.ok(waterfall.includes('repeating-linear-gradient'), 'skipped stages must use a hatch fill');
  const skippedLabels = waterfall.match(/>skipped</g) ?? [];
  assert.equal(skippedLabels.length, 3, `expected 3 "skipped" value labels, got ${skippedLabels.length}`);
  assert.ok(waterfall.includes('first turn — no history to condense'), 'condense must explain why it was skipped');
  assert.ok(waterfall.includes('vision service unavailable or no visual corpus'), 'colpali must explain why it was skipped');
});

ok &= test('a skipped stage never renders as 0ms', () => {
  const valueCells = waterfall.match(/<span class="w-24 shrink-0 text-right[^"]*">([^<]*)<\/span>/g) ?? [];
  assert.ok(valueCells.length >= 9, `expected at least 9 stage value cells, got ${valueCells.length}`);
  for (const cell of valueCells) {
    assert.ok(!cell.includes('>0ms<'), `a stage rendered "0ms" instead of "skipped": ${cell}`);
  }
});

console.log('\n=== First-token marker + unaccounted time ===');

ok &= test('first-token marker sits inside the generate bar, labeled', () => {
  const expected = pct(TELEMETRY.generateStartMs + TELEMETRY.firstTokenMs);
  assert.ok(
    new RegExp(`left:\\s*${expected.toFixed(0)}`).test(waterfall) || waterfall.includes(`left:${expected}%`),
    `expected a marker near ${expected.toFixed(2)}%`,
  );
  assert.ok(waterfall.includes('first token 26606ms'), 'marker must be labeled');
});

ok &= test('the footer states total and unaccounted time with its explanation', () => {
  assert.ok(waterfall.includes('unaccounted'), 'must state the unaccounted figure');
  assert.ok(waterfall.includes('node transitions, prompt assembly, persistence'), 'must explain what the gap is');
});

console.log('\n=== RerankMatrix (task 4.7-4.9) ===');

ok &= test('renders branch attribution per candidate', () => {
  assert.ok(matrix.includes('>BOTH<'), 'dense+sparse hit must be labeled BOTH');
  assert.ok(matrix.includes('>COLP<'), 'visual hit must be labeled COLP');
});

ok &= test('renders fusion -> final rank movement with the delta glyph', () => {
  assert.ok(matrix.includes('▲3'), 'must show the +3 promotion delta (fusion 4 -> final 1)');
});

ok &= test('renders the absorbed OCR chunk count', () => {
  assert.ok(matrix.includes('OCR×2'), 'absorbed count must be shown for the scanned-page candidate');
});

ok &= test('the relevance floor rule carries its value, and cut candidates are struck through', () => {
  assert.ok(matrix.includes('relevance floor 0.15'), 'floor rule must state its value');
  assert.ok(matrix.includes('line-through'), 'a below-floor candidate must render struck through, not omitted');
  assert.ok(matrix.includes('notes.md'), 'the cut candidate must still be visible in the DOM');
});

ok &= test('rerankSkipped renders the degradation message with no scores', () => {
  assert.ok(matrixSkipped.includes('Reranking was unavailable'), 'must state the degradation plainly');
  assert.ok(!matrixSkipped.includes('rerank score'), 'must not synthesize a score under a skipped reranker');
});

console.log(ok ? '\nAll inspector render checks passed.\n' : '\nSome inspector render checks FAILED.\n');
process.exit(ok ? 0 : 1);
