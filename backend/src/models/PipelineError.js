import mongoose from 'mongoose';

// Introduced here for notify failures only (`kind: 'notify'`, written by notify/email.js
// and notify/sms.js). Phase 7 §5.2 reads the full collection from every subsystem
// (`parse`, `embed`, `vision`, `rerank`, `generate`, `queue`, `trace`, `projection`) and
// adds the single `recordPipelineError(kind, err, ctx)` writer helper — the enum below
// already carries every kind Phase 7 needs so that later addition does not require a
// migration.
const PipelineErrorSchema = new mongoose.Schema({
  kind: { type: String, required: true, index: true,
          enum: ['parse', 'embed', 'vision', 'rerank', 'generate', 'queue', 'notify', 'trace', 'projection'] },
  message:    { type: String, required: true, maxlength: 2000 },
  stack:      { type: String, default: null, maxlength: 8000 },
  retryable:  { type: Boolean, default: false },
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  contextId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Context', default: null },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
  fileName:   { type: String, default: null },
}, { timestamps: true });

PipelineErrorSchema.index({ createdAt: -1 });
// 14 days. Long enough to investigate a weekend incident on Monday; short enough that
// the collection cannot become the largest thing in the database.
PipelineErrorSchema.index({ createdAt: 1 }, { expireAfterSeconds: 14 * 24 * 60 * 60 });

// The stack trace is admin-only and never leaves this collection — Phase 7's
// GET /api/admin/errors is the only reader, and it is requireAdmin-gated.
export const PipelineError = mongoose.model('PipelineError', PipelineErrorSchema);
