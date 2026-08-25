// phase_4 task 4.6 — unaccounted-time computation with a parallel group. Run directly with
// `node test/waterfall.test.ts` (Node 22's built-in type stripping), matching this repo's
// existing test/*.test.mjs convention — see frontend/test/stage.test.ts.
import assert from 'node:assert/strict';
import { buildWaterfallRows, computeUnaccountedMs } from '../src/app/components/trace/waterfallLayout.ts';
import type { PipelineTelemetry } from '../src/app/components/core/TelemetryTypes.ts';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL - ${name}`);
    console.error(err);
  }
}

function baseTelemetry(overrides: Partial<PipelineTelemetry>): PipelineTelemetry {
  return {
    condenseMs: null, condenseStartMs: null,
    embedMs: null, embedStartMs: null,
    sparseMs: null, sparseStartMs: null,
    colpaliMs: null, colpaliStartMs: null,
    chunkRetrieveMs: null, chunkRetrieveStartMs: null,
    pageRetrieveMs: null, pageRetrieveStartMs: null,
    mergeMs: null, mergeStartMs: null,
    rerankMs: null, rerankStartMs: null,
    generateMs: null, generateStartMs: null,
    firstTokenMs: null,
    totalMs: 0,
    candidatesRetrieved: 0, candidatesAfterMerge: 0, candidatesAfterFloor: 0,
    rerankSkipped: false, warnings: [],
    ...overrides,
  };
}

// embed/sparse/colpali overlap: embed 10→110 (100ms), sparse 10→15 (5ms), colpali 10→60
// (50ms). The GROUP SPAN is 100ms (110-10), not the sum 155ms — a wrong implementation that
// summed durations would compute unaccounted as 300-245=55 instead of the correct 110.
check('unaccounted uses the parallel-group SPAN, not the sum of its members', () => {
  const t = baseTelemetry({
    embedMs: 100, embedStartMs: 10,
    sparseMs: 5, sparseStartMs: 10,
    colpaliMs: 50, colpaliStartMs: 10,
    generateMs: 90, generateStartMs: 110,
    totalMs: 300,
  });
  assert.equal(computeUnaccountedMs(t), 110);
});

check('a fully-measured telemetry with no gaps has zero unaccounted time', () => {
  const t = baseTelemetry({
    mergeMs: 50, mergeStartMs: 0,
    rerankMs: 50, rerankStartMs: 50,
    totalMs: 100,
  });
  assert.equal(computeUnaccountedMs(t), 0);
});

check('a skipped stage (null duration) contributes nothing to measured time', () => {
  const t = baseTelemetry({
    condenseMs: null, condenseStartMs: null,
    generateMs: 80, generateStartMs: 0,
    totalMs: 100,
  });
  // Only generate (80ms) is measured; condense never ran, so it cannot be part of the gap
  // explanation as a "measured but unaccounted" quantity.
  assert.equal(computeUnaccountedMs(t), 20);
});

check('buildWaterfallRows marks a null-duration stage as skipped with no bar position', () => {
  const t = baseTelemetry({ totalMs: 100 });
  const rows = buildWaterfallRows(t);
  const condenseRow = rows.find((r) => r.spec.label === 'condense')!;
  assert.equal(condenseRow.skipped, true);
  assert.equal(condenseRow.startMs, null);
  assert.equal(condenseRow.durationMs, null);
});

check('buildWaterfallRows reports the exact measured start offset for a non-skipped stage', () => {
  const t = baseTelemetry({ embedMs: 210, embedStartMs: 37, totalMs: 300 });
  const rows = buildWaterfallRows(t);
  const embedRow = rows.find((r) => r.spec.label === 'embed')!;
  assert.equal(embedRow.skipped, false);
  assert.equal(embedRow.startMs, 37);
  assert.equal(embedRow.durationMs, 210);
});

check('buildWaterfallRows brackets the three encode-group rows top/middle/bottom', () => {
  const t = baseTelemetry({
    embedMs: 10, embedStartMs: 0,
    sparseMs: 10, sparseStartMs: 0,
    colpaliMs: 10, colpaliStartMs: 0,
    totalMs: 100,
  });
  const rows = buildWaterfallRows(t);
  const byLabel = Object.fromEntries(rows.map((r) => [r.spec.label, r]));
  assert.equal(byLabel.embed.bracket, 'top');
  assert.equal(byLabel.sparse.bracket, 'middle');
  assert.equal(byLabel.colpali.bracket, 'bottom');
  assert.equal(byLabel.condense.bracket, 'none');
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
} else {
  console.log('\nall passed');
}
