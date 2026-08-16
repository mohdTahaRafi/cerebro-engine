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
