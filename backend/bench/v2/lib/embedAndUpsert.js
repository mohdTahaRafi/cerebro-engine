// Shared paced embed-then-upsert helper — factored out of seed.js so
// projection.bench.js's own corpus seeding (5k/20k single-context, not the 20x5x1k
// tenancy corpus) doesn't duplicate the retry/pacing logic that first run's live 429s
// (seed.js's own header comment) made necessary against this project's trial Cohere key.
import * as embeddings from '../../../src/providers/embeddings.js';
import * as vectorStore from '../../../src/providers/vectorStore.js';

const EMBED_BATCH = 96;
export const DEFAULT_PACE_MS = Number(process.env.BENCH_SEED_PACE_MS ?? 1_200);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function withRetry(fn, { retries = 8, baseDelayMs = 5_000, onRetry } = {}) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRateLimited = err?.statusCode === 429 || /Too\s*Many\s*Requests/i.test(err?.message ?? '');
      if (!isRateLimited || attempt >= retries) throw err;
      const delay = Math.min(60_000, baseDelayMs * 2 ** attempt);
      onRetry?.(attempt, delay);
      await sleep(delay);
    }
  }
}

// texts -> dense (paced, retried) + sparse (local) -> upsertChunks. `onProgress(done,
// total)` fires after each 96-text embed slice for a caller that wants to log a running
// count over a large `texts` array.
export async function pacedEmbedAndUpsert(tenant, documentId, texts, { paceMs = DEFAULT_PACE_MS, onProgress } = {}) {
  const dense = [];
  for (let i = 0; i < texts.length; i += EMBED_BATCH) {
    const slice = texts.slice(i, i + EMBED_BATCH);
    const { vectors } = await withRetry(
      () => embeddings.encodeDocuments(slice),
      { onRetry: (attempt, delay) => console.log(`[embedAndUpsert] 429 — retry ${attempt + 1} in ${delay}ms`) },
    );
    dense.push(...vectors);
    onProgress?.(dense.length, texts.length);
    if (i + EMBED_BATCH < texts.length) await sleep(paceMs);
  }
  const sparse = await embeddings.encodeSparse(texts);

  const chunks = texts.map((text, position) => ({
    documentId, fileName: `${documentId}.txt`,
    contentHash: `${documentId}-${position}`,
    text, page: null, headingPath: null, position, sourceKind: 'text',
  }));
  await vectorStore.upsertChunks(tenant, chunks, dense, sparse);
  return chunks.length;
}
