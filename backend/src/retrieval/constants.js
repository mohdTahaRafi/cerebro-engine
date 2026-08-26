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

// Relevance gating (BUG-002, docs/bugs/BUG-002-relevance-floor-absolute-threshold.md).
//
// Phase 3 §5.1 set this to 0.15, describing it as sitting "in the gap between 'wrong but
// topically adjacent' (0.2-0.5) and 'unrelated' (<0.05)". Those bands do not match what
// rerank-multilingual-v3.0 actually returns against this corpus. Measured over all 56 live
// chunks, the top score for a question the corpus genuinely answers ranges across four
// orders of magnitude — 2.18e-4 for "whose resume is this and what is their name" up to
// 9.93e-1 for "explain what happens when a transaction is rolled back" — while genuinely
// off-corpus questions top out at 1.62e-5. Every answerable phrasing that did not happen to
// quote a proper noun therefore landed three orders of magnitude under 0.15 and was
// refused, even though the chunk holding the answer was ranked #1.
//
// The threshold was right in kind and wrong in magnitude. Measured boundary:
//
//   answerable, lowest observed top score     2.18e-4
//   irrelevant, highest observed top score    1.62e-5
//
// 5e-5 is the geometric midpoint of that 13.5x gap — equidistant on the log scale the
// scores actually live on, ~3x above observed noise and ~4x below the weakest true
// positive. Phase 3 §5.1's cost asymmetry still governs the choice of midpoint over a
// tighter bound: a marginal chunk shown to the user is a minor annoyance, whereas a
// confident "I don't know" about a document the user can see in their library is not.
//
// A ratio test (top/median, top/p90) was measured first and rejected: on the real 56-chunk
// corpus the classes overlap — top/median is 37.61 for the answerable "what is the person's
// name" and 36.65 for the irrelevant "what were the best films released in 1994" — so no
// ratio threshold separates them. It looked viable only on an 8-chunk fixture.
export const RELEVANCE_FLOOR = 5e-5;

// Of an accepted set, keep candidates within one order of magnitude of the peak. With the
// floor three orders of magnitude lower than before, a bare floor would admit most of the
// reranked set as "above noise" and hand the generator a pile of weak context; anchoring
// retention to the peak instead keeps the answer plus its nearest support. The LLM makes
// the final judgment on whether that context answers the question — graph/prompts.js
// already instructs it to refuse when the context does not support an answer.
export const RETENTION_FRACTION = 0.10;

// Cohere embed v3 truncates at 512 tokens ~= 2,000 chars; 4,000 accepts pasted paragraphs
// while bounding the request body. Beyond this the query is a document, not a question
// (phase 3 §8).
// BUG-003 (docs/bugs/BUG-003-stopword-only-queries.md): a query made entirely of function
// words carries no retrievable intent, but the reranker scores it near-perfectly against
// any prose — "the" tops out at 0.911 against the live corpus, above the score of most
// genuine questions — because the token trivially occurs in every candidate. No relevance
// threshold can separate that from a real query, so it is rejected on the query side
// before retrieval runs.
//
// Deliberately English-only and deliberately short: it holds the closed-class function
// words that can plausibly constitute an entire accidental query (a stray keystroke, a
// half-typed question). A query in any other language contains no token from this list and
// is therefore never rejected by it — the check fails safe for the multilingual corpus
// embed-multilingual-v3.0 supports. Rejection also requires *every* token to be in the
// list, so "the transaction states" is unaffected.
export const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'do', 'does', 'for', 'from',
  'had', 'has', 'have', 'he', 'her', 'his', 'i', 'if', 'in', 'into', 'is', 'it', 'its',
  'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 's', 'she', 'so', 't', 'that', 'the',
  'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'was', 'we', 'were',
  'will', 'with', 'you', 'your',
]);

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
