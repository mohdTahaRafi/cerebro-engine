// Standalone verification script (repo convention — see AGENTS.md, no unified test
// framework). BUG-004: selectSources replaces the fixed top-8 source cap with relevance +
// per-document coverage + a character budget. Offline: plain candidate objects, no Qdrant,
// no reranker. Scores below are the real per-document peaks measured on the live corpus
// (docs/bugs/BUG-004-fixed-source-cap.md).
import assert from 'assert';
import { selectSources } from '../../src/retrieval/selectSources.js';
import { RELEVANCE_FLOOR } from '../../src/retrieval/constants.js';

const c = (documentId, relevanceScore, chars = 1300) => ({
  pointId: `${documentId}-${relevanceScore}`, documentId, relevanceScore, sourceKind: 'chunk', text: 'x'.repeat(chars),
});
const docsOf = (sel) => [...new Set(sel.map((s) => s.documentId))].sort();

// ── Overview question: every relevant document is represented ───────────────────────
// "what does this context has?" over 5 resumes: the other four peaked at 6.6e-2..1.1e-1
// of the top — under the 10% retention cut, which is how the old rule dropped three.
{
  const ranked = [c('aryan', 3.26e-3), c('aryan', 2.0e-3), c('om', 3.47e-4), c('raghu', 2.96e-4), c('aman', 2.43e-4), c('jovial', 2.15e-4), c('om', 1.0e-4)]
    .sort((a, b) => b.relevanceScore - a.relevanceScore);
  const sel = selectSources(ranked);
  assert.deepStrictEqual(docsOf(sel), ['aman', 'aryan', 'jovial', 'om', 'raghu'], 'all five resumes must be covered');
  assert.ok(sel.every((s, i) => i === 0 || sel[i - 1].relevanceScore >= s.relevanceScore), 'sources stay in score order');
  console.log('[selectSources.test] PASS — overview question covers all 5 documents (old rule: 2)');
}

// ── Specific question: unrelated documents stay out ─────────────────────────────────
// "how does the anti spammer system detect new spam users?": the other two proposals
// peaked at 5.1e-6 and 7.4e-6 of the top.
{
  const ranked = [c('spam', 1.0), c('spam', 0.6), c('spam', 0.2), c('embedded', 7.35e-6), c('header', 5.13e-6)];
  const sel = selectSources(ranked);
  assert.deepStrictEqual(docsOf(sel), ['spam'], 'unrelated documents must not be pulled in by coverage');
  console.log('[selectSources.test] PASS — specific question stays on the one relevant document');
}

// ── No fixed count: everything within retention survives ───────────────────────────
{
  const ranked = Array.from({ length: 12 }, (_, i) => c('doc', 0.5 - i * 0.01));
  assert.strictEqual(selectSources(ranked).length, 12, 'all 12 retained candidates kept (old rule capped at 8)');
  console.log('[selectSources.test] PASS — 12 relevant passages kept; no cap at 8');
}

// ── Size budget bounds the prompt, coverage first ───────────────────────────────────
{
  const ranked = [c('a', 0.9, 30_000), c('a', 0.85, 30_000), c('b', 0.1, 1_000)];
  const sel = selectSources(ranked, { budgetChars: 40_000 });
  assert.deepStrictEqual(sel.map((s) => s.documentId), ['a', 'b'], 'the second 30k passage is dropped for budget; b still covered');
  console.log('[selectSources.test] PASS — budget enforced, coverage passages take priority');
}

// ── Floor and degraded paths are unchanged in kind ──────────────────────────────────
{
  assert.deepStrictEqual(selectSources([c('a', RELEVANCE_FLOOR / 2)]), [], 'below the floor -> empty');
  const degraded = [c('a', null), c('b', null), c('c', null)];
  assert.strictEqual(selectSources(degraded, { budgetChars: 3_000 }).length, 2, 'degraded rerank: fusion order, bounded by budget');
  assert.deepStrictEqual(selectSources([]), []);
  console.log('[selectSources.test] PASS — relevance floor and degraded-rerank behavior');
}
