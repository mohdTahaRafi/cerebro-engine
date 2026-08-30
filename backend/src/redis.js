import IORedis from 'ioredis';
import { config } from './config/index.js';

// Shared client for /health's probe only. BullMQ (Phase 2) opens its own dedicated
// connection with maxRetriesPerRequest: null, per queue.js's requirements — that
// setting is wrong for a health probe, which must fail fast, not block forever on
// BullMQ's blocking commands.
//
// Connected eagerly at module load, not lazily on first use: a lazily-created client
// races its own TCP handshake against whatever request first needs it, and with
// enableOfflineQueue: false that first command rejects instantly with "Stream isn't
// writeable" even though Redis is genuinely reachable — verified live: the first
// post-boot /health call reported redis down, the very next one (same process, no
// changes) reported it up once the handshake had finished. Creating the client at
// import time gives the handshake the entire server-boot window (mongoose.connect +
// app.listen) to complete before any request can reach it.
const client = new IORedis(config.redis.url, {
  enableOfflineQueue: false,   // health probes must fail fast, not queue behind a dead connection
  maxRetriesPerRequest: 1,
});
// ioredis emits 'error' on every failed reconnect attempt while Redis is down; left
// unhandled that crashes the process. probe() already surfaces the failure via the
// rejected ping() promise, so this listener only prevents the crash.
client.on('error', () => {});

export function redisClient() {
  return client;
}

export async function ping() {
  return client.ping();
}

// Phase 8 §4.2/§8.9: sessions and OTP codes now live in this same Redis (Redis becomes
// durable, docker-compose.prod.yml). The default `allkeys-lru` would evict session keys
// under memory pressure, signing users out at random with no error anywhere — this is
// the config check that names that consequence at boot instead of leaving it to be
// discovered in production. Called once from api/index.js at startup; logs and does NOT
// exit — a wrong policy is a real risk, not a reason to refuse to serve traffic the way
// a missing required env var is (config/index.js's own fail-fast is for values with no
// safe runtime fallback; this one is operationally recoverable by an operator fixing
// the Redis config and restarting).
export async function assertNoEvictionPolicy() {
  try {
    const reply = await client.config('GET', 'maxmemory-policy');
    // ioredis's config() flattens CONFIG GET's RESP array to [key, value, ...] pairs.
    const policy = reply[1];
    if (policy !== 'noeviction') {
      console.error(
        `[redis] maxmemory-policy is "${policy}", not "noeviction". Under memory ` +
        `pressure Redis will evict session and OTP keys at random — signed-in users ` +
        `will be logged out with no error anywhere, and in-flight password resets will ` +
        `silently fail. Set "maxmemory-policy noeviction" (docker-compose.prod.yml's ` +
        `redis service already does via its command:) and restart Redis.`,
      );
    }
  } catch (err) {
    // A CONFIG GET failure (e.g. a managed Redis that disables CONFIG) must not crash
    // the server over a diagnostic check — log and move on, same posture as the
    // deliberately-swallowed 'error' listener above.
    console.error('[redis] could not verify maxmemory-policy:', err.message);
  }
}
