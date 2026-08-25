// phase_4 §1.2, §4 — dev-only demo data for /admin/vectors. Real projections are Phase 7
// (architecture §7.7's cached-UMAP pipeline). Generated deterministically per context id with
// a seeded PRNG — three cluster centers, twelve documents distributed across them, 5,412
// points jittered around their document's cluster — packed exactly the way the real endpoint
// will (architecture §7.9: base64 Float32Array positions + Uint16Array docIndex), so
// decodeProjection.ts exercises the real decode path against this fixture too.
import type {
  ProjectionResponse, ProjectQueryRequest, ProjectQueryResponse, VectorNodeDetail,
} from '../../contracts';

const NODE_COUNT = 5412;
const CLUSTER_CENTERS: Array<[number, number, number]> = [[-3.2, 0.4, 0.1], [3.0, 1.8, -1.4], [-0.6, -2.6, 2.2]];
const CLUSTER_SIGMA = 0.65;

interface DocSpec { id: string; fileName: string; color: number; cluster: number }
const DOCUMENTS: DocSpec[] = [
  { id: 'doc-0', fileName: 'q3-earnings.pdf', color: 0x3b7dd8, cluster: 0 },
  { id: 'doc-1', fileName: 'notes.md', color: 0x2e9e7a, cluster: 0 },
  { id: 'doc-2', fileName: 'risk-factors.pdf', color: 0xd9822b, cluster: 0 },
  { id: 'doc-3', fileName: 'board-deck.pdf', color: 0x8b5cd6, cluster: 0 },
  { id: 'doc-4', fileName: 'guidance-memo.pdf', color: 0x4b6fd6, cluster: 1 },
  { id: 'doc-5', fileName: 'apac-summary.pdf', color: 0x1fa6a6, cluster: 1 },
  { id: 'doc-6', fileName: 'scan.pdf', color: 0xc2568f, cluster: 1 },
  { id: 'doc-7', fileName: 'churn-analysis.md', color: 0x94a3be, cluster: 1 },
  { id: 'doc-8', fileName: 'compliance-log.pdf', color: 0xe08cb0, cluster: 2 },
  { id: 'doc-9', fileName: 'capex-plan.pdf', color: 0x5cc8a0, cluster: 2 },
  { id: 'doc-10', fileName: 'customer-interviews.md', color: 0xf0a65c, cluster: 2 },
  { id: 'doc-11', fileName: 'filing-diff.pdf', color: 0x6c63d6, cluster: 2 },
];

function seedFrom(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Box-Muller — uniform mulberry32 samples turned into a gaussian jitter so each cluster
// reads as a soft cloud rather than a hard-edged cube.
function gaussian(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-9);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

interface GeneratedCloud {
  positions: Float32Array;
  docIndex: Uint16Array;
  pointIds: string[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
  // Computed once per context and cached alongside the cloud — a fresh Date.now() on every
  // call would make `fittedAt` drift by milliseconds on every poll, which VectorSpace.tsx
  // reads as "the projection was just rebuilt" and discards the beacon over (§4.6). A demo
  // fixture that "rebuilds" itself every refresh would make that logic look broken when it
  // is the fixture that is dishonest.
  fittedAt: string;
}

const cloudCache = new Map<string, GeneratedCloud>();

function generateCloud(contextId: string): GeneratedCloud {
  const cached = cloudCache.get(contextId);
  if (cached) return cached;

  const rand = mulberry32(seedFrom(contextId));
  const positions = new Float32Array(NODE_COUNT * 3);
  const docIndex = new Uint16Array(NODE_COUNT);
  const pointIds: string[] = new Array(NODE_COUNT);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < NODE_COUNT; i++) {
    const docI = i % DOCUMENTS.length;
    const doc = DOCUMENTS[docI];
    const center = CLUSTER_CENTERS[doc.cluster];
    const x = center[0] + gaussian(rand) * CLUSTER_SIGMA;
    const y = center[1] + gaussian(rand) * CLUSTER_SIGMA;
    const z = center[2] + gaussian(rand) * CLUSTER_SIGMA;
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    docIndex[i] = docI;
    pointIds[i] = `pt-${contextId}-${i}`;
    min[0] = Math.min(min[0], x); min[1] = Math.min(min[1], y); min[2] = Math.min(min[2], z);
    max[0] = Math.max(max[0], x); max[1] = Math.max(max[1], y); max[2] = Math.max(max[2], z);
  }

  const cloud: GeneratedCloud = {
    positions, docIndex, pointIds, bounds: { min, max },
    fittedAt: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
  };
  cloudCache.set(contextId, cloud);
  return cloud;
}

function toBase64(buf: ArrayBufferLike): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

export function projection(contextId: string): ProjectionResponse {
  const cloud = generateCloud(contextId);
  return {
    staleness: 'fresh',
    reason: null,
    nodeCount: NODE_COUNT,
    positions: toBase64(cloud.positions.buffer),
    docIndex: toBase64(cloud.docIndex.buffer),
    pointIds: cloud.pointIds,
    documents: DOCUMENTS.map((d) => ({ id: d.id, fileName: d.fileName, color: d.color })),
    bounds: cloud.bounds,
    fittedAt: cloud.fittedAt,
  };
}

export function query(body: ProjectQueryRequest): ProjectQueryResponse {
  const cloud = generateCloud(body.contextId);
  const rand = mulberry32(seedFrom(body.query));
  // The query text hashes to a point inside one of the three clusters — a stable, plausible
  // beacon location for a given query string, not a real embedding transform (that's
  // architecture §7.8's fitted-model `transform()`, Phase 7).
  const cluster = CLUSTER_CENTERS[seedFrom(body.query) % CLUSTER_CENTERS.length];
  const beacon: [number, number, number] = [
    cluster[0] + gaussian(rand) * 0.4,
    cluster[1] + gaussian(rand) * 0.4,
    cluster[2] + gaussian(rand) * 0.4,
  ];

  const distances = cloud.pointIds.map((pointId, index) => {
    const dx = cloud.positions[index * 3] - beacon[0];
    const dy = cloud.positions[index * 3 + 1] - beacon[1];
    const dz = cloud.positions[index * 3 + 2] - beacon[2];
    return { pointId, index, distance: Math.sqrt(dx * dx + dy * dy + dz * dz) };
  }).sort((a, b) => a.distance - b.distance).slice(0, 10);

  const neighbors = distances.map((d, i) => ({
    pointId: d.pointId, index: d.index, distance: Number(d.distance.toFixed(4)),
    // Top 4 by distance "survive reranking" (kept, ringed); the rest were retrieved but cut.
    rerankScore: i < 4 ? Number((0.9 - i * 0.15 - rand() * 0.05).toFixed(4)) : null,
    finalRank: i < 4 ? i + 1 : null,
  }));

  return { beacon, neighbors };
}

const CHUNK_TEXT_TEMPLATES = [
  'EMEA revenue for the quarter outperformed APAC by a wide margin, driven primarily by renewal expansions in the enterprise segment.',
  'The board raised concerns about capex pacing relative to the approved budget and requested a revised schedule by the next meeting.',
  'Customer churn in this cohort was attributed to onboarding friction rather than pricing, based on the exit interview notes.',
  'Guidance for next quarter assumes flat headcount growth and a continuation of the current renewal rate.',
];

export function node(pointId: string): VectorNodeDetail | undefined {
  const match = /^pt-(.+)-(\d+)$/.exec(pointId);
  if (!match) return undefined;
  const [, contextId, indexStr] = match;
  const index = Number(indexStr);
  const cloud = generateCloud(contextId);
  if (index < 0 || index >= cloud.pointIds.length || cloud.pointIds[index] !== pointId) return undefined;

  const doc = DOCUMENTS[cloud.docIndex[index]];
  const x = cloud.positions[index * 3], y = cloud.positions[index * 3 + 1], z = cloud.positions[index * 3 + 2];
  return {
    pointId,
    text: CHUNK_TEXT_TEMPLATES[index % CHUNK_TEXT_TEMPLATES.length],
    documentId: doc.id,
    fileName: doc.fileName,
    page: index % 3 === 0 ? 1 + (index % 12) : null,
    headingPath: index % 3 === 0 ? null : 'Revenue › Regional breakdown',
    position: index,
    norm: Number(Math.sqrt(x * x + y * y + z * z).toFixed(4)),
    neighborCount: 10,
  };
}
