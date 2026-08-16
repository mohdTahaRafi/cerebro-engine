import express from 'express';
import { Document } from '../../models/Document.js';
import * as storage from '../../providers/storage.js';

const router = express.Router();

// GET /api/pages/:documentId/:page.jpg — serves a rendered scanned page (phase 4 §7.5).
// The Mongo existence check runs before the storage read specifically so a deleted
// document's images become unreachable immediately, even if storage cleanup lags.
router.get('/api/pages/:documentId/:page.jpg', async (req, res, next) => {
  try {
    const doc = await Document.findById(req.params.documentId).select('_id');
    if (!doc) return res.status(404).end();      // deleted document ⇒ image unreachable

    const key = `pages/${req.params.documentId}/${req.params.page}.jpg`;
    if (!(await storage.exists(key))) return res.status(404).end();

    // storage.get() reads the whole file into memory rather than streaming it (deviating
    // from the phase 4 §7.5 sample's `.pipe(res)`) — this keeps storage.js's documented
    // four-function adapter interface (put/get/delete/exists, phase 2 §7) intact rather
    // than adding a fifth method for one call site. A page JPEG is ~250KB (phase 4 §11),
    // so buffering it costs nothing measurable.
    const buf = await storage.get(key);
    res.set('Content-Type', 'image/jpeg');
    // `private`: keeps document images out of shared/CDN caches — they may be
    // access-scoped later and must not be cached on a path any client could guess.
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

export default router;
