#!/usr/bin/env node
// bench/v2/traces.bench.js — task 8.2: list at 50 rows, detail, and BSON size over 100
// real traces (phase 8 §2.1). "Real" here means real Trace documents in the shape
// telemetry/pipelineTelemetry.js and persistTurn.js actually write (full candidate and
// prompt arrays, not stubs) — generated directly into MongoDB rather than produced by
// running 100 real /api/ask conversations, which would each need a live LLM + Cohere
// round trip purely to manufacture fixture rows. The list/detail ROUTE code (routes/
// traces.js) is exercised unmodified, mounted in a throwaway Express app exactly like
// test/tenancy/isolation.test.js's own `buildApp()` — real Mongo queries, real
// projection, real toSummary/candidateToSource shaping; only the session lookup is
// swapped for a header (requireAuth itself is not this route's concern — it runs at the
// app level in production, index.js's own comment).
import 'dotenv/config';
import mongoose from 'mongoose';
import express from 'express';
import http from 'node:http';
import crypto from 'node:crypto';
import { config } from '../../src/config/index.js';
import { User } from '../../src/models/User.js';
import { Context } from '../../src/models/Context.js';
import { Conversation } from '../../src/models/Conversation.js';
import { Message } from '../../src/models/Message.js';
import { Trace } from '../../src/models/Trace.js';
import tracesRouter from '../../src/api/routes/traces.js';
import { summarizeLatencies } from './lib/percentile.js';

const NUM_TRACES = 100;
const rand = () => crypto.randomBytes(4).toString('hex');

// One 1,200-character preview per candidate (TraceSchema's own cap) x 18 candidates,
// plus a handful of prompt blocks — the same order of magnitude as a real trace at the
// 256 KB truncation boundary (persistTurn.js), not a token-sized stub.
function fakeCandidates(n = 18) {
  const preview = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20).slice(0, 1200);
  return Array.from({ length: n }, (_, i) => ({
    pointId: crypto.randomUUID(), kind: 'text', documentId: new mongoose.Types.ObjectId(),
    fileName: `bench-doc-${i}.pdf`, page: null, headingPath: `Section ${i}`,
    textPreview: preview, branch: ['dense', 'sparse', 'both'][i % 3],
    fusionRank: i + 1, finalRank: i < 8 ? i + 1 : null, score: Math.random(), belowFloor: i >= 8,
  }));
}

function fakePrompt() {
  const text = 'You are Cerebro, a grounded RAG assistant. '.repeat(50);
  return [
    { role: 'system', kind: 'text', content: text, approxTokens: 400 },
    { role: 'user', kind: 'text', content: 'What does the report say about Q3 revenue?', approxTokens: 12 },
  ];
}

function fakeTelemetry() {
  return {
    totalMs: 1800 + Math.random() * 400,
    condenseMs: 120, embedMs: 90, sparseMs: 5, colpaliMs: null,
    chunkRetrieveMs: 180, pageRetrieveMs: null, mergeMs: 8, rerankMs: 240,
    firstTokenMs: 900, generateMs: 1200,
    candidatesRetrieved: 50, candidatesAfterMerge: 42, candidatesAfterFloor: 18,
    rerankSkipped: false, warnings: [],
  };
}

async function seedTraces(user, context, conversation) {
  const docs = [];
  for (let i = 0; i < NUM_TRACES; i++) {
    const message = await Message.create({
      conversationId: conversation._id, userId: user._id, role: 'assistant',
      content: 'This is a synthetic benchmark answer.', sources: [],
    });
    docs.push({
      userId: user._id, contextId: context._id, threadId: conversation._id, messageId: message._id,
      query: `Bench query ${i}: what does the report say about item ${i}?`,
      condensedQuery: null, telemetry: fakeTelemetry(),
      candidates: fakeCandidates(), prompt: fakePrompt(),
      tokens: { input: 450, output: 220, provider: 'anthropic', model: config.llm.anthropic.model },
      runId: null, truncated: false, refused: false,
    });
  }
  await Trace.insertMany(docs);
}

function buildApp(userId) {
  const app = express();
  app.use((req, res, next) => { req.user = { _id: userId }; next(); });
  app.use(tracesRouter);
  return app;
}

function listen(app) {
  return new Promise((resolve) => { const server = app.listen(0, () => resolve(server)); });
}

function requestJson(server, path) {
  const { port } = server.address();
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    http.get({ host: '127.0.0.1', port, path }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ ms: performance.now() - t0, status: res.statusCode, bytes: Buffer.byteLength(body) }));
    }).on('error', reject);
  });
}

async function main() {
  await mongoose.connect(config.mongo.uri);

  const user = await User.create({ email: `bench-traces-${rand()}@example.com` });
  const context = await Context.create({ userId: user._id, title: 'Bench Traces' });
  const conversation = await Conversation.create({ userId: user._id, contextId: context._id, title: 'Bench' });

  try {
    console.log(`[traces.bench] seeding ${NUM_TRACES} real-shaped traces...`);
    await seedTraces(user, context, conversation);

    const app = buildApp(user._id);
    const server = await listen(app);

    console.log('[traces.bench] list (50 rows)...');
    const listSamples = [];
    for (let i = 0; i < 20; i++) {
      const { ms, status } = await requestJson(server, '/api/traces');
      if (status !== 200) throw new Error(`list returned ${status}`);
      listSamples.push(ms);
    }
    const list = summarizeLatencies(listSamples);
    console.log(`  ${JSON.stringify(list)}`);

    const oneTrace = await Trace.findOne({ userId: user._id }).select('_id').lean();
    console.log('[traces.bench] detail...');
    const detailSamples = [];
    for (let i = 0; i < 20; i++) {
      const { ms, status } = await requestJson(server, `/api/traces/${oneTrace._id}`);
      if (status !== 200) throw new Error(`detail returned ${status}`);
      detailSamples.push(ms);
    }
    const detail = summarizeLatencies(detailSamples);
    console.log(`  ${JSON.stringify(detail)}`);

    console.log('[traces.bench] BSON size over 100 traces...');
    const sizes = await Trace.aggregate([
      { $match: { userId: user._id } },
      { $project: { size: { $bsonSize: '$$ROOT' } } },
    ]);
    const byteSizes = sizes.map((s) => s.size);
    const avgBytes = Math.round(byteSizes.reduce((a, b) => a + b, 0) / byteSizes.length);
    const maxBytes = Math.max(...byteSizes);
    console.log(`  avg ${avgBytes} bytes, max ${maxBytes} bytes, cap 262144 bytes (256 KB, architecture §8)`);

    console.log(`\n${JSON.stringify({ list, detail, bson: { avgBytes, maxBytes } }, null, 2)}`);

    server.close();
  } finally {
    await Message.deleteMany({ conversationId: conversation._id });
    await Trace.deleteMany({ userId: user._id });
    await Conversation.deleteOne({ _id: conversation._id });
    await Context.deleteOne({ _id: context._id });
    await User.deleteOne({ _id: user._id });
    await mongoose.disconnect();
  }
}

main().catch((err) => {
  console.error('[traces.bench] FAILED:', err);
  process.exit(1);
});
