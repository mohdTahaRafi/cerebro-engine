// Phase 8 §3.4 — session fixation and session revocation, exercised live against the
// running backend (test/security/lib/client.js), not the unit-level fake-session
// coverage test/auth/session.test.js already has (that one isolates
// sessionLifecycle.js's pure logic; this one is the real cerebro.sid cookie over real
// HTTP, per the phase doc's literal "capture cerebro.sid before login" framing).
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

async function signUp(client, email) {
  const res = await client.postNoCsrf('/api/auth/signup', { email, password: PASSWORD, name: 'Security Test' });
  assert.equal(res.status, 202, `signup failed: ${res.text}`);
}

async function main() {
  console.log(`[security.session] against ${BASE_URL}`);

  await test('session fixation: sid regenerates on login, planted sid is not reused', async () => {
    const email = `sec-fix-${rand()}@example.com`;
    // Sign up first (establishes a real session and account) so login below is a
    // genuine second authentication, not the signup's own session-establishing call.
    const setup = new Client();
    await signUp(setup, email);

    // Simulate an attacker who has planted a KNOWN sid value into the victim's browser
    // before the victim authenticates — the classic fixation setup. `regenerate()`
    // (sessionLifecycle.js's establishSession) must mint a fresh sid regardless of what
    // was presented, so the attacker's known value never becomes a valid authenticated
    // session id.
    const victim = new Client();
    const plantedSid = `attacker-planted-${rand()}`;
    victim.cookies.set('cerebro.sid', plantedSid);

    const loginRes = await victim.postNoCsrf('/api/auth/login', { email, password: PASSWORD });
    assert.equal(loginRes.status, 200, `login failed: ${loginRes.text}`);

    const newSid = victim.get('cerebro.sid');
    assert.ok(newSid, 'login did not set a new cerebro.sid');
    assert.notEqual(newSid, plantedSid, 'sid was not regenerated on login — fixation is possible');

    // The planted value must not itself be a live, authenticated session either.
    const probe = new Client();
    probe.cookies.set('cerebro.sid', plantedSid);
    const probeRes = await probe.get_('/api/contexts');
    assert.equal(probeRes.status, 401, 'the attacker-planted sid was accepted as authenticated');
  });

  await test('session revocation: logout-all invalidates every OTHER live session within one request', async () => {
    const email = `sec-revoke-${rand()}@example.com`;
    const browserA = new Client();
    await signUp(browserA, email);
    // The CSRF cookie is minted on the first request AFTER a session carries a userId
    // (csrf.js's issueCsrfToken) — signup's own response is that first request, so the
    // cookie isn't on the client yet when signUp() returns. One more authenticated GET
    // picks it up, exactly like a real browser's next page navigation would.
    await browserA.get_('/api/contexts');

    const browserB = new Client();
    const loginB = await browserB.postNoCsrf('/api/auth/login', { email, password: PASSWORD });
    assert.equal(loginB.status, 200, `browser B login failed: ${loginB.text}`);

    // Both sessions live: confirm B is authenticated before revoking.
    const beforeB = await browserB.get_('/api/contexts');
    assert.equal(beforeB.status, 200, 'browser B was not authenticated before logout-all');

    const logoutAll = await browserA.post('/api/auth/logout-all');
    assert.equal(logoutAll.status, 204, `logout-all failed: ${logoutAll.text}`);

    const afterB = await browserB.get_('/api/contexts');
    assert.equal(afterB.status, 401, 'browser B session survived logout-all — revocation is not immediate');
  });

  console.log(`\n[security.session] ${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => { console.error('[security.session] FAILED:', err); process.exit(1); });
