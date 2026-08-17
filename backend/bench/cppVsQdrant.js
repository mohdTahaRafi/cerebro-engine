#!/usr/bin/env node
// bench/cppVsQdrant.js — the honest C++-vs-Qdrant benchmark (phase 6 §3, tasks 6.6-6.9).
//
// Four engines, same dataset, same query, at each swept corpus size:
//   js-scalar   pure JavaScript dot-product loop, JIT-warmed
//   cpp-scalar  the C++ addon with AVX2 dispatch forced off (CEREBRO_FORCE_SCALAR=1)
//   cpp-avx2    the C++ addon with runtime AVX2/FMA dispatch active
//   qdrant-hnsw production ANN query against a copy of the same vectors
//
// Isolating cpp-scalar is what makes the result honest (§3.1): a single JS-vs-AVX2 number
// conflates two independent effects — leaving the JS runtime, and using SIMD — and reports
// their product as if it were the SIMD win. Three JS/C++ engines decompose it: *language*
// buys one factor (js-scalar -> cpp-scalar), *SIMD* buys another (cpp-scalar -> cpp-avx2).
//
// cpp-scalar and cpp-avx2 each run in their own child process (bench/lib/cppChild.js) —
// see that file's header comment for why they cannot share a process.
import 'dotenv/config';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { mulberry32, randomFloat32Array, SEED } from './lib/prng.js';
import { runJsScalar } from './lib/jsEngine.js';
import { runQdrant } from './lib/qdrantEngine.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIM = 1024;          // embed-multilingual-v3.0 output width — the real serving dimension (config/index.js)
const K = 10;
const RESULTS_DIR = path.join(__dirname, 'results');

function parseArgs(argv) {
  const args = { sizes: [1_000, 10_000, 100_000, 1_000_000], skipQdrant: false, saveBaseline: false };
  for (const arg of argv) {
    if (arg.startsWith('--sizes=')) args.sizes = arg.slice(8).split(',').map(Number);
    else if (arg === '--skip-qdrant') args.skipQdrant = true;
    else if (arg === '--save-baseline') args.saveBaseline = true;
  }
  return args;
}

function runCppChild(forceScalar, size, seed) {
  const stdout = execFileSync(
    'node',
    [path.join(__dirname, 'lib/cppChild.js'), String(size), String(DIM), String(K), String(seed)],
    {
      env: { ...process.env, ...(forceScalar ? { CEREBRO_FORCE_SCALAR: '1' } : { CEREBRO_FORCE_SCALAR: '' }) },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  return JSON.parse(stdout.toString());
}

function speedup(baselineMs, comparedMs) {
  return Math.round((baselineMs / comparedMs) * 100) / 100;
}

async function benchOneSize(size, { skipQdrant }) {
  console.log(`\n=== corpus size: ${size.toLocaleString()} vectors × ${DIM} dims ===`);
  const seed = SEED ^ size;

  // Ordering here is a memory constraint, not a stylistic choice. At 1M x 1024 dims one
  // dataset copy is ~4.1 GB, so the parent's copy and a child's regenerated copy must never
  // be live at the same time. Everything that needs the parent's buffer (js-scalar, the
  // Qdrant upload) runs FIRST, the buffer is then released, and only then are the C++
  // children spawned — each of which regenerates, measures, and exits before the next
  // starts. Peak RSS is therefore one dataset, not two or three.
  const rng = mulberry32(seed);
  const query = randomFloat32Array(DIM, rng);
  let dataset = randomFloat32Array(size * DIM, rng);

  try {
    console.log('  js-scalar...');
    const jsScalar = runJsScalar(query, dataset, DIM, K);
    console.log(`    median ${jsScalar.medianMs}ms (min ${jsScalar.minMs}, max ${jsScalar.maxMs})`);

    // Qdrant's timed queries do not depend on the exact top-K, only the recall computation
    // does — so the upload and query run here, while the parent still holds the dataset,
    // and recall is computed further down once cpp-avx2 has produced ground truth.
    let qdrant = null;
    if (!skipQdrant) {
      console.log('  qdrant-hnsw (uploading corpus)...');
      qdrant = await runQdrant({
        url: process.env.QDRANT_URL || 'http://localhost:6333',
        apiKey: process.env.QDRANT_API_KEY || undefined,
        collectionName: `cerebro_bench_${size}`,
        dim: DIM,
        dataset,
        query,
        k: K,
        onUploadProgress: (done, total) => {
          if (done === total || done % (UPLOAD_LOG_EVERY(total)) === 0) {
            process.stdout.write(`\r    uploaded ${done.toLocaleString()}/${total.toLocaleString()}`);
          }
        },
      });
      process.stdout.write('\n');
      console.log(`    median ${qdrant.medianMs}ms (min ${qdrant.minMs}, max ${qdrant.maxMs})`);
    }

    // Release before spawning children. `global.gc()` is only available under --expose-gc;
    // dropping the reference is what actually matters, and the synchronous execFileSync
    // below gives V8 ample opportunity to reclaim a multi-GB external ArrayBuffer.
    dataset = null;
    global.gc?.();

    console.log('  cpp-scalar (CEREBRO_FORCE_SCALAR=1)...');
    const cppScalar = runCppChild(true, size, seed);
    console.log(`    median ${cppScalar.medianMs}ms (min ${cppScalar.minMs}, max ${cppScalar.maxMs})`);

    console.log('  cpp-avx2...');
    const cppAvx2 = runCppChild(false, size, seed);
    console.log(`    median ${cppAvx2.medianMs}ms (min ${cppAvx2.minMs}, max ${cppAvx2.maxMs})`);

    // Cross-process determinism guard. The children regenerate the dataset from `seed`
    // rather than receiving the parent's bytes, which is what keeps peak memory to one
    // copy — but it means a divergence in generation order between prng.js's two callers
    // would have every engine silently scoring a DIFFERENT corpus, making the comparison
    // meaningless while still producing plausible-looking numbers. All three engines are
    // exact brute-force scans, so they must agree on the exact top-K; if they disagree, the
    // regeneration is broken and the run is aborted rather than reported.
    assertSameTopK('js-scalar (parent)', jsScalar.top, 'cpp-avx2 (child)', cppAvx2.top);
    assertSameTopK('cpp-scalar (child)', cppScalar.top, 'cpp-avx2 (child)', cppAvx2.top);

    // cpp-avx2 is an exact brute-force scan (same as cpp-scalar and js-scalar — SIMD
    // changes throughput, not which vectors are the true top-K), so its result is ground
    // truth for qdrant-hnsw's Recall@10 by definition, per §3.3.
    if (qdrant) {
      const exact = new Set(cppAvx2.top.slice(0, K).map((r) => r.index));
      const ann = new Set(qdrant.top.map((r) => r.index));
      qdrant.recallAtK = Math.round(([...exact].filter((i) => ann.has(i)).length / exact.size) * 1000) / 1000;
      console.log(`    qdrant recall@${K}: ${qdrant.recallAtK}`);
    }

    return {
      size,
      engines: {
        'js-scalar': pick(jsScalar),
        'cpp-scalar': pick(cppScalar),
        'cpp-avx2': pick(cppAvx2),
        ...(qdrant ? { 'qdrant-hnsw': { ...pick(qdrant), recallAtK: qdrant.recallAtK } } : {}),
      },
      speedup: {
        // Decomposed per §3.1: language factor (leaving JS) × SIMD factor (AVX2 dispatch)
        // = the combined factor a single js-vs-avx2 number would have conflated.
        languageFactor_jsScalarToCppScalar: speedup(jsScalar.medianMs, cppScalar.medianMs),
        simdFactor_cppScalarToCppAvx2: speedup(cppScalar.medianMs, cppAvx2.medianMs),
        combinedFactor_jsScalarToCppAvx2: speedup(jsScalar.medianMs, cppAvx2.medianMs),
        ...(qdrant ? { cppAvx2ToQdrant: speedup(cppAvx2.medianMs, qdrant.medianMs) } : {}),
      },
    };
  } finally {
    // No temp files to clean up any more — the dataset is regenerated from the seed in each
    // child rather than marshalled through disk (see lib/cppChild.js). Releasing the
    // parent's reference here too covers the early-throw path, where the `dataset = null`
    // above was never reached.
    dataset = null;
  }
}

function UPLOAD_LOG_EVERY(total) {
  return Math.max(1, Math.floor(total / 10));
}

// Compares index order only, not scores: all three engines compute the same dot products,
// but js-scalar accumulates in a different order than the AVX2 kernel's 8-lane horizontal
// reduction, so their float32 sums differ in the last bits or two. Identical *ranking* is
// the meaningful invariant; bit-identical scores are not, and asserting on them would fail
// for a reason that has nothing to do with the datasets matching.
function assertSameTopK(nameA, topA, nameB, topB) {
  const a = topA.map((r) => r.index).join(',');
  const b = topB.map((r) => r.index).join(',');
  if (a !== b) {
    throw new Error(
      `Determinism check failed: ${nameA} and ${nameB} ranked different vectors, so they did not score the same dataset.\n` +
      `  ${nameA}: [${a}]\n  ${nameB}: [${b}]\n` +
      'This means the seeded regeneration in bench/lib/prng.js diverged between parent and child; the benchmark numbers are not comparable.',
    );
  }
}

function pick(r) {
  return { medianMs: r.medianMs, minMs: r.minMs, maxMs: r.maxMs, trials: r.trials };
}

function toMarkdown(results) {
  const lines = [];
  lines.push('# C++ vs Qdrant benchmark results');
  lines.push('');
  lines.push(`Generated ${new Date().toISOString()} — dim=${DIM}, k=${K}, trials=${results[0]?.engines['js-scalar']?.trials ?? '?'}`);
  lines.push('');
  lines.push('| Corpus size | js-scalar (ms) | cpp-scalar (ms) | cpp-avx2 (ms) | qdrant-hnsw (ms) | Recall@10 | language factor | SIMD factor | combined factor |');
  lines.push('|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of results) {
    const e = r.engines;
    const q = e['qdrant-hnsw'];
    lines.push(
      `| ${r.size.toLocaleString()} | ${e['js-scalar'].medianMs} | ${e['cpp-scalar'].medianMs} | ${e['cpp-avx2'].medianMs} | ` +
      `${q ? q.medianMs : '—'} | ${q ? q.recallAtK : '—'} | ${r.speedup.languageFactor_jsScalarToCppScalar}x | ` +
      `${r.speedup.simdFactor_cppScalarToCppAvx2}x | ${r.speedup.combinedFactor_jsScalarToCppAvx2}x |`,
    );
  }
  lines.push('');
  const crossover = results.find((r, i) => {
    const q = r.engines['qdrant-hnsw'];
    const prevQ = results[i - 1]?.engines['qdrant-hnsw'];
    return q && r.engines['cpp-avx2'].medianMs > q.medianMs && (!prevQ || results[i - 1].engines['cpp-avx2'].medianMs <= prevQ.medianMs);
  });
  lines.push(crossover
    ? `**Crossover**: qdrant-hnsw overtakes cpp-avx2 on latency at or before ${crossover.size.toLocaleString()} vectors.`
    : '**Crossover**: not observed within the swept sizes (either cpp-avx2 led throughout, or qdrant-hnsw was skipped).');
  return lines.join('\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`Sweeping corpus sizes: ${args.sizes.map((s) => s.toLocaleString()).join(', ')}`);
  if (args.skipQdrant) console.log('(--skip-qdrant: qdrant-hnsw will be omitted from this run)');

  const results = [];
  for (const size of args.sizes) {
    // eslint-disable-next-line no-await-in-loop
    results.push(await benchOneSize(size, args));
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const jsonPath = path.join(RESULTS_DIR, 'latest.json');
  const mdPath = path.join(RESULTS_DIR, 'latest.md');
  fs.writeFileSync(jsonPath, JSON.stringify({ dim: DIM, k: K, generatedAt: new Date().toISOString(), results }, null, 2));
  fs.writeFileSync(mdPath, toMarkdown(results));
  if (args.saveBaseline) fs.copyFileSync(jsonPath, path.join(RESULTS_DIR, 'baseline.json'));

  console.log(`\nResults written to ${path.relative(process.cwd(), jsonPath)} and ${path.relative(process.cwd(), mdPath)}`);
  console.log('\n' + toMarkdown(results));

  const baselinePath = path.join(RESULTS_DIR, 'baseline.json');
  if (fs.existsSync(baselinePath) && !args.saveBaseline) {
    compareToBaseline(results, JSON.parse(fs.readFileSync(baselinePath, 'utf8')).results);
  }
}

// Task 6.6's acceptance criterion is reproducibility ("consecutive runs vary < 10%"), not
// a pass/fail regression gate — this prints the delta for a human to judge, it does not
// exit non-zero, since a real hardware/load difference between CI runs is expected, not a bug.
function compareToBaseline(current, baseline) {
  console.log('\n--- vs baseline.json ---');
  for (const r of current) {
    const base = baseline.find((b) => b.size === r.size);
    if (!base) continue;
    for (const engine of Object.keys(r.engines)) {
      const cur = r.engines[engine]?.medianMs;
      const prev = base.engines[engine]?.medianMs;
      if (cur == null || prev == null) continue;
      const deltaPct = Math.round(((cur - prev) / prev) * 1000) / 10;
      console.log(`  ${r.size.toLocaleString()} / ${engine}: ${prev}ms -> ${cur}ms (${deltaPct > 0 ? '+' : ''}${deltaPct}%)`);
    }
  }
}

main().catch((err) => {
  console.error('\nBenchmark failed:', err);
  process.exitCode = 1;
});
