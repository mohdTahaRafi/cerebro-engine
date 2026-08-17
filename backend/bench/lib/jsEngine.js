// js-scalar (phase 6 §3.1) — pure JavaScript dot-product loop plus the same top-K
// selection the C++ engine performs, so the two are timing equivalent work. The legacy
// benchmark-simd.js only timed the dot-product loop and never selected a top-K at all,
// which understated real js-scalar cost relative to cpp-avx2's SearchVectors (which
// always includes top-K extraction) — fixed here by giving js-scalar the same job.
import { WARMUP_ITERATIONS, TRIALS, summarize } from './stats.js';

function searchJs(query, dataset, dim, k) {
  const numVectors = dataset.length / dim;
  // Small-k selection via insertion into a bounded sorted array (O(n·k)) — k is fixed at
  // 10 for this benchmark, so this is negligible next to the O(n·dim) dot-product cost,
  // and mirrors the shape of C++'s min-heap Top-K rather than skipping selection entirely.
  const top = [];   // ascending by score; top[0] is the current worst kept
  for (let i = 0; i < numVectors; i += 1) {
    const offset = i * dim;
    let sum = 0;
    for (let j = 0; j < dim; j += 1) sum += query[j] * dataset[offset + j];

    if (top.length < k) {
      top.push({ index: i, score: sum });
      top.sort((a, b) => a.score - b.score);
    } else if (sum > top[0].score) {
      top[0] = { index: i, score: sum };
      top.sort((a, b) => a.score - b.score);
    }
  }
  return top.reverse();   // descending, matching CerebroEngine::SearchVectors's output order
}

export function runJsScalar(query, dataset, dim, k) {
  for (let i = 0; i < WARMUP_ITERATIONS; i += 1) searchJs(query, dataset, dim, k);

  const samples = [];
  let lastTop = null;
  for (let i = 0; i < TRIALS; i += 1) {
    const t0 = performance.now();
    lastTop = searchJs(query, dataset, dim, k);
    samples.push(performance.now() - t0);
  }

  return { ...summarize(samples), top: lastTop };
}
