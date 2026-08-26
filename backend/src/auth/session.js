import session from 'express-session';
import { createClient } from 'redis';
import { RedisStore } from 'connect-redis';
import { config } from '../config/index.js';

// A SECOND Redis client library, deliberately. `redis.js`'s shared `redisClient()`
// (ioredis) exists for /health's probe and BullMQ's queue.js, and connect-redis v10's
// `RedisStore` is written against node-redis v4's client shape specifically — its `set()`
// calls `client.set(key, val, { expiration: { type: 'EX', value: ttl } })`, an options
// object ioredis's `set(key, val, 'EX', seconds)` varargs signature does not accept, and
// its `clear()`/`all()` paths call node-redis-only methods (`scanIterator`, `mGet`).
// Handing it the shared ioredis client would compile but silently mis-set (or throw on)
// every session write — verified against connect-redis's own source
// (node_modules/connect-redis/dist/connect-redis.js). A dedicated node-redis client,
// used only here, is the officially-supported pairing and avoids that failure mode
// entirely; every other subsystem keeps using ioredis unchanged.
const sessionRedisClient = createClient({ url: config.redis.url });
sessionRedisClient.on('error', (err) => {
  console.error('[session] Redis connection error:', err.message);
});
// Connected eagerly at module load, mirroring redis.js's own reasoning: the handshake
// gets the whole server-boot window (mongoose.connect + app.listen) to finish before any
// request can reach it, instead of racing the first request that touches a session.
await sessionRedisClient.connect();

export const sessionMiddleware = session({
  name: 'cerebro.sid',                 // not 'connect.sid' — the default advertises the stack
  store: new RedisStore({ client: sessionRedisClient, prefix: 'sess:', ttl: 7 * 24 * 60 * 60 }),
  secret: config.auth.sessionSecret,   // fail-fast validated at startup; ≥ 32 chars
  resave: false,                       // the store is not touched unless the session changed
  saveUninitialized: false,            // no cookie for an anonymous visitor — this is what
                                       // keeps GET /api/auth/session from minting a session
                                       // for every bot that loads the page
  rolling: true,                       // each request extends the 7-day window
  proxy: config.nodeEnv === 'production',   // trust X-Forwarded-Proto from Caddy, so
                                            // `secure: true` does not reject every request
  cookie: {
    httpOnly: true,                    // unreadable from JavaScript — architecture §7.2
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',                   // blocks cross-site POST; 'strict' would break the
                                       // OAuth callback, which IS a cross-site GET back
                                       // into our origin
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  },
});

// `sameSite: 'lax'` rather than `'strict'` is a decision with a specific cause: the OAuth
// provider redirects the browser to `/api/auth/google/callback`, which is a cross-site
// navigation. Under `'strict'` the cookie is withheld on that request, the OAuth state
// check cannot find its stored nonce, and every federated login fails. `'lax'` sends the
// cookie on top-level GET navigations, which is exactly the callback and nothing
// dangerous.

// Why not JWT: a stateless token cannot be revoked before it expires without a
// server-side denylist, and a denylist is a session store with worse ergonomics. Logout
// here is `DEL sess:<sid>` and `SREM usess:<userId> <sid>` (auth/sessionLifecycle.js),
// and it is instantaneous.

// usess:<userId> — the set of every live sid for a user, used by logout-all and by
// requireAuth's credentialVersion check — is maintained separately from this store; see
// auth/sessionLifecycle.js. It uses the shared ioredis client (redis.js), not this one:
// it is a plain SADD/SMEMBERS/EXPIRE/DEL user, none of which touch express-session's
// serializer or the node-redis-specific option shapes above.
