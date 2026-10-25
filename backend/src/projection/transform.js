// Place a query vector into an existing projection by locating its true nearest
// neighbors in the ORIGINAL 1024-dimensional space — which Qdrant does natively in
// ~20ms — and averaging their known 3D coordinates, weighted by similarity.
//
// Why this is the right primitive rather than a compromise: UMAP's own objective is to
// place a point near its high-dimensional neighbors. This computes that placement
// directly from the neighbors the retrieval engine ACTUALLY returned, using the same
// index the answer was retrieved from. The beacon is therefore guaranteed to sit among
// the chunks the user's query really matched — which is the only claim the console
// makes about it — and it cannot drift into a different coordinate space, because it
// never leaves the one the cloud is in.
//
// Rejected: `umap.transform([queryVector])`. It requires the fitted model's full
// internal state INCLUDING the training vectors (5,000 × 1024 floats, 20 MB), so serving
// one beacon would mean holding every context's training set in memory or re-scrolling
// 20 MB from Qdrant per request, against a 400ms budget. It is also fragile in exactly
// the way that produces a convincing wrong answer: if the rehydrated state does not
// exactly reproduce the fit — a different seed, a reordered training set, a version bump
// in umap-js — the beacon lands in a subtly different coordinate space than the cloud
// it is drawn into. It looks fine. It means nothing.
import * as vectorStore from '../providers/vectorStore.js';
import { unpackPositions } from './pack.js';

const BEACON_K = 12;          // enough neighbors to be robust to one outlier, few enough
                              //   that the centroid stays local rather than drifting to
                              //   the cloud's center of mass
const SOFTMAX_TEMPERATURE = 0.07;   // tuned so the top neighbor dominates without the
                                    //   centroid collapsing exactly onto it — at 0.02 the
                                    //   beacon sits on top of neighbor 1 and is invisible;
                                    //   at 0.3 it drifts toward the mean of all 12

// `nearestDense` is injectable (defaulting to the real Qdrant-backed
// vectorStore.nearestDense) purely so test/projection/transform.test.js can exercise the
// centroid math and the stale-projection branch against a fixture, without a live Qdrant
// stack — production call sites (routes/vectors.js) never pass this option.
export async function projectQuery(tenant, queryVector, projection, { nearestDense = vectorStore.nearestDense } = {}) {
  const hits = await nearestDense(tenant, queryVector, BEACON_K);  // Qdrant ANN

  // `projection` is a `.lean()` Mongo row on every production call site, so `positions`
  // arrives as a BSON `Binary` whose numeric indexing is `undefined` — see
  // pack.js's `unpackPositions`. Reading it directly produced a beacon of
  // `[NaN, NaN, NaN]`, serialized to the browser as `[null, null, null]`, on every
  // single query. Tests pass a Float32Array straight through, which unpackPositions
  // returns untouched.
  const positions = unpackPositions(projection.positions);
  if (!positions || positions.length < projection.pointIds.length * 3) {
    // A row whose coordinate buffer is shorter than its own point-id list is corrupt —
    // refuse rather than place the beacon against whatever bytes happen to be there.
    return { placed: false, reason: 'corrupt_projection', hits: [] };
  }

  const index = new Map(projection.pointIds.map((id, i) => [id, i]));

  const usable = hits.filter((h) => index.has(h.pointId));
  if (usable.length === 0) {
    // Every neighbor is outside the projection — the context was ingested since the last
    // fit, or was downsampled past these points. An honest "cannot place" beats a beacon
    // at the origin, which would look like a real placement at a meaningless location.
    return { placed: false, reason: 'stale_projection', hits: [] };
  }

  // Softmax over cosine similarity. Weighting by raw similarity would let twelve
  // mediocre neighbors outvote one excellent match; softmax concentrates weight on the
  // genuinely close ones while still smoothing over a single outlier.
  const sims = usable.map((h) => h.score);
  const max = Math.max(...sims);
  const exps = sims.map((s) => Math.exp((s - max) / SOFTMAX_TEMPERATURE));
  const total = exps.reduce((a, b) => a + b, 0);

  const beacon = [0, 0, 0];
  usable.forEach((h, i) => {
    const j = index.get(h.pointId) * 3;
    const w = exps[i] / total;
    beacon[0] += positions[j]     * w;
    beacon[1] += positions[j + 1] * w;
    beacon[2] += positions[j + 2] * w;
  });

  return {
    placed: true, beacon,
    neighbors: usable.map((h, i) => ({
      pointId: h.pointId, index: index.get(h.pointId),
      distance: 1 - h.score, weight: exps[i] / total,
    })),
    // The route reranks these same candidates and needs the raw hits (documentId,
    // fileName, page, headingPath, text/ocrText, sourceKind) to build rerank input —
    // returned alongside `neighbors` rather than forcing a second Qdrant round trip.
    hits: usable,
  };
}
