// CORS policy integration test (phase 6 §6.2, task 6.16). Runs the real cors() middleware
// configured by the real buildCorsOptions() inside a throwaway Express app, and fires real
// HTTP requests with an Origin header — the same shape a browser's preflight/actual request
// carries, and the same thing that caught this needing a 403 (not the default 500) live.
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { buildCorsOptions } from '../../src/api/corsOptions.js';

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

function buildApp(nodeEnv, allowedOriginsEnv) {
  const app = express();
  app.use(cors(buildCorsOptions(nodeEnv, allowedOriginsEnv)));
  app.get('/probe', (req, res) => res.json({ ok: true }));
  // Mirrors api/index.js's own error handler contract: a CORS rejection carries err.status.
  app.use((err, req, res, next) => res.status(err.status || 500).json({ error: err.message }));
  return app;
}

function listen(app) {
  return new Promise((resolve) => { const server = app.listen(0, () => resolve(server)); });
}

function requestWithOrigin(server, origin) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path: '/probe', method: 'GET', headers: origin ? { Origin: origin } : {} },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({
          status: res.statusCode,
          allowOrigin: res.headers['access-control-allow-origin'] ?? null,
        }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

console.log('\n=== production: explicit allowlist ===');

await test('an allowed origin gets a 200 and the matching ACAO header', async () => {
  const app = buildApp('production', 'https://cerebro.example.com');
  const server = await listen(app);
  try {
    const r = await requestWithOrigin(server, 'https://cerebro.example.com');
    assert.equal(r.status, 200);
    assert.equal(r.allowOrigin, 'https://cerebro.example.com');
  } finally {
    server.close();
  }
});

await test('an unlisted origin is rejected with 403, not the default 500', async () => {
  const app = buildApp('production', 'https://cerebro.example.com');
  const server = await listen(app);
  try {
    const r = await requestWithOrigin(server, 'https://evil.example.com');
    assert.equal(r.status, 403, 'a CORS policy rejection is a client-side condition, not a server error');
    assert.equal(r.allowOrigin, null, 'a rejected origin must not receive an ACAO header');
  } finally {
    server.close();
  }
});

await test('a comma-separated allowlist accepts every listed origin', async () => {
  const app = buildApp('production', 'https://a.example.com, https://b.example.com');
  const server = await listen(app);
  try {
    const a = await requestWithOrigin(server, 'https://a.example.com');
    const b = await requestWithOrigin(server, 'https://b.example.com');
    const c = await requestWithOrigin(server, 'https://c.example.com');
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(c.status, 403);
  } finally {
    server.close();
  }
});

await test('a request with no Origin header is not CORS-policed (server-to-server, curl)', async () => {
  const app = buildApp('production', 'https://cerebro.example.com');
  const server = await listen(app);
  try {
    const r = await requestWithOrigin(server, null);
    assert.equal(r.status, 200, 'a same-origin/non-browser request must not be rejected for lacking an Origin header');
  } finally {
    server.close();
  }
});

await test('an empty CORS_ALLOWED_ORIGINS rejects every browser origin', async () => {
  // A misconfiguration (the env var forgotten in production) must fail closed, not open.
  const app = buildApp('production', undefined);
  const server = await listen(app);
  try {
    const r = await requestWithOrigin(server, 'https://cerebro.example.com');
    assert.equal(r.status, 403);
  } finally {
    server.close();
  }
});

console.log('\n=== development: permissive to localhost only ===');

await test('any localhost port is allowed without configuration', async () => {
  const app = buildApp('development', undefined);
  const server = await listen(app);
  try {
    const r1 = await requestWithOrigin(server, 'http://localhost:5173');
    const r2 = await requestWithOrigin(server, 'http://localhost:41999');
    const r3 = await requestWithOrigin(server, 'http://127.0.0.1:5173');
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200, 'dev must not require a fixed port — Vite picks its own');
    assert.equal(r3.status, 200);
  } finally {
    server.close();
  }
});

await test('a non-localhost origin gets no Access-Control-Allow-Origin header in development', async () => {
  // The dev branch configures `origin` as a RegExp, not a callback — verified live: the
  // `cors` package only actively rejects (calls back an Error, producing our 403) when
  // `origin` is a function. With a RegExp/string/array it has no error path at all; a
  // non-matching origin simply does not get the ACAO header, and the request still
  // completes with 200. That absent header IS the enforcement point: a real browser
  // refuses to expose the response body to JS without it. A first version of this test
  // asserted 403 here, which is what the production (function-based) branch does — not
  // what this branch does or was ever designed to do; fixed to assert the real mechanism
  // instead of the wrong branch's behavior.
  const app = buildApp('development', undefined);
  const server = await listen(app);
  try {
    const r = await requestWithOrigin(server, 'https://not-localhost.example.com');
    assert.equal(r.status, 200, 'the cors package does not block the response server-side for a non-matching RegExp origin');
    assert.equal(r.allowOrigin, null, 'omitting ACAO is what stops a real browser from reading the response');
  } finally {
    server.close();
  }
});

console.log(failures === 0 ? '\nAll CORS tests passed.\n' : `\n${failures} test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
