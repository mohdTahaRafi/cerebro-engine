# Bug Register

Working log of defects found in Cerebro after the Phase 6 merge, with the evidence that
identified each one and the change that closed it. One file per bug, numbered in the order
they were found.

Each entry follows the same shape: **Symptom** (what the user sees) → **Root Cause**
(the mechanism, with the measurement that proves it) → **Options Considered** →
**Fix** → **Verification** (the command run and its actual output).

A bug is only marked Fixed when its verification section contains real output from a run,
not an expectation.

| # | Title | Area | Severity | Status |
|---|---|---|---|---|
| [001](BUG-001-vision-embed-pages-envelope.md) | `visualResults.map is not a function` — every scanned PDF fails to ingest | ingestion / vision provider | Critical | **Fixed** |
| [002](BUG-002-relevance-floor-absolute-threshold.md) | Answerable questions rejected with "I could not find anything…" | retrieval / relevance floor | High | **Fixed** |
| [003](BUG-003-stopword-only-queries.md) | A stopword-only query (`the`) returns arbitrary content | retrieval / query validation | Medium | **Fixed** |
| [004](BUG-004-fixed-source-cap.md) | A fixed cap of 8 sources let a broad question see 2 of 3 documents | retrieval / generation context | Medium | **Fixed** |

## Severity scale

| Level | Meaning |
|---|---|
| Critical | A whole document class or feature is unusable; no workaround. |
| High | Correct results are silently discarded; a workaround exists but users won't find it. |
| Medium | Degraded output or misleading UI, core function intact. |
| Low | Cosmetic, or an inaccurate message with no functional impact. |

## Open observations (not yet triaged into bugs)

| Observation | Where | Note |
|---|---|---|
| `GET /favicon.ico` 404 on every page load | `frontend/index.html` | No `<link rel="icon">` and no `public/favicon.ico`. Cosmetic; one console error per load. |
| Consumer footer claims "operates entirely offline. No data leaves your machine." | `ConsumerDashboard.tsx` | Untrue since the pivot — Cohere, LlamaParse, Groq/Anthropic and LangSmith are all live network calls (AGENTS.md "Technical constraints" says so explicitly). Misleading on a consumer-facing screen. |
| `[search] ColPali query embedding failed, text-only: 503` on every query | `retrieval/search.js` | **Not a bug.** `COLPALI_ENABLED=false` makes `/embed_query` refuse in ~9ms by design, and search degrades to text-only. Noise only — the backend has no local flag telling it visual retrieval is off, so it asks every time. |
