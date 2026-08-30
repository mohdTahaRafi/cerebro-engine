// Phase 8 §3.4 — "50 login attempts each for an existing and an unknown email; median
// latencies within 15% and bodies byte-identical."
//
// Sample-size note: identical constraint to bench/v2/auth.bench.js (see that file's
// header comment) — auth/limits.js's LIMITS.loginPerIp caps ALL login attempts from one
// IP at 50 per 900s, enforced independently of which batch (existing/unknown) a given
// attempt belongs to. This suite runs several OTHER tests that also consume that same
// budget (session.test.js: ~1, csrf.test.js: ~1), so SECURITY_TEST_ENUM_SAMPLES
// defaults to 15 (30 total here) rather than 50, leaving headroom for `npm run
// test:security` to run everything in one 900s window. Pass
// SECURITY_TEST_ENUM_SAMPLES=50 to run the literal spec figure in isolation.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Client, BASE_URL } from './lib/client.js';

const SAMPLES = Number(process.env.SECURITY_TEST_ENUM_SAMPLES ?? 15);
const rand = () => crypto.randomBytes(6).toString('hex');
const PASSWORD = 'SecurityTestHorseBattery9!';

function median(samples) {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function main() {
  console.log(`[security.enumeration] against ${BASE_URL}, ${SAMPLES} samples per condition`);

  const existingEmail = `sec-enum-${rand()}@example.com`;
  const setupClient = new Client();
  const signup = await setupClient.postNoCsrf('/api/auth/signup', { email: existingEmail, password: PASSWORD, name: 'Enum Test' });
  assert.equal(signup.status, 202, `signup failed: ${signup.text}`);

  const existingLatencies = [];
  let existingBody = null;
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    const res = await new Client().postNoCsrf('/api/auth/login', { email: existingEmail, password: 'definitely-the-wrong-password' });
    existingLatencies.push(performance.now() - t0);
    if (i === 0) { existingBody = res.text; assert.equal(res.status, 401, `expected 401, got ${res.status}`); }
  }

  const unknownLatencies = [];
  let unknownBody = null;
  for (let i = 0; i < SAMPLES; i++) {
    const t0 = performance.now();
    const res = await new Client().postNoCsrf('/api/auth/login', { email: `sec-enum-unknown-${rand()}@example.com`, password: 'whatever-password-123' });
    unknownLatencies.push(performance.now() - t0);
    if (i === 0) { unknownBody = res.text; assert.equal(res.status, 401, `expected 401, got ${res.status}`); }
  }

  const existingMedian = median(existingLatencies);
  const unknownMedian = median(unknownLatencies);
  const gapPct = Math.abs(existingMedian - unknownMedian) / Math.max(existingMedian, unknownMedian) * 100;

  console.log(`  existing-email median: ${existingMedian.toFixed(1)}ms`);
  console.log(`  unknown-email  median: ${unknownMedian.toFixed(1)}ms`);
  console.log(`  gap: ${gapPct.toFixed(1)}% (threshold 15%)`);
  console.log(`  bodies identical: ${existingBody === unknownBody}`);

  let failed = false;
  if (existingBody !== unknownBody) {
    console.error(`  FAIL: bodies differ\n    existing: ${existingBody}\n    unknown:  ${unknownBody}`);
    failed = true;
  }
  if (gapPct > 15) {
    console.error(`  FAIL: timing gap ${gapPct.toFixed(1)}% exceeds 15% threshold`);
    failed = true;
  }
  console.log(`\n[security.enumeration] ${failed ? 'FAIL' : 'PASS'}`);
  if (failed) process.exit(1);
}

main().catch((err) => { console.error('[security.enumeration] FAILED:', err); process.exit(1); });
