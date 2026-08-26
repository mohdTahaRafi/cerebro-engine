// Context counter maintenance (phase 6 §6.4). `documentCount`/`chunkCount` are
// denormalized onto the Context row so /api/contexts can render every card without an
// aggregation per card (a grid of N contexts would otherwise be N queries). They are kept
// current at three points: on ingest completion (`$inc`, ingestDocument.js), on document
// delete (`$inc` negative, documents.js), and here — called after any bulk operation
// (context creation's initial zero state aside, and the cascade's own final delete). `$inc`
// drifts under partial failures (a crashed request between the Qdrant delete and the Mongo
// `$inc`, a retried job that double-counts); recomputing from the authoritative Document
// rows is what corrects that drift rather than compounding it.
import { Document } from '../models/Document.js';
import { Context } from '../models/Context.js';

export async function recomputeContextCounters(contextId) {
  const [documentCount, chunkAgg] = await Promise.all([
    Document.countDocuments({ contextId }),
    // Only 'ready' documents carry real vectors — a 'queued'/'processing'/'failed' row's
    // chunkCount is 0 by the schema default, and a 'duplicate' row never gets its own
    // vectors at all, so restricting the sum to 'ready' is the literal count of chunks
    // actually indexed under this context, not an optimization.
    Document.aggregate([
      { $match: { contextId, status: 'ready' } },
      { $group: { _id: null, total: { $sum: '$chunkCount' } } },
    ]),
  ]);
  const chunkCount = chunkAgg[0]?.total ?? 0;

  await Context.updateOne({ _id: contextId }, { documentCount, chunkCount });
  return { documentCount, chunkCount };
}
