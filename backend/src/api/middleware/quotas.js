// Phase 8 §3.3: the four per-tenant quotas a rate limit does not cover — a user can
// stay under uploadLimiter's 10/hour indefinitely and still fill the disk. Every
// refusal names the limit and the current value (§3.3's own requirement: "a refusal
// that does not say the number is unactionable") and increments
// cerebro_quota_rejections_total with the limit it tripped.
import mongoose from 'mongoose';
import { Context } from '../../models/Context.js';
import { Document } from '../../models/Document.js';
import { config } from '../../config/index.js';
import { quotaRejections } from '../../telemetry/metrics.js';

// POST /api/contexts — mounted before Context.create(). Counts only 'active' contexts,
// matching GET /api/contexts' own listing filter (a 'deleting' context still occupies a
// row but is not something the user perceives as "one of my contexts" any more).
export async function checkContextLimit(req, res, next) {
  try {
    const max = config.quotas.maxContextsPerUser;
    const count = await Context.countDocuments({ userId: req.user._id, status: 'active' });
    if (count >= max) {
      quotaRejections.inc({ limit: 'contexts_per_user' });
      return res.status(409).json({
        code: 'context_limit',
        message: `You have ${count} contexts, the maximum (${max}). Delete one to create another.`,
      });
    }
    next();
  } catch (err) { next(err); }
}

// POST /api/contexts/:contextId/documents — mounted AFTER requireContext (needs
// req.tenant) and BEFORE upload.single('document') (§3.3: the storage check runs
// "before the multer write" — multer starts streaming the upload to disk the moment
// its own middleware runs, so every check here must precede that call in the route's
// middleware chain, not just precede the handler).
export async function checkUploadQuotas(req, res, next) {
  try {
    const { userId, contextId } = req.tenant;
    const userObjectId = new mongoose.Types.ObjectId(userId);

    const [documentCount, storageAgg, chunkAgg] = await Promise.all([
      // A 'duplicate' row shares its bytes/chunks with the original it points at
      // (documents.js's own dedup comment) and is excluded here for the same reason
      // recomputeContextCounters excludes it from documentCount.
      Document.countDocuments({ contextId, status: { $ne: 'duplicate' } }),
      Document.aggregate([
        { $match: { userId: userObjectId, status: { $ne: 'duplicate' } } },
        { $group: { _id: null, bytes: { $sum: '$sizeBytes' } } },
      ]),
      // Chunks per user (§3.3): "checked at ingest completion" describes WHEN the count
      // crosses the limit, not where the check runs — the actual refusal is always at
      // the next upload attempt ("the document still finishes, and the next upload is
      // refused"), so a live aggregate here is both correct and simpler than a
      // maintained counter that could drift.
      Document.aggregate([
        { $match: { userId: userObjectId, status: 'ready' } },
        { $group: { _id: null, chunks: { $sum: '$chunkCount' } } },
      ]),
    ]);
    const storageBytes = storageAgg[0]?.bytes ?? 0;
    const chunkCount = chunkAgg[0]?.chunks ?? 0;

    if (documentCount >= config.quotas.maxDocumentsPerContext) {
      quotaRejections.inc({ limit: 'documents_per_context' });
      return res.status(409).json({
        code: 'context_full',
        message: `This context holds ${documentCount} documents, the maximum (${config.quotas.maxDocumentsPerContext}). Delete some or create another context.`,
      });
    }
    if (storageBytes >= config.quotas.maxStorageBytesPerUser) {
      quotaRejections.inc({ limit: 'storage' });
      return res.status(413).json({
        code: 'storage_quota',
        message: `You are storing ${storageBytes} of ${config.quotas.maxStorageBytesPerUser} bytes allowed. Delete some documents to free up space.`,
      });
    }
    if (chunkCount >= config.quotas.maxChunksPerUser) {
      quotaRejections.inc({ limit: 'chunks' });
      return res.status(409).json({
        code: 'chunk_limit',
        message: `You have ${chunkCount} chunks indexed, the maximum (${config.quotas.maxChunksPerUser}). Delete some documents to free up capacity.`,
      });
    }
    next();
  } catch (err) { next(err); }
}
