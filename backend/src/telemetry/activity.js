// Backs cerebro_active_tenants (phase 8 §5.1) without an unbounded per-user label: a
// per-minute Redis SET of userIds, unioned over the last 5 buckets on scrape. The gauge
// itself carries no label at all — this is bookkeeping to compute its single value, not
// a second high-cardinality metric.
import { redisClient } from '../redis.js';

const BUCKET_MS = 60_000;
const WINDOW_BUCKETS = 5;                 // "last 5 minutes"
const KEY_TTL_SECONDS = 600;              // 10 min — comfortably longer than the window
                                          //   read on scrape, so a slow scrape never
                                          //   reads a bucket that already expired.

function bucketKey(bucket) {
  return `activity:${bucket}`;
}

// Called from api/middleware/requireAuth.js on every authenticated request.
export async function recordActivity(userId) {
  const bucket = Math.floor(Date.now() / BUCKET_MS);
  const redis = redisClient();
  const key = bucketKey(bucket);
  await redis.sadd(key, String(userId));
  await redis.expire(key, KEY_TTL_SECONDS);
}

// Called from routes/metrics.js on scrape. SUNION over 5 small per-minute sets is cheap
// and bounded by minute-bucket count, never by request volume.
export async function countActiveTenants() {
  const nowBucket = Math.floor(Date.now() / BUCKET_MS);
  const keys = [];
  for (let i = 0; i < WINDOW_BUCKETS; i++) keys.push(bucketKey(nowBucket - i));
  const redis = redisClient();
  const members = await redis.sunion(...keys);
  return members.length;
}
