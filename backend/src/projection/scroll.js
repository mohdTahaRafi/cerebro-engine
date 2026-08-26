// scrollAllVectors — the only place in the system that pulls dense vectors back out of
// Qdrant (phase 7 §4.2's own comment); every query path uses with_vector: false. Reads
// `cerebro_chunks` only — the pages collection's `colpali` vectors are 128-dim
// multivectors in a completely different space (late-interaction, not a single point per
// chunk), so they cannot share one 3D UMAP fit with the dense chunk embeddings, and are
// out of scope for this projection (architecture §5.4 already treats them as a distinct
// retrieval mode, not a comparable embedding space).
import { client } from '../providers/vectorStore.js';
import { config } from '../config/index.js';

// Qdrant's scroll API page size. 1,000 points × (1024 floats + payload) is a few MB per
// page — comfortable well under any HTTP body limit, and few enough round trips that a
// 47k-chunk context (the downsampling ceiling's own example) scrolls in ~50 requests.
const SCROLL_PAGE_SIZE = 1000;

export async function scrollAllVectors(tenant) {
  const filter = {
    must: [
      { key: 'userId', match: { value: tenant.userId } },
      { key: 'contextId', match: { value: tenant.contextId } },
    ],
  };

  const points = [];
  let offset = undefined;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const page = await client().scroll(config.qdrant.chunksCollection, {
      filter, limit: SCROLL_PAGE_SIZE, offset,
      with_payload: true, with_vector: ['dense'],
    });
    for (const p of page.points) {
      points.push({ id: String(p.id), vector: p.vector.dense, payload: p.payload });
    }
    offset = page.next_page_offset;
    if (!offset || page.points.length === 0) break;
  }
  return points;
}
