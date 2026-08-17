// POST /api/search (phase 3 §8). Mounts at the same path the legacy MongoDB-backed
// handler served — this is the first cutover point: /api/search now reads Qdrant instead
// of MongoDB. The legacy handler's module was deleted in Phase 6 (§5.1) once this path
// had soaked.
import express from 'express';
import { search } from '../../retrieval/search.js';
import { MAX_QUERY_CHARS, TOP_N_DEFAULT, TOP_N_MIN, TOP_N_MAX } from '../../retrieval/constants.js';

const router = express.Router();

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function isArrayOfObjectIds(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && OBJECT_ID_RE.test(v));
}

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

router.post('/api/search', async (req, res, next) => {
  const { query, documentIds, topN } = req.body ?? {};

  if (typeof query !== 'string' || query.trim() === '') {
    return res.status(400).json({ error: 'Query text is required.' });
  }
  if (query.length > MAX_QUERY_CHARS) {
    return res.status(400).json({ error: `Query exceeds ${MAX_QUERY_CHARS} characters.` });
  }
  if (documentIds !== undefined && !isArrayOfObjectIds(documentIds)) {
    return res.status(400).json({ error: 'documentIds must be an array of document ids.' });
  }

  try {
    const result = await search(query, {
      documentIds: documentIds ?? null,
      topN: clamp(Number(topN ?? TOP_N_DEFAULT), TOP_N_MIN, TOP_N_MAX),
    });
    res.json({ query, ...result });
  } catch (err) {
    // The qdrant.chunks breaker (vectorStore.js) is the one on the critical path here —
    // rerank failures are absorbed by rerankOrDegrade and never reach this catch.
    if (err.code === 'EOPENBREAKER') {
      return res.status(503).json({ status: 'Circuit Open', error: 'Search is temporarily unavailable.' });
    }
    next(err);
  }
});

export default router;
