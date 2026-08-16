// GET/PATCH/DELETE /api/threads — thread CRUD and history resume (phase 5 §10.1).
import express from 'express';
import mongoose from 'mongoose';
import { Conversation } from '../../models/Conversation.js';
import { Message } from '../../models/Message.js';
import { Document } from '../../models/Document.js';

const router = express.Router();

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

// ── GET /api/threads ──────────────────────────────────────────────────────────────────
// Paginated, sorted lastMessageAt desc, with a message count per thread.
router.get('/api/threads', async (req, res, next) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 20)));

    const [threads, total] = await Promise.all([
      Conversation.find().sort({ lastMessageAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      Conversation.countDocuments(),
    ]);

    const counts = await Message.aggregate([
      { $match: { conversationId: { $in: threads.map((t) => t._id) } } },
      { $group: { _id: '$conversationId', count: { $sum: 1 } } },
    ]);
    const countByThread = new Map(counts.map((c) => [String(c._id), c.count]));

    res.json({
      threads: threads.map((t) => ({ ...t, messageCount: countByThread.get(String(t._id)) ?? 0 })),
      page, limit, total, totalPages: Math.ceil(total / limit),
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/threads/:id ──────────────────────────────────────────────────────────────
// Full message list, ascending, with resolved source metadata.
router.get('/api/threads/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Thread not found.' });

    const thread = await Conversation.findById(req.params.id).lean();
    if (!thread) return res.status(404).json({ error: 'Thread not found.' });

    const messages = await Message.find({ conversationId: req.params.id }).sort({ createdAt: 1 }).lean();

    // Phase 5 §10.2: resuming a thread whose cited documents have since been deleted.
    // Sources are annotated, never dropped — the historical answer genuinely was
    // grounded in that document, and erasing the citation would misrepresent the record.
    //
    // Message.sources (models/Message.js) only ever persists kind/pointId/documentId/
    // page/score — never fileName or chunk text, which live only in Qdrant and would
    // duplicate storage for no read this route needs until now. "Resolved source
    // metadata" means joining today's Document.fileName back in (a rename since the
    // message was written should show the new name) and reconstructing imageUri for a
    // page citation the same way toPublicResult does — not resurrecting the chunk text,
    // which was never stored here and isn't worth a Qdrant round-trip for a history view.
    const documentIds = [...new Set(messages.flatMap((m) => m.sources.map((s) => String(s.documentId))))];
    const docsById = new Map((await Document.find({ _id: { $in: documentIds } }).select('_id fileName').lean())
      .map((d) => [String(d._id), d]));

    const resolved = messages.map((m) => ({
      ...m,
      sources: m.sources.map((s) => {
        const doc = docsById.get(String(s.documentId));
        return {
          ...s,
          available: !!doc,
          fileName: doc?.fileName ?? null,
          imageUri: s.kind === 'page' && doc ? `/api/pages/${s.documentId}/${s.page}.jpg` : null,
        };
      }),
    }));

    // Unwrapped resource + nested related array — matches GET /api/documents/:id's
    // convention (documents.js) rather than introducing a new `{ thread, messages }` shape.
    res.json({ ...thread, messages: resolved });
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/threads/:id ────────────────────────────────────────────────────────────
// Rename ({ title }), max 200 chars.
router.patch('/api/threads/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Thread not found.' });

    const { title } = req.body ?? {};
    if (typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'title is required.' });
    }
    if (title.length > 200) {
      return res.status(400).json({ error: 'title exceeds 200 characters.' });
    }

    const thread = await Conversation.findByIdAndUpdate(
      req.params.id, { title: title.trim() }, { new: true },
    );
    if (!thread) return res.status(404).json({ error: 'Thread not found.' });

    res.json(thread);
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/threads/:id ───────────────────────────────────────────────────────────
// Deletes the conversation and all its messages.
router.delete('/api/threads/:id', async (req, res, next) => {
  try {
    if (!isValidId(req.params.id)) return res.status(404).json({ error: 'Thread not found.' });

    const thread = await Conversation.findById(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found.' });

    const { deletedCount } = await Message.deleteMany({ conversationId: thread._id });
    await thread.deleteOne();

    res.json({ deleted: true, threadId: thread._id, deletedMessages: deletedCount });
  } catch (err) {
    next(err);
  }
});

export default router;
