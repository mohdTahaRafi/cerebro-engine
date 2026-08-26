// Standalone verification script (this repo's test/ convention — see AGENTS.md). Exercises
// task 5.10's acceptance criteria against a real (local) Redis — no network, no live SMTP.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { redisClient } from '../../src/redis.js';
import {
  issueOtp, verifyOtp, consumeResetToken, discardOtp, OTP_MAX_ATTEMPTS,
} from '../../src/auth/otp.js';

const redis = redisClient();
let failures = 0;

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
    } catch (err) {
      console.error(`  FAIL  ${name}\n        ${err.message}`);
      failures += 1;
    }
  })();
}

// Every test gets its own fake userId so concurrent Redis state never crosses tests.
function fakeUserId() {
  return crypto.randomUUID();
}

async function run() {
  // redis.js's shared client is constructed with `enableOfflineQueue: false` (its own
  // header comment) so a health probe fails fast instead of queuing behind a dead
  // connection — but that means the very first command issued before the initial
  // handshake finishes rejects instantly. The running server gives it the whole
  // mongoose.connect + app.listen window; this standalone script has no such window, so
  // it waits for 'ready' explicitly instead.
  if (redis.status !== 'ready') {
    await new Promise((resolve, reject) => {
      redis.once('ready', resolve);
      redis.once('error', reject);
    });
  }

  await test('a code verifies once and only once', async () => {
    const userId = fakeUserId();
    const issued = await issueOtp(userId, 'email');
    assert.equal(issued.throttled, false);
    const first = await verifyOtp(userId, issued.code);
    assert.equal(first.ok, true);
    assert.ok(first.resetToken);
    // The record was deleted on success — verifying the SAME code again must not
    // succeed a second time.
    const second = await verifyOtp(userId, issued.code);
    assert.equal(second.ok, false);
    assert.equal(second.reason, 'expired');
  });

  await test('the 6th attempt returns locked and deletes the key', async () => {
    const userId = fakeUserId();
    const issued = await issueOtp(userId, 'email');
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i += 1) {
      const result = await verifyOtp(userId, '000000');
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'invalid', `attempt ${i + 1} should be 'invalid', got '${result.reason}'`);
      assert.equal(result.attemptsRemaining, OTP_MAX_ATTEMPTS - (i + 1));
    }
    // Real code is never '000000' with overwhelming probability — if it collided this
    // assertion would be the tell; astronomically unlikely (1 in 10^6) so not guarded.
    const locked = await verifyOtp(userId, '000000');
    assert.equal(locked.ok, false);
    assert.equal(locked.reason, 'locked');
    assert.equal(await redis.exists(`otp:pwreset:${userId}`), 0);
  });

  await test('a code issued 11 minutes ago returns expired', async () => {
    const userId = fakeUserId();
    const issued = await issueOtp(userId, 'email');
    assert.equal(issued.throttled, false);
    // Simulating the 10-minute TTL's expiry by deleting the record directly is
    // equivalent to Redis expiring it — verifyOtp's "no record" branch is exactly the
    // same code path either way (§5.1: `if (!record?.hash) return {reason:'expired'}`).
    await redis.del(`otp:pwreset:${userId}`);
    const result = await verifyOtp(userId, issued.code);
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'expired');
  });

  await test('verifyOtp increments attempts BEFORE comparing', async () => {
    const userId = fakeUserId();
    await issueOtp(userId, 'email');
    await verifyOtp(userId, '111111');   // wrong — should increment regardless of outcome
    const attempts = await redis.hget(`otp:pwreset:${userId}`, 'attempts');
    assert.equal(attempts, '1');
  });

  await test('issueOtp respects the resend cooldown (throttled, no new code)', async () => {
    const userId = fakeUserId();
    const first = await issueOtp(userId, 'email');
    assert.equal(first.throttled, false);
    const second = await issueOtp(userId, 'email');
    assert.equal(second.throttled, true);
    assert.equal(second.code, undefined);
  });

  await test('consumeResetToken is single-use (GETDEL is atomic)', async () => {
    const userId = fakeUserId();
    const issued = await issueOtp(userId, 'email');
    const verified = await verifyOtp(userId, issued.code);
    assert.equal(verified.ok, true);
    const token = verified.resetToken;

    const first = await consumeResetToken(token);
    assert.equal(first, String(userId));
    const secondConcurrent = await consumeResetToken(token);
    assert.equal(secondConcurrent, null);
  });

  await test('discardOtp deletes the record but leaves the cooldown key', async () => {
    const userId = fakeUserId();
    await issueOtp(userId, 'email');
    await discardOtp(userId);
    assert.equal(await redis.exists(`otp:pwreset:${userId}`), 0);
    assert.equal(await redis.exists(`otp:cooldown:${userId}`), 1);
  });

  console.log(failures === 0 ? '\nAll otp.js tests passed.\n' : `\n${failures} test(s) FAILED.\n`);
  redis.disconnect();
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
