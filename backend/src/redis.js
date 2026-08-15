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
