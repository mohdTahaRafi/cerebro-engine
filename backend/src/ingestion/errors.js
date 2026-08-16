import { UnrecoverableError } from 'bullmq';

// Thrown by parser.js/verifyType.js call sites for conditions that will never resolve on
// retry — bundled here so ingestDocument.js has one place to classify against.
export class PermanentIngestError extends Error {
  constructor(message, code, cause) {
    super(message);
    this.name = 'PermanentIngestError';
    this.code = code;
    this.cause = cause;
  }
}

// Retrying a malformed document three times wastes ~2.5 minutes to reach the same
// conclusion (phase 2 §3.2). BullMQ's UnrecoverableError means "do not retry, fail now".
const PERMANENT_CODES = new Set([
  'UNSUPPORTED_FILE_TYPE',
  'CORRUPT_DOCUMENT',         // parser rejected the container — covers broken AND
                              // password/DRM-protected PDFs alike (see parser.js: LlamaParse
                              // does not expose which one on the thrown error, only in a
                              // console.warn side effect — verified live, both produce the
                              // identical generic "status: ERROR" message)
  'NO_EXTRACTABLE_CONTENT',   // parsed fine, produced zero text
]);

// Amended during Phase 2 implementation (phase 2 §4.2): a real LlamaParse job-failure is a
// thrown Error whose message is always the generic "Failed to parse the file: <jobId>,
// status: ERROR" — no distinguishing code reaches the caller. parser.js tags `.code =
// 'CORRUPT_DOCUMENT'` on this shape directly at the point it's thrown, which is the
// primary path PERMANENT_CODES above catches. This regex is a second line of defense only
// — in case some other call site someday throws the same LlamaParse-shaped message without
// going through parser.js's own tagging.
const LLAMAPARSE_JOB_FAILURE_RE = /status: ERROR$/;

export function classify(err) {
  if (err.code && PERMANENT_CODES.has(err.code)) {
    return new UnrecoverableError(err.message);
  }
  if (LLAMAPARSE_JOB_FAILURE_RE.test(err.message ?? '')) {
    return new UnrecoverableError(err.message);
  }
  return err;   // transient (429, 5xx, ECONNRESET, timeout) → retried by BullMQ
}
