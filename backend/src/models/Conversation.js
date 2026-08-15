import mongoose from 'mongoose';

const ConversationSchema = new mongoose.Schema({
  title:         { type: String, default: 'New conversation' },
  lastMessageAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

export const Conversation = mongoose.model('Conversation', ConversationSchema);
