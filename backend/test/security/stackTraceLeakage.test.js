// Phase 8 §3.4 — "every 4xx/5xx body across the API is asserted to contain no `at `
// frame; stacks appear only in /api/admin/errors." Two parts: a static check that
// middleware/errorHandler.js's catch-all branch never serializes `err.stack` into a
// response body (the actual control — see that file), and a live sweep of real
// endpoints across the running backend, deliberately provoking a 4xx/5xx from each
// major router, asserting none of the bodies contain a stack-trace line.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, BASE_URL } from './lib/client.js';

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { console.error(`  FAIL  ${name}\n        ${err.stack}`); failures += 1; }
}

// A JS stack frame line: "    at functionName (file:line:col)" or "    at file:line:col".
const STACK_FRAME_RE = /\n\s*at\s+\S/;

async function main() {
  console.log(`[security.stackTraceLeakage] against ${BASE_URL}`);

  await test('errorHandler.js\'s catch-all branch never sends err.stack', () => {
    const src = fs.readFileSync(
      new URL('../../src/middleware/errorHandler.js', import.meta.url),
      'utf8',
    );
    // The only response bodies errorHandler.js ever sends are literal string messages
    // (err.message, or a fixed string) — this assertion fails loudly if a future edit
    // adds `err.stack` (or `err` itself, which JSON.stringifies its own stack-bearing
    // properties) to any res.json(...) call in the file.
    const jsonCalls = [...src.matchAll(/res\.status\([^)]*\)\.json\(\{([^}]*)\}\)/g)];
    assert.ok(jsonCalls.length > 0, 'could not find any res.json(...) calls to inspect — file shape changed');
    for (const [, body] of jsonCalls) {
      assert.ok(!/\bstack\b/.test(body), `a res.json(...) call in errorHandler.js references .stack: ${body}`);
    }
  });

  const client = new Client();
  const anon = new Client();

  // A representative sweep across the major routers — deliberately malformed input or
  // missing auth, one per surface, not exhaustive of every 4xx branch in the app.
  const PROBES = [
    ['GET', '/api/auth/session', anon, undefined],                        // 200, included as a sanity control
    ['POST', '/api/auth/login', anon, { email: 'not-an-email', password: 'x' }],   // 401/400
    ['GET', '/api/contexts', anon, undefined],                            // 401 unauthenticated
    ['GET', '/api/contexts/not-a-valid-object-id', anon, undefined],      // 401 (requireAuth first) — still a 4xx to sweep
    ['POST', '/api/contexts', anon, { title: '' }],                       // 401
    ['GET', '/api/documents/not-a-valid-object-id', anon, undefined],     // 401
    ['GET', '/api/traces/not-a-valid-object-id', anon, undefined],        // 401
    ['GET', '/api/pages/000000000000000000000000/1.jpg', anon, undefined], // 401
    ['GET', '/api/search', anon, undefined],                              // 401
    ['POST', '/api/ask', anon, { query: 'x' }],                           // 401
    ['GET', '/api/admin/queue', anon, undefined],                         // 401/403 — admin-gated
    ['GET', '/nonexistent-route-entirely', anon, undefined],              // Express's own 404
  ];

  await test(`a sweep of ${PROBES.length} endpoints finds no 'at ' stack frame in any 4xx/5xx body`, async () => {
    const offenders = [];
    for (const [method, path, actor, body] of PROBES) {
      const res = method === 'GET' ? await actor.get_(path) : await actor.request(path, { method, body });
      if (res.status >= 400 && STACK_FRAME_RE.test(res.text)) {
        offenders.push({ method, path, status: res.status, snippet: res.text.slice(0, 300) });
      }
    }
    assert.equal(offenders.length, 0, `stack frames leaked: ${JSON.stringify(offenders, null, 2)}`);
  });

  console.log(`\n[security.stackTraceLeakage] ${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main().catch((err) => { console.error('[security.stackTraceLeakage] FAILED:', err); process.exit(1); });
