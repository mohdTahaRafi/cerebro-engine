import mongoose from 'mongoose';

const UsageEventSchema = new mongoose.Schema({
  provider:   { type: String, required: true },   // 'cohere' | 'anthropic' | 'llamaparse' | 'ollama'
  operation:  { type: String, required: true },   // 'embed' | 'rerank' | 'generate' | 'parse'
  requestId:  { type: String, default: null },
  inputTokens:  { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  callCount:  { type: Number, default: 1 },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
  // Phase 6 §4.2: optional, null for ingest-time calls that predate the migration (and
  // for any call site not yet threading a tenant through — recordUsage's own contract is
  // unchanged, this is additive).
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true });
UsageEventSchema.index({ createdAt: -1, provider: 1 });
UsageEventSchema.index({ userId: 1, createdAt: -1 });

export const UsageEvent = mongoose.model('UsageEvent', UsageEventSchema);
