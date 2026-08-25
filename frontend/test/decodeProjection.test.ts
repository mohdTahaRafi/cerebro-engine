// phase_4 task 4.12 — decodeProjection's two length assertions, plus the color-resolution
// and bounds pass-through. Run directly with `node test/decodeProjection.test.ts` (Node 22's
// built-in type stripping) — see frontend/test/stage.test.ts for the convention.
import assert from 'node:assert/strict';
import { decodeProjection } from '../src/app/components/vectors/decodeProjection.ts';
import type { ProjectionResponse } from '../src/api/contracts.ts';

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

function b64(bytes: number[]): string {
  return Buffer.from(Uint8Array.from(bytes)).toString('base64');
}

function float32Bytes(values: number[]): number[] {
  const buf = new ArrayBuffer(values.length * 4);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setFloat32(i * 4, v, true));
  return [...new Uint8Array(buf)];
}

function uint16Bytes(values: number[]): number[] {
  const buf = new ArrayBuffer(values.length * 2);
  const view = new DataView(buf);
  values.forEach((v, i) => view.setUint16(i * 2, v, true));
  return [...new Uint8Array(buf)];
}

function baseResponse(overrides: Partial<ProjectionResponse>): ProjectionResponse {
  return {
    staleness: 'fresh', reason: null,
    nodeCount: 2,
    positions: b64(float32Bytes([0, 0, 0, 1, 1, 1])),
    docIndex: b64(uint16Bytes([0, 1])),
    pointIds: ['p1', 'p2'],
    documents: [
      { id: 'd1', fileName: 'a.pdf', color: 0xff0000 },
      { id: 'd2', fileName: 'b.pdf', color: 0x00ff00 },
    ],
    bounds: { min: [0, 0, 0], max: [1, 1, 1] },
    fittedAt: '2026-08-25T00:00:00.000Z',
    ...overrides,
  };
}

check('a position buffer one byte short throws with the expected/actual byte counts', () => {
  const truncated = b64(float32Bytes([0, 0, 0, 1, 1, 1]).slice(0, -1));
  const res = baseResponse({ positions: truncated });
  assert.throws(
    () => decodeProjection(res),
    (err: Error) => {
      assert.match(err.message, /expected 24 position bytes, got 23/);
      return true;
    },
  );
});

check('a docIndex buffer of the wrong length throws with the expected/actual byte counts', () => {
  const truncated = b64(uint16Bytes([0, 1]).slice(0, -1));
  const res = baseResponse({ docIndex: truncated });
  assert.throws(
    () => decodeProjection(res),
    (err: Error) => {
      assert.match(err.message, /expected 4 docIndex bytes, got 3/);
      return true;
    },
  );
});

check('decodes positions into a correctly-sized Float32Array', () => {
  const res = baseResponse({});
  const decoded = decodeProjection(res);
  assert.equal(decoded.positions.length, 6);
  assert.equal(decoded.positions[3], 1);
});

check('resolves per-instance color from the document palette by docIndex', () => {
  const res = baseResponse({});
  const decoded = decodeProjection(res);
  // point 0 → document 0 (red, linear-space != 1.0 exactly but should be > 0), point 1 →
  // document 1 (green channel dominant).
  assert.ok(decoded.colors[0] > decoded.colors[1]); // point 0 is red-dominant
  assert.ok(decoded.colors[4] > decoded.colors[3]); // point 1 (index 3..5) is green-dominant
});

check('passes bounds and pointIds through unchanged', () => {
  const res = baseResponse({});
  const decoded = decodeProjection(res);
  assert.deepEqual(decoded.bounds, { min: [0, 0, 0], max: [1, 1, 1] });
  assert.deepEqual(decoded.pointIds, ['p1', 'p2']);
});

if (failures > 0) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
} else {
  console.log('\nall passed');
}
