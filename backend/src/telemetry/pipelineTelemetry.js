// PipelineTelemetry — the canonical wire contract for both /api/search's response and
// /api/ask's SSE `telemetry` event (phase 6 §2.1, task 6.1). Every field the console reads
// is normalized here, once, so neither call site can silently omit a key: a stage that was
// skipped or never attempted comes back `null`, never `0` and never simply absent from the
// JSON — an absent key is indistinguishable from a client bug that forgot to read it, an
// explicit `null` is not (§2.1's own framing).
//
// Each stage reports BOTH a duration (`<stage>Ms`) and a start offset (`<stage>StartMs`,
// milliseconds from the request's own origin). The offsets are what let the console draw
// §2.2's waterfall against real elapsed time rather than a stacked sum — see
// retrieval/timer.js's header for why durations alone cannot satisfy that requirement.
//
// This is a pure function over whatever raw timing/count fields the caller accumulated
// (retrieval/search.js's timer.report(), the graph's RagState.timings bag) plus the request
// origin — it does no timing itself.

// Every stage in pipeline order. Each entry maps the public field prefix to the raw
// absolute-instant field the producers emit (`*StartAt`, a bare performance.now() value).
const STAGES = [
  'condense', 'embed', 'sparse', 'colpali',
  'chunkRetrieve', 'pageRetrieve', 'merge', 'rerank', 'generate',
];

export function buildTelemetry(raw = {}, originMs) {
  const telemetry = {};

  for (const stage of STAGES) {
    const durationMs = raw[`${stage}Ms`] ?? null;
    const startAt = raw[`${stage}StartAt`] ?? null;
    telemetry[`${stage}Ms`] = durationMs;
    // A start offset is only meaningful when the caller supplied an origin AND the stage
    // actually ran. Without an origin (a caller that never measured one) the honest report
    // is `null` — not `0`, which would pin every bar to the left edge of the waterfall and
    // silently manufacture the stacked-sum layout §2.2 exists to prevent.
    telemetry[`${stage}StartMs`] = (startAt != null && originMs != null)
      ? round(startAt - originMs)
      : null;
  }

  // A duration inside the generate stage, not an offset from the request origin — the
  // console positions its marker at generateStartMs + firstTokenMs.
  telemetry.firstTokenMs = raw.firstTokenMs ?? null;

  // Unlike the per-stage fields above, totalMs is never null — every response (even an
  // empty-corpus early exit) took *some* real wall-clock time, and the caller is required
  // to pass it explicitly (see search.js/ask.js) rather than defaulting to 0, which would
  // silently mask a caller that forgot to compute it.
  telemetry.totalMs = raw.totalMs;

  telemetry.candidatesRetrieved = raw.candidatesRetrieved ?? 0;
  telemetry.candidatesAfterMerge = raw.candidatesAfterMerge ?? 0;
  telemetry.candidatesAfterFloor = raw.candidatesAfterFloor ?? 0;
  telemetry.rerankSkipped = raw.rerankSkipped ?? false;
  telemetry.warnings = raw.warnings ?? [];

  return telemetry;
}

function round(ms) {
  return Math.round(ms * 100) / 100;
}
