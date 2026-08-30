#!/usr/bin/env node
// bench/v2/seed.js — task 8.1. Generates and ingests 20 users × 5 contexts × 1,000
// chunks (100,000 points total) so tenant-filtered retrieval is actually exercised at
// the scale architecture §8's hard gate names — "a single-tenant benchmark cannot
// detect a filter that is slow at 20 tenants" (phase 8 §2.1).
//
// Runs against QDRANT_CHUNKS_COLLECTION, which `npm run bench:v2` sets to
// `cerebro_chunks_bench` — a DEDICATED collection, not the real `cerebro_chunks` a dev
// or production instance actually serves from. This is a deliberate amendment to the
// phase doc's "against the running system" framing: the collection's schema and
// `is_tenant` payload index (vectorStore.js's `ensureCollections`) are identical either
// way, so the measurement is exactly as real, and 100,000 synthetic points never sit
// permanently alongside a demo instance's real documents — the same isolation
// `QDRANT_CHUNKS_COLLECTION=cerebro_chunks_test` already gives `npm run test:retrieval`
// and `npm run test:tenancy` (test/retrieval/regression.test.js, test/tenancy/
// isolation.test.js), applied to a second, benchmark-scale collection.
//
// Real Cohere embed calls, real BM25 sparse encoding, real Qdrant upserts — no mocking.
// ~1,100 embed calls at BATCH_SIZE=96 (embeddings.js); CONCURRENCY below runs several
// contexts' embed calls in flight at once to keep wall-clock time reasonable without
// overrunning the embed breaker's 10s per-call timeout.
//
// Idempotent by construction: point ids are uuidv5(documentId:position) (vectorStore.js),
// so re-running this script overwrites the same 100,000 points rather than duplicating
// them — safe to re-run after an interrupted first attempt.
import 'dotenv/config';
import { config } from '../../src/config/index.js';
import * as vectorStore from '../../src/providers/vectorStore.js';
import { generateChunkText } from './lib/corpus.js';
import { NUM_TENANTS, CONTEXTS_PER_TENANT, CHUNKS_PER_CONTEXT, TOTAL_CHUNKS, allContexts, tenantUser } from './lib/tenants.js';
import { pacedEmbedAndUpsert, DEFAULT_PACE_MS } from './lib/embedAndUpsert.js';

if (config.qdrant.chunksCollection === 'cerebro_chunks') {
  throw new Error(
    'QDRANT_CHUNKS_COLLECTION resolves to the live collection — run via `npm run bench:v2`, ' +
    'which sets it to cerebro_chunks_bench, or set it yourself before running this script directly.',
  );
}

// Amended live, during the first real run: this project's COHERE_API_KEY is a trial
// key. Trial keys enforce a request-rate limit independent of the monthly quota — the
// very first batch of 4 concurrent embed calls came back 429 Too Many Requests with
// `x-trial-endpoint-call-remaining: 91` still showing plenty of quota left, meaning the
// limiter is per-second/burst, not per-quota. CONCURRENCY defaults to 1 (not 4), and
// every embed call goes through lib/embedAndUpsert.js's withRetry(), which backs off
// and retries a 429 rather than letting one throttled call fail the whole 100k-point
// seed. lib/embedAndUpsert.js is shared with projection.bench.js's own corpus seeding
// for the identical reason.
const CONCURRENCY = Number(process.env.BENCH_SEED_CONCURRENCY ?? 1);

async function seedOneContext({ userIndex, contextIndex, tenant, documentId }) {
  const texts = [];
  for (let i = 0; i < CHUNKS_PER_CONTEXT; i++) {
    // Seed derived from (userIndex, contextIndex, i) — every run generates the exact
    // same 100,000 chunk texts, matching this file's own idempotence claim above.
    const seed = ((userIndex * 7919 + contextIndex * 104729 + i) >>> 0) || 1;
    texts.push(generateChunkText(seed, userIndex, contextIndex, i));
  }
  return pacedEmbedAndUpsert(tenant, documentId, texts);
}

// A minimal concurrency-limited runner — no new dependency for something this small.
async function runPool(items, limit, worker) {
  let cursor = 0;
  let completed = 0;
  const start = performance.now();

  async function lane() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
      completed++;
      const elapsedSec = (performance.now() - start) / 1000;
      const rate = completed / elapsedSec;
      const etaSec = rate > 0 ? (items.length - completed) / rate : 0;
      console.log(
        `[seed] context ${completed}/${items.length} ` +
        `(user ${item.userIndex}, context ${item.contextIndex}) — ` +
        `${elapsedSec.toFixed(0)}s elapsed, ~${etaSec.toFixed(0)}s remaining`,
      );
    }
  }

  await Promise.all(Array.from({ length: limit }, lane));
}

async function verify() {
  console.log('\n[seed] verifying...');
  let total = 0;
  const perTenant = [];
  for (let u = 0; u < NUM_TENANTS; u++) {
    const count = await vectorStore.client().count(config.qdrant.chunksCollection, {
      filter: { must: [{ key: 'userId', match: { value: tenantUser(u) } }] },
      exact: true,
    });
    perTenant.push({ userId: tenantUser(u), count: count.count });
    total += count.count;
  }
  console.log(`[seed] ${perTenant.length} distinct userId values, ${total} points total`);
  for (const row of perTenant) {
    if (row.count !== CONTEXTS_PER_TENANT * CHUNKS_PER_CONTEXT) {
      console.error(`[seed] MISMATCH: ${row.userId} has ${row.count} points, expected ${CONTEXTS_PER_TENANT * CHUNKS_PER_CONTEXT}`);
    }
  }
  if (total !== TOTAL_CHUNKS) {
    throw new Error(`[seed] verification FAILED: expected ${TOTAL_CHUNKS} total points, got ${total}`);
  }
  console.log(`[seed] PASS — ${total} points across ${NUM_TENANTS} distinct userId values`);
}

async function main() {
  console.log(
    `[seed] seeding ${NUM_TENANTS} users x ${CONTEXTS_PER_TENANT} contexts x ` +
    `${CHUNKS_PER_CONTEXT} chunks = ${TOTAL_CHUNKS} points into ` +
    `"${config.qdrant.chunksCollection}" (concurrency ${CONCURRENCY}, pace ${DEFAULT_PACE_MS}ms)`,
  );
  await vectorStore.ensureCollections();
  const contexts = [...allContexts()];
  await runPool(contexts, CONCURRENCY, seedOneContext);
  await verify();
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed] FAILED:', err);
  process.exit(1);
});
