import mongoose from 'mongoose';

const ConversationSchema = new mongoose.Schema({
  // Phase 6 §4.2: every conversation belongs to exactly one user and one context.
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contextId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Context', required: true },
  title:         { type: String, default: 'New conversation' },
  lastMessageAt: { type: Date, default: Date.now },
}, { timestamps: true });

// Replaces the v1 {lastMessageAt: -1} index — GET /api/threads is now (userId,
// lastMessageAt desc), never a global list.
ConversationSchema.index({ userId: 1, lastMessageAt: -1 });

export const Conversation = mongoose.model('Conversation', ConversationSchema);
