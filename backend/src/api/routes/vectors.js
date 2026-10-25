// GET /api/vectors/:contextId/projection, POST /api/vectors/query,
// GET /api/vectors/node/:pointId, POST /api/vectors/:contextId/rebuild (phase 7 §4).
// `requireAuth` runs at the app level (index.js).
import express from 'express';
import { Projection } from '../../models/Projection.js';
import { Context } from '../../models/Context.js';
import * as embeddings from '../../providers/embeddings.js';
import * as vectorStore from '../../providers/vectorStore.js';
import { rerankOrDegrade } from '../../providers/reranker.js';
import { applyRelevanceGate } from '../../retrieval/search.js';
import { MAX_QUERY_CHARS } from '../../retrieval/constants.js';
import { normalize } from '../../ingestion/normalize.js';
import { requireContext } from '../middleware/requireContext.js';
import { enqueueProjectionRebuild, hasPendingFit } from '../../projection/worker.js';
import { projectQuery } from '../../projection/transform.js';

const router = express.Router();

// `pending` is the one thing the console cannot work out for itself. 'absent' covers two
// states that look identical on the wire and need opposite client behavior: a context
// whose first fit was just enqueued (poll — a cloud is seconds away) and a context whose
// fit FAILED and will never complete on its own (stop polling; show the reason and the
// Rebuild control). Rather than have the client guess from the reason string or burn a
// fixed retry budget on every visit, the server states the fact it already knows.
function toWireProjection(row, extra) {
  return {
    staleness: extra.staleness, reason: extra.reason, pending: extra.pending,
    nodeCount: row?.nodeCount ?? 0,
    positions: row?.positions ? row.positions.toString('base64') : '',
    docIndex: row?.docIndex ? row.docIndex.toString('base64') : '',
    pointIds: row?.pointIds ?? [],
    documents: row?.documents ?? [],
    // A row created by enqueueProjectionRebuild's own upsert (status: 'fitting', not
    // yet fit even once) carries mongoose's empty-array subdocument defaults
    // (`{min: [], max: []}`), not a real 3-tuple — decodeProjection's consumers (three.js
    // scene bounds) need an actual triple even in that transient state.
    bounds: row?.bounds?.min?.length === 3 ? row.bounds : { min: [0, 0, 0], max: [0, 0, 0] },
    fittedAt: row?.fittedAt ?? null,
  };
}

// ── GET /api/vectors/:contextId/projection ──────────────────────────────────────────
// §4.4's six staleness states. A stale or absent read enqueues a rebuild as a side
// effect of the GET — deliberate: the console has no separate "compute" button on first
// load (the milestone's own "first load returns absent and enqueues a fit").
router.get('/api/vectors/:contextId/projection', requireContext, async (req, res, next) => {
  try {
    const row = await Projection.findOne({ contextId: req.tenant.contextId }).lean();

    if (!row) {
      await enqueueProjectionRebuild(req.tenant);
      return res.json(toWireProjection(null, {
        staleness: 'absent', pending: true,
        reason: 'No projection has been computed for this context yet — fitting it now.',
      }));
    }
    if (row.status === 'failed') {
      return res.json(toWireProjection(row, { staleness: 'absent', pending: false, reason: row.reason }));
    }
    if (row.status === 'fitting') {
      // 'fitting' is a claim about the QUEUE, and the row cannot verify it on its own:
      // the flag is written by enqueueProjectionRebuild before the job is confirmed
      // enqueued, so anything that loses the job afterwards (a dropped add, a flushed
      // Redis, a worker killed mid-fit) strands the row here permanently — the console
      // reports "Rebuilding…" forever and the beacon stays 409-blocked, with no action
      // the user can take. Check the claim against the queue and re-enqueue when it is
      // no longer true. `hasPendingFit` answers true while Redis is unreachable, so an
      // outage waits rather than enqueueing a rebuild per page load.
      if (!(await hasPendingFit(req.tenant.contextId))) {
        await enqueueProjectionRebuild(req.tenant);
      }
      const context = await Context.findById(req.tenant.contextId).select('chunkCount').lean();
      const delta = Math.max(0, (context?.chunkCount ?? 0) - row.fittedChunkCount);
      // delta === 0 is the explicit Rebuild action on an unchanged corpus, which the
      // count-based wording renders as "0 new chunks aren't plotted yet" — a sentence
      // that describes nothing and reads like a bug.
      return res.json(toWireProjection(row, {
        staleness: 'rebuilding', pending: true,
        reason: delta === 0
          ? 'Refitting this projection — the cloud below is the previous fit.'
          : `Rebuilding — ${delta} new chunk${delta === 1 ? '' : 's'} aren't plotted yet.`,
      }));
    }

    // status === 'fresh' from here down.
    const context = await Context.findById(req.tenant.contextId).select('chunkCount').lean();
    const currentCount = context?.chunkCount ?? row.fittedChunkCount;
    if (currentCount !== row.fittedChunkCount) {
      // Counts differ and nothing is already fitting — a real rebuild is enqueued, and
      // the STALE (last-known-good) projection is still served underneath it so the
      // cloud never disappears while the rebuild runs (VectorSpace.tsx dims it instead).
      await enqueueProjectionRebuild(req.tenant);
      const delta = currentCount - row.fittedChunkCount;
      const reason = delta > 0
        ? `${delta} chunk${delta === 1 ? '' : 's'} were added since this was fitted.`
        : `${-delta} chunk${-delta === 1 ? '' : 's'} were removed since this was fitted.`;
      return res.json(toWireProjection(row, { staleness: 'rebuilding', pending: true, reason }));
    }

    // Downsampled at fit time: nodeCount (the plotted sample) is smaller than
    // fittedChunkCount (the true corpus size) — still 'fresh', just honest about scope.
    const reason = row.nodeCount < row.fittedChunkCount
      ? `Showing ${row.nodeCount.toLocaleString()} of ${row.fittedChunkCount.toLocaleString()} chunks.`
      : null;
    res.json(toWireProjection(row, { staleness: 'fresh', pending: false, reason }));
  } catch (err) { next(err); }
});

// ── POST /api/vectors/:contextId/rebuild ────────────────────────────────────────────
// The explicit "Rebuild" action (§4.5) — deduplicated by the same jobId as every other
// enqueue call, so pressing it twice in a row still fits once.
router.post('/api/vectors/:contextId/rebuild', requireContext, async (req, res, next) => {
  try {
    await enqueueProjectionRebuild(req.tenant);
    res.status(202).json({ contextId: req.tenant.contextId, status: 'fitting' });
  } catch (err) { next(err); }
});

// ── POST /api/vectors/query ──────────────────────────────────────────────────────────
// The query beacon (§4.3). `contextId` arrives in the body — requireContext resolves it
// from `req.body.contextId` (its own fallback chain already covers this).
router.post('/api/vectors/query', requireContext, async (req, res, next) => {
  try {
    const { query } = req.body ?? {};
    if (typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Query text is required.' });
    }
    if (query.length > MAX_QUERY_CHARS) {
      return res.status(400).json({ error: `Query exceeds ${MAX_QUERY_CHARS} characters.` });
    }

    const row = await Projection.findOne({ contextId: req.tenant.contextId }).lean();
    if (!row || row.status !== 'fresh') {
      return res.status(409).json({ error: 'No fresh projection is available to place a beacon into.' });
    }

    const { vector } = await embeddings.encodeQuery(normalize(query));
    const result = await projectQuery(req.tenant, vector, row);
    if (!result.placed) {
      // Two distinct reasons reach here and they are not the same problem: a projection
      // whose coordinate buffer no longer matches its own point-id list is broken and a
      // rebuild fixes it, while a stale projection just does not cover these particular
      // neighbors yet. Saying the wrong one sends the user looking in the wrong place.
      const error = result.reason === 'corrupt_projection'
        ? 'This projection is corrupt and needs rebuilding.'
        : 'None of this query\'s nearest neighbors are in the current projection.';
      return res.status(422).json({ error, reason: result.reason });
    }

    // §4.3's own closing line: rerank the beacon's real neighbors with the SAME rerank
    // call the retrieval path uses, so the response can mark which ones would have
    // survived the relevance floor — retrieved-vs-kept, the most interesting thing the
    // beacon can show.
    const { ranked } = await rerankOrDegrade(normalize(query), result.hits, result.hits.length);
    // BUG-002's two-step gate (retrieval/search.js's applyRelevanceGate) — same reasoning
    // as rerank.js: a bare `relevanceScore >= RELEVANCE_FLOOR` filter would admit nearly
    // everything now that RELEVANCE_FLOOR is 5e-5, the accept/reject threshold alone.
    // `skipped` (degraded rerank, every score null) is handled inside the gate itself.
    const { results: survivors } = applyRelevanceGate(ranked);
    const finalRankByPointId = new Map(survivors.map((r, i) => [r.pointId, i + 1]));
    const scoreByPointId = new Map(ranked.map((r) => [r.pointId, r.relevanceScore]));

    res.json({
      beacon: result.beacon,
      neighbors: result.neighbors.map((n) => ({
        pointId: n.pointId, index: n.index, distance: n.distance,
        rerankScore: scoreByPointId.get(n.pointId) ?? null,
        finalRank: finalRankByPointId.get(n.pointId) ?? null,
      })),
    });
  } catch (err) {
    // Same mapping search.js applies to its own critical-path provider: an unreachable
    // or rate-limited embedding service is a 503 with something the user can act on, not
    // an opaque 500. Verified live — with this deployment's Cohere key over its monthly
    // trial quota, the beacon previously surfaced as "Request failed (500)." with no
    // indication that retrying later would help.
    if (err.code === 'EOPENBREAKER') {
      return res.status(503).json({ code: 'provider_unavailable', error: 'The embedding service is unavailable — the beacon cannot be placed right now.' });
    }
    if (err.code === 'ETIMEDOUT') {
      return res.status(503).json({ code: 'provider_timeout', error: 'The embedding service timed out. Try again in a moment.' });
    }
    if (err.statusCode === 429 || err.status === 429) {
      return res.status(503).json({ code: 'provider_rate_limited', error: 'The embedding service is rate-limited right now. Try again in a few minutes.' });
    }
    next(err);
  }
});

// ── GET /api/vectors/node/:pointId ──────────────────────────────────────────────────
router.get('/api/vectors/node/:pointId', async (req, res, next) => {
  try {
    const point = await vectorStore.retrieveById(req.params.pointId);
    // 404, never 403 — same existence-oracle reasoning as every other tenant-boundary
    // check in this codebase: ownership is verified AFTER the fetch, since Qdrant's
    // retrieve-by-id API carries no filter to check it before returning the point.
    if (!point || String(point.payload.userId) !== String(req.user._id)) {
      return res.status(404).json({ error: 'Node not found.' });
    }

    const tenant = { userId: String(point.payload.userId), contextId: String(point.payload.contextId) };
    const norm = point.vector ? Math.sqrt(point.vector.reduce((sum, v) => sum + v * v, 0)) : null;
    // "Other chunks sharing this node's document" — a real, tenant-scoped count, not a
    // fabricated graph-neighbor count the projection payload has no data to support.
    const documentChunkCount = await vectorStore.countByDocument(tenant, point.payload.documentId);

    res.json({
      pointId: point.pointId, text: point.payload.text ?? point.payload.ocrText ?? '',
      documentId: point.payload.documentId, fileName: point.payload.fileName ?? null,
      page: point.payload.page ?? null, headingPath: point.payload.headingPath ?? null,
      position: point.payload.position ?? null,
      norm, neighborCount: Math.max(0, documentChunkCount - 1),
    });
  } catch (err) { next(err); }
});

export default router;
