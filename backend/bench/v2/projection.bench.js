#!/usr/bin/env node
// bench/v2/projection.bench.js — task 8.2: UMAP fit at 5k and 20k nodes, payload size,
// decode time, and project-query end-to-end (phase 8 §2.1). Seeds two DEDICATED
// single-context corpora (5,000 and 20,000 chunks — MAX_NODES in projection/fit.js is
// exactly 20,000, so this is both the p95-reporting size and the downsample-cap
// boundary) into the same `cerebro_chunks_bench` collection tenancy.bench.js and
// seed.js use, under a real Mongo User + Context so POST /api/vectors/query's
// requireContext middleware (routes/vectors.js) resolves a real row.
//
// Uses lib/embedAndUpsert.js's paced, retried embedding — see seed.js's header comment
// for why: this project's COHERE_API_KEY is a trial key with an aggressive rate limit.
import 'dotenv/config';
import mongoose from 'mongoose';
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import { config } from '../../src/config/index.js';
import { User } from '../../src/models/User.js';
import { Context } from '../../src/models/Context.js';
import { Projection } from '../../src/models/Projection.js';
import * as vectorStore from '../../src/providers/vectorStore.js';
import { scrollAllVectors } from '../../src/projection/scroll.js';
import { runFit, PROJECTION_PARAMS, PROJECTION_SEED } from '../../src/projection/fit.js';
import vectorsRouter from '../../src/api/routes/vectors.js';
import { generateChunkText } from './lib/corpus.js';
import { pacedEmbedAndUpsert } from './lib/embedAndUpsert.js';

if (config.qdrant.chunksCollection === 'cerebro_chunks') {
  throw new Error('QDRANT_CHUNKS_COLLECTION resolves to the live collection — run via `npm run bench:v2`.');
}

const SIZES = [5_000, 20_000];   // 20,000 = projection/fit.js's own MAX_NODES
const rand = () => crypto.randomBytes(4).toString('hex');

async function seedSizedContext(user, size) {
  const context = await Context.create({ userId: user._id, title: `Bench Projection ${size}` });
  const tenant = { userId: String(user._id), contextId: String(context._id) };
  const documentId = `bench-proj-doc-${size}-${rand()}`;

  const texts = [];
  for (let i = 0; i < size; i++) {
    const seed = ((size * 7919 + i) >>> 0) || 1;
    texts.push(generateChunkText(seed, 0, 0, i));
  }
  console.log(`[projection.bench] seeding ${size} chunks into a single context...`);
  let done = 0;
  await pacedEmbedAndUpsert(tenant, documentId, texts, {
    onProgress: (n) => {
      done = n;
      if (done % (96 * 10) < 96) console.log(`  ${done}/${size} embedded`);
    },
  });
  return { context, tenant };
}

function buildApp(userId) {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => { req.user = { _id: userId }; next(); });
  app.use(vectorsRouter);
  return app;
}

function listen(app) {
  return new Promise((resolve) => { const server = app.listen(0, () => resolve(server)); });
}

function postJson(server, path, body) {
  const { port } = server.address();
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const req = http.request(
      { host: '127.0.0.1', port, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let out = '';
        res.on('data', (c) => { out += c; });
        res.on('end', () => resolve({ ms: performance.now() - t0, status: res.statusCode, body: out }));
      },
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function main() {
  await mongoose.connect(config.mongo.uri);
  await vectorStore.ensureCollections();

  const user = await User.create({ email: `bench-projection-${rand()}@example.com` });
  const results = [];
  const cleanupContextIds = [];

  try {
    for (const size of SIZES) {
      const { context, tenant } = await seedSizedContext(user, size);
      cleanupContextIds.push(context._id);

      console.log(`[projection.bench] fitting ${size}-node context...`);
      const fitStart = performance.now();
      const points = await scrollAllVectors(tenant);
      const fitResult = await runFit(points, { fileNameById: new Map() });
      const fitMs = performance.now() - fitStart;

      if (fitResult.status === 'failed') throw new Error(`fit failed at size ${size}: ${fitResult.reason}`);

      const payloadBytes = fitResult.positions.byteLength + fitResult.docIndex.byteLength
        + Buffer.byteLength(JSON.stringify(fitResult.documents)) + Buffer.byteLength(JSON.stringify(fitResult.pointIds));

      // "Decode time" — the frontend's own job: base64 -> ArrayBuffer -> typed array
      // (VectorSpace.tsx). Measured here the same way, since Node's Buffer decode is the
      // representative cost (both are a base64 parse into a byte array).
      const decodeStart = performance.now();
      const b64 = fitResult.positions.toString('base64');
      const decoded = Buffer.from(b64, 'base64');
      const decodeMs = performance.now() - decodeStart;
      if (decoded.length !== fitResult.positions.byteLength) throw new Error('decode round-trip mismatch');

      await Projection.updateOne(
        { contextId: tenant.contextId },
        {
          userId: tenant.userId, contextId: tenant.contextId, status: 'fresh', reason: null,
          nodeCount: fitResult.nodeCount, pointIds: fitResult.pointIds,
          positions: fitResult.positions, docIndex: fitResult.docIndex,
          documents: fitResult.documents, bounds: fitResult.bounds,
          params: { nNeighbors: PROJECTION_PARAMS.nNeighbors, minDist: PROJECTION_PARAMS.minDist, spread: PROJECTION_PARAMS.spread, seed: PROJECTION_SEED },
          fittedChunkCount: fitResult.fittedChunkCount, fittedAt: new Date(),
        },
        { upsert: true },
      );

      const app = buildApp(user._id);
      const server = await listen(app);
      console.log('[projection.bench] project-query end-to-end...');
      const { ms: queryMs, status, body } = await postJson(server, '/api/vectors/query', {
        contextId: String(context._id), query: 'What does the quarterly revenue statement show?',
      });
      server.close();
      if (status !== 200) console.error(`  project-query returned ${status}: ${body}`);

      const row = {
        size, fitMs: Math.round(fitMs), payloadBytes, decodeMs: Math.round(decodeMs * 1000) / 1000,
        projectQueryMs: Math.round(queryMs), projectQueryStatus: status,
      };
      results.push(row);
      console.log(`  ${JSON.stringify(row)}`);
    }

    console.log(`\n${JSON.stringify(results, null, 2)}`);

    const slow = results.find((r) => r.fitMs > 60_000);
    if (slow) {
      console.error(`[projection.bench] fit at ${slow.size} nodes took ${slow.fitMs}ms — exceeds the ProjectionFitSlow alert threshold (60s p95, alerts.yml)`);
    }
  } finally {
    await Projection.deleteMany({ userId: String(user._id) });
    await Context.deleteMany({ _id: { $in: cleanupContextIds } });
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[projection.bench] FAILED:', err);
  process.exit(1);
});
