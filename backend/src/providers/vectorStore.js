import { QdrantClient } from '@qdrant/js-client-rest';
import { v5 as uuidv5 } from 'uuid';
import { config } from '../config/index.js';
import { wrap } from './breaker.js';
import { PREFETCH_LIMIT } from '../retrieval/constants.js';

let _client = null;

export function client() {
  if (_client) return _client;
  _client = new QdrantClient({
    url: config.qdrant.url,
    apiKey: config.qdrant.apiKey,
    // The server is deliberately pinned to v1.12.4 (docker-compose.yml); the client
    // SDK tracks npm's latest and will usually be newer. The basic CRUD surface this
    // adapter uses (collections, payload indexes, points) is stable across that gap —
    // verified live against v1.12.4 — so the compatibility warning is noise, not risk.
    checkCompatibility: false,
  });
  return _client;
}

async function pingRaw() {
  await client().getCollections();
}

// architecture §6.1: qdrant breaker timeout — ANN query is ~20ms; a 5s breach means
// the node is unhealthy, not slow.
const qdrantBreaker = wrap('qdrant', (...args) => pingRaw(...args), { timeout: 5_000 });

export async function ping() {
  return qdrantBreaker.fire();
}

// Phase 2: a second breaker, same 5s timeout, for the chunk read/write operations added
// this phase. Kept distinct from `qdrantBreaker` above (name 'qdrant') because that one is
// hardwired to `pingRaw` — opossum's `wrap()` memoizes the wrapped function by name on
// first call, so reusing the name would silently make every upsert/delete just re-run the
// health ping instead of the real operation.
const qdrantOpBreaker = wrap('qdrant.chunks', (fn) => fn(), { timeout: 5_000 });

// ── Collection schema (architecture §4, phase 1 §4) ─────────────────────────

const CHUNKS_SCHEMA = {
  vectors: {
    dense: {
      size: 1024,                    // embed-multilingual-v3.0 output width
      distance: 'Cosine',            // Cohere v3 vectors are not unit-normalized; Cosine, not Dot
      on_disk: false,                // 100k × 1024 × 4B = 410 MB — fits RAM, keep it hot
    },
  },
  sparse_vectors: {
    // modifier: 'idf' — Amended during Phase 2 implementation (architecture §5.12): Qdrant
    // computes real BM25 (IDF + length normalization) server-side from raw term-frequency
    // counts when this is set; the client (providers/bm25.js) only ever sends counts.
    sparse: { index: { on_disk: false }, modifier: 'idf' },
  },
  optimizers_config: {
    default_segment_number: 2,       // 2 segments on a dev-scale corpus; more adds merge overhead
  },
  hnsw_config: {
    m: 16,                           // Qdrant default; recall ≈0.97 at this corpus size
    ef_construct: 128,               // build-time candidate width; 128 balances build time vs recall
  },
};

const PAGES_SCHEMA = {
  vectors: {
    colpali: {
      size: 128,                     // ColPali v1.3 per-patch vector width
      distance: 'Cosine',
      multivector_config: { comparator: 'max_sim' },   // late interaction — mandatory for ColPali
      quantization_config: {
        scalar: { type: 'int8', quantile: 0.99, always_ram: true },
      },
      on_disk: true,                 // raw fp32 multivectors to disk; int8 copies stay in RAM
    },
  },
};

const PAYLOAD_INDEXES = ['documentId', 'contentHash'];

// Compares only the fields that determine correctness (dimension, distance, multivector
// comparator, quantization type, sparse modifier). A mismatch here means points would be
// silently scored against the wrong metric or dimensionality — exactly the "unversioned
// Atlas index" failure this script exists to prevent.
function diffVectorConfig(name, existing, expected) {
  const diffs = [];
  for (const [vectorName, expectedVec] of Object.entries(expected.vectors)) {
    const existingVec = existing?.[vectorName];
    if (!existingVec) {
      diffs.push(`vector "${vectorName}" is missing`);
      continue;
    }
    if (existingVec.size !== expectedVec.size) {
      diffs.push(`vector "${vectorName}" size: expected ${expectedVec.size}, got ${existingVec.size}`);
    }
    const existingDistance = String(existingVec.distance ?? '').toLowerCase();
    const expectedDistance = String(expectedVec.distance).toLowerCase();
    if (existingDistance !== expectedDistance) {
      diffs.push(`vector "${vectorName}" distance: expected ${expectedVec.distance}, got ${existingVec.distance}`);
    }
    if (expectedVec.multivector_config) {
      const existingComparator = existingVec.multivector_config?.comparator;
      if (existingComparator !== expectedVec.multivector_config.comparator) {
        diffs.push(
          `vector "${vectorName}" multivector comparator: expected ${expectedVec.multivector_config.comparator}, got ${existingComparator ?? 'none'}`,
        );
      }
    }
    if (expectedVec.quantization_config) {
      const existingType = existingVec.quantization_config?.scalar?.type;
      const expectedType = expectedVec.quantization_config.scalar.type;
      if (existingType !== expectedType) {
        diffs.push(`vector "${vectorName}" quantization: expected ${expectedType}, got ${existingType ?? 'none'}`);
      }
    }
  }
  if (expected.sparse_vectors) {
    for (const [sparseName, expectedSparse] of Object.entries(expected.sparse_vectors)) {
      const existingSparse = existing.sparse_vectors?.[sparseName] ?? existing[sparseName];
      if (!existingSparse) {
        // Qdrant reports sparse vectors under a separate key in getCollection's response;
        // treat either shape as satisfying the check.
        diffs.push(`sparse vector "${sparseName}" is missing`);
        continue;
      }
      const existingModifier = existingSparse.modifier ?? 'none';
      const expectedModifier = expectedSparse.modifier ?? 'none';
      if (existingModifier !== expectedModifier) {
        diffs.push(`sparse vector "${sparseName}" modifier: expected ${expectedModifier}, got ${existingModifier}`);
      }
    }
  }
  return diffs.length > 0 ? { name, diffs } : null;
}

async function ensureCollection(name, schema) {
  const { collections } = await client().getCollections();
  const exists = collections.some((c) => c.name === name);

  if (!exists) {
    await client().createCollection(name, schema);
    console.log(`[setup-qdrant] created "${name}"`);
    return { created: true };
  }

  const info = await client().getCollection(name);
  const existingVectors = info.config?.params?.vectors ?? {};
  const existingSparse = info.config?.params?.sparse_vectors ?? {};
  const mismatch = diffVectorConfig(name, { ...existingVectors, sparse_vectors: existingSparse }, schema);
  if (mismatch) {
    throw new Error(
      `Collection "${name}" already exists with a mismatched config:\n  ${mismatch.diffs.join('\n  ')}`,
    );
  }
  console.log(`[setup-qdrant] "${name}" already exists, config matches`);
  return { created: false };
}

export async function ensureCollections() {
  const chunks = await ensureCollection(config.qdrant.chunksCollection, CHUNKS_SCHEMA);
  const pages = await ensureCollection(config.qdrant.pagesCollection, PAGES_SCHEMA);

  for (const collection of [config.qdrant.chunksCollection, config.qdrant.pagesCollection]) {
    for (const field of PAYLOAD_INDEXES) {
      await client().createPayloadIndex(collection, { field_name: field, field_schema: 'keyword' });
    }
  }

  return { chunks, pages };
}

// ── Phase 2: chunk upsert / delete ───────────────────────────────────────────

// Fixed namespace UUID for uuidv5 point-id derivation. Any valid UUID works as a
// namespace — what matters is that it never changes across runs, since re-ingesting the
// same document must land on the same point ids every time (task 2.14).
const NAMESPACE = 'bd3ef651-79c8-48e5-811d-5f151ecd9b2c';

export async function upsertChunks(chunks, denseVectors, sparseVectors) {
  const points = chunks.map((chunk, i) => ({
    // Deterministic UUIDv5 from (documentId, position). Re-ingesting the same document
    // overwrites the same point ids instead of duplicating — this is what makes
    // FR-DOC-03 (re-ingest replaces) work without a delete-then-insert race.
    id: uuidv5(`${chunk.documentId}:${chunk.position}`, NAMESPACE),
    vector: { dense: denseVectors[i], sparse: sparseVectors[i] },
    payload: chunk,
  }));

  for (let i = 0; i < points.length; i += 256) {
    const batch = points.slice(i, i + 256);
    await qdrantOpBreaker.fire(() => client().upsert(config.qdrant.chunksCollection, {
      wait: true,                       // block until indexed, so 'ready' means queryable
      points: batch,
    }));
  }
}

export async function deleteByDocument(documentId) {
  const before = await client().count(config.qdrant.chunksCollection, {
    filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
    exact: true,
  }).catch(() => ({ count: 0 }));   // collection may not exist yet on a very first call

  await qdrantOpBreaker.fire(() => client().delete(config.qdrant.chunksCollection, {
    wait: true,
    filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
  }));

  return { deletedPoints: before.count };
}

export async function countByDocument(documentId) {
  const { count } = await client().count(config.qdrant.chunksCollection, {
    filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
    exact: true,
  });
  return count;
}

// ── Phase 3: hybrid retrieval ─────────────────────────────────────────────────

function documentIdFilter(documentIds) {
  return documentIds?.length
    ? { must: [{ key: 'documentId', match: { any: documentIds } }] }
    : undefined;
}

// Server-side fusion via Qdrant's Query API (phase 3 §3.1) — one HTTP round trip fuses
// the dense and sparse branches with RRF, deleting the hand-rolled RRF loop the legacy
// search service (deleted phase 6 §5.1) used to run in Node. `filter` is applied inside EACH prefetch branch
// and again at the top level: applying it only at the top level would let each branch
// fill its PREFETCH_LIMIT slots with out-of-scope documents that then get discarded,
// leaving far fewer than PREFETCH_LIMIT in-scope candidates for fusion to work with.
//
// Phase 6 §2.3: the provenance panel needs to show which branch(es) — dense, sparse, or
// both — actually produced each result. The fused query above cannot answer that on its
// own: Qdrant's server-side RRF returns only the merged hit list, discarding which
// prefetch branch(es) contributed a given point. Two additional membership-only queries
// (`with_payload: false, with_vector: false` — just id lists, not a second hydration of
// every candidate's stored text) run concurrently with the fused query rather than after
// it, at the same PREFETCH_LIMIT the fused query's own prefetch branches use, so their
// membership sets exactly match what fusion drew from. This is 3 round trips instead of
// 1 (a deliberate cost accepted for honest attribution, not an oversight) — all three are
// sub-30ms ANN/lookup queries against the same warm collection, negligible next to the
// ~240ms rerank stage that follows.
export async function hybridQuery({ denseVector, sparseVector, limit, documentIds = null }) {
  const filter = documentIdFilter(documentIds);

  const [fused, denseOnly, sparseOnly] = await Promise.all([
    qdrantOpBreaker.fire(() => client().query(config.qdrant.chunksCollection, {
      prefetch: [
        { query: denseVector, using: 'dense', limit: PREFETCH_LIMIT, filter },
        { query: sparseVector, using: 'sparse', limit: PREFETCH_LIMIT, filter },
      ],
      query: { fusion: 'rrf' },   // Qdrant computes Reciprocal Rank Fusion server-side, k=60
      limit,
      filter,
      with_payload: true,
      with_vector: false,        // never ship 1024 floats per hit back to Node
    })),
    qdrantOpBreaker.fire(() => client().query(config.qdrant.chunksCollection, {
      query: denseVector, using: 'dense', limit: PREFETCH_LIMIT, filter,
      with_payload: false, with_vector: false,
    })),
    qdrantOpBreaker.fire(() => client().query(config.qdrant.chunksCollection, {
      query: sparseVector, using: 'sparse', limit: PREFETCH_LIMIT, filter,
      with_payload: false, with_vector: false,
    })),
  ]);

  const denseIds = new Set(denseOnly.points.map((p) => String(p.id)));
  const sparseIds = new Set(sparseOnly.points.map((p) => String(p.id)));

  return fused.points.map((p, i) => {
    const id = String(p.id);
    const inDense = denseIds.has(id);
    const inSparse = sparseIds.has(id);
    return {
      pointId: id,
      fusionScore: p.score,      // RRF score — a rank artifact, NOT a relevance measure
      // Rank within this branch's own pre-rerank ordering (1-based) — NOT a rank across
      // both chunks and pages, since fusionScore (RRF) and maxSimScore (late interaction,
      // multivectorQuery below) are on incomparable scales, same reasoning as toPublicResult's
      // "neither is ever compared to the other" (retrieval/search.js).
      fusionRank: i + 1,
      // Falls back to 'dense' only in the (should-not-happen) case where PREFETCH_LIMIT
      // truncation makes the fused result's own id fall outside both membership sets —
      // both membership queries share the fused query's own PREFETCH_LIMIT, so this is a
      // defensive default, not the expected path.
      branch: inDense && inSparse ? 'both' : inSparse && !inDense ? 'sparse' : 'dense',
      ...p.payload,
    };
  });
}

// Total chunk count, optionally scoped to a set of documents — used by search.js to
// distinguish "you have no documents" (empty_corpus) from "your documents don't cover
// this" (no_relevant_matches), phase 3 §5.2.
export async function countPoints(documentIds = null) {
  const { count } = await client().count(config.qdrant.chunksCollection, {
    filter: documentIdFilter(documentIds),
    exact: true,
  });
  return count;
}

// ── Phase 4: visual pages ─────────────────────────────────────────────────────────────

// A second op breaker for the pages collection, distinct from `qdrantOpBreaker` above for
// the same reason that one is distinct from the health-check `qdrantBreaker`: opossum's
// `wrap()` memoizes by name on first call, so reusing either existing name would silently
// route page upserts/deletes/queries into whichever function that name was first bound
// to. (Amended from the phase 4 §6.4 sample, which called `qdrantBreaker.fire('upsert',
// ...)` — that breaker is hardwired to the zero-arg health-check `pingRaw`, so the call as
// written would have re-run a health ping instead of the real upsert.)
const qdrantPagesBreaker = wrap('qdrant.pages', (fn) => fn(), { timeout: 5_000 });

export async function upsertPages(pages, documentId, fileName) {
  const points = pages.map((p) => ({
    id: uuidv5(`${documentId}:page:${p.page}`, NAMESPACE),
    vector: { colpali: p.multivector },      // list-of-lists → Qdrant multivector
    payload: {
      documentId, fileName, page: p.page,
      imageUri: p.imageUri, widthPx: p.widthPx, heightPx: p.heightPx,
      ocrText: p.ocrText.slice(0, 8000),     // payload preview; the chunked copy is authoritative
      ocrQuality: p.ocrQuality, meanConfidence: p.meanConfidence,
      patchCount: p.patchCount, sourceKind: 'page',
    },
  }));

  // Batch size 4, not 256: one page is ~527 KB of fp32 multivector, so a 256-point
  // batch would be a 135 MB request body. 4 keeps each request near 2 MB.
  for (let i = 0; i < points.length; i += 4) {
    const batch = points.slice(i, i + 4);
    await qdrantPagesBreaker.fire(() => client().upsert(config.qdrant.pagesCollection, {
      wait: true, points: batch,
    }));
  }
}

// MAX_SIM retrieval over the pages collection (phase 4 §7.1, architecture §5.4). Qdrant
// applies MAX_SIM automatically for a `multivector_config` field when the query itself is
// a list of vectors (the PAGES_SCHEMA `colpali` field above) — no `fusion` parameter is
// needed since there is only one vector field to query here, unlike hybridQuery's two.
export async function multivectorQuery({ queryMultivector, limit, documentIds = null }) {
  const filter = documentIdFilter(documentIds);

  const res = await qdrantPagesBreaker.fire(() => client().query(config.qdrant.pagesCollection, {
    query: queryMultivector,
    using: 'colpali',
    limit,
    filter,
    with_payload: true,
    with_vector: false,        // never ship a 1030x128 multivector per hit back to Node
  }));

  return res.points.map((p, i) => ({
    pointId: String(p.id),
    maxSimScore: p.score,      // late-interaction score — a rank artifact, NOT a
                                // relevance measure, same status as hybridQuery's fusionScore
    fusionRank: i + 1,          // rank within the ColPali branch's own pre-rerank ordering (phase 6 §2.3)
    branch: 'colpali',
    ...p.payload,
  }));
}

export async function deletePagesByDocument(documentId) {
  const before = await client().count(config.qdrant.pagesCollection, {
    filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
    exact: true,
  }).catch(() => ({ count: 0 }));   // collection may not exist yet on a very first call

  await qdrantPagesBreaker.fire(() => client().delete(config.qdrant.pagesCollection, {
    wait: true,
    filter: { must: [{ key: 'documentId', match: { value: documentId } }] },
  }));

  return { deletedPoints: before.count };
}

// Total page count — /health's `collections` field (phase 6 §7.1), the twin of
// countPoints() above for the pages collection.
export async function countPagePoints() {
  const { count } = await client().count(config.qdrant.pagesCollection, { exact: true });
  return count;
}
