import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { config } from '../config/index.js';
import { ingestDocumentJob } from './ingestDocument.js';

// Amended during Phase 2 implementation: verified live that a single shared connection
// with `maxRetriesPerRequest: null` — required for the Worker's blocking commands, or it
// would error out on any transient hiccup — also makes `ingestQueue.add()` hang
// indefinitely when Redis is down, instead of rejecting. `docker compose stop redis` then
// `POST /api/documents` reproduced this directly: the request never returned, and the
// Document row created just before the `.add()` call sat in Mongo as an orphaned 'queued'
// row for as long as Redis stayed down. Architecture §6.2's stated failure mode — "Upload
// returns 503 before writing the Document row" — requires the enqueue call to fail fast,
// which is a different requirement from the Worker's "never give up mid-job." Two
// connections, one per role:
//
// Worker connection — unlimited per-request retries, exactly as BullMQ's docs require, so
// a mid-job Redis blip doesn't crash the long-lived worker process.
const workerConnection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });

// Queue connection — used only by the HTTP-facing enqueue path. `maxRetriesPerRequest: 1`
// bounds an individual in-flight command (e.g. one `.add()` call) to one retry before it
// rejects — this is the fail-fast half. `retryStrategy` is deliberately left at its
// ioredis default (bounded backoff, never returns null) rather than given a cap: that
// governs the *background* reconnect loop, a separate concern from a single command's
// retry budget. Returning null there was an earlier, wrong version of this fix — verified
// live it makes ioredis give up reconnecting permanently, so the connection never
// recovers even after Redis comes back up. Leaving it at the default means the client
// keeps trying to reconnect indefinitely in the background while every command issued
// during the outage still fails fast.
const queueConnection = new IORedis(config.redis.url, { maxRetriesPerRequest: 1 });

export const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },   // 5s → 25s → 125s
  removeOnComplete: { age: 86_400, count: 1000 },   // keep 24h of history for the UI
  removeOnFail: { age: 604_800 },                   // keep failures 7 days for debugging
};

export const ingestQueue = new Queue('ingest', { connection: queueConnection });

let worker = null;
let sawConnectionError = false;   // set on the Worker's first error, consumed on next 'ready'

function buildWorker() {
  const w = new Worker('ingest', ingestDocumentJob, {
    connection: workerConnection,
    concurrency: 2,          // architecture §6: >2 saturates CPU-bound work in Phase 4
    lockDuration: 300_000,   // 5 min — a 100-page LlamaParse job must not lose its lock
  });

  w.on('failed', (job, err) => {
    console.error(`[ingest] job ${job?.id} failed (attempt ${job?.attemptsMade}/3):`, err.message);
  });
  w.on('completed', (job) => {
    console.log(`[ingest] job ${job.id} completed`);
  });
  // Without a listener, an 'error' event on any Node EventEmitter (BullMQ's Worker
  // included) throws and crashes the process — this is Node's default behavior for the
  // 'error' event specifically, not a BullMQ quirk. A Redis connection blip during a
  // long-running worker must log and keep running, not take the whole backend down.
  w.on('error', (err) => {
    console.error('[ingest] worker connection error:', err.message);
    sawConnectionError = true;
  });
  return w;
}

// Amended during Phase 2 implementation: verified live, reproducibly, that BullMQ's
// Worker does not reliably resume its internal job-fetch loop after a Redis outage even
// once the underlying connection reports 'ready' again — `docker compose stop redis` then
// `start redis` while a Worker was already running left every subsequently-added job
// sitting in 'waiting' with zero 'active', indefinitely, confirmed via
// `ingestQueue.getJobCounts()`. A brand new Worker instance against the same
// now-healthy connection picks the same jobs up immediately, so the fix is to rebuild the
// Worker (not the connection, which does recover correctly on its own) once the
// connection comes back from an outage.
workerConnection.on('ready', () => {
  if (!sawConnectionError) return;   // first boot — nothing to recover from
  sawConnectionError = false;
  console.warn('[ingest] Redis connection recovered after an outage — rebuilding the worker to re-establish its fetch loop');
  const old = worker;
  worker = buildWorker();
  old?.close().catch((err) => console.error('[ingest] error closing stale worker:', err.message));
});

export function startWorker() {
  if (worker) return worker;
  worker = buildWorker();
  return worker;
}
