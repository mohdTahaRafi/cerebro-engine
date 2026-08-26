import crypto from 'crypto';
import { redisClient } from '../redis.js';

const redis = redisClient();

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 600;        // 10 minutes — long enough for a slow inbox,
                                           //   short enough that a shoulder-surfed code
                                           //   is not useful an hour later
export const OTP_MAX_ATTEMPTS = 5;         // 5 tries over 10^6 codes = 1 in 200,000
export const OTP_RESEND_COOLDOWN = 60;     // seconds
export const RESET_TOKEN_TTL_SECONDS = 300;

// crypto.randomInt, NOT Math.random. A predictable reset code is a full account takeover,
// and Math.random is seeded per-process and is not a CSPRNG.
function generateCode() {
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

// Salted with the userId so two users holding the same 6-digit code do not share a hash,
// and so a stolen hash cannot be matched against a precomputed table of 10^6 codes.
function hashCode(code, userId) {
  return crypto.createHash('sha256').update(`${code}:${userId}`).digest('hex');
}

export async function issueOtp(userId, channel) {
  const cooling = await redis.exists(`otp:cooldown:${userId}`);
  if (cooling) return { throttled: true };

  const code = generateCode();
  const key = `otp:pwreset:${userId}`;
  // A pipeline, not sequential awaits: an OTP that is written but whose TTL fails to set
  // is a code that never expires.
  await redis.multi()
    .del(key)
    .hset(key, { hash: hashCode(code, userId), channel, attempts: '0', issuedAt: String(Date.now()) })
    .expire(key, OTP_TTL_SECONDS)
    .set(`otp:cooldown:${userId}`, '1', 'EX', OTP_RESEND_COOLDOWN)
    .exec();

  return { throttled: false, code, expiresInSeconds: OTP_TTL_SECONDS };
}

export async function verifyOtp(userId, submitted) {
  const key = `otp:pwreset:${userId}`;
  const record = await redis.hgetall(key);
  if (!record?.hash) return { ok: false, reason: 'expired' };

  // Increment FIRST, then compare. The reverse order lets an attacker who can abort the
  // connection mid-request retry indefinitely without ever incrementing the counter.
  const attempts = await redis.hincrby(key, 'attempts', 1);
  if (attempts > OTP_MAX_ATTEMPTS) {
    await redis.del(key);
    return { ok: false, reason: 'locked' };
  }

  const expected = Buffer.from(record.hash, 'hex');
  const actual = Buffer.from(hashCode(String(submitted), userId), 'hex');
  // Both buffers are always 32 bytes (sha256), so timingSafeEqual cannot throw on a
  // length mismatch. A plain === here leaks the shared-prefix length through timing.
  if (!crypto.timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'invalid', attemptsRemaining: OTP_MAX_ATTEMPTS - attempts };
  }

  // Single use: the code dies the moment it succeeds, before the password is written.
  await redis.del(key);

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await redis.set(`otp:reset-token:${tokenHash}`, String(userId), 'EX', RESET_TOKEN_TTL_SECONDS);
  return { ok: true, resetToken: token, expiresInSeconds: RESET_TOKEN_TTL_SECONDS };
}

export async function consumeResetToken(token) {
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const key = `otp:reset-token:${tokenHash}`;
  // GETDEL is atomic — two concurrent resets with the same token must not both succeed.
  const userId = await redis.getdel(key);
  return userId ?? null;
}

// §5.4's failure mode: when delivery throws after issueOtp() already wrote the record,
// the route deletes the record (so the next request isn't blocked by a code that was
// never delivered) but leaves `otp:cooldown:<userId>` in place, so the retry is paced.
export async function discardOtp(userId) {
  await redis.del(`otp:pwreset:${userId}`);
}

// The reset token is stored HASHED, exactly like the code, and for the same reason: it
// is a live credential for five minutes and a Redis dump must not contain usable ones.
