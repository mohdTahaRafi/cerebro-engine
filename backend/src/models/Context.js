import mongoose from 'mongoose';

const ContextSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title:       { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  description: { type: String, default: null, maxlength: 280 },

  // Denormalized counters. Recomputed on ingest completion and on delete rather than
  // aggregated per request: /contexts renders these for every card, and an aggregation
  // over `documents` per card is N queries for a grid.
  documentCount: { type: Number, default: 0, min: 0 },
  chunkCount:    { type: Number, default: 0, min: 0 },

  // 'deleting' is set BEFORE the cascade starts and the row is excluded from list
  // queries while it holds. A cascade over 50 documents takes up to 20s (architecture
  // §8); a context that vanishes and reappears would read as data loss, and one that
  // stays clickable would 404 mid-delete.
  status:      { type: String, enum: ['active', 'deleting'], default: 'active', index: true },
  lastQueryAt: { type: Date, default: null },
}, { timestamps: true });

// Every list query is (userId, updatedAt desc). No unique index on title: two contexts
// named "Drafts" are two contexts (phase_2 §3.3).
ContextSchema.index({ userId: 1, updatedAt: -1 });

export const Context = mongoose.model('Context', ContextSchema);
