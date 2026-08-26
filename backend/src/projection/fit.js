// fitContext — the UMAP fit that produces one context's cached 3D projection (phase 7
// §4.2). Runs inside the BullMQ 'projection' worker (worker.js), never on the request
// path — this is a 5-15s CPU-bound operation.
//
// Split into `fitContext` (I/O: Qdrant scroll + Mongo filename lookup) and `runFit` (pure:
// sampling + the UMAP fit itself) so test/projection/fit.test.js can exercise determinism,
// the minimum-points guard, and downsampling against synthetic in-memory vectors, without
// a live Mongo/Qdrant stack — the same offline/online split the repo's other
// standalone test scripts already draw (AGENTS.md's Checks section).
import { UMAP } from 'umap-js';
import { Document } from '../models/Document.js';
import { scrollAllVectors } from './scroll.js';
import { packProjection } from './pack.js';

export const PROJECTION_PARAMS = {
  nNeighbors: 15,   // UMAP's own default. Below ~5 the projection fragments into noise;
                    //   above ~50 local structure — the thing being inspected — is lost.
  minDist: 0.1,     // default. Tighter packs clusters into unreadable blobs; looser
                    //   spreads them until cluster membership stops being visible.
  spread: 1.0,
  nComponents: 3,
};

// Fixed seed. UMAP is stochastic: two fits on identical data produce two clouds that
// look equally reasonable and share no coordinate system. A fixed seed makes a rebuild
// on unchanged data reproduce the same picture, so a user who refreshes does not think
// their data moved.
export const PROJECTION_SEED = 42;

export const MAX_NODES = 20_000;   // above this the fit exceeds the 15s budget and the
                                    //   payload exceeds 100 KB. Larger contexts are
                                    //   DOWNSAMPLED, not refused (§4.4).

// mulberry32 — a small, dependency-free deterministic PRNG. umap-js accepts any
// `() => number in [0,1)` as its `random` source; Math.random() would make two fits of
// identical data produce two different clouds, which is exactly what the fixed seed
// above exists to prevent.
export function mulberry32(seed) {
  let s = seed;
  return function next() {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sort by point id (stable, input-order-independent), then take an evenly-spaced stride
// sample across the WHOLE sorted set. A plain [0, maxNodes) slice would systematically
// keep only the oldest-ingested chunks and silently make "downsampled" mean "truncated,"
// which contradicts §4.4's "Showing 20,000 of 47,331 chunks" framing — the shown subset
// is meant to represent the whole corpus, not its earliest fraction.
export function deterministicSample(points, maxNodes) {
  const sorted = [...points].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const stride = sorted.length / maxNodes;
  const sample = new Array(maxNodes);
  for (let i = 0; i < maxNodes; i++) sample[i] = sorted[Math.min(sorted.length - 1, Math.floor(i * stride))];
  return sample;
}

// The pure computation: given a point list already in memory (`{ id, vector, payload }`,
// `payload.documentId` required — `pack.js`'s own contract), run the minimum-points
// guard, downsample if needed, and fit. No Mongo, no Qdrant, no BullMQ. `params`/`maxNodes`/
// `seed` are overridable (defaulting to the real production constants above) purely so
// tests can run a fast fit over a handful of synthetic points instead of PROJECTION_PARAMS'
// production nNeighbors=15 / MAX_NODES=20,000.
export async function runFit(points, { fileNameById = new Map(), params = PROJECTION_PARAMS, maxNodes = MAX_NODES, seed = PROJECTION_SEED, onProgress } = {}) {
  if (points.length < params.nNeighbors + 1) {
    // UMAP cannot build a neighborhood graph with fewer points than nNeighbors. This is
    // a legitimate state (a new context with 4 chunks), not an error.
    return { status: 'failed', reason:
      `A projection needs at least ${params.nNeighbors + 1} chunks; this context has ${points.length}.` };
  }

  const totalCount = points.length;
  const sample = totalCount > maxNodes ? deterministicSample(points, maxNodes) : points;

  const umap = new UMAP({ ...params, random: mulberry32(seed) });
  const embedding = await umap.fitAsync(sample.map((p) => p.vector), (epoch) => onProgress?.(epoch));

  const packed = packProjection(sample, embedding, { fileNameById });
  // `fittedChunkCount` is the TRUE corpus size at fit time, not `nodeCount` (which is the
  // possibly-downsampled sample size) — routes/vectors.js's staleness check compares
  // `nodeCount < fittedChunkCount` to tell "downsampled" apart from "stale," and needs
  // both real numbers to do it, not one number twice.
  return { ...packed, fittedChunkCount: totalCount };
}

export async function fitContext(tenant, { onProgress } = {}) {
  // Scroll the whole context WITH vectors. This is the only place in the system that
  // pulls dense vectors back out of Qdrant; every query path uses with_vector: false.
  const points = await scrollAllVectors(tenant);        // [{ id, vector, payload }]

  const documentIds = [...new Set(points.map((p) => String(p.payload.documentId)))];
  const docs = await Document.find({ _id: { $in: documentIds } }).select('_id fileName').lean();
  const fileNameById = new Map(docs.map((d) => [String(d._id), d.fileName]));

  return runFit(points, { fileNameById, onProgress });
}
