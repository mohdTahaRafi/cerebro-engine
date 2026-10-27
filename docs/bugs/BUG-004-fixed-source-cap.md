# BUG-004 — A fixed cap of 8 sources decided answer coverage by count, not by relevance

| | |
|---|---|
| **Area** | `backend/src/graph/nodes/rerank.js`, `backend/src/retrieval/selectSources.js`, `backend/src/retrieval/search.js`, `backend/src/providers/vectorStore.js`, `backend/src/graph/nodes/generate.js`, `backend/src/graph/prompts.js` |
| **Severity** | Medium. Answers to broad questions silently omitted documents the user can see in their context |
| **Found** | 2026-10-28, in production use on cerebrodigital.tech |
| **Status** | **Fixed** |

## 1. Symptom

Asked "what is this context about?" over a context of three GSoC proposals, the answer
described two proposals and said nothing of the third. All three were ingested and
`ready` (15, 23 and 37 chunks).

## 2. Root Cause

The answer path took the reranker's **top 8** candidates (`TOP_N_SOURCES = 8`, phase 5
§6), then applied BUG-002's retention step (keep scores within 10% of the peak). Two
independent problems:

1. **The count was fixed.** When more than eight passages cleared the relevance gate, the
   rest were dropped.
2. **Nothing was document-aware.** For a broad question, rerank scores are flat-ish across
   documents but rarely within 10% of each other, so whole documents fell under the
   retention cut. The model was never told the other documents existed.

Measured on the live corpus (`rerank-multilingual-v3.0`, 2026-10-28). "Ratio" is each
document's best passage relative to the peak:

| Question | Old rule kept | Per-document best / peak |
|---|---|---|
| "what is this context about?" (3 proposals) | 8 of 12 passages that cleared retention | 1.0, 0.25, 0.12 |
| "what does this context has?" (5 resumes) | 2 sources from **2 of 5** documents | 1.0, 0.11, 0.091, 0.075, 0.066 |
| "who is the best guy on codeforces among them?" | 4 sources from 4 of 5 | 1.0, 0.74, 0.17, 0.16, 0.079 |
| "what is Aryan Kadian's codeforces rating?" | 5 sources from 4 of 5 | 1.0, 0.25, 0.16, 0.14, **3.2e-4** |
| "how does the anti spammer system detect new spam users?" | 8 sources from 1 of 3 | 1.0, **7.4e-6**, **5.1e-6** |

Broad questions put every document within two orders of magnitude of the peak. Specific
questions put unrelated documents three or more orders below it.

## 3. Fix

Source selection is now `selectSources(ranked)`. It applies these steps in order:

1. **Accept/reject (unchanged from BUG-002).** The peak must clear `RELEVANCE_FLOOR`.
2. **Coverage.** Each document whose best passage is at least `COVERAGE_FRACTION = 0.01`
   of the peak contributes that passage. 0.01 is ~6.6x below the weakest relevant document
   measured (0.066) and ~31x above the strongest unrelated one (3.2e-4).
3. **Depth.** Every candidate within `RETENTION_FRACTION` (10%) of the peak is kept, as before.
4. **Budget, not count.** Coverage passages go in first (strongest document first), then
   depth passages in score order, until `SOURCE_CHAR_BUDGET = 60,000` characters (~15k
   tokens, about 6x the old 8-chunk context). The first passage is always kept.

Supporting changes:

- **Every candidate is reranked**, not only the top 8. The set stays at or under 100
  (50 fused + 10 pages + 40 coverage), which Cohere bills as one search unit, so the cost
  per question is unchanged.
- **Coverage retrieval.** `vectorStore.coverageQuery` is one grouped Qdrant query
  (`group_by: documentId`, `group_size: 1`, up to `COVERAGE_MAX_DOCS = 40`). It fetches each
  document's best chunk, so a document missing from the fused 50 can still be represented.
  Small contexts already had every document in the fused set; large ones would not.
- **Document inventory.** The generation prompt now carries
  `<documents total="N">…</documents>`: every ready document in scope, up to 100 names, plus
  the count of any not listed. System-prompt rule 6 tells the model to answer questions
  about the collection from that list, and to answer questions about content only from the
  sources.

`/api/search` is unchanged. It still returns a caller-sized `topN` through
`applyRelevanceGate`.

## 4. Verification

- `npm run test:select-sources` reproduces every row of the table above with the measured
  scores: the overview question covers all 5 documents, the specific question stays on 1,
  12 relevant passages survive (the old cap was 8), and the budget and floor paths hold.
- Live `/api/ask` checks are blocked while the deployment's Gemini key is on the free tier
  (20 requests/day).
