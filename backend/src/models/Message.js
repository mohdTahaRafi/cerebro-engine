import mongoose from 'mongoose';

const MessageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  // Phase 6 §4.2: defense in depth, since `conversationId` already implies ownership —
  // every read of a Message goes through its parent Conversation's own tenant check.
  userId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  role:           { type: String, required: true, enum: ['user', 'assistant'] },
  content:        { type: String, required: true },
  condensedQuery: { type: String, default: null },   // what retrieval actually ran on
  sources: [{                                         // the units actually cited
    kind:       { type: String, enum: ['chunk', 'page'], required: true },
    pointId:    { type: String, required: true },
    documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document', required: true },
    page:       { type: Number, default: null },
    score:      { type: Number, required: true },
  }],
}, { timestamps: true });
MessageSchema.index({ conversationId: 1, createdAt: 1 });

export const Message = mongoose.model('Message', MessageSchema);
