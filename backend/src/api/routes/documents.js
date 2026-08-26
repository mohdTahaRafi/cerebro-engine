// /api/documents/:id — single-document lifecycle routes (phase 6 §5.4). Upload and the
// tenant-scoped list moved to /api/contexts/:contextId/documents (routes/contexts.js);
// what remains here is ownership-checked per-document access: GET, GET .../status, POST
// .../reingest, DELETE. `requireAuth` runs at the app level (index.js) before this router,
// so `req.user` is always populated — ownership is then a plain
// `{_id, userId: req.user._id}` lookup, and a foreign id 404s exactly like a nonexistent
// one (§5.2's own reasoning: a 403 would confirm the document exists, an existence oracle
// across the tenant boundary).
import express from 'express';
import fs from 'fs/promises';
import { Document } from '../../models/Document.js';
import { ingestQueue, JOB_OPTS } from '../../ingestion/queue.js';
import * as vectorStore from '../../providers/vectorStore.js';
import * as storage from '../../providers/storage.js';
import { recomputeContextCounters } from '../../contexts/counters.js';

const router = express.Router();

// ── GET /api/documents/:id ───────────────────────────────────────────────────
router.get('/api/documents/:id', async (req, res, next) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, userId: req.user._id });
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    res.json(doc);
  } catch (err) {
    next(err);
  }
});

// ── GET /api/documents/:id/status ────────────────────────────────────────────
// Lightweight poll endpoint — status/progress/error only, no full document body.
router.get('/api/documents/:id/status', async (req, res, next) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, userId: req.user._id })
      .select('status progress error chunkCount pageCount');
    if (!doc) return res.status(404).json({ error: 'Document not found.' });
    res.json({
      status: doc.status, progress: doc.progress, error: doc.error,
      chunkCount: doc.chunkCount, pageCount: doc.pageCount,
    });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/documents/:id/reingest ─────────────────────────────────────────
router.post('/api/documents/:id/reingest', async (req, res, next) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, userId: req.user._id });
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    await doc.updateOne({
      status: 'queued', progress: 0, error: null, chunkCount: 0, pageCount: 0,
      textPageCount: 0, visualPageCount: 0, warnings: [],
    });
    try {
      await ingestQueue.add('ingest:document', { documentId: doc._id.toString() }, JOB_OPTS);
    } catch (queueErr) {
      return res.status(503).json({ error: 'Upload queue is unavailable. Please retry shortly.' });
    }

    res.status(202).json({ documentId: doc._id, status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/documents/:id ────────────────────────────────────────────────
router.delete('/api/documents/:id', async (req, res, next) => {
  try {
    const doc = await Document.findOne({ _id: req.params.id, userId: req.user._id });
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    const tenant = { userId: String(doc.userId), contextId: String(doc.contextId) };

    // Vectors first, registry last. If deletion fails midway the document still appears
    // in the list and can be retried; the reverse ordering would orphan points with no
    // registry row pointing at them — unreachable garbage that nothing would ever clean up.
    const { deletedPoints } = await vectorStore.deleteByDocument(tenant, doc._id.toString());
    const { deletedPoints: deletedPagePoints } = await vectorStore.deletePagesByDocument(tenant, doc._id.toString());
    await storage.deletePrefix(`pages/${doc._id}/`);
    await fs.unlink(doc.storagePath).catch(() => {});   // may be shared by a duplicate row
    await Document.updateMany(
      { duplicateOf: doc._id },
      { duplicateOf: null, status: 'failed', error: 'Original document was deleted.' },
    );
    await doc.deleteOne();
    await recomputeContextCounters(doc.contextId);

    res.json({ deleted: true, documentId: doc._id, deletedPoints, deletedPagePoints });
  } catch (err) {
    next(err);
  }
});

export default router;
