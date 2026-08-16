// Stage timing for the search pipeline (phase 3 §7.1). Every stage is measured with real
// elapsed time — the legacy pipeline reported a `cacheWaitMs: 0` for a cache that did not
// exist; nothing here reports a number it did not measure. A mark that was never taken
// reports `null`, not `0` — a zero would be indistinguishable from an instantaneous stage
// (e.g. a skipped rerank) in the console.
export function createTimer() {
  const marks = { start: performance.now() };
  return {
    mark: (name) => { marks[name] = performance.now(); },
    report: (extra = {}) => ({
      embedMs: marks.embedEnd != null ? round(marks.embedEnd - marks.embedStart) : null,
      retrieveMs: marks.retrieveEnd != null ? round(marks.retrieveEnd - marks.retrieveStart) : null,
      rerankMs: marks.rerankEnd != null ? round(marks.rerankEnd - marks.rerankStart) : null,
      totalMs: round(performance.now() - marks.start),
      ...extra,
    }),
  };
}

function round(ms) {
  return Math.round(ms * 100) / 100;
}
