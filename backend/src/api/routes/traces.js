// GET /api/traces, /api/traces/:id, /api/traces/by-message/:messageId — the trace list
// and detail routes (phase 7 §3). `requireAuth` runs at the app level (index.js), so
// `req.user` is always populated; every query below is scoped to it, never admin-wide —
// a trace is a record of the signed-in user's own queries, not an admin surface.
import express from 'express';
import mongoose from 'mongoose';
import { Trace } from '../../models/Trace.js';
import { Context } from '../../models/Context.js';
import { config } from '../../config/index.js';
import { RELEVANCE_FLOOR } from '../../retrieval/constants.js';

const router = express.Router();

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// Matches the frontend's TraceTimeWindow union exactly (api/endpoints/traces.ts) — an
// unrecognized or missing value falls through to 'all' turned into "no cutoff", which
// keeps the route permissive rather than 400ing on a value a future window option
// forgets to add here.
const WINDOW_MS = { '1h': 3_600_000, '24h': 86_400_000, '7d': 7 * 86_400_000 };

function langsmithUrl(runId) {
  if (!runId || !config.tracing.orgId) return null;
  return `https://smith.langchain.com/o/${config.tracing.orgId}/projects/p/${encodeURIComponent(config.tracing.project)}/r/${runId}`;
}

// The list projection (§3, task 7.9): explicitly EXCLUDES `candidates` and `prompt` — the
// two fields that can each independently approach the 256 KB trace cap. Without this a
// 50-row page is up to 12 MB and the < 100ms budget (§9) is unreachable.
const LIST_PROJECTION = '-candidates -prompt';

function toSummary(trace, contextTitleById) {
  return {
    id: trace._id, threadId: trace.threadId, messageId: trace.messageId,
    contextId: trace.contextId, contextTitle: contextTitleById.get(String(trace.contextId)) ?? 'Unknown context',
    query: trace.query, totalMs: trace.telemetry.totalMs,
    sourceCount: trace.telemetry.candidatesAfterFloor ?? 0,
    telemetry: trace.telemetry,
    refused: trace.refused, rerankSkipped: trace.telemetry.rerankSkipped ?? false,
    warningCount: (trace.telemetry.warnings ?? []).length,
    createdAt: trace.createdAt,
  };
}

// Projects one stored CandidateSchema entry (textPreview, no imageUri/ocrQuality/position)
// into the wire ProvenanceSource shape the console already renders live chat sources with
// — the same "one shape, one place" discipline retrieval/search.js's toPublicResult uses.
function candidateToSource(c) {
  return {
    pointId: c.pointId, kind: c.kind, text: c.textPreview, score: c.score,
    documentId: c.documentId, fileName: c.fileName, page: c.page,
    headingPath: c.headingPath, position: null,
    imageUri: c.kind === 'page' ? `/api/pages/${c.documentId}/${c.page}.jpg` : null,
    ocrQuality: null,
    absorbedChunks: c.absorbedChunks ?? null,
    branch: c.branch, fusionRank: c.fusionRank, finalRank: c.finalRank,
    belowFloor: c.belowFloor,
  };
}

// ── GET /api/traces ──────────────────────────────────────────────────────────────────
router.get('/api/traces', async (req, res, next) => {
  try {
    const filter = { userId: req.user._id };
    if (req.query.contextId) {
      if (!isValidId(req.query.contextId)) {
        return res.status(400).json({ error: 'contextId is not a valid id.' });
      }
      filter.contextId = req.query.contextId;
    }
    const window = req.query.window;
    if (window && WINDOW_MS[window]) {
      filter.createdAt = { $gte: new Date(Date.now() - WINDOW_MS[window]) };
    }

    const traces = await Trace.find(filter).select(LIST_PROJECTION).sort({ createdAt: -1 }).limit(200).lean();

    const contextIds = [...new Set(traces.map((t) => String(t.contextId)))];
    const contexts = await Context.find({ _id: { $in: contextIds } }).select('title').lean();
    const contextTitleById = new Map(contexts.map((c) => [String(c._id), c.title]));

    res.json({ traces: traces.map((t) => toSummary(t, contextTitleById)) });
  } catch (err) { next(err); }
});

// ── GET /api/traces/:id ──────────────────────────────────────────────────────────────
router.get('/api/traces/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Trace not found.' });
    const trace = await Trace.findOne({ _id: req.params.id, userId: req.user._id }).lean();
    // 404, never 403 — same existence-oracle reasoning as requireContext.js: a foreign
    // trace id must be indistinguishable from a nonexistent one.
    if (!trace) return res.status(404).json({ error: 'Trace not found.' });

    const context = await Context.findById(trace.contextId).select('title').lean();
    const contextTitleById = new Map(context ? [[String(context._id), context.title]] : []);

    res.json({
      ...toSummary(trace, contextTitleById),
      condensedQuery: trace.condensedQuery,
      candidates: trace.candidates.map(candidateToSource),
      relevanceFloor: RELEVANCE_FLOOR,
      prompt: trace.prompt,
      tokens: (trace.tokens.input == null && trace.tokens.output == null && !trace.tokens.provider) ? null : trace.tokens,
      runId: trace.runId,
      langsmithUrl: langsmithUrl(trace.runId),
      truncated: trace.truncated,
    });
  } catch (err) { next(err); }
});

// ── GET /api/traces/by-message/:messageId ──────────────────────────────────────────────
// Resolves a chat message to its trace — the provenance ribbon's deep link when a caller
// only has the message id, not the trace id (e.g. a resumed thread history view).
router.get('/api/traces/by-message/:messageId', async (req, res, next) => {
  try {
    if (!isValidId(req.params.messageId)) return res.status(404).json({ error: 'Trace not found.' });
    const trace = await Trace.findOne({ messageId: req.params.messageId, userId: req.user._id }).select('_id');
    if (!trace) return res.status(404).json({ error: 'Trace not found.' });
    res.redirect(`/api/traces/${trace._id}`);
  } catch (err) { next(err); }
});

export default router;
