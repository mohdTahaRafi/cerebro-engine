import mongoose from 'mongoose';

const DocumentSchema = new mongoose.Schema({
  // Phase 6 §4.2: every document belongs to exactly one user and one context.
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contextId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Context', required: true },
  fileName:     { type: String, required: true },
  mimeType:     { type: String, required: true },
  sizeBytes:    { type: Number, required: true },
  contentHash:  { type: String, required: true },  // sha256 of raw bytes
  storagePath:  { type: String, required: true },
  status: {
    type: String,
    required: true,
    enum: ['queued', 'processing', 'ready', 'failed', 'duplicate'],
    default: 'queued',
    index: true,
  },
  error:        { type: String, default: null },        // human-readable failure reason
  // Phase 7 §5.3: the real lifecycle stage, written by ingestDocument.js at the same six
  // points that already call updateProgress(). Retires the frontend's client-side
  // status+progress derivation (frontend/src/app/components/documents/stage.ts, deleted
  // this phase) — the enum matches that interim mapping's five PRD-named stages exactly,
  // so the client change is "read doc.stage" with no shape change.
  stage: {
    type: String,
    enum: ['queued', 'parsing', 'chunking', 'embedding', 'ready', 'failed'],
    default: 'queued',
  },
  // Populated only at the progress-45 write, when visual pages are present — e.g. "OCR
  // and page embedding, 12 pages" — built server-side from visualPageCount so the client
  // never invents wording the backend hasn't confirmed.
  stageDetail:  { type: String, default: null },
  pageCount:    { type: Number, default: 0 },
  textPageCount:   { type: Number, default: 0 },        // populated Phase 4
  visualPageCount: { type: Number, default: 0 },        // populated Phase 4
  chunkCount:   { type: Number, default: 0 },
  progress:     { type: Number, default: 0, min: 0, max: 100 },
  duplicateOf:  { type: mongoose.Schema.Types.ObjectId, ref: 'Document', default: null },
  // Non-fatal ingestion issues (phase 4 §6.3) — e.g. "N scanned page(s) were skipped:
  // <reason>" when the vision service is down but the text path still completed. A
  // populated array does not block 'ready'; it tells the user what's incomplete.
  warnings:     { type: [String], default: [] },
}, { timestamps: true });

// Phase 6 §4.2: every list query is (userId, contextId, createdAt desc); the v1
// {contentHash} index becomes {userId, contextId, contentHash} — duplicate detection is
// now scoped to a tenant's own context (§4.3), so the index that backs it must be too.
DocumentSchema.index({ userId: 1, contextId: 1, createdAt: -1 });
DocumentSchema.index({ userId: 1, contextId: 1, contentHash: 1 });

// The v1 `{ fileName: 'text' }` index is DROPPED (phase 6 §4.2): a text index is global
// to the collection and cannot be composed with a tenant equality prefix, so it would
// scan every tenant's filenames and then filter. Filename search moves to a
// case-insensitive regex over the already tenant-scoped result set (documents.js), which
// at per-tenant document counts (hundreds, not millions) is faster as well as safer.

export const Document = mongoose.model('Document', DocumentSchema);
