// Standalone verification script (this repo's test/ convention — see AGENTS.md, no
// unified test framework). Live, against `cerebro_chunks_test`/`cerebro_pages_test` —
// NEVER the real collections, following the discipline test/retrieval/scoping.test.js
// already establishes. This is the deliverable that makes Phase 6's central claim
// checkable: two users signing in with different accounts see disjoint documents,
// disjoint conversations, and disjoint retrieval results.
//
// REQUIRES a running Mongo/Qdrant (docker compose up) and live Cohere credentials — it
// calls the real embed API for the one real chunk each synthetic user gets. Run via
// `npm run test:tenancy`, or directly with
// `QDRANT_CHUNKS_COLLECTION=cerebro_chunks_test QDRANT_PAGES_COLLECTION=cerebro_pages_test node test/tenancy/isolation.test.js`.
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import mongoose from 'mongoose';
import { config } from '../../src/config/index.js';
import { User } from '../../src/models/User.js';
import { Context } from '../../src/models/Context.js';
import { Document } from '../../src/models/Document.js';
import * as vectorStore from '../../src/providers/vectorStore.js';
import * as embeddings from '../../src/providers/embeddings.js';
import { search } from '../../src/retrieval/search.js';
import documentsRouter from '../../src/api/routes/documents.js';
import contextsRouter from '../../src/api/routes/contexts.js';

if (config.qdrant.chunksCollection === 'cerebro_chunks') {
  throw new Error('QDRANT_CHUNKS_COLLECTION resolves to the live collection — run via `npm run test:tenancy`.');
}
if (config.qdrant.pagesCollection === 'cerebro_pages') {
  throw new Error('QDRANT_PAGES_COLLECTION resolves to the live collection — run via `npm run test:tenancy`.');
}

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.stack}`);
    failures += 1;
  }
}

const rand = () => crypto.randomBytes(4).toString('hex');

// A minimal throwaway app — same pattern test/api/corsOptions.test.js uses (a real Express
// app, real HTTP requests via node:http). `req.user` is set from a test-only header
// instead of a real session/passport cookie: requireAuth's own session-validation logic
// is already covered by test/auth/session.test.js, and assertions 5/6 below exist to prove
// the ROUTE-LEVEL ownership check (documents.js, requireContext.js), not requireAuth
// itself — this header is that test's fake req.session equivalent.
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(async (req, res, next) => {
    const userId = req.get('x-test-user-id');
    if (!userId) return res.status(401).json({ code: 'unauthenticated' });
    const user = await User.findById(userId).lean();
    if (!user) return res.status(401).json({ code: 'unauthenticated' });
    req.user = user;
    next();
  });
  app.use(contextsRouter);
  app.use(documentsRouter);
  return app;
}

function listen(app) {
  return new Promise((resolve) => { const server = app.listen(0, () => resolve(server)); });
}

function getAs(server, path, userId) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { 'x-test-user-id': userId } },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  await mongoose.connect(config.mongo.uri);
  await vectorStore.ensureCollections();

  const createdUserIds = [];
  const createdContextIds = [];
  const createdDocumentIds = [];
  let server;

  try {
    // ── Setup: two synthetic users, one context each ──────────────────────────────────
    const userA = await User.create({ email: `tenancy-a-${rand()}@example.com` });
    const userB = await User.create({ email: `tenancy-b-${rand()}@example.com` });
    createdUserIds.push(userA._id, userB._id);

    const contextA = await Context.create({ userId: userA._id, title: 'A — Isolation Fixture' });
    const contextB = await Context.create({ userId: userB._id, title: 'B — Isolation Fixture' });
    createdContextIds.push(contextA._id, contextB._id);

    const tenantA = { userId: String(userA._id), contextId: String(contextA._id) };
    const tenantB = { userId: String(userB._id), contextId: String(contextB._id) };

    const docA = await Document.create({
      userId: userA._id, contextId: contextA._id,
      fileName: 'secret.pdf', mimeType: 'application/pdf', sizeBytes: 100,
      contentHash: `hash-a-${rand()}`, storagePath: '/dev/null', status: 'ready', chunkCount: 1,
    });
    const docB = await Document.create({
      userId: userB._id, contextId: contextB._id,
      fileName: 'unrelated.pdf', mimeType: 'application/pdf', sizeBytes: 100,
      contentHash: `hash-b-${rand()}`, storagePath: '/dev/null', status: 'ready', chunkCount: 1,
    });
    createdDocumentIds.push(docA._id, docB._id);

    // A ingests a fixture containing a distinctive sentence.
    const SENTENCE = 'The quarterly pemmican allowance is fourteen units.';
    const OTHER = 'The warehouse ships zinc fittings on alternating Tuesdays.';

    async function ingestOneChunk(tenant, documentId, fileName, text) {
      const chunk = {
        documentId, fileName, contentHash: `hash-${rand()}`, text,
        page: 1, headingPath: null, position: 0, sourceKind: 'text',
      };
      const [{ vectors: dense }, sparse] = await Promise.all([
        embeddings.encodeDocuments([text]),
        embeddings.encodeSparse([text]),
      ]);
      await vectorStore.upsertChunks(tenant, [chunk], dense, sparse);
    }

    await ingestOneChunk(tenantA, String(docA._id), docA.fileName, SENTENCE);

    // A page point for A, for assert 4 — a fabricated 128-dim multivector is enough to
    // exercise Qdrant's tenant filter; no real ColPali embedding is needed to prove scoping.
    const fabricatedVector = () => Array.from({ length: 128 }, () => Math.random());
    await vectorStore.upsertPages(tenantA, [{
      page: 1, multivector: [fabricatedVector(), fabricatedVector()],
      imageUri: `pages/${docA._id}/1.jpg`, widthPx: 100, heightPx: 100,
      ocrText: SENTENCE, ocrQuality: 'good', meanConfidence: 0.9, patchCount: 2,
    }], String(docA._id), docA.fileName);

    server = await listen(buildApp());

    // ── Assertions ──────────────────────────────────────────────────────────────────
    //
    // Assert 1 runs BEFORE B ingests anything of their own, deliberately — this is what
    // makes candidatesRetrieved === 0 an unambiguous proof rather than a coincidence. Once
    // B has even one unrelated chunk of their OWN, Qdrant's dense (cosine) branch will
    // always return it as a "nearest" neighbor regardless of how dissimilar it actually is
    // (that is how ANN search works — it returns the closest available points, not only
    // ones above some relevance bar; the relevance FLOOR is what rejects a bad match, and
    // that floor is deliberately downstream of this measurement). With B's tenant holding
    // zero points at this instant, both the dense and sparse branches of hybridQuery have
    // nothing to return no matter what, so a nonzero candidatesRetrieved here could only
    // mean the tenant filter let one of A's points through — exactly the leak this
    // assertion exists to catch. B's own unrelated fixture is ingested immediately after,
    // for assertions 2-4, which test the filter's precision (excludes A) rather than this
    // one's completeness (excludes A even from an empty result set).
    await test('assert 1 (retrieval): B (zero points of their own) searching A\'s exact sentence gets 0 results and candidatesRetrieved === 0', async () => {
      const { results, telemetry, empty } = await search(tenantB, 'pemmican allowance');
      assert.equal(results.length, 0, `expected 0 results, got ${results.length}`);
      // The load-bearing distinction: candidatesRetrieved === 0 means A's points were
      // NEVER retrieved at all — not retrieved and then filtered downstream (which would
      // show up as candidatesAfterFloor: 0 with a nonzero candidatesRetrieved instead).
      assert.equal(telemetry.candidatesRetrieved, 0, `expected candidatesRetrieved 0, got ${telemetry.candidatesRetrieved}`);
      assert.equal(empty?.reason, 'empty_corpus', `expected empty_corpus, got ${JSON.stringify(empty)}`);
    });

    await ingestOneChunk(tenantB, String(docB._id), docB.fileName, OTHER);

    await test('assert 2 (count): countPoints(B) excludes every one of A\'s points', async () => {
      const bCount = await vectorStore.countPoints(tenantB);
      assert.equal(bCount, 1, `expected exactly B's own 1 point, got ${bCount}`);
    });

    await test('assert 3 (delete): deleteByDocument(B, A\'s documentId) is a no-op, A\'s points survive', async () => {
      const before = await vectorStore.countByDocument(tenantA, String(docA._id));
      assert.equal(before, 1, 'fixture setup: A should have exactly 1 point before this assertion');

      const { deletedPoints } = await vectorStore.deleteByDocument(tenantB, String(docA._id));
      assert.equal(deletedPoints, 0, `expected deletedPoints 0 (cross-tenant delete is a no-op), got ${deletedPoints}`);

      const after = await vectorStore.countByDocument(tenantA, String(docA._id));
      assert.equal(after, 1, `A's point must still exist after B's delete attempt, found ${after}`);
    });

    await test('assert 4 (pages): multivectorQuery(B) returns none of A\'s pages', async () => {
      const results = await vectorStore.multivectorQuery(tenantB, {
        queryMultivector: [fabricatedVector()], limit: 10,
      });
      assert.equal(results.length, 0, `expected 0 page results for B, got ${results.length}`);
    });

    await test('assert 5 (ownership): GET /api/documents/<A id> as B returns 404', async () => {
      const res = await getAs(server, `/api/documents/${docA._id}`, String(userB._id));
      assert.equal(res.status, 404, `expected 404, got ${res.status}: ${res.body}`);
    });

    await test('assert 6 (context): GET /api/contexts/<A contextId> as B returns 404', async () => {
      const res = await getAs(server, `/api/contexts/${contextA._id}`, String(userB._id));
      assert.equal(res.status, 404, `expected 404, got ${res.status}: ${res.body}`);
    });

    console.log(failures === 0 ? '\nAll tenancy isolation tests passed.\n' : `\n${failures} test(s) FAILED.\n`);
  } finally {
    // ── Teardown: delete both users' points by tenant filter, drop the test rows ──────
    if (server) await new Promise((resolve) => server.close(resolve));
    const tenantA = createdUserIds[0] && createdContextIds[0]
      ? { userId: String(createdUserIds[0]), contextId: String(createdContextIds[0]) } : null;
    const tenantB = createdUserIds[1] && createdContextIds[1]
      ? { userId: String(createdUserIds[1]), contextId: String(createdContextIds[1]) } : null;
    if (tenantA) {
      await vectorStore.deleteByContext(tenantA).catch(() => {});
      await vectorStore.deletePagesByContext(tenantA).catch(() => {});
    }
    if (tenantB) {
      await vectorStore.deleteByContext(tenantB).catch(() => {});
      await vectorStore.deletePagesByContext(tenantB).catch(() => {});
    }
    if (createdDocumentIds.length) await Document.deleteMany({ _id: { $in: createdDocumentIds } });
    if (createdContextIds.length) await Context.deleteMany({ _id: { $in: createdContextIds } });
    if (createdUserIds.length) await User.deleteMany({ _id: { $in: createdUserIds } });
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
