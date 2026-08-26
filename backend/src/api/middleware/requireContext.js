// requireContext — resolves and verifies ownership of a context, and is the ONLY place
// `req.tenant` is constructed (phase 6 §5.2). No route builds one from request input.
import mongoose from 'mongoose';
import { Context } from '../../models/Context.js';

export async function requireContext(req, res, next) {
  const contextId = req.params.contextId ?? req.body?.contextId ?? req.query?.contextId;
  if (!contextId || !mongoose.Types.ObjectId.isValid(contextId)) {
    return res.status(400).json({ code: 'context_required', message: 'Select a context.' });
  }
  const ctx = await Context.findOne({ _id: contextId, userId: req.user._id }).lean();

  // 404, never 403. A 403 confirms the context exists, which is an existence oracle
  // across the tenant boundary (architecture §9). A foreign id and a nonexistent id are
  // indistinguishable from outside.
  if (!ctx) return res.status(404).json({ code: 'context_not_found', message: 'Context not found.' });
  if (ctx.status === 'deleting') {
    return res.status(409).json({ code: 'context_deleting', message: 'This context is being deleted.' });
  }

  req.context = ctx;
  req.tenant = { userId: String(req.user._id), contextId: String(ctx._id) };
  next();
}
