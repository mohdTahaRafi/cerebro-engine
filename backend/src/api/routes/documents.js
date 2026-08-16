import express from 'express';
import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { config } from '../../config/index.js';
import { upload, ACCEPTED } from '../middleware/upload.js';
import { verifyType } from '../../ingestion/verifyType.js';
import { Document } from '../../models/Document.js';
import { ingestQueue, JOB_OPTS } from '../../ingestion/queue.js';
import * as vectorStore from '../../providers/vectorStore.js';
import * as storage from '../../providers/storage.js';

const router = express.Router();

async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const buf = await fs.readFile(filePath);
  hash.update(buf);
  return hash.digest('hex');
}

// ── POST /api/documents ──────────────────────────────────────────────────────
router.post('/api/documents', upload.single('document'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No document provided.' });

  const tmpPath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    // 1. Verify real type before anything else touches the bytes.
    const verdict = await verifyType(tmpPath, ext);
    if (!verdict.ok) {
      await fs.unlink(tmpPath);
      return res.status(400).json({ error: verdict.reason });
    }

    // 2. Reject empty/whitespace-only uploads up front (FR-ING edge case).
    if (req.file.size === 0) {
      await fs.unlink(tmpPath);
      return res.status(400).json({ error: 'File is empty.' });
    }

    // 3. Hash the bytes and move the file to its content-addressed home.
    const contentHash = await sha256File(tmpPath);
    const storagePath = path.join(config.storage.uploadsDir, contentHash);
    await fs.rename(tmpPath, storagePath);

    // 4. Duplicate check BEFORE creating a queued row, so no job is enqueued for it.
    const existing = await Document.findOne({ contentHash, status: 'ready' });
    if (existing) {
      const dup = await Document.create({
        fileName: req.file.originalname, mimeType: ACCEPTED.get(ext),
        sizeBytes: req.file.size, contentHash, storagePath,
        status: 'duplicate', duplicateOf: existing._id,
      });
      return res.status(200).json({
        documentId: dup._id, status: 'duplicate', duplicateOf: existing._id,
        message: `Identical content was already ingested as "${existing.fileName}".`,
      });
    }

    // 5. Enqueue FIRST, create the row only if the queue accepted it. Ordering matters: a
    //    Redis outage must not leave an orphan 'queued' row that no worker will ever pick
    //    up (architecture §6.2).
    const doc = await Document.create({
      fileName: req.file.originalname, mimeType: ACCEPTED.get(ext),
      sizeBytes: req.file.size, contentHash, storagePath, status: 'queued',
    });
    try {
      await ingestQueue.add('ingest:document', { documentId: doc._id.toString() }, JOB_OPTS);
    } catch (queueErr) {
      await Document.deleteOne({ _id: doc._id });     // roll the row back
      return res.status(503).json({ error: 'Upload queue is unavailable. Please retry shortly.' });
    }

    res.status(202).json({ documentId: doc._id, status: 'queued', fileName: doc.fileName });
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    next(err);
  }
});

// ── GET /api/documents ───────────────────────────────────────────────────────
router.get('/api/documents', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    if (req.query.q) filter.$text = { $search: req.query.q };

    const [documents, total] = await Promise.all([
      Document.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Document.countDocuments(filter),
    ]);

    res.json({ documents, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/documents/:id ───────────────────────────────────────────────────
router.get('/api/documents/:id', async (req, res, next) => {
  try {
    const doc = await Document.findById(req.params.id);
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
    const doc = await Document.findById(req.params.id).select('status progress error chunkCount pageCount');
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
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    await doc.updateOne({
      status: 'queued', progress: 0, error: null, chunkCount: 0, pageCount: 0,
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
    const doc = await Document.findById(req.params.id);
    if (!doc) return res.status(404).json({ error: 'Document not found.' });

    // Vectors first, registry last. If deletion fails midway the document still appears
    // in the list and can be retried; the reverse ordering would orphan points with no
    // registry row pointing at them — unreachable garbage that nothing would ever clean up.
    const { deletedPoints } = await vectorStore.deleteByDocument(doc._id.toString());
    await storage.deletePrefix(`pages/${doc._id}/`);
    await fs.unlink(doc.storagePath).catch(() => {});   // may be shared by a duplicate row
    await Document.updateMany(
      { duplicateOf: doc._id },
      { duplicateOf: null, status: 'failed', error: 'Original document was deleted.' },
    );
    await doc.deleteOne();

    res.json({ deleted: true, documentId: doc._id, deletedPoints });
  } catch (err) {
    next(err);
  }
});

export default router;
