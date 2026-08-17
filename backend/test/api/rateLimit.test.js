// Rate-limit middleware integration test (phase 6 §6.1, §16.3, task 6.15).
//
// Runs the REAL middleware (api/middleware/rateLimit.js) inside a throwaway Express app and
// fires REAL HTTP requests at it, against the Redis instance backend/.env already points at
// — not a mock store. Two things here were only ever caught by doing exactly this: the
// shared-connection boot crash (§16.3), and the polling-exhaustion bug where GET status
// polls counted against the same 10/hour budget as uploads. Neither is visible from reading
// the middleware in isolation; both are visible from firing requests at it.
//
// Requires REDIS_URL reachable (backend/.env). Uses its own key prefix per limiter name and
// flushes those keys before and after, so it does not disturb rate-limit state any other
// process (the dev server, a previous run) has accumulated.
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import IORedis from 'ioredis';
import 'dotenv/config';
import { askLimiter, uploadLimiter, globalLimiter } from '../../src/api/middleware/rateLimit.js';

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

function buildApp() {
  const app = express();
  app.use('/api/ask', askLimiter);
  app.use('/api/documents', uploadLimiter);
  app.use('/api', globalLimiter);
  app.post('/api/ask', (req, res) => res.json({ ok: true }));
  app.post('/api/documents', (req, res) => res.status(202).json({ ok: true }));
  app.get('/api/documents/:id/status', (req, res) => res.json({ status: 'processing' }));
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function request(server, method, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.end();
  });
}

async function flushPrefix(redis, prefix) {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
}

async function main() {
  const redis = new IORedis(process.env.REDIS_URL);

  // Isolation: every limiter test gets its own fresh Express app/server (a fresh process
  // never shares express-rate-limit's in-memory pieces with another test), but the
  // underlying Redis counters are prefixed by limiter name and shared globally by design
  // (§6.1 — that IS the feature, surviving a restart) — so each test explicitly clears its
  // own prefix first rather than relying on isolation the store doesn't provide.
  await flushPrefix(redis, 'rl:ask:');
  await flushPrefix(redis, 'rl:upload:');
  await flushPrefix(redis, 'rl:global:');

  console.log('\n=== /api/ask: 20 allowed, 21st is 429 (task 6.15) ===');
  await test('exactly 20 succeed, the 21st is rate-limited', async () => {
    const app = buildApp();
    const server = await listen(app);
    try {
      const codes = [];
      for (let i = 0; i < 21; i += 1) codes.push(await request(server, 'POST', '/api/ask')); // eslint-disable-line no-await-in-loop
      const succeeded = codes.filter((c) => c === 200).length;
      const limited = codes.filter((c) => c === 429).length;
      assert.equal(succeeded, 20, `expected 20 successes, got ${succeeded} (codes: ${codes})`);
      assert.equal(limited, 1, `expected exactly 1 rate-limited response, got ${limited}`);
      assert.equal(codes[20], 429, 'the 21st request specifically must be the one limited');
    } finally {
      server.close();
    }
  });

  console.log('\n=== /api/documents: GET polling does not consume the upload budget (§16.3 regression) ===');
  await test('30 rapid status polls are never rate-limited', async () => {
    await flushPrefix(redis, 'rl:upload:');
    const app = buildApp();
    const server = await listen(app);
    try {
      const codes = [];
      for (let i = 0; i < 30; i += 1) codes.push(await request(server, 'GET', '/api/documents/abc123/status')); // eslint-disable-line no-await-in-loop
      const limited = codes.filter((c) => c === 429).length;
      assert.equal(limited, 0, `polling must never hit the upload limiter, but ${limited}/30 were blocked`);
    } finally {
      server.close();
    }
  });

  await test('POST uploads are still capped at 10/hour after the fix', async () => {
    // The regression fix must narrow the limiter to POST-only, not disable it — this proves
    // the actual protection (§6.1: "ingestion is the exhaustion vector") still holds.
    await flushPrefix(redis, 'rl:upload:');
    const app = buildApp();
    const server = await listen(app);
    try {
      const codes = [];
      for (let i = 0; i < 11; i += 1) codes.push(await request(server, 'POST', '/api/documents')); // eslint-disable-line no-await-in-loop
      const succeeded = codes.filter((c) => c === 202).length;
      assert.equal(succeeded, 10, `expected 10 uploads to succeed, got ${succeeded}`);
      assert.equal(codes[10], 429, 'the 11th upload must still be rate-limited');
    } finally {
      server.close();
    }
  });

  console.log('\n=== cumulative application: a route hits its own limiter AND the global backstop ===');
  await test('a request under a specific limiter also consumes the global budget', async () => {
    // §6.1's own framing: the global limiter is a "catch-all backstop", not a replacement —
    // every request counts against both, so /api/ask requests must leave a footprint under
    // BOTH the rl:ask: and rl:global: prefixes, not just the specific one.
    await flushPrefix(redis, 'rl:ask:');
    await flushPrefix(redis, 'rl:global:');
    const app = buildApp();
    const server = await listen(app);
    try {
      for (let i = 0; i < 5; i += 1) await request(server, 'POST', '/api/ask'); // eslint-disable-line no-await-in-loop
      const askKeys = await redis.keys('rl:ask:*');
      const globalKeys = await redis.keys('rl:global:*');
      assert.ok(askKeys.length > 0, 'the ask-specific limiter must have recorded these requests');
      assert.ok(globalKeys.length > 0, 'the global backstop must ALSO have recorded these same requests');
    } finally {
      server.close();
    }
  });

  await flushPrefix(redis, 'rl:ask:');
  await flushPrefix(redis, 'rl:upload:');
  await flushPrefix(redis, 'rl:global:');
  redis.disconnect();

  console.log(failures === 0 ? '\nAll rate-limit tests passed.\n' : `\n${failures} test(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Rate limit test run failed:', err);
  process.exit(1);
});
