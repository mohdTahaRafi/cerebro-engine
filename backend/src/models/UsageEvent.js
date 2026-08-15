import mongoose from 'mongoose';

const UsageEventSchema = new mongoose.Schema({
  provider:   { type: String, required: true },   // 'cohere' | 'anthropic' | 'llamaparse' | 'ollama'
  operation:  { type: String, required: true },   // 'embed' | 'rerank' | 'generate' | 'parse'
  requestId:  { type: String, default: null },
  inputTokens:  { type: Number, default: 0 },
  outputTokens: { type: Number, default: 0 },
  callCount:  { type: Number, default: 1 },
  documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
}, { timestamps: true });
UsageEventSchema.index({ createdAt: -1, provider: 1 });

export const UsageEvent = mongoose.model('UsageEvent', UsageEventSchema);
