// Projection — the cached 3D UMAP layout of one context's embeddings (phase 7 §4.1). One
// row per context (`unique: true` on contextId); refit replaces it in place rather than
// versioning, since the console only ever shows "the current projection."
import mongoose from 'mongoose';

const ProjectionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contextId: { type: mongoose.Schema.Types.ObjectId, ref: 'Context', required: true, unique: true },

  status: { type: String, enum: ['fitting', 'fresh', 'failed'], required: true, index: true },
  reason: { type: String, default: null },       // populated on 'failed'

  nodeCount: { type: Number, default: 0 },
  pointIds:  { type: [String], default: [] },
  // Binary, not an array of numbers. 5,000 × 3 floats as a Mongo array of Doubles is
  // ~360 KB of BSON; as a Buffer it is exactly 60,000 bytes.
  positions: { type: Buffer, default: null },    // Float32Array, interleaved [x,y,z]
  docIndex:  { type: Buffer, default: null },    // Uint16Array, index into `documents`
  documents: [{ id: String, fileName: String, color: Number }],
  bounds:    { min: [Number], max: [Number] },

  params:    { nNeighbors: Number, minDist: Number, spread: Number, seed: Number },
  // The chunk count at fit time. The console reports "N new chunks aren't plotted yet"
  // by comparing this against the context's current count — a real number, not a guess.
  fittedChunkCount: { type: Number, default: 0 },
  fittedAt:  { type: Date, default: null },
}, { timestamps: true });

export const Projection = mongoose.model('Projection', ProjectionSchema);
