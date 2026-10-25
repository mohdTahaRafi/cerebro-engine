// Standalone verification script (repo convention — see AGENTS.md). Exercises
// `projectQuery` (src/projection/transform.js) against a fixture projection and a
// fixture `nearestDense`, with no live Qdrant stack — see that function's own
// `nearestDense` injection point. Covers task 7.13: centroid placement inside the
// convex hull of the top neighbors, and the stale-projection (no usable neighbor) case.
import assert from 'assert';
import { Binary } from 'bson';
import { projectQuery } from '../../src/projection/transform.js';

// A tiny fixture projection: 4 points at known 3D coordinates.
const pointIds = ['a', 'b', 'c', 'd'];
const coords = {
  a: [0, 0, 0],
  b: [1, 0, 0],
  c: [0, 1, 0],
  d: [10, 10, 10],   // deliberately far away — must NOT be pulled toward by an outlier
};
const positions = new Float32Array(pointIds.length * 3);
pointIds.forEach((id, i) => {
  const [x, y, z] = coords[id];
  positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
});
const projection = { pointIds, positions };

const tenant = { userId: 'u1', contextId: 'c1' };

// ── Centroid placement (task 7.13) ──────────────────────────────────────────────────
{
  // Fixture nearestDense: the query's top-3 neighbors are a, b, c (NOT d) — a realistic
  // ANN result where the query is near the origin cluster and far from the outlier.
  const fixtureHits = [
    { pointId: 'a', score: 0.95 },
    { pointId: 'b', score: 0.80 },
    { pointId: 'c', score: 0.75 },
  ];
  const nearestDense = async () => fixtureHits;

  const result = await projectQuery(tenant, [0, 0, 0], projection, { nearestDense });
  assert.strictEqual(result.placed, true, 'a query with usable neighbors must place a beacon');
  assert.strictEqual(result.neighbors.length, 3, 'every usable neighbor must be reported');

  // Convex-hull containment (a, b, c are all in the z=0 plane with x,y in [0,1]): the
  // beacon's centroid must lie within their bounding box, and — the specific claim this
  // test exists to catch a regression in — must NOT be dragged toward the far outlier d,
  // which was never even offered to the softmax because it wasn't one of the top-3 hits.
  const [bx, by, bz] = result.beacon;
  const xs = ['a', 'b', 'c'].map((id) => coords[id][0]);
  const ys = ['a', 'b', 'c'].map((id) => coords[id][1]);
  const zs = ['a', 'b', 'c'].map((id) => coords[id][2]);
  assert.ok(bx >= Math.min(...xs) && bx <= Math.max(...xs), 'beacon x must lie within the top-3 neighbors\' bounding box');
  assert.ok(by >= Math.min(...ys) && by <= Math.max(...ys), 'beacon y must lie within the top-3 neighbors\' bounding box');
  assert.ok(bz >= Math.min(...zs) && bz <= Math.max(...zs), 'beacon z must lie within the top-3 neighbors\' bounding box');
  assert.ok(Math.hypot(bx - 10, by - 10, bz - 10) > 5, 'the beacon must not drift toward a neighbor (d) that was never in the top-3 hits');
  console.log('[transform.test] PASS — the beacon lies inside the convex hull (bounding box) of its top-3 neighbors, unaffected by a far outlier');
}

// ── Softmax weighting favors the closer neighbor ────────────────────────────────────
{
  // Neighbor 'a' (score 0.99) should dominate over 'b' (score 0.10) — the beacon should
  // land much closer to a=(0,0,0) than to b=(1,0,0), not at their unweighted midpoint.
  const fixtureHits = [
    { pointId: 'a', score: 0.99 },
    { pointId: 'b', score: 0.10 },
  ];
  const nearestDense = async () => fixtureHits;
  const result = await projectQuery(tenant, [0, 0, 0], projection, { nearestDense });
  assert.ok(result.beacon[0] < 0.5, 'a dominant top neighbor must pull the beacon far closer to it than an unweighted midpoint (0.5) would');
  console.log('[transform.test] PASS — softmax weighting concentrates the beacon near the closer neighbor, not at the unweighted midpoint');
}

// ── Stale projection: every neighbor is outside the projection (task 7.13) ─────────
{
  const fixtureHits = [
    { pointId: 'not-in-projection-1', score: 0.9 },
    { pointId: 'not-in-projection-2', score: 0.8 },
  ];
  const nearestDense = async () => fixtureHits;
  const result = await projectQuery(tenant, [0, 0, 0], projection, { nearestDense });
  assert.strictEqual(result.placed, false, 'no usable neighbor must refuse to place a beacon');
  assert.strictEqual(result.reason, 'stale_projection', 'the refusal reason must be stale_projection');
  console.log('[transform.test] PASS — every neighbor outside the projection returns placed:false, reason:\'stale_projection\'');
}

// ── Stored-buffer shapes: the coordinate source is not always a Float32Array ─────────
// This is the regression the tests above did not catch. Every assertion so far hands
// `projectQuery` a Float32Array, which is what `packProjection` produced — but no
// production call site ever does. routes/vectors.js reads the row with mongoose
// `.lean()`, and a `Buffer`-typed path comes back through that as a BSON `Binary`, which
// has no numeric indexing at all: `positions[j]` is `undefined`, the weighted sum is
// `NaN`, and `JSON.stringify` writes it to the browser as `[null, null, null]`. Nothing
// throws anywhere along that path. So the beacon must be exercised against the shapes a
// row is ACTUALLY read back as, not only the shape it was written from.
{
  const fixtureHits = [
    { pointId: 'a', score: 0.95 },
    { pointId: 'b', score: 0.80 },
    { pointId: 'c', score: 0.75 },
  ];
  const nearestDense = async () => fixtureHits;
  const reference = await projectQuery(tenant, [0, 0, 0], projection, { nearestDense });

  const asBuffer = Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength);
  const shapes = {
    'Node Buffer (a hydrated mongoose doc)': asBuffer,
    'BSON Binary (a .lean() read — every production call site)': new Binary(asBuffer),
  };

  for (const [label, stored] of Object.entries(shapes)) {
    // eslint-disable-next-line no-await-in-loop
    const result = await projectQuery(tenant, [0, 0, 0], { pointIds, positions: stored }, { nearestDense });
    assert.strictEqual(result.placed, true, `${label}: the beacon must place`);
    for (const v of result.beacon) {
      assert.ok(Number.isFinite(v), `${label}: every beacon coordinate must be a finite number, got ${JSON.stringify(result.beacon)}`);
    }
    assert.deepStrictEqual(
      result.beacon.map((v) => v.toFixed(6)), reference.beacon.map((v) => v.toFixed(6)),
      `${label}: must place the beacon at the same coordinate a Float32Array does`,
    );
  }
  console.log('[transform.test] PASS — a projection stored as a Buffer or a BSON Binary places the beacon at the same finite coordinate as a Float32Array');
}

// ── A coordinate buffer shorter than the point-id list is refused, not guessed ───────
{
  const nearestDense = async () => [{ pointId: 'a', score: 0.95 }];
  const truncated = { pointIds, positions: positions.slice(0, 6) };   // 2 points' worth for 4 ids
  const result = await projectQuery(tenant, [0, 0, 0], truncated, { nearestDense });
  assert.strictEqual(result.placed, false, 'a truncated coordinate buffer must refuse to place');
  assert.strictEqual(result.reason, 'corrupt_projection', 'the refusal reason must be corrupt_projection');
  console.log('[transform.test] PASS — a coordinate buffer shorter than its own point-id list refuses with reason:\'corrupt_projection\'');
}

console.log('[transform.test] PASS — all assertions');
