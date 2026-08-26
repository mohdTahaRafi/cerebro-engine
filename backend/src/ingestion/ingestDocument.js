import path from 'path';
import fs from 'fs/promises';
import { UnrecoverableError } from 'bullmq';
import { Document } from '../models/Document.js';
import * as parser from '../providers/parser.js';
import * as embeddings from '../providers/embeddings.js';
import * as vectorStore from '../providers/vectorStore.js';
import * as visionService from '../providers/visionService.js';
import * as storage from '../providers/storage.js';
import { chunkPages } from './chunker.js';
import { rollbackDocument } from './rollback.js';
import { classify } from './errors.js';
import { recordUsage } from '../telemetry/usage.js';
import { ingestJobDuration } from '../telemetry/metrics.js';
import { config } from '../config/index.js';
import { recomputeContextCounters } from '../contexts/counters.js';
import { recordPipelineError } from '../telemetry/pipelineError.js';
import { enqueueProjectionRebuild } from '../projection/worker.js';

// Keeps BullMQ's own job.progress (internal queue bookkeeping) and the Document row's
// `progress` field (what GET /api/documents/:id and :id/status actually serve to the
// poller) in lock-step. Phase 2/3 called job.updateProgress() alone at some band
// boundaries, which never touched doc.progress — invisible to a client polling the
// document, and not what phase 4's milestone walk (§9: "climbs past 15%... sits at
// 45-75%...") requires. Every band boundary in this job goes through this helper instead.
//
// Phase 7 §5.3: `stage`/`stageDetail` are written at the same six calls — the real
// backend truth that retires the frontend's client-side status+progress derivation.
async function updateProgress(doc, job, pct, stage, stageDetail = null) {
  await Promise.all([doc.updateOne({ progress: pct, stage, stageDetail }), job.updateProgress(pct)]);
}

// Phase 7 §5.3, §5.2: ingestDocument.js's catch block is one of the writers listed for
// recordPipelineError — 'parse' for the permanent, pre-Qdrant failure modes classify()
// already recognizes (bad container, no extractable content, unsupported type); 'embed'
// for everything else (a transient provider/network failure during embed/upsert, the
// stage most of this job's wall-clock time is actually spent in).
const PARSE_CODES = new Set(['UNSUPPORTED_FILE_TYPE', 'CORRUPT_DOCUMENT', 'NO_EXTRACTABLE_CONTENT']);
function pipelineErrorKind(err) {
  return PARSE_CODES.has(err.code) ? 'parse' : 'embed';
}

// architecture §6.2: a vision-service outage degrades the document rather than failing
// it. The text path still completes and the document still reaches 'ready' — just with
// its scanned pages unindexed and a warning naming how many were skipped.
async function embedVisualPages(doc, pages, job) {
  try {
    return await visionService.embedPages(doc.storagePath, doc._id.toString(), pages);
  } catch (err) {
    console.warn(`[ingest] vision service unavailable for ${doc._id}: ${err.message}`);
    await doc.updateOne({
      warnings: [`${pages.length} scanned page(s) were skipped: ${err.message}`],
    });
    return [];        // text pages still complete; document reaches 'ready'
  }
}

// Phase 6 §8, §12: the Python vision service has no S3 awareness of its own — it always
// writes each rendered page JPEG to PAGE_STORAGE_DIR on local disk (vision/app/routes.py's
// `_process_pages`), a decision that keeps the vision container's job purely computational
// and avoids re-implementing storage.js's driver selection in a second language. In
// production (STORAGE_DRIVER=s3), docker-compose.prod.yml mounts that same local path as a
// shared scratch volume into *this* container too — visionResults[].imageUri is already
// storage.js's own key format ("pages/<documentId>/<page>.jpg", routes.py's literal
// construction), so once the page is written there this reads it back off the shared volume
// and uploads it through the real storage driver, then deletes the staging copy.
//
// Deleting matters: without it the shared volume grows without bound, keeping a full second
// copy of every page image ever ingested for the lifetime of the deployment, with nothing
// that would ever reclaim it (document deletion routes through storage.deletePrefix, which
// under the S3 driver only touches the bucket). The staging copy is scratch space for one
// hand-off, not a tier of storage.
//
// On STORAGE_DRIVER=filesystem this is skipped entirely rather than run as a read-then-write
// of a file onto itself: there, PAGE_STORAGE_DIR *is* the storage backend, so the vision
// service has already written the page to its canonical, authoritative location — and
// deleting the "staging" copy would delete the only copy.
async function syncPageImagesToStorage(visionResults) {
  if (visionResults.length === 0 || config.storage.driver !== 's3') return;

  for (const page of visionResults) {
    const stagingPath = path.join(config.storage.pagesDir, '..', page.imageUri);
    try {
      // eslint-disable-next-line no-await-in-loop
      const buf = await fs.readFile(stagingPath);
      // eslint-disable-next-line no-await-in-loop
      await storage.put(page.imageUri, buf);
      // eslint-disable-next-line no-await-in-loop
      await fs.unlink(stagingPath).catch((err) => {
        // The upload succeeded, which is what correctness depends on — a staging file that
        // could not be removed is a disk-space concern to log, not a reason to fail or
        // retry an ingestion that has otherwise completed.
        console.warn(`[ingest] page image ${page.imageUri} uploaded but staging copy remains: ${err.message}`);
      });
    } catch (err) {
      // A page whose image failed to sync still has its OCR text and multivector
      // indexed below — it degrades to "citable but not viewable" rather than failing
      // the whole document, the same asymmetry embedVisualPages' own catch above accepts
      // for a vision-service outage.
      console.warn(`[ingest] failed to sync page image ${page.imageUri} to storage: ${err.message}`);
    }
  }
}

export async function ingestDocumentJob(job) {
  const { documentId } = job.data;
  const jobT0 = performance.now();
  const doc = await Document.findById(documentId);
  if (!doc) throw new UnrecoverableError(`Document ${documentId} no longer exists`);
  // Phase 6 §2: every Document row carries userId/contextId from creation onward
  // (routes/contexts.js), so the tenant is always resolvable here, before any Qdrant call.
  const tenant = { userId: String(doc.userId), contextId: String(doc.contextId) };

  try {
    await doc.updateOne({ status: 'processing', progress: 5, stage: 'parsing', stageDetail: null, error: null, warnings: [] });

    const ext = path.extname(doc.fileName).toLowerCase();
    const base = {
      documentId: doc._id.toString(), fileName: doc.fileName, mimeType: doc.mimeType,
      contentHash: doc.contentHash,
    };

    // 1. Classify (PDF only) ──────────────────────────────── 5% → 15%
    let routing = { textPages: null, visualPages: [] };
    if (doc.mimeType === 'application/pdf') {
      routing = await visionService.classify(doc.storagePath);
      await doc.updateOne({
        pageCount: routing.pageCount,
        textPageCount: routing.textPages.length,
        visualPageCount: routing.visualPages.length,
      });
    }
    await updateProgress(doc, job, 15, 'parsing');

    // 2. Text path — unchanged from Phase 2, restricted to text pages ── 15% → 45%
    // Skipped entirely when classification found zero text pages: parsing pages that
    // will all be discarded wastes a paid LlamaParse job on a document already known to
    // contain nothing the text path will use (decided during implementation — the phase
    // 4 spec's sample runs the parse unconditionally).
    let parsed = [];
    if (!routing.textPages || routing.textPages.length > 0) {
      parsed = await parser.parseDocument(doc.storagePath, ext);
    }
    const textPages = routing.textPages
      ? parsed.filter((p) => routing.textPages.includes(p.metadata.page))
      : parsed;
    // Phase 7 §5.3: the sub-label the milestone walks literally ("OCR and page embedding,
    // 12 pages") — built here, server-side, from the real visualPageCount classification
    // just found, so the client renders it verbatim rather than inventing wording.
    const visualStageDetail = routing.visualPages.length > 0
      ? `OCR and page embedding, ${routing.visualPages.length} page${routing.visualPages.length === 1 ? '' : 's'}`
      : null;
    await updateProgress(doc, job, 45, 'parsing', visualStageDetail);

    // 3. Visual path ──────────────────────────────────────── 45% → 75%
    let visualResults = [];
    if (routing.visualPages.length > 0) {
      visualResults = await embedVisualPages(doc, routing.visualPages, job);
      await syncPageImagesToStorage(visualResults);
    }
    await updateProgress(doc, job, 75, 'chunking');

    // 4. Chunk text pages + OCR text together ──────────────── 75% → 85%
    const chunks = [
      ...await chunkPages(textPages, base),
      ...await chunkPages(
        visualResults.map((v) => ({ text: v.ocrText, metadata: { page: v.page } })),
        { ...base, sourceKind: 'ocr' },          // marks provenance for merge.js's dedup
      ),
    ];
    if (!routing.textPages) await doc.updateOne({ pageCount: parsed.length });   // non-PDF: unset by step 1
    await updateProgress(doc, job, 85, 'embedding');

    // The no-content reversal (§6.2): a fully scanned PDF has zero extractable text *and*
    // is perfectly ingestable via the visual path, so "no content" must mean neither path
    // produced anything usable. `hasVisual` is deliberately keyed on `routing.visualPages`
    // (what classification found), not `visualResults` (what got successfully embedded
    // this run) — amended from the phase 4 §6.2 sample, which keyed it on
    // `visualResults.length > 0` and would otherwise fail a scanned PDF outright the
    // moment the vision service is down, contradicting §6.3's own degradation contract
    // and task 4.13 ("a scanned PDF still reaches ready" during a vision outage). A
    // document classification already found to be visual is visual regardless of whether
    // this particular run managed to index it.
    const hasText = chunks.length > 0;
    const hasVisual = routing.visualPages.length > 0;
    if (!hasText && !hasVisual) {
      const err = new Error('Document contains no extractable text and no renderable pages.');
      err.code = 'NO_EXTRACTABLE_CONTENT';   // permanent — a re-parse yields the same
      throw err;
    }

    // 5. Embed text + OCR chunks ─────────────────────────────── 85% → 95%
    let totalTokens = 0;
    if (chunks.length > 0) {
      const texts = chunks.map((c) => (c.headingPath ? `${c.headingPath}\n\n${c.text}` : c.text));
      const [{ vectors: dense, totalTokens: tokens }, sparse] = await Promise.all([
        embeddings.encodeDocuments(texts),
        embeddings.encodeSparse(texts),
      ]);
      totalTokens = tokens;
      await vectorStore.upsertChunks(tenant, chunks, dense, sparse);
    }
    await updateProgress(doc, job, 95, 'embedding');

    // 6. Upsert pages ─────────────────────────────────────────── 95% → 100%
    // Only pages that actually carry a multivector. With COLPALI_ENABLED=false the vision
    // service returns `multivector: null` for every page (vision/app/routes.py) — it did
    // the render/deskew/OCR work but not the embedding. Those pages are already fully
    // indexed as OCR chunks in step 4 and their images are already stored, so they stay
    // searchable and citable; writing them here with a null vector would be rejected by
    // Qdrant, and writing an empty list would create points that can never match.
    const embeddablePages = visualResults.filter((p) => Array.isArray(p.multivector) && p.multivector.length > 0);
    if (embeddablePages.length > 0) {
      await vectorStore.upsertPages(tenant, embeddablePages, doc._id.toString(), doc.fileName);
    }

    await doc.updateOne({ status: 'ready', progress: 100, stage: 'ready', stageDetail: null, chunkCount: chunks.length, error: null });
    if (totalTokens > 0) {
      await recordUsage({ provider: 'cohere', operation: 'embed', inputTokens: totalTokens, documentId });
    }
    await recomputeContextCounters(doc.contextId);
    // Phase 7 §4.5: enqueued on ingest completion, not on every chunk upsert — one fit
    // per document, deduplicated per context by the queue's own jobId.
    await enqueueProjectionRebuild(tenant);
    ingestJobDuration.observe({ outcome: 'success' }, (performance.now() - jobT0) / 1000);
  } catch (err) {
    // Atomicity (NFR-REL-03): remove every trace before recording the failure, so a
    // failed document is never partially queryable and a retry starts from clean state.
    // Rollback itself is wrapped: if the failure IS Qdrant/vision being unreachable, the
    // delete calls fail too — but in that case nothing was written in the first place, so
    // there is nothing to clean up and the status update below must still happen
    // regardless. If a partial upsert did land before a later batch failed, a transient
    // error here means BullMQ retries the whole job (classify() below), and the retry's
    // own rollback call — once the dependency is reachable again — deletes whatever the
    // first attempt left behind.
    try {
      await rollbackDocument(tenant, documentId);
    } catch (rollbackErr) {
      console.warn(`[ingest] rollback for ${documentId} failed (will retry on next attempt if transient):`, rollbackErr.message);
    }
    await Document.findByIdAndUpdate(documentId, {
      status: 'failed', progress: 0, stage: 'failed', stageDetail: null, error: err.message, chunkCount: 0,
    });
    // Phase 7 §5.2: ingestDocument.js's own catch is one of the named recordPipelineError
    // writers. `kind` follows classify()'s own permanent/transient split — a permanent
    // failure (bad container, no extractable content, unsupported type) is a 'parse'
    // problem; everything else is 'embed', the stage most of this job's wall-clock time
    // is spent in. Best-effort: the pipeline_errors write is a diagnostic, and its own
    // failure must not mask the real ingest error being thrown below.
    await recordPipelineError(pipelineErrorKind(err), err, {
      userId: tenant.userId, contextId: tenant.contextId, documentId, fileName: doc.fileName,
      retryable: !PARSE_CODES.has(err.code),
    });
    // Recorded per attempt, not per document: a transient failure BullMQ later retries
    // successfully still produces one real 'failure' sample for how long that attempt ran
    // before it errored, same as any other outcome-labeled measurement.
    ingestJobDuration.observe({ outcome: 'failure' }, (performance.now() - jobT0) / 1000);
    throw classify(err);
  }
}
