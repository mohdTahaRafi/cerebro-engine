// Phase 8 §3.4 — "A cross-origin fetch with credentials: 'include' and no header
// returns 403." Node's fetch has no browser origin concept to actually simulate
// cross-origin, but the control this exercises is server-side: does the request
// succeed WITHOUT the X-CSRF-Token header despite carrying a valid session cookie? That
// is exactly what a cross-origin attacker's forged request looks like from the server's
// point of view (it CAN make the browser send the cookie; it CANNOT read the cookie to
// build the matching header — csrf.js's own header comment) — this test is the
// server-side half of that story; the browser-side half (same-origin policy blocking
// the read) is not something a Node script can exercise at all.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Client, BASE_URL } from './lib/client.js';

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { console.error(`  FAIL  ${name}\n        ${err.stack}`); failures += 1; }
}

const rand = () => crypto.randomBytes(6).toString('hex');
const PASSWORD = 'SecurityTestHorseBattery9!';

async function main() {
  console.log(`[security.csrf] against ${BASE_URL}`);
  const email = `sec-csrf-${rand()}@example.com`;
  const client = new Client();
  const signup = await client.postNoCsrf('/api/auth/signup', { email, password: PASSWORD, name: 'CSRF Test' });
  assert.equal(signup.status, 202, `signup failed: ${signup.text}`);
  await client.get_('/api/contexts');   // picks up the csrf cookie, minted on the first post-signup request

  await test('POST with cookies but no X-CSRF-Token header returns 403', async () => {
    const res = await client.postNoCsrf('/api/contexts', { title: 'Should Be Blocked' });
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${res.text}`);
    assert.equal(res.json?.code, 'csrf_failed');
  });

  await test('POST with cookies AND the correct X-CSRF-Token header succeeds', async () => {
    const res = await client.post('/api/contexts', { title: `CSRF OK ${rand()}` });
    assert.equal(res.status, 201, `expected 201, got ${res.status}: ${res.text}`);
  });

  await test('POST with cookies and a WRONG X-CSRF-Token header returns 403', async () => {
    const res = await client.request('/api/contexts', {
      method: 'POST', body: { title: 'Wrong Token' },
      headers: { 'X-CSRF-Token': 'not-the-real-token' },
    });
    assert.equal(res.status, 403, `expected 403, got ${res.status}: ${res.text}`);
  });

  await test('POST /api/auth/login succeeds with no CSRF header (exempt — no session exists yet)', async () => {
    const anon = new Client();
    const res = await anon.postNoCsrf('/api/auth/login', { email, password: PASSWORD });
    assert.equal(res.status, 200, `login should be CSRF-exempt: ${res.status} ${res.text}`);
  });

  console.log(`\n[security.csrf] ${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => { console.error('[security.csrf] FAILED:', err); process.exit(1); });
