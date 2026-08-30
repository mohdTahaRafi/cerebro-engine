// Phase 8 §3.4 — "A 60 MB file, a .zip renamed .pdf, and a zip bomb are each refused
// before parsing." Real multer + verifyType + zipGuard, exercised via real HTTP
// (fetch + FormData, both global in Node 22) against a throwaway app mounting the REAL
// contextsRouter — same `x-test-user-id` auth-bypass pattern as pageImageLeak.test.js,
// for the identical reason (this control is about the upload pipeline, not the auth
// stack, and running it against the live server's real signup would draw further on
// auth/limits.js's shared signupPerIp budget this whole suite already spends).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import express from 'express';
import { config } from '../../src/config/index.js';
import { User } from '../../src/models/User.js';
import { Context } from '../../src/models/Context.js';
import { Document } from '../../src/models/Document.js';
import contextsRouter from '../../src/api/routes/contexts.js';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { buildZipBomb } from './lib/zipBomb.js';

let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  PASS  ${name}`); }
  catch (err) { console.error(`  FAIL  ${name}\n        ${err.stack}`); failures += 1; }
}

const rand = () => crypto.randomBytes(6).toString('hex');

function buildApp(userId) {
  const app = express();
  app.use((req, res, next) => { req.user = { _id: userId }; next(); });
  app.use(contextsRouter);
  app.use(errorHandler);
  return app;
}

function listen(app) {
  return new Promise((resolve) => { const server = app.listen(0, () => resolve(server)); });
}

async function uploadFile(server, contextId, userId, buffer, filename) {
  const { port } = server.address();
  const form = new FormData();
  form.append('document', new Blob([buffer]), filename);
  const res = await fetch(`http://127.0.0.1:${port}/api/contexts/${contextId}/documents`, {
    method: 'POST', headers: { 'x-test-user-id': userId }, body: form,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON — e.g. an HTML 413 from a body-size limiter */ }
  return { status: res.status, json, text };
}

async function main() {
  await mongoose.connect(config.mongo.uri);
  const user = await User.create({ email: `sec-upload-${rand()}@example.com` });
  const context = await Context.create({ userId: user._id, title: 'Upload Abuse Test' });
  const app = buildApp(String(user._id));
  const server = await listen(app);

  try {
    await test('a 60 MB file is refused (413) before parsing', async () => {
      const oversized = Buffer.alloc(60 * 1024 * 1024, 0x41);
      const res = await uploadFile(server, context._id, String(user._id), oversized, 'huge.pdf');
      assert.equal(res.status, 413, `expected 413, got ${res.status}: ${res.text.slice(0, 200)}`);
    });

    await test('a .zip renamed .pdf is refused (400) by the magic-byte check', async () => {
      // A real, minimal, valid PK-signed zip — just not a PDF.
      const zipBytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const res = await uploadFile(server, context._id, String(user._id), zipBytes, 'renamed.pdf');
      assert.equal(res.status, 400, `expected 400, got ${res.status}: ${res.text}`);
      assert.match(res.json?.error ?? '', /do not match that format/);
    });

    await test('a zip bomb (.xlsx, 50MB declared / ~50KB on disk) is refused (400) before parsing', async () => {
      const bomb = buildZipBomb({ uncompressedBytes: 50 * 1024 * 1024, fileName: 'bomb.xlsx' });
      const res = await uploadFile(server, context._id, String(user._id), bomb, 'bomb.xlsx');
      assert.equal(res.status, 400, `expected 400, got ${res.status}: ${res.text}`);
      assert.match(res.json?.error ?? '', /rejected before parsing/);
    });
  } finally {
    server.close();
    await Document.deleteMany({ contextId: context._id });
    await Context.deleteOne({ _id: context._id });
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  }

  console.log(`\n[security.uploadAbuse] ${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`);
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => { console.error('[security.uploadAbuse] FAILED:', err); process.exit(1); });
