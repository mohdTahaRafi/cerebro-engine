// Phase 3 tuning constants (phase 3 §3.1, §5.1, §8). Every value here is justified where
// it is consumed; kept in one file so vectorStore.js, search.js, and the API route all
// read the same numbers instead of each hardcoding its own copy.

// Each prefetch branch must overfetch so RRF fusion has material to work with. 100 is 2x
// the fused limit — below ~1.5x the branches barely overlap and RRF degenerates toward
// whichever branch ranked first (phase 3 §3.1).
export const PREFETCH_LIMIT = 100;

// Fused candidate count handed to the reranker. Matches the reranker's cost ceiling
// (§4.2) — larger candidate sets raise rerank latency linearly with negligible top-8 gain.
export const FUSION_LIMIT = 50;

// Cohere rerank v3 returns a calibrated relevanceScore in [0,1]. 0.15 sits in the gap
// between "wrong but topically adjacent" (0.2-0.5) and "unrelated" (<0.05), chosen low
// rather than high because the cost asymmetry favors recall — a marginal chunk shown to
// the user is a minor annoyance, whereas discarding the only chunk containing the answer
// produces a confident "I don't know" about a document the user can see in their library
// (phase 3 §5.1).
export const RELEVANCE_FLOOR = 0.15;

// Cohere embed v3 truncates at 512 tokens ~= 2,000 chars; 4,000 accepts pasted paragraphs
// while bounding the request body. Beyond this the query is a document, not a question
// (phase 3 §8).
export const MAX_QUERY_CHARS = 4_000;

// POST /api/search's topN default and clamp range. Above 25 the reranker's topN exceeds
// the 50-candidate pool's useful depth (phase 3 §8).
export const TOP_N_DEFAULT = 8;
export const TOP_N_MIN = 1;
export const TOP_N_MAX = 25;

// Search-time HNSW exploration width. The index is built with ef_construct: 128
// (CHUNKS_SCHEMA / PAGES_SCHEMA), but build-time ef says nothing about how hard a *query*
// looks: with no explicit params.hnsw_ef, every search ran at Qdrant's untuned default,
// which does not grow with the corpus. More points then compete for the same fixed
// exploration budget, so recall decays as the corpus grows — backwards from what a
// production index should do.
//
// Measured with backend/bench/cppVsQdrant.js at 100k x 1024 dims, against exact
// brute-force ground truth (`--hnsw-ef=<n>` sweeps it):
//
//     ef        Recall@10
//     default   0.5
//     128       0.6
//     256       0.7
//     512       0.8
//     1024      0.9
//
// Two caveats that keep 256 provisional rather than settled, both real:
//
//   1. The benchmark computes recall from ONE query vector, so every figure above is
//      quantized to 0.1 and carries no confidence interval. The monotonic climb is the
//      trustworthy part; the individual values are not precise. Sweeping ef against a
//      multi-query recall harness is what would justify a final number.
//   2. That corpus is uniform random vectors in 1024 dimensions — close to the worst case
//      for any ANN index, since random high-dimensional points are all nearly equidistant.
//      Real Cohere embeddings cluster heavily, so production recall at a given ef is
//      expected to be materially better than this table. It is a floor, not an estimate.
//
// 256 is chosen as the point where recall has clearly improved over the default while
// query latency stays within noise of it (the sweep's latency column varied
// non-monotonically — 32ms, 39ms, 26ms, 62ms, 34ms — i.e. HTTP overhead dominates ef's
// cost at this scale, so latency does not argue against raising it).
export const HNSW_EF_SEARCH = 256;

// Phase 4 (§7.1): the ColPali branch's candidate width. A page is roughly 5-8 chunks'
// worth of content, so 10 pages and FUSION_LIMIT's 50 chunks contribute comparable
// volumes of material to the reranker while keeping the combined candidate set at the
// 50-60 the reranker is budgeted for (§4.2).
export const PAGE_FUSION_LIMIT = 10;
