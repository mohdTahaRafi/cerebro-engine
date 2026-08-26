// Trace — the durable record of one answer's full execution (phase 7 §2.1). Written once,
// in persistTurn, after the graph has finished; never updated afterward.
import mongoose from 'mongoose';

const PromptBlockSchema = new mongoose.Schema({
  role:         { type: String, enum: ['system', 'user'], required: true },
  kind:         { type: String, enum: ['text', 'image'], required: true },
  // For an image block this is the SERVED uri (/api/pages/<id>/<n>.jpg), never base64.
  // A base64 page is ~350 KB of unreadable text that would dominate the document and
  // blow the 256 KB cap on its own (architecture §8).
  content:      { type: String, required: true },
  approxTokens: { type: Number, default: null },
}, { _id: false });

const CandidateSchema = new mongoose.Schema({
  pointId:    { type: String, required: true },
  kind:       { type: String, enum: ['text', 'page'], required: true },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
  fileName:   { type: String, default: null },
  page:       { type: Number, default: null },
  headingPath:{ type: String, default: null },
  // Truncated at 1,200 characters. The full chunk is in Qdrant; this is a preview for
  // the console, and 18 untruncated candidates is most of the document cap.
  textPreview:{ type: String, default: null },
  branch:     { type: String, enum: ['dense', 'sparse', 'both', 'colpali'], default: null },
  fusionRank: { type: Number, default: null },
  // null when the reranker was skipped OR when this candidate fell below the floor and
  // was never assigned a final position. `belowFloor` distinguishes the two.
  finalRank:  { type: Number, default: null },
  score:      { type: Number, default: null },
  belowFloor: { type: Boolean, default: false },
  absorbedChunks: { type: [String], default: undefined },
}, { _id: false });

const TraceSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User',         required: true },
  contextId: { type: mongoose.Schema.Types.ObjectId, ref: 'Context',      required: true },
  threadId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true },
  // The assistant Message this trace explains. Unique: one answer, one trace.
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', required: true, unique: true },

  query:          { type: String, required: true, maxlength: 4000 },
  condensedQuery: { type: String, default: null, maxlength: 4000 },

  // The PipelineTelemetry object verbatim. Stored as a loose subdocument rather than a
  // typed schema because it is a wire contract owned by telemetry/pipelineTelemetry.js;
  // duplicating its 21 fields here would create a second definition to keep in sync.
  telemetry:  { type: mongoose.Schema.Types.Mixed, required: true },

  candidates: { type: [CandidateSchema], default: [] },
  prompt:     { type: [PromptBlockSchema], default: [] },

  tokens: {
    input:    { type: Number, default: null },   // null, not 0 — "not reported" is not "zero"
    output:   { type: Number, default: null },
    provider: { type: String, default: null },
    model:    { type: String, default: null },
  },

  runId:     { type: String, default: null },     // the LangSmith root run id
  truncated: { type: Boolean, default: false },   // the 256 KB cap fired
  refused:   { type: Boolean, default: false },   // the noContext branch ran
}, { timestamps: true });

TraceSchema.index({ userId: 1, createdAt: -1 });          // the list query
TraceSchema.index({ userId: 1, contextId: 1, createdAt: -1 });
// 30-day retention (architecture §8). Without this the collection grows without bound:
// 256 KB × 100 traces/user/day is ~768 MB per user per month.
TraceSchema.index({ createdAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const Trace = mongoose.model('Trace', TraceSchema);
