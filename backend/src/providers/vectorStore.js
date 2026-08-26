import { QdrantClient } from '@qdrant/js-client-rest';
import { v5 as uuidv5 } from 'uuid';
import { config } from '../config/index.js';
import { wrap } from './breaker.js';
import { PREFETCH_LIMIT, HNSW_EF_SEARCH } from '../retrieval/constants.js';

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

// ── Phase 6: tenancy (§2) ─────────────────────────────────────────────────────────────
//
// Every exported query function below takes a `tenant` object as its first, required
// argument and throws before issuing any request if it is missing or incomplete. The
// throw is a TypeError, not a returned error: a missing tenant is a programming defect,
// and a defect that returns an empty result set would look like "no matches" and ship.
//
// @typedef {{ userId: string, contextId: string|null }} Tenant

function assertTenant(tenant, fn) {
  if (!tenant || typeof tenant.userId !== 'string' || !tenant.userId) {
    throw new TypeError(
      `vectorStore.${fn}: tenant.userId is required. Every Qdrant operation is ` +
      `tenant-scoped — see docs/planning/v2/phase_6_tenancy_and_contexts.md §2.`,
    );
  }
  if (tenant.contextId !== null && typeof tenant.contextId !== 'string') {
    throw new TypeError(`vectorStore.${fn}: tenant.contextId must be a string or null.`);
  }
  return tenant;
}

// The one place a tenant becomes a Qdrant filter. `contextId: null` is a DELIBERATE,
// explicit widening to "every context this user owns" — used only by the migration
// script's verification count. It is not a default; a caller must pass null on purpose,
// and `assertTenant` still requires userId.
function tenantConditions({ userId, contextId }) {
  const must = [{ key: 'userId', match: { value: userId } }];
  if (contextId !== null && contextId !== undefined) {
    must.push({ key: 'contextId', match: { value: contextId } });
  }
  return must;
}

// Always returns a filter object — never `undefined`. v1's document-scope-only helper
// returned `undefined` when no document scope was given, and `undefined` passed to Qdrant
// means "no filter" — an unscoped search. Under tenancy there is no such thing as an
// unfiltered query, so that helper is deleted outright, not merely widened.
function scopedFilter(tenant, documentIds = null) {
  const must = tenantConditions(tenant);
  if (documentIds?.length) must.push({ key: 'documentId', match: { any: documentIds } });
  return { must };
}

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

// Phase 6 §3.1: `is_tenant` tells Qdrant this field partitions the data. It physically
// groups a tenant's points into contiguous segments, so a filtered search reads FEWER
// segments than an unfiltered one — the filter makes retrieval faster, not slower. This is
// the single reason a shared collection beats collection-per-tenant at this scale
// (architecture §5).
const PAYLOAD_INDEXES = [
  { field_name: 'userId', field_schema: { type: 'keyword', is_tenant: true } },
  { field_name: 'contextId', field_schema: 'keyword' },
  { field_name: 'documentId', field_schema: 'keyword' },
  { field_name: 'contentHash', field_schema: 'keyword' },
];

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
    for (const { field_name, field_schema } of PAYLOAD_INDEXES) {
      // createPayloadIndex is idempotent, so npm run setup:qdrant remains safe to re-run.
      await client().createPayloadIndex(collection, { field_name, field_schema });
    }
  }

  return { chunks, pages };
}

// ── Phase 2: chunk upsert / delete ───────────────────────────────────────────

// Fixed namespace UUID for uuidv5 point-id derivation. Any valid UUID works as a
// namespace — what matters is that it never changes across runs, since re-ingesting the
// same document must land on the same point ids every time (task 2.14).
const NAMESPACE = 'bd3ef651-79c8-48e5-811d-5f151ecd9b2c';

export async function upsertChunks(tenant, chunks, denseVectors, sparseVectors) {
  assertTenant(tenant, 'upsertChunks');
  const points = chunks.map((chunk, i) => ({
    // Deterministic UUIDv5 from (documentId, position). Re-ingesting the same document
    // overwrites the same point ids instead of duplicating — this is what makes
    // FR-DOC-03 (re-ingest replaces) work without a delete-then-insert race.
    id: uuidv5(`${chunk.documentId}:${chunk.position}`, NAMESPACE),
    vector: { dense: denseVectors[i], sparse: sparseVectors[i] },
    // Phase 6 §3.2: userId/contextId stored as strings, not Mongo ObjectIds — the Qdrant
    // client serializes an ObjectId to an opaque object and the keyword index would never
    // match it. This is a silent-failure risk (writes succeed, reads return nothing), so
    // it is stated here at the one place these fields enter every point's payload.
    payload: { ...chunk, userId: tenant.userId, contextId: tenant.contextId },
  }));

  for (let i = 0; i < points.length; i += 256) {
    const batch = points.slice(i, i + 256);
    await qdrantOpBreaker.fire(() => client().upsert(config.qdrant.chunksCollection, {
      wait: true,                       // block until indexed, so 'ready' means queryable
      points: batch,
    }));
  }
}

// `deleteByDocument` taking a tenant is not redundant with `documentId`. A delete-by-filter
// with only `documentId` would, given a guessed or leaked id, delete another tenant's
// points. The tenant condition makes a cross-tenant delete a no-op that reports zero rather
// than a successful attack.
export async function deleteByDocument(tenant, documentId) {
  assertTenant(tenant, 'deleteByDocument');
  const filter = scopedFilter(tenant, [documentId]);

  const before = await client().count(config.qdrant.chunksCollection, {
    filter, exact: true,
  }).catch(() => ({ count: 0 }));   // collection may not exist yet on a very first call

  await qdrantOpBreaker.fire(() => client().delete(config.qdrant.chunksCollection, {
    wait: true, filter,
  }));

  return { deletedPoints: before.count };
}

export async function countByDocument(tenant, documentId) {
  assertTenant(tenant, 'countByDocument');
  const { count } = await client().count(config.qdrant.chunksCollection, {
    filter: scopedFilter(tenant, [documentId]),
    exact: true,
  });
  return count;
}

// ── Phase 3: hybrid retrieval ─────────────────────────────────────────────────

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
//
// Phase 6 §2.4: the filter — now carrying the tenant conditions folded in — is applied at
// the SAME PREFETCH_LIMIT to every one of these five Qdrant calls (2 prefetch branches +
// top level + 2 membership queries). A membership set drawn at a different scope than the
// fused query would attribute branches to the wrong results.
export async function hybridQuery(tenant, { denseVector, sparseVector, limit, documentIds = null }) {
  assertTenant(tenant, 'hybridQuery');
  const filter = scopedFilter(tenant, documentIds);

  const [fused, denseOnly, sparseOnly] = await Promise.all([
    qdrantOpBreaker.fire(() => client().query(config.qdrant.chunksCollection, {
      prefetch: [
        // hnsw_ef only on the dense branch: sparse is served by an inverted index, which
        // has no HNSW graph to explore and ignores the parameter.
        { query: denseVector, using: 'dense', limit: PREFETCH_LIMIT, filter, params: { hnsw_ef: HNSW_EF_SEARCH } },
        { query: sparseVector, using: 'sparse', limit: PREFETCH_LIMIT, filter },
      ],
      query: { fusion: 'rrf' },   // Qdrant computes Reciprocal Rank Fusion server-side, k=60
      limit,
      filter,
      with_payload: true,
      with_vector: false,        // never ship 1024 floats per hit back to Node
    })),
    qdrantOpBreaker.fire(() => client().query(config.qdrant.chunksCollection, {
      // Same hnsw_ef as the fused query's dense prefetch above — a membership set drawn at
      // a different exploration width would not match what fusion actually drew from, and
      // the provenance panel would attribute branches to the wrong results.
      query: denseVector, using: 'dense', limit: PREFETCH_LIMIT, filter,
      params: { hnsw_ef: HNSW_EF_SEARCH },
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
export async function countPoints(tenant, documentIds = null) {
  assertTenant(tenant, 'countPoints');
  const { count } = await client().count(config.qdrant.chunksCollection, {
    filter: scopedFilter(tenant, documentIds),
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

export async function upsertPages(tenant, pages, documentId, fileName) {
  assertTenant(tenant, 'upsertPages');
  const points = pages.map((p) => ({
    id: uuidv5(`${documentId}:page:${p.page}`, NAMESPACE),
    vector: { colpali: p.multivector },      // list-of-lists → Qdrant multivector
    payload: {
      documentId, fileName, page: p.page,
      userId: tenant.userId, contextId: tenant.contextId,
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
export async function multivectorQuery(tenant, { queryMultivector, limit, documentIds = null }) {
  assertTenant(tenant, 'multivectorQuery');
  const filter = scopedFilter(tenant, documentIds);

  const res = await qdrantPagesBreaker.fire(() => client().query(config.qdrant.pagesCollection, {
    query: queryMultivector,
    using: 'colpali',
    limit,
    filter,
    params: { hnsw_ef: HNSW_EF_SEARCH },   // same recall gap as hybridQuery's dense branch

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

export async function deletePagesByDocument(tenant, documentId) {
  assertTenant(tenant, 'deletePagesByDocument');
  const filter = scopedFilter(tenant, [documentId]);

  const before = await client().count(config.qdrant.pagesCollection, {
    filter, exact: true,
  }).catch(() => ({ count: 0 }));   // collection may not exist yet on a very first call

  await qdrantPagesBreaker.fire(() => client().delete(config.qdrant.pagesCollection, {
    wait: true, filter,
  }));

  return { deletedPoints: before.count };
}

// Tenant-scoped total, used only by the migration script's verification step (§7.1 step
// 6) — pass `{ userId, contextId: null }` there to widen to every context the bootstrap
// user owns.
export async function countPagePoints(tenant) {
  assertTenant(tenant, 'countPagePoints');
  const { count } = await client().count(config.qdrant.pagesCollection, {
    filter: { must: tenantConditions(tenant) },
    exact: true,
  });
  return count;
}

// ── Phase 6 §6.1: the cascade primitives ────────────────────────────────────────────
//
// Both take a tenant whose `contextId` must be a real string, not the `null` widening
// `tenantConditions` otherwise allows — deleting "every context this user owns" is never
// what a context-delete cascade means, so that specific misuse is rejected here rather
// than left to `assertTenant`'s weaker "string or null" check.
function assertConcreteContext(tenant, fn) {
  assertTenant(tenant, fn);
  if (!tenant.contextId) {
    throw new TypeError(`vectorStore.${fn}: tenant.contextId must be a non-null context id.`);
  }
}

export async function deleteByContext(tenant) {
  assertConcreteContext(tenant, 'deleteByContext');
  const filter = { must: tenantConditions(tenant) };
  await qdrantOpBreaker.fire(() => client().delete(config.qdrant.chunksCollection, {
    wait: true, filter,
  }));
}

// Named and guarded separately from `deleteByContext` above (which only ever touches
// `cerebro_chunks`, per that function's own comment) — the cascade (§6.1 step 3) deletes
// the pages collection as its own ordered step, against its own breaker.
export async function deletePagesByContext(tenant) {
  assertConcreteContext(tenant, 'deletePagesByContext');
  const filter = { must: tenantConditions(tenant) };
  await qdrantPagesBreaker.fire(() => client().delete(config.qdrant.pagesCollection, {
    wait: true, filter,
  }));
}

// ── Infra-only, cross-tenant totals — /health (phase 1 §8, phase 6 §7.1) ────────────
//
// Deliberately NOT part of the tenant-guarded surface above and deliberately NOT named
// `countPoints`/`countPagePoints` (which are now tenant-required). /health reports the
// whole deployment's collection sizes for operators — a single integer, never any
// document content or per-tenant breakdown — so it carries no cross-tenant leak despite
// running with no tenant filter. `assertTenant` is intentionally not called here; these
// two functions are the one place in this module a Qdrant count runs unscoped, and that
// is by design, not an oversight — see phase_6_tenancy_and_contexts.md's amendment note.
export async function countAllPoints() {
  const { count } = await client().count(config.qdrant.chunksCollection, { exact: true });
  return count;
}

export async function countAllPagePoints() {
  const { count } = await client().count(config.qdrant.pagesCollection, { exact: true });
  return count;
}
