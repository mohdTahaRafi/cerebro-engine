// GET /api/admin/queue, GET /api/admin/errors — the two operator-only endpoints Phase 7
// adds (phase 7 §5). Both `requireAdmin`-gated (imports `requireAuth` itself, so this
// router needs no app-level `requireAuth` prefix — see index.js's own comment on why
// /api/admin is deliberately absent from that list). A non-admin gets 403, not 404:
// `/api/admin/*`'s existence is public knowledge from this document, not a per-tenant
// resource, so a 403 leaks nothing (§6's own note on task 7.21).
import express from 'express';
import { requireAdmin } from '../middleware/requireAdmin.js';
import { ingestQueue } from '../../ingestion/queue.js';
import { getThroughputPerMin } from '../../telemetry/throughput.js';
import { PipelineError } from '../../models/PipelineError.js';

const router = express.Router();

const WORKER_CONCURRENCY = 2;   // ingestion/queue.js's own configured value

// ── GET /api/admin/queue ─────────────────────────────────────────────────────────────
router.get('/api/admin/queue', requireAdmin, async (req, res, next) => {
  try {
    const [depth, throughputPerMin, workers, waiting] = await Promise.all([
      ingestQueue.getJobCounts('waiting', 'active', 'failed', 'completed'),
      getThroughputPerMin(),
      ingestQueue.getWorkers(),
      ingestQueue.getWaiting(0, 0),   // just the oldest waiting job, for its timestamp
    ]);

    res.json({
      depth,
      throughputPerMin: throughputPerMin ?? 0,
      workerConcurrency: WORKER_CONCURRENCY,
      activeWorkers: workers.length,          // real — getWorkers().length, not the configured number
      oldestWaitingAgeMs: waiting[0] ? Date.now() - waiting[0].timestamp : null,
    });
  } catch (err) { next(err); }
});

// ── GET /api/admin/errors ────────────────────────────────────────────────────────────
router.get('/api/admin/errors', requireAdmin, async (req, res, next) => {
  try {
    // Admin-wide, not tenant-scoped — this is the operator's own view of the whole
    // deployment's failures, same posture as /health's collection counts.
    const errors = await PipelineError.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json({
      errors: errors.map((e) => ({
        id: e._id, kind: e.kind, message: e.message,
        documentId: e.documentId, fileName: e.fileName, contextId: e.contextId,
        // The stack trace is admin-only and never leaves this endpoint (§5.2) — it is
        // included here (this route IS the admin-only boundary) but never attached to
        // any user-facing error response elsewhere in the API.
        stack: e.stack, retryable: e.retryable, createdAt: e.createdAt,
      })),
    });
  } catch (err) { next(err); }
});

export default router;
