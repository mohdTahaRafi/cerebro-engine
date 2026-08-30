// Phase 8 §3.4 — "6 wrong codes -> locked and the Redis key deleted; 6 requests in an
// hour -> 429."
//
// This dev environment has no SMTP configured (backend/.env.example's own note), so
// POST /api/auth/forgot-password cannot actually deliver a code — mailer.sendOtp()
// throws, and password.js's own catch branch discards the record (§5.4's documented
// failure mode) before this test could ever recover a code to submit. The brute-force
// half therefore seeds a real OTP record directly via auth/otp.js's issueOtp() (the
// same function the route itself calls), in-process against the SAME Redis the live
// server uses — everything downstream (the 6 wrong-code submissions, the lockout, the
// Redis key deletion) goes through the real, live POST /api/auth/verify-otp route over
// real HTTP. The request-rate half (6 forgot-password calls -> 429) needs no email
// delivery at all: limits.js's rate check runs and returns before send is attempted.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { User } from '../../src/models/User.js';
import { issueOtp } from '../../src/auth/otp.js';
import { redisClient } from '../../src/redis.js';
import mongoose from 'mongoose';
import { config } from '../../src/config/index.js';
import { Client, BASE_URL } from './lib/client.js';

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { console.error(`  FAIL  ${name}\n        ${err.stack}`); failures += 1; }
}

const rand = () => crypto.randomBytes(6).toString('hex');
const PASSWORD = 'SecurityTestHorseBattery9!';

async function main() {
  console.log(`[security.otp] against ${BASE_URL}`);
  await mongoose.connect(config.mongo.uri);
  const redis = redisClient();

  await test('6 wrong OTP codes lock the reset and delete the Redis key', async () => {
    const email = `sec-otp-${rand()}@example.com`;
    // Signed up on a SETUP client, then abandoned — the real forgot-password flow is
    // invoked by a signed-OUT visitor (that is the whole reason it exists), so the
    // verify-otp calls below use a fresh, never-authenticated Client. requireCsrf's
    // check is a no-op for a session that never carried a userId in the first place
    // (csrf.js: issueCsrfToken only mints a token once one does), matching the
    // documented exemption reasoning for the pre-authentication routes even though
    // forgot-password/verify-otp aren't in csrf.js's literal EXEMPT list — there is no
    // session yet for the double-submit token to protect.
    const setup = new Client();
    const signup = await setup.postNoCsrf('/api/auth/signup', { email, password: PASSWORD, name: 'OTP Test' });
    assert.equal(signup.status, 202, `signup failed: ${signup.text}`);
    const user = await User.findOne({ email });
    assert.ok(user, 'user was not created');

    const issued = await issueOtp(String(user._id), 'email');
    assert.equal(issued.throttled, false, 'issueOtp was throttled unexpectedly');

    const redisKey = `otp:pwreset:${user._id}`;
    assert.ok(await redis.exists(redisKey), 'OTP record was not written to Redis');

    const anon = new Client();
    let lastRes;
    for (let i = 0; i < 6; i++) {
      lastRes = await anon.postNoCsrf('/api/auth/verify-otp', { identifier: email, code: '000000' });
    }
    // 5 attempts return otp_invalid (auth/otp.js's OTP_MAX_ATTEMPTS = 5); the 6th finds
    // attempts > 5 and locks.
    assert.equal(lastRes.status, 400);
    assert.equal(lastRes.json?.code, 'otp_locked', `expected otp_locked on the 6th attempt, got ${JSON.stringify(lastRes.json)}`);
    assert.equal(await redis.exists(redisKey), 0, 'Redis OTP key was not deleted after lockout');
  });

  await test('6 forgot-password requests for the same identifier in one window -> 429 on the 6th', async () => {
    const email = `sec-otp-rate-${rand()}@example.com`;
    const setup = new Client();
    const signup = await setup.postNoCsrf('/api/auth/signup', { email, password: PASSWORD, name: 'OTP Rate Test' });
    assert.equal(signup.status, 202, `signup failed: ${signup.text}`);

    const anon = new Client();
    let last;
    for (let i = 0; i < 6; i++) {
      last = await anon.postNoCsrf('/api/auth/forgot-password', { identifier: email, channel: 'email' });
    }
    assert.equal(last.status, 429, `expected 429 on the 6th request, got ${last.status}: ${last.text}`);
    assert.equal(last.json?.code, 'rate_limited');
  });

  await mongoose.disconnect();
  console.log(`\n[security.otp] ${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`);
  // The shared ioredis client (redis.js) stays connected for the life of the process by
  // design (its own header comment) — an explicit exit is what ends this script instead
  // of the open connection keeping the event loop alive indefinitely.
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => { console.error('[security.otp] FAILED:', err); process.exit(1); });
