import { CohereClient } from 'cohere-ai';
import { config } from '../config/index.js';
import { wrap } from './breaker.js';

let _client = null;

function client() {
  if (_client) return _client;
  _client = new CohereClient({ token: config.cohere.apiKey });
  return _client;
}

// architecture §6.1: 50 short documents return in ~250ms p95; this stage is
// inside the interactive query budget.
export const rerankBreaker = wrap('cohere.rerank', (req) => client().rerank(req), { timeout: 5_000 });

export async function ping() {
  await rerankBreaker.fire({
    model: config.cohere.rerankModel,
    query: 'ping',
    documents: ['pong', 'unrelated'],
    topN: 1,
  });
}

// ── Phase 3: cross-encoder reranking ─────────────────────────────────────────

// The reranker sees heading context, because a bare table row is unrankable without
// knowing what section it came from. Truncated at 4000 chars: rerank v3 caps input per
// document and a chunk is ~1300 chars, so this only bites on Phase 4 OCR pages (§4.1).
const RERANK_TEXT_CHARS = 4_000;

// Phase 4 (§7.3): the reranker is text-only, so a page is represented by its OCR text.
// Both kinds go into the same rerank call — this function is the single place their
// scores become comparable, since after this everything is "the reranker's opinion of
// this text passage" regardless of which collection it came from.
function buildRerankText(c) {
  if (c.sourceKind === 'page') {
    const label = `[Scanned page ${c.page} of ${c.fileName}]`;
    // Poor-OCR pages still get submitted — their identifiers often survive even when
    // prose does not, and excluding them would make handwritten pages unrankable.
    return `${label}\n\n${c.ocrText}`.slice(0, RERANK_TEXT_CHARS);
  }
  const prefix = c.headingPath ? `${c.headingPath}\n\n` : '';
  return `${prefix}${c.text}`.slice(0, RERANK_TEXT_CHARS);
}

// A cross-encoder reads the query and the passage *together* through one transformer, so
// it can judge whether the passage actually answers the question — bi-encoder retrieval
// only measures proximity in a fixed space. This is why reranking runs on 50 candidates
// (§4.2's cost ceiling) rather than the whole corpus: too expensive to be the retrieval
// step, too accurate to skip as the ranking step.
export async function rerank(query, candidates, topN = 8) {
  if (candidates.length === 0) return [];

  const documents = candidates.map(buildRerankText);

  const res = await rerankBreaker.fire({
    model: config.cohere.rerankModel,
    query,
    documents,
    topN: Math.min(topN, documents.length),
    returnDocuments: false,   // we already hold the payloads; index mapping is enough
  });

  return res.results.map((r) => ({
    ...candidates[r.index],
    relevanceScore: r.relevanceScore,   // [0,1], calibrated — this IS a relevance measure
  }));
}

// §4.3: a reranker outage degrades the response rather than failing it. Results still
// come back, just ordered by fusion rank — `relevanceScore: null` rather than a
// fabricated number, because the relevance floor (§5.1) must not run against invented
// values and the advanced console must be able to show that ranking was degraded rather
// than silently presenting worse results as normal.
export async function rerankOrDegrade(query, candidates, topN) {
  try {
    const ranked = await rerank(query, candidates, topN);
    return { ranked, skipped: false };
  } catch (err) {
    console.warn('[rerank] unavailable, falling back to fusion order:', err.message);
    const ranked = candidates.slice(0, topN).map((c) => ({ ...c, relevanceScore: null }));
    return { ranked, skipped: true };
  }
}
