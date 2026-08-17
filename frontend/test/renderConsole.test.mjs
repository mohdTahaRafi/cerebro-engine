// Server-renders the real /advanced console components against fixture telemetry and
// asserts on the resulting DOM (phase 6 tasks 6.2-6.5).
//
// Why this exists: the console's correctness is mostly *geometry* — where each bar starts,
// how wide it is, whether a skipped stage is visually distinct, and whether every row
// shares one column grid. `vite build` succeeding proves none of that. This bundles the
// actual components with esbuild and renders them through react-dom/server, so the
// assertions run against the same markup a browser would receive.
//
// What it does NOT cover, stated plainly: applied CSS, fonts, colors, and anything
// requiring layout or paint. Tailwind class names are asserted as *present*, not as
// producing any particular visual result. A human still has to look at it once.
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
// generate present. Offsets are real values captured from a live /api/ask run.
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

const SOURCES = [
  {
    pointId: 'p1', kind: 'text', text: 'EMEA revenue reached 42.4 million dollars.',
    score: 0.9934, documentId: 'd1', fileName: 'report.txt', page: 1,
    headingPath: null, imageUri: null, ocrQuality: null, absorbedChunks: null,
    branch: 'both', fusionRank: 4, finalRank: 1,
  },
  {
    pointId: 'p2', kind: 'page', text: 'scanned page OCR text',
    score: 0.61, documentId: 'd2', fileName: 'invoice.pdf', page: 7,
    headingPath: null, imageUri: '/api/pages/d2/7.jpg', ocrQuality: 0.8,
    absorbedChunks: ['c1', 'c2'], branch: 'colpali', fusionRank: 2, finalRank: 2,
  },
];

const ENTRY = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ExecutionPlan } from ${JSON.stringify(path.join(ROOT, 'src/app/components/core/ExecutionPlan.tsx'))};
import { ProvenancePanel } from ${JSON.stringify(path.join(ROOT, 'src/app/components/core/ProvenancePanel.tsx'))};

export function renderAll(telemetry, sources) {
  return {
    plan: renderToStaticMarkup(React.createElement(ExecutionPlan, {
      telemetry, isGenerating: false, runId: 'run-abc', langsmith: { orgId: 'org-1', project: 'cerebro' },
    })),
    planNoLink: renderToStaticMarkup(React.createElement(ExecutionPlan, {
      telemetry, isGenerating: false, runId: 'run-abc', langsmith: { orgId: null, project: 'cerebro' },
    })),
    planEmpty: renderToStaticMarkup(React.createElement(ExecutionPlan, { telemetry: null })),
    provenance: renderToStaticMarkup(React.createElement(ProvenancePanel, { sources })),
  };
}
`;

async function renderComponents() {
  // Output lands under node_modules/.cache (gitignored, never shipped) rather than /tmp for
  // one specific reason: react-dom/server is CommonJS and must stay EXTERNAL — bundling it
  // rewrites its internal `require('stream')` into a stub that throws. Left external, Node
  // resolves it at import time by walking up from the bundle's own location, which only
  // finds frontend/node_modules if the bundle sits inside the project.
  const dir = await mkdtemp(path.join(ROOT, 'node_modules', '.cache', 'cerebro-render-'));
  const outPath = path.join(dir, 'bundle.cjs');

  // CommonJS output with React left external. Both halves are required: react-dom/server
  // and lucide-react ship CJS builds that call `require()` internally, and esbuild's ESM
  // output replaces `require` with a stub that throws on any real module. Emitting CJS
  // keeps `require` native, and keeping React external avoids bundling two copies of it.
  //
  // stdin + resolveDir rather than a temp entry file: esbuild resolves bare imports
  // relative to the *entry's* directory, so resolveDir points resolution at the project
  // root while keeping the generated entry out of the repo tree entirely.
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

  const out = createRequire(import.meta.url)(outPath).renderAll(TELEMETRY, SOURCES);
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

const { plan, planNoLink, planEmpty, provenance } = await renderComponents();
let ok = true;
const pct = (ms) => (ms / TELEMETRY.totalMs) * 100;

console.log('\n=== ExecutionPlan (task 6.2 — measured-offset waterfall) ===');

ok &= test('renders one row per pipeline stage', () => {
  for (const label of ['condense', 'embed', 'sparse', 'colpali', 'chunk-retrieve', 'page-retrieve', 'merge', 'rerank', 'generate']) {
    assert.ok(plan.includes(`>${label}<`), `missing stage row "${label}"`);
  }
});

ok &= test('bar offsets match MEASURED start offsets, not a stacked sum', () => {
  const bars = extractBars(plan);
  // 9 stage bars in STAGES order; skipped ones are full-width hatches at left:0.
  assert.equal(bars.length, 9, `expected 9 bars, got ${bars.length}`);
  const [condense, embed, sparse, colpali, chunkR, pageR, merge, rerank, generate] = bars;

  // Assertions run in MILLISECOND space, not percentage space. With a 31.6s total, a 61ms
  // positioning error is only 0.19% of the track — comfortably inside any tolerance loose
  // enough to survive rounding, so a %-space comparison cannot actually distinguish a
  // measured offset from a stacked one. Converting back to ms makes the check meaningful.
  const toMs = (leftPct) => (leftPct / 100) * TELEMETRY.totalMs;

  // The three encode stages start together (~58ms) — the fan-out §2.2 requires be drawn on
  // a shared timeline. Under a stacked layout, sparse would begin where embed ended.
  assert.ok(Math.abs(toMs(embed.left) - 58.06) < 0.5, `embed starts at ${toMs(embed.left).toFixed(2)}ms, expected 58.06ms`);
  assert.ok(Math.abs(toMs(sparse.left) - 58.06) < 0.5, 'sparse must start with embed, not after it');
  assert.ok(sparse.width < embed.width, 'sparse (5ms) must be narrower than embed (401ms)');

  // Sequential stages sit at their own measured offsets, with real gaps preserved.
  assert.ok(Math.abs(toMs(chunkR.left) - 459.55) < 0.5, 'chunk-retrieve offset must be measured');
  assert.ok(Math.abs(toMs(rerank.left) - 495.77) < 0.5, 'rerank offset must be measured');
  assert.ok(Math.abs(toMs(generate.left) - 859.71) < 0.5, 'generate offset must be measured');

  // A stacked sum would place rerank at the cumulative duration of everything before it.
  // The 61ms gap between that and the measured offset is exactly the unaccounted node
  // transition time the waterfall is supposed to expose rather than absorb.
  const stackedMs = 400.86 + 5.21 + 28.49 + 0.01;
  assert.ok(
    Math.abs(toMs(rerank.left) - stackedMs) > 10,
    `rerank must NOT be positioned by stacking durations (measured ${toMs(rerank.left).toFixed(2)}ms vs stacked ${stackedMs.toFixed(2)}ms)`,
  );

  // Skipped stages claim no span: full-width hatch anchored at 0.
  for (const [n, b] of [['condense', condense], ['colpali', colpali], ['page-retrieve', pageR]]) {
    assert.equal(b.left, 0, `${n} (skipped) must not claim a timeline position`);
    assert.equal(b.width, 100, `${n} (skipped) must render as a full-width hatch`);
  }
  assert.ok(merge.width >= 0.4, 'sub-millisecond merge must still floor to a visible sliver');
});

ok &= test('every row shares one column grid (task 6.2 alignment)', () => {
  // The B2 defect: grouped rows were wrapped in an indent container, shifting them
  // relative to ungrouped rows. Every row must now open with the same label+gutter widths.
  const rowOpens = plan.match(/<span class="w-28 shrink-0 text-gray-400[^"]*">/g) ?? [];
  assert.equal(rowOpens.length, 9, `expected 9 identically-classed label cells, got ${rowOpens.length}`);
  const gutters = plan.match(/<span class="w-3 shrink-0 self-stretch relative">/g) ?? [];
  assert.equal(gutters.length, 9, `expected a bracket gutter on all 9 rows, got ${gutters.length}`);
  assert.ok(!plan.includes('ml-[7rem]'), 'grouped rows must not be indented by a wrapper');
});

ok &= test('parallel groups get bracket decoration in the gutter', () => {
  const brackets = plan.match(/absolute left-0 top-1\/2 w-2 h-\[2px\]/g) ?? [];
  // encode group (embed/sparse/colpali) + retrieve group (chunk/page) = 5 bracketed rows.
  assert.equal(brackets.length, 5, `expected 5 bracketed rows, got ${brackets.length}`);
});

console.log('\n=== Skipped-stage rendering (task 6.3) ===');

ok &= test('skipped stages are hatched, labeled "skipped", and name their reason', () => {
  assert.ok(plan.includes('repeating-linear-gradient'), 'skipped stages must use a hatch fill');
  const skippedLabels = plan.match(/>skipped</g) ?? [];
  assert.equal(skippedLabels.length, 3, `expected 3 "skipped" value labels, got ${skippedLabels.length}`);
  assert.ok(plan.includes('first turn — no history to condense'), 'condense must explain why it was skipped');
  assert.ok(plan.includes('vision service unavailable or no visual corpus'), 'colpali must explain why it was skipped');
});

ok &= test('a skipped stage never renders as 0ms', () => {
  // Scoped to the stage rows' value column (w-32) — the axis row legitimately prints a
  // "0ms" origin tick, which is a scale label, not a stage measurement. Matching the whole
  // document would conflate the two.
  const valueCells = plan.match(/<span class="w-32 shrink-0 text-right[^"]*">([^<]*)<\/span>/g) ?? [];
  assert.ok(valueCells.length >= 9, `expected at least 9 stage value cells, got ${valueCells.length}`);
  for (const cell of valueCells) {
    assert.ok(!cell.includes('>0ms<'), `a stage rendered "0ms" instead of "skipped": ${cell}`);
  }
});

console.log('\n=== First-token marker + counts ===');

ok &= test('first-token marker sits inside the generate bar at its measured position', () => {
  const expected = pct(TELEMETRY.generateStartMs + TELEMETRY.firstTokenMs);
  assert.ok(
    new RegExp(`left:\\s*${expected.toFixed(0)}`).test(plan) || plan.includes(`left:${expected}%`),
    `expected a marker near ${expected.toFixed(2)}%`,
  );
  assert.ok(plan.includes('first token 26606ms into generation'), 'marker must be labeled');
});

ok &= test('candidate counts are rendered', () => {
  assert.ok(plan.includes('>12<'), 'candidatesRetrieved/AfterMerge must render');
  assert.ok(plan.includes('>3<'), 'candidatesAfterFloor must render');
});

console.log('\n=== LangSmith deep link (task 6.5) ===');

ok &= test('renders a real href when orgId is configured', () => {
  assert.ok(
    plan.includes('href="https://smith.langchain.com/o/org-1/projects/p/cerebro/r/run-abc"'),
    'expected a LangSmith deep link',
  );
});

ok &= test('degrades to a non-link hint when orgId is unset', () => {
  assert.ok(!planNoLink.includes('smith.langchain.com'), 'must not emit a broken link');
  assert.ok(planNoLink.includes('Set LANGSMITH_ORG_ID'), 'must explain how to enable it');
});

ok &= test('empty state renders no bars', () => {
  assert.equal(extractBars(planEmpty).length, 0);
  assert.ok(planEmpty.includes('Awaiting query'), 'empty state must prompt for a query');
});

console.log('\n=== ProvenancePanel (task 6.4) ===');

ok &= test('renders branch attribution per source', () => {
  assert.ok(provenance.includes('>Both<'), 'dense+sparse hit must be labeled Both');
  assert.ok(provenance.includes('>ColPali<'), 'visual hit must be labeled ColPali');
});

ok &= test('renders fusion -> final rank movement', () => {
  assert.ok(provenance.includes('>#4<') && provenance.includes('>#1<'), 'must show fusion rank 4 and final rank 1');
  assert.ok(provenance.includes('(+3)'), 'must show the +3 promotion delta');
});

ok &= test('renders absorbed OCR chunk count and page thumbnail', () => {
  assert.ok(provenance.includes('2 OCR chunk(s) absorbed'), 'absorbed count must be shown');
  assert.ok(provenance.includes('src="/api/pages/d2/7.jpg"'), 'page source must render a thumbnail');
});

console.log(ok ? '\nAll console render checks passed.\n' : '\nSome console render checks FAILED.\n');
process.exit(ok ? 0 : 1);
