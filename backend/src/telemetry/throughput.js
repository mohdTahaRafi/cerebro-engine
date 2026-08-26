// Ingest queue throughput (phase 7 §5.1). `throughputPerMin` needs a real source: BullMQ's
// own `completed` job count is cumulative since the queue was created and says nothing
// about rate. The worker ZADDs `queue:completions` with the completion timestamp as both
// score and member on every finished job; the endpoint ZCOUNTs the last 60 seconds.
//
// Reuses redis.js's `redisClient()` (fail-fast, `enableOfflineQueue: false`) rather than
// opening a third dedicated connection — this is exactly the "Redis only" workload
// /health's probe client is already built for.
import { redisClient } from '../redis.js';

const KEY = 'queue:completions';
// 5 minutes of history is generous over the 60s window the endpoint actually reads —
// enough slack that a burst of completions right at a minute boundary is never
// undercounted by a trim that ran a moment too early.
const RETENTION_MS = 5 * 60_000;

export async function recordCompletion() {
  const now = Date.now();
  const client = redisClient();
  try {
    await client.zadd(KEY, now, `${now}:${Math.random().toString(36).slice(2, 8)}`);
    // A ZREMRANGEBYSCORE on each write trims anything older than 5 minutes, so the set
    // stays bounded regardless of ingest volume — never a separate cron/sweep job.
    await client.zremrangebyscore(KEY, 0, now - RETENTION_MS);
  } catch (err) {
    // Best-effort: a missed throughput sample must never fail the ingest job whose
    // completion triggered it.
    console.warn('[throughput] failed to record completion:', err.message);
  }
}

export async function getThroughputPerMin() {
  const now = Date.now();
  try {
    return await redisClient().zcount(KEY, now - 60_000, now);
  } catch (err) {
    console.warn('[throughput] failed to read throughput:', err.message);
    return null;
  }
}
