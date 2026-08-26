// recordPipelineError — the single writer for models/PipelineError.js (phase 7 §5.2,
// task 7.20). Every subsystem that used to create a row inline (auth.js, password.js,
// cascade.js) now calls this instead, and every subsystem phase 7 adds (ingestDocument.js's
// catch, the projection job, the trace-capture catch) is written through it from the
// start — one place decides the document shape, so a field added later (or a future
// kind) does not need to be kept in sync across N call sites.
import { PipelineError } from '../models/PipelineError.js';

// `ctx` carries only what the caller actually knows — never guessed or defaulted to a
// wrong tenant. All optional: a queue-level failure (BullMQ connection lost before any
// job data was read) may have no ids to attach at all, and that is a legitimate call.
export async function recordPipelineError(kind, err, ctx = {}) {
  const { userId = null, contextId = null, documentId = null, fileName = null, retryable = false } = ctx;
  try {
    await PipelineError.create({
      kind,
      message: err?.message ?? String(err),
      stack: err?.stack ?? null,
      retryable,
      userId,
      contextId,
      documentId,
      fileName,
    });
  } catch (writeErr) {
    // A pipeline_errors write failing must never throw into the caller's own error path —
    // that would turn "we couldn't record a failure" into "we crashed while trying to
    // record a failure," which is strictly worse. Logged, not swallowed silently.
    console.error(`[pipelineError] failed to record a '${kind}' error:`, writeErr.message);
  }
}
