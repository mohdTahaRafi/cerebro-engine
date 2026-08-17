// Runs one C++ engine's trial suite in its own process (phase 6 §3.1). This MUST be a
// separate process per engine, not a toggle inside one long-lived process: VectorMath.cpp's
// ScalarForced() reads CEREBRO_FORCE_SCALAR exactly once and caches the result forever
// (getenv() is not free to call per dot product, and a native addon is loaded once per
// process) — so cpp-scalar and cpp-avx2 cannot share a process without one of them
// silently reading the other's cached dispatch decision.
//
// The dataset is REGENERATED here from the same seed the parent used, rather than passed
// across the process boundary as a file. At 1M x 1024 dims the dataset is ~4.1 GB, so the
// file round-trip cost 4.1 GB of disk writes, 4.1 GB of reads, and — because the parent
// still held its own copy while the child read one — ~8.2 GB of concurrent RSS. mulberry32
// is deterministic and the seed derivation is identical on both sides (prng.js), so the
// child scores byte-identical vectors while only one copy ever exists at a time.
//
// Invocation: node cppChild.js <size> <dim> <k> <seed>
// stdout: one JSON line — { medianMs, minMs, maxMs, trials, top: [{index, score}, ...] }
import { createRequire } from 'module';
import { mulberry32, randomFloat32Array } from './prng.js';
import { WARMUP_ITERATIONS, TRIALS, summarize } from './stats.js';

const require = createRequire(import.meta.url);
const { CerebroEngine } = require('../../build/Release/cerebro_core.node');

const [, , sizeArg, dimArg, kArg, seedArg] = process.argv;
const size = Number(sizeArg);
const dim = Number(dimArg);
const k = Number(kArg);
const seed = Number(seedArg);

// Identical generation order to the parent's benchOneSize: query first, then dataset, off
// one rng stream. Reordering these would desynchronize the streams and score a different
// dataset — the whole point of seeding is defeated if the draw order differs.
const rng = mulberry32(seed);
const query = randomFloat32Array(dim, rng);
const dataset = randomFloat32Array(size * dim, rng);

const engine = new CerebroEngine();

for (let i = 0; i < WARMUP_ITERATIONS; i += 1) engine.SearchVectors(query, dataset, k);

const samples = [];
let lastTop = null;
for (let i = 0; i < TRIALS; i += 1) {
  const t0 = performance.now();
  const top = engine.SearchVectors(query, dataset, k);
  samples.push(performance.now() - t0);
  lastTop = top;
}

process.stdout.write(JSON.stringify({
  ...summarize(samples),
  top: lastTop.map((r) => ({ index: r.index, score: r.score })),
}));
