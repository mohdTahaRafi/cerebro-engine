// Local sparse-vector encoder — replaces FastEmbed's `Qdrant/bm25` model, which the npm
// `fastembed` package does not ship (architecture §5.12, phase 2 §6.2, verified live).
// This produces raw term-frequency counts only; the actual BM25 formula (IDF weighting,
// document-length normalization) is computed server-side by Qdrant because the
// `cerebro_chunks` collection's sparse field carries `modifier: "idf"` (vectorStore.js).

const TOKEN_RE = /[\p{L}\p{N}]+/gu;   // Unicode-aware — CJK/Arabic runs survive, not just ASCII \w

// FNV-1a 32-bit: deterministic, dependency-free, uniform enough for a hashed vocabulary.
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// 2^24 (16.7M) buckets. Birthday-bound collision estimate at 20,000 unique terms in one
// chunk corpus: 20000^2 / (2 * 16.7M) ≈ 1.2% — negligible for a lexical channel that is
// fused with dense search (Phase 3), not relied on alone.
export const VOCAB_SPACE = 1 << 24;

export function tokenize(text) {
  return text.toLowerCase().match(TOKEN_RE) ?? [];
}

export function encodeSparseOne(text) {
  const counts = new Map();   // hashed index -> raw term count
  for (const token of tokenize(text)) {
    const idx = fnv1a(token) % VOCAB_SPACE;
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }
  // Falls back to hashing the whole trimmed string as one pseudo-token when the text has
  // zero \p{L}\p{N} runs (e.g. a symbol-only fragment) — guarantees a non-empty sparse
  // vector for every non-empty chunk (task 2.13's acceptance criterion).
  if (counts.size === 0 && text.trim().length > 0) {
    counts.set(fnv1a(text.trim()) % VOCAB_SPACE, 1);
  }
  const indices = [...counts.keys()].sort((a, b) => a - b);   // Qdrant expects ascending indices
  const values = indices.map((i) => counts.get(i));
  return { indices, values };
}

export async function encodeSparse(texts) {
  return texts.map(encodeSparseOne);
}
