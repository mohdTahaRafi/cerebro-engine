// Trial aggregation (phase 6 §3.2). A single run varies 15-25% between invocations from
// scheduler noise and thermal state — TRIALS repeated runs, median reported, is the fix.
export const WARMUP_ITERATIONS = 20;   // lets V8's JIT reach steady state before js-scalar is timed
export const TRIALS = 11;              // odd, so the median is a real sample, not an interpolation

export function median(samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export function summarize(samples) {
  return {
    medianMs: round(median(samples)),
    minMs: round(Math.min(...samples)),
    maxMs: round(Math.max(...samples)),
    trials: samples.length,
  };
}

function round(ms) {
  return Math.round(ms * 1000) / 1000;
}
