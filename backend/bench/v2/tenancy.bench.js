#!/usr/bin/env node
// bench/v2/tenancy.bench.js — task 8.2/8.4, the hard gate (phase 8 §2.2, gate 1):
// tenant-filtered hybrid retrieval p95 at 100k chunks across 20 synthetic tenants MUST
// be < 550ms, and the SAME query run unfiltered (no tenant scope at all, over the whole
// 100k-point collection) is measured alongside it to confirm the `is_tenant` payload
// index (vectorStore.js) makes the filter faster than an unfiltered scan, not slower.
//
// Measures vectorStore.hybridQuery() directly — the dense+sparse fusion Qdrant call
// alone (telemetry's `chunkRetrieve` stage), NOT the full search() pipeline, which also
// runs Cohere Rerank. The 550ms budget in architecture §8 and the RetrievalP95Regression
// alert (alerts.yml) are both stated in terms of chunkRetrieve specifically — rerank
// latency is a separate, already-budgeted stage (architecture §8's rerank row).
//
// REQUIRES `npm run bench:v2` (or bench/v2/seed.js run manually first) to have seeded
// the 100,000-point corpus into QDRANT_CHUNKS_COLLECTION=cerebro_chunks_bench.
import 'dotenv/config';
import { config } from '../../src/config/index.js';
import * as embeddings from '../../src/providers/embeddings.js';
import * as vectorStore from '../../src/providers/vectorStore.js';
import { FUSION_LIMIT, PREFETCH_LIMIT, HNSW_EF_SEARCH } from '../../src/retrieval/constants.js';
import { BENCH_QUERIES } from './lib/corpus.js';
import { NUM_TENANTS, CONTEXTS_PER_TENANT, tenant } from './lib/tenants.js';
import { summarizeLatencies } from './lib/percentile.js';

if (config.qdrant.chunksCollection === 'cerebro_chunks') {
  throw new Error('QDRANT_CHUNKS_COLLECTION resolves to the live collection — run via `npm run bench:v2`.');
}

const HARD_GATE_MS = 550;   // phase 8 §2.2 gate 1
const SAMPLES_PER_TENANT = 5;   // 20 tenants x 5 = 100 samples per condition

// The unfiltered comparison — same dense+sparse RRF fusion shape as
// vectorStore.hybridQuery(), just with no tenant filter at all, run over the same
// 100,000-point collection. Bypasses vectorStore's assertTenant on purpose (this is the
// one place in the codebase that is deliberately allowed to query without a tenant —
// see vectorStore.js's own comment on why every OTHER caller must not).
async function unfilteredHybridQuery({ denseVector, sparseVector, limit }) {
  const result = await vectorStore.client().query(config.qdrant.chunksCollection, {
    prefetch: [
      { query: denseVector, using: 'dense', limit: PREFETCH_LIMIT, params: { hnsw_ef: HNSW_EF_SEARCH } },
      { query: sparseVector, using: 'sparse', limit: PREFETCH_LIMIT },
    ],
    query: { fusion: 'rrf' },
    limit,
    with_payload: false,
    with_vector: false,
  });
  return result.points;
}

async function main() {
  console.log(`[tenancy.bench] encoding ${BENCH_QUERIES.length} queries...`);
  const encoded = [];
  for (const q of BENCH_QUERIES) {
    const [{ vector: denseVector }, [sparseVector]] = await Promise.all([
      embeddings.encodeQuery(q), embeddings.encodeSparse([q]),
    ]);
    encoded.push({ query: q, denseVector, sparseVector });
  }

  const filteredMs = [];
  const unfilteredMs = [];

  let sample = 0;
  for (let u = 0; u < NUM_TENANTS; u++) {
    for (let i = 0; i < SAMPLES_PER_TENANT; i++) {
      const { denseVector, sparseVector } = encoded[sample % encoded.length];
      const t = tenant(u, sample % CONTEXTS_PER_TENANT);
      sample++;

      const t0 = performance.now();
      await vectorStore.hybridQuery(t, { denseVector, sparseVector, limit: FUSION_LIMIT });
      filteredMs.push(performance.now() - t0);

      const t1 = performance.now();
      await unfilteredHybridQuery({ denseVector, sparseVector, limit: FUSION_LIMIT });
      unfilteredMs.push(performance.now() - t1);
    }
  }

  const filtered = summarizeLatencies(filteredMs);
  const unfiltered = summarizeLatencies(unfilteredMs);

  console.log('\n[tenancy.bench] tenant-filtered hybrid retrieval (vectorStore.hybridQuery):');
  console.log(`  ${JSON.stringify(filtered)}`);
  console.log('[tenancy.bench] same query, unfiltered (no tenant scope, whole collection):');
  console.log(`  ${JSON.stringify(unfiltered)}`);

  const gatePassed = filtered.p95Ms < HARD_GATE_MS;
  const fasterThanUnfiltered = filtered.p95Ms <= unfiltered.p95Ms;

  console.log(`\n[tenancy.bench] HARD GATE 1: filtered p95 ${filtered.p95Ms}ms < ${HARD_GATE_MS}ms? ${gatePassed ? 'PASS' : 'FAIL'}`);
  console.log(`[tenancy.bench] filtered p95 (${filtered.p95Ms}ms) <= unfiltered p95 (${unfiltered.p95Ms}ms)? ${fasterThanUnfiltered ? 'yes — is_tenant grouping is not a regression' : 'NO — investigate'}`);

  console.log(`\n${JSON.stringify({ filtered, unfiltered, hardGateMs: HARD_GATE_MS, gatePassed, fasterThanUnfiltered }, null, 2)}`);

  if (!gatePassed) {
    console.error('\n[tenancy.bench] HARD GATE FAILED — this blocks the phase per phase_8 §2.2.');
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[tenancy.bench] FAILED:', err);
  process.exit(1);
});
