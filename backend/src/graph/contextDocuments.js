// The ready documents a question is asked over, by file name — shared by condense (which
// resolves "the document" / "this guy" against it) and generate (which shows the model the
// whole collection, BUG-004). `contextId: null` is the deliberate user-wide scope
// (vectorStore.js §2) and lists across all the user's contexts; `documentIds` narrows to an
// explicit per-question scope. A lookup failure degrades to an empty list rather than
// failing the turn: both callers treat the list as context, never as a requirement.
import { Document } from '../models/Document.js';

export async function loadContextDocuments(tenant, { limit, documentIds = null } = {}) {
  if (!tenant?.userId) return { names: [], total: 0 };
  try {
    const filter = { userId: tenant.userId, status: 'ready' };
    if (tenant.contextId) filter.contextId = tenant.contextId;
    if (documentIds?.length) filter._id = { $in: documentIds };
    const [docs, total] = await Promise.all([
      Document.find(filter).sort({ updatedAt: -1 }).limit(limit).select('fileName').lean(),
      Document.countDocuments(filter),
    ]);
    return { names: docs.map((d) => d.fileName), total };
  } catch (err) {
    console.warn('[graph] could not list context documents:', err.message);
    return { names: [], total: 0 };
  }
}
