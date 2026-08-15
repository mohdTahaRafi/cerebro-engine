import mongoose from 'mongoose';

const DocumentSchema = new mongoose.Schema({
  fileName:     { type: String, required: true },
  mimeType:     { type: String, required: true },
  sizeBytes:    { type: Number, required: true },
  contentHash:  { type: String, required: true, index: true },  // sha256 of raw bytes
  storagePath:  { type: String, required: true },
  status: {
    type: String,
    required: true,
    enum: ['queued', 'processing', 'ready', 'failed', 'duplicate'],
    default: 'queued',
    index: true,
  },
  error:        { type: String, default: null },        // human-readable failure reason
  pageCount:    { type: Number, default: 0 },
  textPageCount:   { type: Number, default: 0 },        // populated Phase 4
  visualPageCount: { type: Number, default: 0 },        // populated Phase 4
  chunkCount:   { type: Number, default: 0 },
  progress:     { type: Number, default: 0, min: 0, max: 100 },
  duplicateOf:  { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
}, { timestamps: true });

DocumentSchema.index({ createdAt: -1 });
DocumentSchema.index({ fileName: 'text' });   // powers FR-DOC-04 list filtering

export const Document = mongoose.model('Document', DocumentSchema);
