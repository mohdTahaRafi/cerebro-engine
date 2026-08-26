// The projection queue (phase 7 §4.5) — BullMQ 'projection', concurrency 1 across the
// whole process. A fit is CPU-bound (umap-js) and blocks nothing else in this worker
// (fitAsync yields between epochs, fit.js's own comment), so one concurrent fit at a
// time is a deliberate simplicity choice, not a throughput ceiling this deployment has
// hit — this repo runs one backend instance, same reasoning as the context-delete queue.
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';
import { Projection } from '../models/Projection.js';
import { fitContext, PROJECTION_PARAMS, PROJECTION_SEED } from './fit.js';
import { recordPipelineError } from '../telemetry/pipelineError.js';

// Same two-connection split as ingestion/queue.js and contexts/queue.js, for the
// identical reason: the worker needs unlimited per-command retries (BullMQ's blocking
// commands must survive a Redis blip mid-job), while the HTTP-facing enqueue path needs
// to fail fast rather than hang a request behind a dead Redis connection.
const workerConnection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });
const queueConnection = new IORedis(config.redis.url, { maxRetriesPerRequest: 1 });

export const JOB_OPTS = {
  attempts: 2,
  backoff: { type: 'exponential', delay: 5_000 },   // 5s → 25s
  removeOnComplete: { age: 86_400, count: 500 },
  removeOnFail: { age: 604_800 },
};

export const projectionQueue = new Queue('projection', { connection: queueConnection });

// Enqueued on: ingest completion, document delete, and an explicit rebuild action. NOT
// on every chunk upsert (§4.5) — ingestDocument.js calls this once per document, at
// completion, not per chunk.
//
// `jobId: projection-${contextId}` is the dedup key BullMQ enforces: `.add()` with a
// jobId already waiting/active is a silent no-op (task 7.15's "ten uploads, one job").
// A dash, not a colon — verified live: BullMQ's Job.js rejects any custom id containing
// ':' ("Custom Id cannot contain :"), since it uses colons internally for the Redis key
// namespace a job's id becomes part of. The queue NAME can't contain one either (the
// context-delete queue's own comment already notes this for queue names); this is the
// same restriction, discovered here for job ids specifically.
// The Projection row is flipped to 'fitting' here, synchronously, BEFORE the job is
// even confirmed enqueued — a context whose fit is stale must read as 'rebuilding'
// immediately (§4.4), not only once a worker slot picks the job up.
export async function enqueueProjectionRebuild(tenant) {
  try {
    await Projection.updateOne(
      { contextId: tenant.contextId },
      { $set: { status: 'fitting' }, $setOnInsert: { userId: tenant.userId, contextId: tenant.contextId } },
      { upsert: true },
    );
    await projectionQueue.add(
      'projection:fit',
      { userId: tenant.userId, contextId: tenant.contextId },
      { ...JOB_OPTS, jobId: `projection-${tenant.contextId}` },
    );
  } catch (err) {
    // A Redis outage here must not fail the ingest/delete request it was called from —
    // the projection is an inspection artifact, and the next successful enqueue call
    // (the next upload, or the console's own retry) picks the corpus up correctly.
    console.error(`[projection] failed to enqueue rebuild for context ${tenant.contextId}:`, err.message);
  }
}

async function processFit(job) {
  const tenant = { userId: job.data.userId, contextId: job.data.contextId };
  const result = await fitContext(tenant);

  if (result.status === 'failed') {
    await Projection.updateOne(
      { contextId: tenant.contextId },
      { userId: tenant.userId, contextId: tenant.contextId, status: 'failed', reason: result.reason },
      { upsert: true },
    );
    return;
  }

  await Projection.updateOne(
    { contextId: tenant.contextId },
    {
      userId: tenant.userId, contextId: tenant.contextId,
      status: 'fresh', reason: null,
      nodeCount: result.nodeCount, pointIds: result.pointIds,
      positions: result.positions, docIndex: result.docIndex,
      documents: result.documents, bounds: result.bounds,
      params: {
        nNeighbors: PROJECTION_PARAMS.nNeighbors, minDist: PROJECTION_PARAMS.minDist,
        spread: PROJECTION_PARAMS.spread, seed: PROJECTION_SEED,
      },
      fittedChunkCount: result.fittedChunkCount, fittedAt: new Date(),
    },
    { upsert: true },
  );
}

let worker = null;
let sawConnectionError = false;

function buildWorker() {
  const w = new Worker('projection', processFit, {
    connection: workerConnection,
    concurrency: 1,
    lockDuration: 90_000,   // 90s — comfortably over the 60s budget for the 20,000-node cap
  });

  w.on('failed', async (job, err) => {
    console.error(`[projection] job ${job?.id} failed (attempt ${job?.attemptsMade}/${JOB_OPTS.attempts}):`, err.message);
    // Only after every retry is exhausted — a transient Qdrant/Mongo blip BullMQ retries
    // successfully is not the permanent failure the error stream should surface.
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      const { userId, contextId } = job.data ?? {};
      await Projection.updateOne(
        { contextId },
        { userId, contextId, status: 'failed', reason: `Projection fit failed: ${err.message}` },
        { upsert: true },
      ).catch(() => {});
      await recordPipelineError('projection', err, { userId, contextId, retryable: true });
    }
  });
  w.on('completed', (job) => {
    console.log(`[projection] job ${job.id} completed — context ${job.data.contextId} fitted`);
  });
  // Same reasoning as every other Worker in this codebase: an unhandled 'error' event on
  // a BullMQ Worker crashes the process.
  w.on('error', (err) => {
    console.error('[projection] worker connection error:', err.message);
    sawConnectionError = true;
  });
  return w;
}

// Same rebuild-on-recovery behavior as ingestion/queue.js and contexts/queue.js, for the
// identical, verified-live reason documented there: a BullMQ Worker's internal fetch
// loop does not reliably resume on its own after a Redis outage even once the underlying
// connection reports 'ready' again.
workerConnection.on('ready', () => {
  if (!sawConnectionError) return;
  sawConnectionError = false;
  console.warn('[projection] Redis connection recovered after an outage — rebuilding the worker');
  const old = worker;
  worker = buildWorker();
  old?.close().catch((err) => console.error('[projection] error closing stale worker:', err.message));
});

export function startProjectionWorker() {
  if (worker) return worker;
  worker = buildWorker();
  return worker;
}
