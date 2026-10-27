// selectSources — which reranked candidates the generator sees (BUG-004,
// docs/bugs/BUG-004-fixed-source-cap.md). Replaces "top 8, then the retention gate".
//
//   1. Accept/reject (unchanged, BUG-002): the peak must clear RELEVANCE_FLOOR, else [].
//   2. Coverage: each document whose best passage is >= COVERAGE_FRACTION of the peak
//      contributes that passage — so "what is in here?" sees every relevant document.
//   3. Depth: every candidate within RETENTION_FRACTION of the peak (BUG-002's retention).
//   4. Budget: coverage passages first (strongest document first), then depth in score
//      order, until SOURCE_CHAR_BUDGET characters of text. The first candidate is always
//      kept, however long. Size, not a count, is what bounds the prompt.
//
// Returned in descending score order, so source [1] is still the strongest evidence.
import { COVERAGE_FRACTION, RELEVANCE_FLOOR, RETENTION_FRACTION, SOURCE_CHAR_BUDGET } from './constants.js';

const textOf = (c) => (c.sourceKind === 'page' ? c.ocrText : c.text) ?? '';

export function selectSources(ranked, { budgetChars = SOURCE_CHAR_BUDGET } = {}) {
  if (ranked.length === 0) return [];

  // Degraded rerank (every score null, reranker.js's fallback): no scores to gate on, so
  // keep fusion order — but still bounded by the budget, since there is no longer a fixed
  // count to stop at.
  if (ranked[0].relevanceScore === null) return fillBudget(ranked, budgetChars);

  const peak = ranked[0].relevanceScore;   // rerank returns descending order
  if (peak < RELEVANCE_FLOOR) return [];

  const coverage = [];
  const seenDocs = new Set();
  for (const c of ranked) {
    if (seenDocs.has(c.documentId)) continue;
    seenDocs.add(c.documentId);                         // first hit per document is its best
    if (c.relevanceScore >= peak * COVERAGE_FRACTION && c.relevanceScore >= RELEVANCE_FLOOR) coverage.push(c);
  }
  const depth = ranked.filter((c) => c.relevanceScore >= peak * RETENTION_FRACTION);

  const ordered = [...coverage, ...depth.filter((c) => !coverage.includes(c))];
  return fillBudget(ordered, budgetChars).sort((a, b) => b.relevanceScore - a.relevanceScore);
}

function fillBudget(candidates, budgetChars) {
  const out = [];
  let used = 0;
  for (const c of candidates) {
    const len = textOf(c).length;
    if (out.length > 0 && used + len > budgetChars) continue;   // skip, a shorter one may still fit
    out.push(c);
    used += len;
  }
  return out;
}
