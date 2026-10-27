// The session lifecycle sequence from phase_5 §3.3, factored into one place because
// signup, login, the OAuth callback, and password reset all need to run the exact same
// steps and any drift between them (e.g. one route forgetting `usess:` bookkeeping) would
// make logout-all silently incomplete for whichever route skipped it.
//
// Uses the SHARED ioredis client (redis.js), not session.js's dedicated node-redis
// client: `usess:<userId>` is a plain Redis set maintained with SADD/SREM/EXPIRE/DEL,
// none of which touch express-session's serializer or connect-redis's store at all.
import { User } from '../models/User.js';
import { redisClient } from '../redis.js';

const USESS_TTL_SECONDS = 7 * 24 * 60 * 60;   // matches the session cookie's maxAge (§3.1)

// signup / login / oauth callback / password reset all call this on success.
//   req.session.regenerate()  ← new sid; defeats fixation (architecture §9)
//   req.session.userId = user._id
//   req.session.credentialVersion = user.credentialVersion
//   SADD usess:<userId> <newSid>   ← so logout-all can find it
//   EXPIRE usess:<userId> 604800
//
// `persistent: false` (login with "Remember me" unticked) makes cerebro.sid a browser-
// session cookie — no Expires/Max-Age, so the browser drops it when it closes. Set after
// regenerate (which builds a fresh cookie from session.js's 7-day default) and before
// save. maxAge null also sets originalMaxAge null, and `rolling`'s per-request touch()
// copies originalMaxAge back, so it stays a session cookie for its whole life. The
// server-side record keeps the store's 7-day TTL either way.
export function establishSession(req, user, { persistent = true } = {}) {
  return new Promise((resolve, reject) => {
    req.session.regenerate(async (err) => {
      if (err) return reject(err);
      try {
        if (!persistent) req.session.cookie.maxAge = null;
        req.session.userId = String(user._id);
        req.session.credentialVersion = user.credentialVersion;
        req.session.save(async (saveErr) => {
          if (saveErr) return reject(saveErr);
          const redis = redisClient();
          await redis.sadd(`usess:${user._id}`, req.sessionID);
          await redis.expire(`usess:${user._id}`, USESS_TTL_SECONDS);
          // Best-effort, not awaited-before-resolve on the redis calls above: a signed-in
          // response must not wait on a field that exists purely for operator visibility.
          User.updateOne({ _id: user._id }, { lastLoginAt: new Date() }).catch(() => {});
          resolve();
        });
      } catch (e) {
        reject(e);
      }
    });
  });
}

// POST /api/auth/logout — DEL sess:<sid> · SREM usess:<userId> <sid>
export async function destroySession(req) {
  const { userId, } = req.session ?? {};
  const sid = req.sessionID;
  if (userId && sid) {
    await redisClient().srem(`usess:${userId}`, sid);
  }
  await new Promise((resolve) => req.session.destroy(() => resolve()));
}

// POST /api/auth/logout-all and a completed password reset — every sid in
// usess:<userId> is a live express-session key under session.js's RedisStore prefix
// ('sess:'), so deleting it here (via the shared ioredis client) is equivalent to that
// store expiring it: the next request carrying that sid finds no session at all.
export async function destroyAllSessions(userId) {
  const redis = redisClient();
  const key = `usess:${userId}`;
  const sids = await redis.smembers(key);
  if (sids.length > 0) {
    await redis.del(...sids.map((sid) => `sess:${sid}`));
  }
  await redis.del(key);
}
