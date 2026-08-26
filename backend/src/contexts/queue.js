// The context-delete queue (phase 6 §6.2) — a SEPARATE BullMQ queue from `ingest`
// (ingestion/queue.js), at concurrency 1. Deleting 50 documents means two Qdrant
// delete-by-filter calls, 50 S3 prefix deletes, and four Mongo deletes — up to 20 seconds
// (architecture §8). Running that on the ingest queue would occupy one of its two workers
// for that whole span and stall every upload in the system; a dedicated queue means a
// context delete never competes with ingestion for a worker slot. Concurrency 1 (not 2,
// like ingest) because a cascade is I/O-bound on Qdrant/S3/Mongo round trips, not
// CPU-bound — nothing here benefits from running two cascades in parallel, and this repo
// runs one backend instance, so a single worker draining one cascade at a time is enough
// to keep the queue from backing up under normal use.
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';
import { cascadeDeleteContext, recordCascadeFailure } from './cascade.js';

// Same two-connection split as ingestion/queue.js, for the same reason: the worker needs
// unlimited per-command retries (BullMQ's blocking commands must survive a Redis blip
// mid-job), while the HTTP-facing enqueue path needs to fail fast so `DELETE
// /api/contexts/:id` can return 503 instead of hanging when Redis is down.
const workerConnection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });
const queueConnection = new IORedis(config.redis.url, { maxRetriesPerRequest: 1 });

export const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },   // 5s → 25s → 125s — same as ingest
  removeOnComplete: { age: 86_400, count: 1000 },
  removeOnFail: { age: 604_800 },
};

// BullMQ queue names cannot contain ':' (only job names can — 'ingest:document' on the
// ingest queue is a job name on a queue literally named 'ingest') — 'context-delete' is
// the queue, 'context:delete' (routes/contexts.js's `.add()` call) is the job name.
export const contextDeleteQueue = new Queue('context-delete', { connection: queueConnection });

async function processCascade(job) {
  const { contextId, userId } = job.data;
  await cascadeDeleteContext(contextId, userId);
}

let worker = null;
let sawConnectionError = false;

function buildWorker() {
  const w = new Worker('context-delete', processCascade, {
    connection: workerConnection,
    concurrency: 1,
    lockDuration: 60_000,   // 60s — generous over the ~20s budget for a 50-document context
  });

  w.on('failed', async (job, err) => {
    console.error(`[context:delete] job ${job?.id} failed (attempt ${job?.attemptsMade}/3):`, err.message);
    // Only after every retry is exhausted — a transient mid-cascade failure that BullMQ
    // will retry successfully is not the permanent failure §6.3 wants surfaced.
    if (job && job.attemptsMade >= (job.opts.attempts ?? 1)) {
      await recordCascadeFailure(job.data.contextId, job.data.userId, err).catch((recordErr) => {
        console.error('[context:delete] failed to record pipeline_errors row:', recordErr.message);
      });
    }
  });
  w.on('completed', (job) => {
    console.log(`[context:delete] job ${job.id} completed — context ${job.data.contextId} removed`);
  });
  // Same reasoning as ingestion/queue.js's identical listener: an unhandled 'error' event
  // on a BullMQ Worker crashes the process.
  w.on('error', (err) => {
    console.error('[context:delete] worker connection error:', err.message);
    sawConnectionError = true;
  });
  return w;
}

// Same rebuild-on-recovery behavior as ingestion/queue.js, for the identical, verified-live
// reason: a BullMQ Worker's internal fetch loop does not reliably resume on its own after a
// Redis outage even once the connection itself reports 'ready' again.
workerConnection.on('ready', () => {
  if (!sawConnectionError) return;
  sawConnectionError = false;
  console.warn('[context:delete] Redis connection recovered after an outage — rebuilding the worker');
  const old = worker;
  worker = buildWorker();
  old?.close().catch((err) => console.error('[context:delete] error closing stale worker:', err.message));
});

export function startContextDeleteWorker() {
  if (worker) return worker;
  worker = buildWorker();
  return worker;
}
