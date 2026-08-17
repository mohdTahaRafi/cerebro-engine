// qdrant-hnsw (phase 6 §3.1, §3.3) — a temporary collection populated with the exact same
// dataset the other three engines scored, queried via Qdrant's HNSW index and measured the
// same way (warm-up, TRIALS repeats, median). `distance: 'Dot'` matches SimdDotProduct and
// the JS engines exactly (raw dot product, no normalization) so Recall@10 measures ANN
// approximation error only — not a metric mismatch between engines.
import { QdrantClient } from '@qdrant/js-client-rest';
import { WARMUP_ITERATIONS, TRIALS, summarize } from './stats.js';

const UPLOAD_BATCH = 500;

// Returns latency stats plus the ANN top-K. Recall is deliberately NOT computed here: it
// needs cpp-avx2's exact result as ground truth, and that engine runs in a child process
// spawned only AFTER the parent has released its dataset copy (see cppVsQdrant.js's
// ordering comment), so the comparison happens in the caller once both halves exist.
export async function runQdrant({ url, apiKey, collectionName, dim, dataset, query, k, onUploadProgress }) {
  const client = new QdrantClient({ url, apiKey, checkCompatibility: false });

  await client.deleteCollection(collectionName).catch(() => {});
  await client.createCollection(collectionName, {
    vectors: { size: dim, distance: 'Dot', on_disk: false },
    hnsw_config: { m: 16, ef_construct: 128 },   // matches CHUNKS_SCHEMA (vectorStore.js) — the real serving config
    optimizers_config: { default_segment_number: 2 },
  });

  try {
    const numVectors = dataset.length / dim;
    for (let i = 0; i < numVectors; i += UPLOAD_BATCH) {
      const end = Math.min(i + UPLOAD_BATCH, numVectors);
      const points = [];
      for (let idx = i; idx < end; idx += 1) {
        points.push({
          id: idx,
          vector: Array.from(dataset.subarray(idx * dim, (idx + 1) * dim)),
          payload: { index: idx },
        });
      }
      await client.upsert(collectionName, { wait: true, points });
      onUploadProgress?.(end, numVectors);
    }

    const queryVec = Array.from(query);

    for (let i = 0; i < WARMUP_ITERATIONS; i += 1) {
      await client.query(collectionName, { query: queryVec, limit: k, with_payload: false, with_vector: false });
    }

    const samples = [];
    let lastTop = null;
    for (let i = 0; i < TRIALS; i += 1) {
      const t0 = performance.now();
      // eslint-disable-next-line no-await-in-loop
      const res = await client.query(collectionName, { query: queryVec, limit: k, with_payload: true, with_vector: false });
      samples.push(performance.now() - t0);
      lastTop = res.points;
    }

    return {
      ...summarize(samples),
      top: lastTop.map((p) => ({ index: p.payload.index, score: p.score })),
    };
  } finally {
    // Always drop the temporary collection, even on failure mid-sweep — a benchmark
    // artifact must not linger in the same Qdrant instance the real app's cerebro_chunks/
    // cerebro_pages collections live in.
    await client.deleteCollection(collectionName).catch(() => {});
  }
}
