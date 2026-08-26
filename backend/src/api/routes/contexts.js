// /api/contexts — CRUD plus the nested document routes that replace v1's global
// POST/GET /api/documents (phase 6 §5.4, §6). Every route below runs behind requireAuth
// (mounted at the app level, index.js) so `req.user` is always populated here.
import express from 'express';
import fs from 'fs/promises';
import crypto from 'crypto';
import path from 'path';
import { config } from '../../config/index.js';
import { Context } from '../../models/Context.js';
import { Document } from '../../models/Document.js';
import { requireContext } from '../middleware/requireContext.js';
import { uploadLimiter } from '../middleware/rateLimit.js';
import { upload, ACCEPTED } from '../middleware/upload.js';
import { verifyType } from '../../ingestion/verifyType.js';
import { ingestQueue, JOB_OPTS as INGEST_JOB_OPTS } from '../../ingestion/queue.js';
import { contextDeleteQueue, JOB_OPTS as DELETE_JOB_OPTS } from '../../contexts/queue.js';

const router = express.Router();

// ── GET /api/contexts ─────────────────────────────────────────────────────────────────
router.get('/api/contexts', async (req, res, next) => {
  try {
    // 'deleting' contexts are excluded — a context mid-cascade must not be clickable
    // (§4.1's own comment) and must not flash back into the list while its delete job
    // is still running.
    const contexts = await Context.find({ userId: req.user._id, status: 'active' })
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ contexts });
  } catch (err) { next(err); }
});

// ── POST /api/contexts ────────────────────────────────────────────────────────────────
router.post('/api/contexts', async (req, res, next) => {
  try {
    const { title, description } = req.body ?? {};
    if (typeof title !== 'string' || title.trim().length < 1 || title.trim().length > 80) {
      return res.status(400).json({ code: 'invalid_request', message: 'Title must be 1-80 characters.' });
    }
    if (description !== undefined && description !== null) {
      if (typeof description !== 'string' || description.length > 280) {
        return res.status(400).json({ code: 'invalid_request', message: 'Description must be at most 280 characters.' });
      }
    }
    const context = await Context.create({
      userId: req.user._id, title: title.trim(), description: description?.trim() || null,
    });
    res.status(201).json(context);
  } catch (err) { next(err); }
});

// ── GET /api/contexts/:contextId ──────────────────────────────────────────────────────
router.get('/api/contexts/:contextId', requireContext, async (req, res) => {
  res.json(req.context);
});

// ── PATCH /api/contexts/:contextId ────────────────────────────────────────────────────
router.patch('/api/contexts/:contextId', requireContext, async (req, res, next) => {
  try {
    const { title, description } = req.body ?? {};
    const update = {};
    if (title !== undefined) {
      if (typeof title !== 'string' || title.trim().length < 1 || title.trim().length > 80) {
        return res.status(400).json({ code: 'invalid_request', message: 'Title must be 1-80 characters.' });
      }
      update.title = title.trim();
    }
    if (description !== undefined) {
      if (description !== null && (typeof description !== 'string' || description.length > 280)) {
        return res.status(400).json({ code: 'invalid_request', message: 'Description must be at most 280 characters.' });
      }
      update.description = description === null ? null : description.trim() || null;
    }
    const updated = await Context.findByIdAndUpdate(req.context._id, update, { new: true });
    res.json(updated);
  } catch (err) { next(err); }
});

// ── DELETE /api/contexts/:contextId ───────────────────────────────────────────────────
// Phase 6 §6.2: enqueues the cascade and returns immediately. The requireContext
// middleware has already set status to whatever it was BEFORE this handler runs — the row
// is flipped to 'deleting' by cascadeDeleteContext's own first step, not here, so a
// duplicate DELETE while the cascade is queued but not yet started still 409s via
// requireContext's own status check on the second call... except the FIRST call has not
// flipped status yet either. To close that race (two DELETEs arriving back-to-back before
// the queued job starts), flip status here, synchronously, before enqueueing — the
// cascade's own step 1 (cascade.js) then finds it already 'deleting' and no-ops on the
// update, which is exactly the idempotence the whole job is built on.
router.delete('/api/contexts/:contextId', requireContext, async (req, res, next) => {
  try {
    await Context.updateOne({ _id: req.context._id }, { status: 'deleting' });
    try {
      await contextDeleteQueue.add(
        'context:delete',
        { contextId: String(req.context._id), userId: String(req.user._id) },
        DELETE_JOB_OPTS,
      );
    } catch (queueErr) {
      // Roll the status flip back — a Redis outage must not strand a context in
      // 'deleting' with no job ever queued to finish the cascade.
      await Context.updateOne({ _id: req.context._id }, { status: 'active' });
      return res.status(503).json({ error: 'Delete queue is unavailable. Please retry shortly.' });
    }
    res.status(202).json({ contextId: req.context._id, status: 'deleting' });
  } catch (err) { next(err); }
});

// ── POST /api/contexts/:contextId/documents ───────────────────────────────────────────
// Replaces v1's POST /api/documents (phase 6 §5.4, §9). Same verify/hash/dedup/enqueue
// sequence as v1 — see documents.js's header comment for why each step is ordered the way
// it is — with tenant fields now written onto the Document row at creation, and duplicate
// detection scoped to {contentHash, userId, contextId} (§4.3): a global check would be a
// content-existence oracle across tenants ("Identical content was already ingested" proves
// another user holds that exact file), so two tenants uploading the same public PDF get
// two independent documents with two independent vector sets — real storage duplication,
// accepted deliberately as the price of not leaking.
async function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const buf = await fs.readFile(filePath);
  hash.update(buf);
  return hash.digest('hex');
}

router.post('/api/contexts/:contextId/documents', requireContext, uploadLimiter, upload.single('document'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No document provided.' });

  const tmpPath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();
  const { userId, contextId } = req.tenant;

  try {
    const verdict = await verifyType(tmpPath, ext);
    if (!verdict.ok) {
      await fs.unlink(tmpPath);
      return res.status(400).json({ error: verdict.reason });
    }

    if (req.file.size === 0) {
      await fs.unlink(tmpPath);
      return res.status(400).json({ error: 'File is empty.' });
    }

    const contentHash = await sha256File(tmpPath);
    const storagePath = path.join(config.storage.uploadsDir, contentHash);
    await fs.rename(tmpPath, storagePath);

    const existing = await Document.findOne({ contentHash, userId, contextId, status: 'ready' });
    if (existing) {
      const dup = await Document.create({
        userId, contextId,
        fileName: req.file.originalname, mimeType: ACCEPTED.get(ext),
        sizeBytes: req.file.size, contentHash, storagePath,
        status: 'duplicate', duplicateOf: existing._id,
      });
      return res.status(200).json({
        documentId: dup._id, status: 'duplicate', duplicateOf: existing._id,
        message: `Identical content was already ingested as "${existing.fileName}".`,
      });
    }

    const doc = await Document.create({
      userId, contextId,
      fileName: req.file.originalname, mimeType: ACCEPTED.get(ext),
      sizeBytes: req.file.size, contentHash, storagePath, status: 'queued',
    });
    try {
      await ingestQueue.add('ingest:document', { documentId: doc._id.toString() }, INGEST_JOB_OPTS);
    } catch (queueErr) {
      await Document.deleteOne({ _id: doc._id });
      return res.status(503).json({ error: 'Upload queue is unavailable. Please retry shortly.' });
    }

    res.status(202).json({ documentId: doc._id, status: 'queued', fileName: doc.fileName });
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    next(err);
  }
});

// ── GET /api/contexts/:contextId/documents ────────────────────────────────────────────
// Replaces v1's global GET /api/documents (§5.4). Filename search is a case-insensitive
// regex over this already tenant-scoped result set (§4.2) — the v1 text index that used to
// back it is dropped, since a text index is global to the collection and cannot compose
// with a tenant-equality prefix.
router.get('/api/contexts/:contextId/documents', requireContext, async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));
    const filter = { userId: req.tenant.userId, contextId: req.tenant.contextId };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.q) filter.fileName = { $regex: String(req.query.q), $options: 'i' };

    const [documents, total] = await Promise.all([
      Document.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Document.countDocuments(filter),
    ]);

    res.json({ documents, page, limit, total, totalPages: Math.ceil(total / limit) });
  } catch (err) { next(err); }
});

export default router;
