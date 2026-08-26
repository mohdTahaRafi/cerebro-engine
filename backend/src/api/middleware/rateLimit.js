// Per-route rate limiting (phase 6 §6.1), backed by Redis rather than express-rate-limit's
// default in-memory store — the in-memory store resets on restart and is per-process,
// meaning it would silently stop limiting the moment the API scales past one instance
// (NFR-SCALE-02).
//
// A dedicated connection, not the shared one `redis.js` exports — verified live: that
// client is deliberately built with `enableOfflineQueue: false` so /health fails fast
// instead of blocking on a dead connection (redis.js's own comment). `rate-limit-redis`'s
// RedisStore calls `loadIncrementScript()` synchronously in its constructor, at module
// load time, before this process's Redis handshake has necessarily finished — with
// offline queueing disabled that command has nowhere to wait and throws immediately,
// crashing the whole server on every boot. A rate limiter's own connection has no reason
// to share that fail-fast requirement — the default (queue briefly, connect, then drain)
// is exactly the tolerance rate limiting needs during the same startup window.
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import IORedis from 'ioredis';
import { config } from '../../config/index.js';

const connection = new IORedis(config.redis.url);
connection.on('error', (err) => console.error('[rateLimit] Redis connection error:', err.message));

// Phase 6 §5.5: keyed on identity when the request is authenticated, IP otherwise.
// IP-keyed limits punish everyone behind a corporate NAT and are evaded by an
// authenticated attacker with a proxy pool; identity-keyed limits are the opposite on
// both counts. `req.user` is only ever populated for a route requireAuth has already run
// on — index.js mounts requireAuth for every prefix these limiters cover BEFORE the
// limiter middleware, specifically so this keyGenerator sees it. Every one of
// `/api/auth/*` never gets requireAuth (there is no identity yet to key on), so those
// routes stay IP-keyed automatically — no separate branch needed here.
function identityKey(req) {
  return req.user ? `u:${req.user._id}` : `ip:${req.ip}`;
}

function limiter(windowMs, max, name, extra = {}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: identityKey,
    store: new RedisStore({
      sendCommand: (...args) => connection.call(...args),
      prefix: `rl:${name}:`,
    }),
    message: { error: 'Too many requests. Please slow down.' },
    ...extra,
  });
}

// architecture §6: /api/ask is the costliest route (condense + embed + rerank + generate,
// up to a ~90s LLM call) — capped tightest. /api/search shares the retrieval half of that
// cost but never generates, so it can run more often. /api/documents' ingestion is the
// resource-exhaustion vector (a 50MB upload spawns a multi-stage BullMQ job), not a
// per-request cost, so its cap is the tightest of all in absolute terms despite the
// longest window. The global backstop catches anything not covered by a specific route —
// every request also counts against it, cumulatively with whichever specific limiter
// applies (phase 6 §6.1's own framing: "catch-all backstop", not a replacement).
export const askLimiter = limiter(60_000, 20, 'ask');
export const searchLimiter = limiter(60_000, 60, 'search');

// Amended during Phase 6 implementation (§6.1): the upload budget counts WRITES only.
// §6.1's `app.use('/api/documents', limiter(3_600_000, 10, 'upload'))` applies to every
// method and every subpath under /api/documents — including `GET /api/documents/:id/status`,
// which is a *polling* endpoint the ingestion UI hits every 1.5 seconds (EngineContext's
// POLL_INTERVAL_MS) for the entire duration of an ingest. Verified live: uploading a single
// document and polling it to completion exhausted the whole hourly budget in about fifteen
// seconds, after which the UI could no longer read its own document's status and every
// subsequent upload was refused for the rest of the hour.
//
// `skip` keeps the intended protection exactly where §6.1 aimed it — "ingestion is the
// exhaustion vector", and only a POST starts an ingestion — while leaving reads to the
// global backstop, which at 300/min comfortably absorbs a 40/min poll.
export const uploadLimiter = limiter(3_600_000, 10, 'upload', {
  skip: (req) => req.method !== 'POST',
});

export const globalLimiter = limiter(60_000, 300, 'global');
