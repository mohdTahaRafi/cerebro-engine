// p95/p50 over a sample array. bench/lib/stats.js already has median() for the v1
// cppVsQdrant harness's small-trial-count use (11 trials, "the median IS a sample");
// bench/v2 measures latency distributions over dozens-to-hundreds of real HTTP/gRPC
// round trips, where p95 is the number architecture §8's budgets are actually stated in
// — a separate, minimal helper rather than overloading stats.js's trial-count assumptions.
export function percentile(samples, p) {
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export function summarizeLatencies(samplesMs) {
  return {
    count: samplesMs.length,
    p50Ms: round(percentile(samplesMs, 50)),
    p95Ms: round(percentile(samplesMs, 95)),
    minMs: round(Math.min(...samplesMs)),
    maxMs: round(Math.max(...samplesMs)),
  };
}

function round(ms) {
  return Math.round(ms * 1000) / 1000;
}
