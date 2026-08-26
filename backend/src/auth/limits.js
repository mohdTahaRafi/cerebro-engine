import crypto from 'crypto';
import { redisClient } from '../redis.js';

const redis = redisClient();

// sha256(lowercased email) truncated to 32 hex characters. The plaintext address is
// never a Redis key: keys appear in SCAN output, MONITOR, and slow-log entries, and a
// rate-limit key set is otherwise an enumerable list of every address that has tried to
// sign in (phase_5 §2.2).
export function hashId(identifier) {
  return crypto.createHash('sha256').update(String(identifier).toLowerCase()).digest('hex').slice(0, 32);
}

export const LIMITS = {
  otpPerIdentifier: { key: (id) => `rl:otp:${hashId(id)}`,        max: 5,  windowSec: 3600 },
  otpPerIp:         { key: (ip) => `rl:otp:ip:${ip}`,             max: 20, windowSec: 3600 },
  loginPerIdentifier:{ key: (id) => `rl:login:${hashId(id)}`,     max: 10, windowSec: 900 },
  loginPerIp:       { key: (ip) => `rl:login:ip:${ip}`,           max: 50, windowSec: 900 },
  signupPerIp:      { key: (ip) => `rl:signup:ip:${ip}`,          max: 10, windowSec: 3600 },
};

// INCR then EXPIRE-if-new. Not `SET ... EX` — that would reset the window on every hit
// and make the limit unreachable.
export async function hit({ key, max, windowSec }, subject) {
  const k = key(subject);
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSec);
  return { exceeded: n > max, count: n, retryAfterSec: await redis.ttl(k) };
}

// The per-identifier and per-IP limits are both required and neither is sufficient.
// Per-IP alone lets an attacker with a proxy pool grind one account; per-identifier
// alone lets an attacker spray one attempt each across ten thousand accounts.
