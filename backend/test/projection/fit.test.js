// Standalone verification script (repo convention — see AGENTS.md, no unified test
// framework). Exercises `runFit` (src/projection/fit.js), the pure computational half of
// the UMAP fit — no Mongo, no Qdrant, no BullMQ, entirely synthetic in-memory vectors.
// Covers task 7.11 (fixed seed, minimum-points guard) and 7.12 (downsampling).
import assert from 'assert';
import { runFit, deterministicSample } from '../../src/projection/fit.js';

function syntheticPoints(n, dims = 6) {
  // Deterministic pseudo-random data (not Math.random()) so a failing assertion is
  // reproducible across runs — a real bug should fail every time, not intermittently.
  let seed = 1;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed % 1000) / 1000;
  };
  const points = [];
  for (let i = 0; i < n; i++) {
    const vector = Array.from({ length: dims }, () => rand());
    // 3 documents' worth of ids, spread across the set — pack.js's documentId grouping
    // and downsampling's "represents the whole corpus" claim both need more than one
    // document present to be meaningful to assert against.
    const documentId = `doc-${i % 3}`;
    points.push({ id: `pt-${String(i).padStart(4, '0')}`, vector, payload: { documentId } });
  }
  return points;
}

// ── Minimum-points guard (task 7.11) ────────────────────────────────────────────────
{
  const points = syntheticPoints(5);   // well below the default nNeighbors(15) + 1 = 16
  const result = await runFit(points);
  assert.strictEqual(result.status, 'failed', 'fewer than nNeighbors+1 points must fail, not fit');
  assert.match(result.reason, /at least 16 chunks/, 'the failure reason must name the real threshold');
  assert.match(result.reason, /this context has 5/, 'the failure reason must name the real point count');
  console.log('[fit.test] PASS — minimum-points guard rejects a 5-point context naming the 16-chunk threshold');
}

// ── Determinism (task 7.11): two fits of unchanged data produce identical coordinates ─
{
  const points = syntheticPoints(20);
  const params = { nNeighbors: 5, minDist: 0.1, spread: 1.0, nComponents: 3 };
  const a = await runFit(points, { params, seed: 42 });
  const b = await runFit(points, { params, seed: 42 });
  assert.strictEqual(a.status, 'fresh', 'a 20-point fit with nNeighbors=5 must succeed');
  assert.ok(Buffer.compare(a.positions, b.positions) === 0, 'two fits of identical data with the same seed must produce byte-identical positions');
  console.log('[fit.test] PASS — two fits of unchanged data with a fixed seed produce identical coordinates');
}

// A different seed must NOT be guaranteed to match — sanity check that the equality
// above is actually testing the seed, not an accidental degenerate fit (e.g. everything
// collapsing to the origin regardless of input).
{
  const points = syntheticPoints(20);
  const params = { nNeighbors: 5, minDist: 0.1, spread: 1.0, nComponents: 3 };
  const a = await runFit(points, { params, seed: 42 });
  const c = await runFit(points, { params, seed: 1337 });
  assert.ok(Buffer.compare(a.positions, c.positions) !== 0, 'two different seeds should not coincidentally produce identical coordinates');
  console.log('[fit.test] PASS — a different seed produces different coordinates (the determinism check is non-degenerate)');
}

// ── Downsampling (task 7.12) ────────────────────────────────────────────────────────
{
  const points = syntheticPoints(50);
  const params = { nNeighbors: 5, minDist: 0.1, spread: 1.0, nComponents: 3 };
  const result = await runFit(points, { params, maxNodes: 10, seed: 42 });
  assert.strictEqual(result.nodeCount, 10, 'downsampling must cap nodeCount at maxNodes');
  assert.strictEqual(result.fittedChunkCount, 50, 'fittedChunkCount must report the TRUE corpus size, not the sampled size');
  assert.strictEqual(result.positions.byteLength, 10 * 3 * 4, 'positions buffer must be exactly nodeCount*3 float32s');
  assert.strictEqual(result.docIndex.byteLength, 10 * 2, 'docIndex buffer must be exactly nodeCount uint16s');
  console.log('[fit.test] PASS — a 50-point corpus downsamples to 10 nodes while reporting the true 50-chunk count');
}

// ── deterministicSample: stride sampling spans the whole sorted id range ───────────
{
  const points = syntheticPoints(100);
  const sample = deterministicSample(points, 10);
  assert.strictEqual(sample.length, 10, 'the sample must have exactly maxNodes points');
  const ids = sample.map((p) => p.id).sort();
  assert.strictEqual(ids[0], 'pt-0000', 'a stride sample must include the first id, not skip straight past it');
  assert.notStrictEqual(ids[ids.length - 1], 'pt-0009', 'a stride sample must NOT be a plain [0,maxNodes) prefix slice');
  console.log('[fit.test] PASS — deterministicSample spans the full id range rather than truncating to a prefix');
}

console.log('[fit.test] PASS — all assertions');
