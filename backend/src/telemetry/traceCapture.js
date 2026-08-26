// traceCapture — assembles the Trace document from one graph run's final state (phase 7
// §2.3). A pure function: no I/O, no Mongo call — persistTurn owns the write and the
// failure isolation around it.
export const MAX_TRACE_BYTES = 256 * 1024;
export const MAX_PREVIEW_CHARS = 1200;

export function buildTrace({ tenant, threadId, messageId, state, telemetry, runId, usage }) {
  const candidates = (state.allCandidates ?? []).map((c) => ({
    pointId: c.pointId, kind: c.kind, documentId: c.documentId, fileName: c.fileName,
    page: c.page ?? null, headingPath: c.headingPath ?? null,
    textPreview: c.text ? c.text.slice(0, MAX_PREVIEW_CHARS) : null,
    branch: c.branch ?? null, fusionRank: c.fusionRank ?? null,
    finalRank: c.finalRank ?? null, score: c.score ?? null,
    belowFloor: c.belowFloor === true,
    absorbedChunks: c.absorbedChunks ?? undefined,
  }));

  const doc = {
    userId: tenant.userId, contextId: tenant.contextId, threadId, messageId,
    query: state.query, condensedQuery: state.condensedQuery ?? null,
    telemetry, candidates, prompt: state.promptBlocks ?? [],
    tokens: {
      input: usage?.inputTokens ?? null, output: usage?.outputTokens ?? null,
      provider: usage?.provider ?? null, model: usage?.model ?? null,
    },
    runId: runId ?? null, refused: state.refused === true, truncated: false,
  };

  // Cap enforcement. Shed in order of least value: previews first (the full text is in
  // Qdrant), then prompt text bodies (the structure and token counts survive, which is
  // what the drawer's shape is built from). The document is never rejected outright —
  // a trace that exists and says it was truncated is worth far more than no trace.
  let size = Buffer.byteLength(JSON.stringify(doc));
  if (size > MAX_TRACE_BYTES) {
    for (const c of doc.candidates) c.textPreview = c.textPreview?.slice(0, 200) ?? null;
    doc.truncated = true;
    size = Buffer.byteLength(JSON.stringify(doc));
  }
  if (size > MAX_TRACE_BYTES) {
    for (const b of doc.prompt) {
      if (b.kind === 'text' && b.content.length > 2000) {
        b.content = `${b.content.slice(0, 2000)}\n…[truncated at the 256 KB trace cap]`;
      }
    }
  }
  return doc;
}
