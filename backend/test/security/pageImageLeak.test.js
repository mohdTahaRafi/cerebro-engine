// Phase 8 §3.4 — "GET /api/pages/<foreign>/1.jpg returns 404 authenticated, 401
// anonymous." A throwaway Express app mounting the REAL pagesRouter, same pattern
// test/tenancy/isolation.test.js already establishes (`x-test-user-id` header stands in
// for a real session/passport cookie — requireAuth's own session-validation logic is
// covered separately by test/auth/session.test.js and this suite's session.test.js).
// Not run against the live server over real signup/login: auth/limits.js's
// signupPerIp (10/hour) is a shared budget this whole `test:security` suite's other
// files already draw down, and this control is about ROUTE-level ownership
// (routes/pages.js), not the auth stack — the throwaway app exercises that directly.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import express from 'express';
import http from 'node:http';
import { config } from '../../src/config/index.js';
import { User } from '../../src/models/User.js';
import { Context } from '../../src/models/Context.js';
import { Document } from '../../src/models/Document.js';
import * as storage from '../../src/providers/storage.js';
import pagesRouter from '../../src/api/routes/pages.js';

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { console.error(`  FAIL  ${name}\n        ${err.stack}`); failures += 1; }
}

const rand = () => crypto.randomBytes(6).toString('hex');

function buildApp() {
  const app = express();
  app.use((req, res, next) => {
    const userId = req.get('x-test-user-id');
    if (!userId) return res.status(401).json({ code: 'unauthenticated' });
    req.user = { _id: userId };
    next();
  });
  app.use(pagesRouter);
  return app;
}

function listen(app) {
  return new Promise((resolve) => { const server = app.listen(0, () => resolve(server)); });
}

function get(server, path, userId) {
  const { port } = server.address();
  const headers = userId ? { 'x-test-user-id': userId } : {};
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

async function main() {
  await mongoose.connect(config.mongo.uri);

  const owner = await User.create({ email: `sec-pages-owner-${rand()}@example.com` });
  const stranger = await User.create({ email: `sec-pages-stranger-${rand()}@example.com` });
  const context = await Context.create({ userId: owner._id, title: 'Owner Context' });
  const doc = await Document.create({
    userId: owner._id, contextId: context._id,
    fileName: 'confidential.pdf', mimeType: 'application/pdf', sizeBytes: 100,
    contentHash: `sec-pages-${rand()}`, storagePath: '/dev/null', status: 'ready',
    pageCount: 1, visualPageCount: 1,
  });
  const pageKey = `pages/${doc._id}/1.jpg`;
  const fakeJpegBytes = Buffer.from('sec-page-leak-fixture-not-a-real-jpeg');
  await storage.put(pageKey, fakeJpegBytes);

  const app = buildApp();
  const server = await listen(app);
  const path = `/api/pages/${doc._id}/1.jpg`;

  try {
    await test('foreign document image returns 404 to an authenticated non-owner', async () => {
      const res = await get(server, path, String(stranger._id));
      assert.equal(res.status, 404, `expected 404, got ${res.status}`);
    });

    await test('the SAME path returns 401 to an anonymous caller', async () => {
      const res = await get(server, path, null);
      assert.equal(res.status, 401, `expected 401, got ${res.status}`);
    });

    await test('the owner themselves gets the real image bytes back (200)', async () => {
      const res = await get(server, path, String(owner._id));
      assert.equal(res.status, 200, `expected 200, got ${res.status}`);
      assert.equal(res.body.toString(), fakeJpegBytes.toString(), 'owner did not receive the actual stored bytes');
    });
  } finally {
    server.close();
    await storage.delete(pageKey).catch(() => {});
    await Document.deleteOne({ _id: doc._id });
    await Context.deleteOne({ _id: context._id });
    await User.deleteMany({ _id: { $in: [owner._id, stranger._id] } });
    await mongoose.disconnect();
  }

  console.log(`\n[security.pageImageLeak] ${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => { console.error('[security.pageImageLeak] FAILED:', err); process.exit(1); });
