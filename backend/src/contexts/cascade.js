// The context-delete cascade (phase 6 §6.1) — vectors first, registry last, the same
// discipline v1 uses for a single document's delete (documents.js). Every step is a
// delete-by-filter that is a no-op the second time, so the whole job is idempotent: a
// retry resumes from wherever the previous attempt left off rather than corrupting state.
// The reverse order would orphan points with no row pointing at them, which nothing would
// ever collect.
import fs from 'fs/promises';
import { Context } from '../models/Context.js';
import { Document } from '../models/Document.js';
import { Conversation } from '../models/Conversation.js';
import { Message } from '../models/Message.js';
import { Trace } from '../models/Trace.js';
import { Projection } from '../models/Projection.js';
import { recordPipelineError } from '../telemetry/pipelineError.js';
import * as vectorStore from '../providers/vectorStore.js';
import * as storage from '../providers/storage.js';

export async function cascadeDeleteContext(contextId, userId) {
  const tenant = { userId: String(userId), contextId: String(contextId) };

  // 1. Mark 'deleting' — excluded from list queries from this instant. Idempotent: a
  //    retry finds it already 'deleting' and updateOne is a no-op.
  await Context.updateOne({ _id: contextId }, { status: 'deleting' });

  // 2-3. Vectors — cerebro_chunks, then cerebro_pages, by {userId, contextId}.
  await vectorStore.deleteByContext(tenant);
  await vectorStore.deletePagesByContext(tenant);

  // 4-5. Page images and uploaded source files, per document. Read the document list
  //      fresh each call rather than caching it across a retry — a first attempt that
  //      died after deleting file N's storage still has documents N+1..end to clean up,
  //      and a die after step 6 (registry deleted) means this list is now empty, which is
  //      exactly the no-op a retry needs.
  const docs = await Document.find({ userId, contextId }).select('_id storagePath').lean();
  for (const doc of docs) {
    // eslint-disable-next-line no-await-in-loop
    await storage.deletePrefix(`pages/${doc._id}/`);
    // eslint-disable-next-line no-await-in-loop
    await fs.unlink(doc.storagePath).catch(() => {});   // may already be gone, or shared by a duplicate row
  }

  // 6. Document registry.
  await Document.deleteMany({ userId, contextId });

  // 7-8. Conversations and their messages.
  const threadIds = await Conversation.find({ userId, contextId }).distinct('_id');
  await Message.deleteMany({ conversationId: { $in: threadIds } });
  await Conversation.deleteMany({ userId, contextId });

  // 9. Traces and the cached vector projection — a context that no longer exists must
  //    leave no orphaned Trace rows (the 30-day TTL would eventually reclaim them, but a
  //    trace whose contextId resolves to nothing is a dangling reference until then) and
  //    no stale Projection row, which nothing else would ever collect.
  await Trace.deleteMany({ userId, contextId });
  await Projection.deleteOne({ contextId });

  // 10. The context row itself, last.
  await Context.deleteOne({ _id: contextId });
}

// Phase 6 §6.3: failure mode. Called by the queue's own 'failed' handler once BullMQ has
// exhausted its retry attempts (context/queue.js's JOB_OPTS) — the context is left at
// `status: 'deleting'` (never silently marked deleted with vectors still in Qdrant: an
// orphaned point that still matches a tenant filter would be returned by that tenant's
// future queries, citing a document that no longer exists) and a `pipeline_errors` row
// records the failure so the UI's retry button has something to show.
export async function recordCascadeFailure(contextId, userId, err) {
  await recordPipelineError('queue', { message: `Context deletion failed: ${err.message}`, stack: err.stack }, {
    userId, contextId, retryable: true,
  });
}
