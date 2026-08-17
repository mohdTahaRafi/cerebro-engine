// Stage timing for the search pipeline (phase 3 §7.1, extended phase 6 §2.1). Every stage
// is measured with real elapsed time — the legacy pipeline reported a `cacheWaitMs: 0` for
// a cache that did not exist; nothing here reports a number it did not measure. A mark that
// was never taken reports `null`, not `0` — a zero would be indistinguishable from an
// instantaneous stage (e.g. a skipped rerank) in the console.
//
// Field names below match PipelineTelemetry (phase 6 §2.1) exactly, so both call sites —
// retrieval/search.js's /api/search response and the graph nodes that feed /api/ask's SSE
// `telemetry` event — report the same stage vocabulary through telemetry/pipelineTelemetry.js's
// buildTelemetry(), the single place that fills in the fields a given call site didn't
// produce (condenseMs, firstTokenMs, generateMs — retrieval never touches those).
//
// Amended during Phase 6 implementation (§2.2): each stage reports its absolute start
// instant (`*StartAt`, a raw performance.now() value) alongside its duration. §2.2 requires
// the console's waterfall x-axis be "real elapsed time from request start, not a stacked
// sum" — durations alone cannot satisfy that, because reconstructing where each bar *begins*
// from durations alone is exactly the stacked sum §2.2 rules out. buildTelemetry() converts
// these absolute instants into offsets from the request's own origin and drops the raw
// values, so they never reach the wire. All timing lives in one Node process, so
// performance.now() values taken in different modules (this timer, condense.js, rerank.js,
// generate.js) are directly comparable against one shared origin.
export function createTimer() {
  const marks = { start: performance.now() };
  return {
    mark: (name) => { marks[name] = performance.now(); },
    // Absolute instant this timer was created, for use as a request origin by whichever
    // caller owns the whole request (search.js's runSearch). Not a duration — never send
    // this to a client.
    startedAt: () => marks.start,
    // Total time since this timer was created. Only meaningful as an end-to-end total when
    // the timer's lifetime spans the whole request (search.js's runSearch) — a timer scoped
    // to one sub-stage (retrieveCandidates, reused by the graph's retrieveNode) reports only
    // that sub-stage's own elapsed time here, so callers who don't own the whole request
    // must not forward this field upward under the public `totalMs` name unchanged.
    elapsedMs: () => round(performance.now() - marks.start),
    report: (extra = {}) => ({
      embedMs: diff('embedStart', 'embedEnd'),
      embedStartAt: startOf('embedStart', 'embedEnd'),
      // Local BM25 encoding, run concurrently with the dense Cohere embed call (both
      // kicked off together in retrieval/search.js's retrieveStage) — typically 2-4ms,
      // its own mark pair rather than folded into embedMs so the console can show it as
      // the near-instant local computation it actually is.
      sparseMs: diff('sparseStart', 'sparseEnd'),
      sparseStartAt: startOf('sparseStart', 'sparseEnd'),
      // Phase 4: the ColPali branches run concurrently with embedMs/retrieveMs above, not
      // nested inside them, so they carry their own start/end pair rather than reusing
      // the text ones. Marks are only taken when the branch actually attempted a real
      // call — see search.js's colpaliVec ? ... : ... guard around pageRetrieve.
      colpaliMs: diff('colpaliStart', 'colpaliEnd'),
      colpaliStartAt: startOf('colpaliStart', 'colpaliEnd'),
      chunkRetrieveMs: diff('retrieveStart', 'retrieveEnd'),
      chunkRetrieveStartAt: startOf('retrieveStart', 'retrieveEnd'),
      pageRetrieveMs: diff('pageRetrieveStart', 'pageRetrieveEnd'),
      pageRetrieveStartAt: startOf('pageRetrieveStart', 'pageRetrieveEnd'),
      // Phase 6 §2.1: mergeByProvenance itself is a synchronous Map/loop over ~50-60
      // candidates — sub-millisecond in practice — but it gets its own mark pair rather
      // than being assumed free, since "assumed free" is exactly the kind of unmeasured
      // number this timer exists to avoid.
      mergeMs: diff('mergeStart', 'mergeEnd'),
      mergeStartAt: startOf('mergeStart', 'mergeEnd'),
      rerankMs: diff('rerankStart', 'rerankEnd'),
      rerankStartAt: startOf('rerankStart', 'rerankEnd'),
      ...extra,
    }),
  };

  function diff(startName, endName) {
    return marks[endName] != null ? round(marks[endName] - marks[startName]) : null;
  }

  // Keyed on the END mark, deliberately: several stages mark their start unconditionally
  // and their end only if the branch actually ran (search.js's pageRetrieve guard). A start
  // reported for a stage that never completed would place a bar on the timeline for work
  // that never happened — the same class of lie as reporting 0ms for a skipped stage.
  function startOf(startName, endName) {
    return marks[endName] != null ? marks[startName] : null;
  }
}

function round(ms) {
  return Math.round(ms * 100) / 100;
}
