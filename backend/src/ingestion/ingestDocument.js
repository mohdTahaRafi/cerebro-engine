import path from 'path';
import { UnrecoverableError } from 'bullmq';
import { Document } from '../models/Document.js';
import * as parser from '../providers/parser.js';
import * as embeddings from '../providers/embeddings.js';
import * as vectorStore from '../providers/vectorStore.js';
import { chunkPages } from './chunker.js';
import { normalize } from './normalize.js';
import { rollbackDocument } from './rollback.js';
import { classify } from './errors.js';
import { recordUsage } from '../telemetry/usage.js';

export async function ingestDocumentJob(job) {
  const { documentId } = job.data;
  const doc = await Document.findById(documentId);
  if (!doc) throw new UnrecoverableError(`Document ${documentId} no longer exists`);

  try {
    await doc.updateOne({ status: 'processing', progress: 5, error: null });

    // 1. Parse ────────────────────────────────────────────── 5% → 45%
    const ext = path.extname(doc.fileName).toLowerCase();
    const pages = await parser.parseDocument(doc.storagePath, ext);
    if (pages.length === 0 || pages.every((p) => normalize(p.text).length === 0)) {
      const err = new Error('Document contains no extractable text.');
      err.code = 'NO_EXTRACTABLE_CONTENT';   // permanent — a re-parse yields the same
      throw err;
    }
    await job.updateProgress(45);

    // 2. Normalize + chunk ────────────────────────────────── 45% → 55%
    const chunks = await chunkPages(pages, {
      documentId: doc._id.toString(),
      fileName: doc.fileName,
      mimeType: doc.mimeType,
      contentHash: doc.contentHash,
    });
    await doc.updateOne({ progress: 55, pageCount: pages.length });

    // 3. Embed ────────────────────────────────────────────── 55% → 85%
    const texts = chunks.map((c) => (c.headingPath ? `${c.headingPath}\n\n${c.text}` : c.text));
    const [{ vectors: dense, totalTokens }, sparse] = await Promise.all([
      embeddings.encodeDocuments(texts),
      embeddings.encodeSparse(texts),
    ]);
    await job.updateProgress(85);

    // 4. Upsert ───────────────────────────────────────────── 85% → 100%
    await vectorStore.upsertChunks(chunks, dense, sparse);

    await doc.updateOne({ status: 'ready', progress: 100, chunkCount: chunks.length, error: null });
    await recordUsage({ provider: 'cohere', operation: 'embed', inputTokens: totalTokens, documentId });
  } catch (err) {
    // Atomicity (NFR-REL-03): remove every trace before recording the failure, so a
    // failed document is never partially queryable and a retry starts from clean state.
    // Rollback itself is wrapped: if the failure IS Qdrant being unreachable, the delete
    // call fails too — but in that case nothing was written in the first place (the
    // upsert that triggered this catch never got past its first batch), so there is
    // nothing to clean up and the status update below must still happen regardless. If a
    // partial upsert did land before a later batch failed, a transient error here means
    // BullMQ retries the whole job (classify() below), and the retry's own rollback call
    // — once Qdrant is reachable again — deletes whatever the first attempt left behind.
    try {
      await rollbackDocument(documentId);
    } catch (rollbackErr) {
      console.warn(`[ingest] rollback for ${documentId} failed (will retry on next attempt if transient):`, rollbackErr.message);
    }
    await Document.findByIdAndUpdate(documentId, {
      status: 'failed', progress: 0, error: err.message, chunkCount: 0,
    });
    throw classify(err);
  }
}
