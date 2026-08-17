// PipelineTelemetry contract tests (phase 6 §2.1, §2.2, task 6.1).
//
// The whole point of this contract is a distinction that is easy to break silently and
// impossible to spot from a passing request: a stage that did not run reports `null`, never
// `0`, and never simply goes missing from the payload. Every assertion below exists because
// the opposite behaviour would still produce a plausible-looking response that renders a
// misleading waterfall — which is exactly the class of bug §2.1 was written against.
import assert from 'node:assert/strict';
import { buildTelemetry } from '../../src/telemetry/pipelineTelemetry.js';
import { createTimer } from '../../src/retrieval/timer.js';

const STAGES = [
  'condense', 'embed', 'sparse', 'colpali',
  'chunkRetrieve', 'pageRetrieve', 'merge', 'rerank', 'generate',
];

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    failures += 1;
  }
}

console.log('\n=== buildTelemetry: the null-vs-zero contract ===');

test('every stage key is present even when nothing was measured', () => {
  const t = buildTelemetry({ totalMs: 5 }, 0);
  for (const stage of STAGES) {
    assert.ok(`${stage}Ms` in t, `${stage}Ms must always be present`);
    assert.ok(`${stage}StartMs` in t, `${stage}StartMs must always be present`);
  }
  // An absent key is indistinguishable from a client that forgot to read it; an explicit
  // null is not. This is the assertion that keeps the contract honest for consumers.
  assert.equal(t.firstTokenMs, null);
});

test('a stage that did not run is null, never 0', () => {
  const t = buildTelemetry({ totalMs: 5 }, 0);
  for (const stage of STAGES) {
    assert.equal(t[`${stage}Ms`], null, `${stage}Ms must be null, not 0`);
    assert.equal(t[`${stage}StartMs`], null, `${stage}StartMs must be null, not 0`);
  }
});

test('a genuinely instantaneous stage reports 0, not null', () => {
  // The mirror image of the case above, and the reason the distinction has to be carried
  // explicitly rather than inferred from falsiness: merge really does complete in under
  // 0.01ms on a small candidate set, and that measured near-zero must survive as a number.
  const t = buildTelemetry({ mergeMs: 0, mergeStartAt: 100, totalMs: 5 }, 100);
  assert.equal(t.mergeMs, 0, 'a measured 0ms duration must not be coerced to null');
  assert.equal(t.mergeStartMs, 0);
});

test('start offsets are measured relative to the supplied origin', () => {
  const origin = 1_000;
  const t = buildTelemetry({
    embedMs: 400, embedStartAt: 1_058,
    rerankMs: 356, rerankStartAt: 1_495.77,
    totalMs: 2_000,
  }, origin);
  assert.equal(t.embedStartMs, 58);
  assert.equal(t.rerankStartMs, 495.77);
});

test('offsets are null when no origin was supplied', () => {
  // Defaulting a missing origin to 0 would pin every bar to the left edge and silently
  // manufacture the stacked-sum layout §2.2 exists to prevent. Reporting null instead makes
  // the omission visible rather than plausible.
  const t = buildTelemetry({ embedMs: 400, embedStartAt: 1_058, totalMs: 2_000 });
  assert.equal(t.embedMs, 400, 'the duration is still known without an origin');
  assert.equal(t.embedStartMs, null, 'the offset is not knowable without an origin');
});

test('raw absolute instants never reach the wire', () => {
  const t = buildTelemetry({ embedMs: 400, embedStartAt: 1_058, totalMs: 2_000 }, 1_000);
  for (const key of Object.keys(t)) {
    assert.ok(!key.endsWith('StartAt'), `internal field ${key} leaked into the payload`);
  }
});

test('counts default to 0 and warnings to an empty array', () => {
  const t = buildTelemetry({ totalMs: 5 }, 0);
  assert.equal(t.candidatesRetrieved, 0);
  assert.equal(t.candidatesAfterMerge, 0);
  assert.equal(t.candidatesAfterFloor, 0);
  assert.equal(t.rerankSkipped, false);
  assert.deepEqual(t.warnings, []);
});

test('a rerank that was skipped is reported as skipped AND as null latency', () => {
  // Both halves matter: the flag drives the console's "degraded" badge, and the null stops
  // a failed provider call's rejection latency from being drawn as real rerank time.
  const t = buildTelemetry({ rerankSkipped: true, totalMs: 900, candidatesAfterFloor: 4 }, 0);
  assert.equal(t.rerankSkipped, true);
  assert.equal(t.rerankMs, null);
  assert.equal(t.candidatesAfterFloor, 4);
});

console.log('\n=== createTimer: marks, offsets, and skipped branches ===');

test('a branch that never completed reports null duration and null start', () => {
  const t = createTimer();
  t.mark('pageRetrieveStart');          // started, then the branch bailed out
  const r = t.report();
  assert.equal(r.pageRetrieveMs, null, 'no end mark => no duration');
  assert.equal(r.pageRetrieveStartAt, null, 'a start with no end must not place a bar');
});

test('a completed stage reports both a duration and an absolute start', () => {
  const t = createTimer();
  t.mark('embedStart');
  t.mark('embedEnd');
  const r = t.report();
  assert.equal(typeof r.embedMs, 'number');
  assert.ok(r.embedMs >= 0);
  assert.equal(typeof r.embedStartAt, 'number');
  assert.ok(r.embedStartAt >= t.startedAt(), 'start instant must not precede the timer origin');
});

test('concurrent stages report overlapping spans, not sequential ones', () => {
  // The fan-out §2.2 requires be drawn on a shared timeline. Marking all three starts before
  // any end mirrors retrieveStage's real dispatch, and the resulting offsets must coincide.
  const t = createTimer();
  t.mark('embedStart'); t.mark('sparseStart'); t.mark('colpaliStart');
  t.mark('sparseEnd'); t.mark('colpaliEnd'); t.mark('embedEnd');
  const r = t.report();
  const origin = t.startedAt();
  const starts = [r.embedStartAt, r.sparseStartAt, r.colpaliStartAt].map((s) => s - origin);
  const spread = Math.max(...starts) - Math.min(...starts);
  assert.ok(spread < 5, `concurrent stages should start together, spread was ${spread}ms`);
});

test('end-to-end through buildTelemetry, a skipped branch stays skipped', () => {
  const t = createTimer();
  t.mark('embedStart'); t.mark('embedEnd');
  t.mark('colpaliStart');               // vision unavailable — never completed
  const wire = buildTelemetry({ ...t.report(), totalMs: t.elapsedMs() }, t.startedAt());
  assert.equal(typeof wire.embedMs, 'number');
  assert.equal(typeof wire.embedStartMs, 'number', 'a completed stage must carry a numeric offset');
  assert.ok(wire.embedStartMs >= 0 && wire.embedStartMs <= wire.totalMs,
    `offset ${wire.embedStartMs} must fall inside the request window [0, ${wire.totalMs}]`);
  assert.equal(wire.colpaliMs, null);
  assert.equal(wire.colpaliStartMs, null);
});

console.log(failures === 0 ? '\nAll pipeline telemetry tests passed.\n' : `\n${failures} test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
