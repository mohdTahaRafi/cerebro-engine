# BUG-002 — Answerable questions refused: the relevance floor was set three orders of magnitude too high

| | |
|---|---|
| **Area** | `backend/src/retrieval/constants.js`, `backend/src/retrieval/search.js` |
| **Severity** | High — correctly-ranked results silently discarded |
| **Found** | 2026-08-18, asking `what is the person's name` against a freshly ingested resume |
| **Status** | **Fixed** |

## 1. Symptom

With a resume ingested and visible in the library (`status: ready`, 4 chunks), both of
these return the fixed refusal string `no_relevant_matches` (`graph/prompts.js:26`):

- `what is the person's name`
- `whose resume is this and what is their name`

The `/advanced` execution plan shows retrieval working and the final stage discarding
everything:

```
RETRIEVED 50   AFTER MERGE 50   AFTER FLOOR 0     GENERATE skipped
```

`GENERATE skipped` means the LLM was never called. The refusal was not a model judgment —
it is a hardcoded string emitted because zero chunks survived the floor.

## 2. Root Cause

`RELEVANCE_FLOOR = 0.15` was applied as an absolute cutoff on rerank v3's `relevanceScore`:

```js
const results = ranked.filter((r) => r.relevanceScore === null || r.relevanceScore >= RELEVANCE_FLOOR);
```

Phase 3 §5.1 justified 0.15 as sitting "in the gap between 'wrong but topically adjacent'
(0.2-0.5) and 'unrelated' (<0.05)". **Those bands do not describe what
`rerank-multilingual-v3.0` returns against this corpus.** The real scores for answerable
questions span four orders of magnitude, most of them far below 0.15.

Measured by reranking **all 56 live chunks** against each query — the production candidate
pool is `FUSION_LIMIT = 50` of these, so this is the real operating point:

| Class | Query | top score |
|---|---|---|
| Answerable | `explain what happens when a transaction is rolled back` | 9.93e-1 |
| Answerable | `what is the email address and GPA of the candidate` | 4.33e-3 |
| Answerable | `what is the person's name` | 1.78e-3 |
| Answerable | `whose resume is this and what is their name` | 2.18e-4 |
| Irrelevant | `what were the best films released in 1994` | 1.62e-5 |
| Irrelevant | `how do I bake sourdough bread at home` | 1.43e-5 |
| Irrelevant | `what is the capital of France and its population` | 3.47e-6 |

Two findings:

1. **The threshold was right in kind, wrong in magnitude.** Absolute score separates the
   two classes cleanly — lowest answerable 2.18e-4 against highest irrelevant 1.62e-5, a
   13.5x gap — but the boundary sits near **1e-4**, not 0.15. Three of four answerable
   questions scored 30x–700x under the old floor and were refused.

2. **The ranking was already correct.** In every answerable case the chunk holding the
   answer ranked #1. Retrieval, fusion and reranking all did their jobs; only the
   accept/reject decision was wrong. This was a pure false negative.

The queries that *did* work were the ones that quoted the document's proper nouns —
`Mohd Arham Farooqui education and email` scores 1.0000 — which is why the bug looked like
"the app only answers if you already know what's in the file."

### 2.1 A rejected hypothesis, recorded because it was measured

The first diagnosis was that absolute score is meaningless across queries and the
distribution *shape* should decide instead — a `top/median` separation test. On an
8-chunk fixture this looked decisive (answerable 25x–496x, irrelevant 1.6x–1.8x) and was
implemented with `SEPARATION_MIN = 5.0`.

**It does not hold at the real operating point.** Re-measured over the full 56-chunk
corpus, the classes overlap:

| Query | Class | top/median |
|---|---|---|
| `what is the person's name` | Answerable | 37.61 |
| `what were the best films released in 1994` | Irrelevant | 36.65 |

No ratio threshold separates 37.61 from 36.65. Live verification confirmed it: under
`SEPARATION_MIN = 5.0`, `what is the person's name` still returned `REFUSED … separation=3.95`.
The separation test was reverted. The lesson is recorded here because the fixture that
motivated it was too small to be representative, and a future tuning pass should not
re-derive it.

## 3. Options Considered

| # | Option | Verdict |
|---|---|---|
| A | Lower `RELEVANCE_FLOOR` to the measured boundary | **Chosen.** The measurement shows absolute score is a valid discriminator; only the constant was wrong. Smallest change that addresses the actual cause. |
| B | Replace the floor with a `top/median` separation test | **Rejected on measurement** — see §2.1. Classes overlap on the real corpus. |
| C | Rewrite vague queries in the condense step | **Rejected.** Helps only when history or an attached document exists to resolve against; a fresh thread has nothing. Also does not explain why *specific* queries like `what is the email address and GPA of the candidate` (4.33e-3) were refused. Treats a symptom. |
| D | Delete the floor; let the LLM refuse from context | **Adopted in part.** The LLM is the better judge of whether context answers a question, and `graph/prompts.js` already instructs it to refuse ungrounded. But with no floor every off-corpus question costs a full generate call. Kept as the second half: the floor's remaining job is the cheap noise rejection, retention decides what the LLM sees. |
| E | Bypass the floor for small scoped document sets | **Rejected.** Ad-hoc, and measurement showed the scoped case fails identically (`candidatesConsidered: 4`, `bestScore 1.78e-3`) — scoping changes which candidates compete, not their scores. |

## 4. Fix

Two steps in `search.js`, replacing the single filter:

1. **Accept/reject** — the top score must clear `RELEVANCE_FLOOR`. Below it the reranker
   found nothing above corpus noise; the caller emits `no_relevant_matches` with no
   generate call, preserving the existing fast-refusal behaviour.
2. **Retention** — keep candidates within `RETENTION_FRACTION` of the peak. With the floor
   now near the noise level it would otherwise admit most of the reranked set, handing the
   generator a long weak tail.

### 4.1 Constants

| Constant | Old | New | Justification |
|---|---|---|---|
| `RELEVANCE_FLOOR` | `0.15` | `5e-5` | Geometric midpoint of the measured 13.5x gap (irrelevant ceiling 1.62e-5, answerable floor 2.18e-4) — equidistant on the log scale the scores actually occupy, ~3x above noise, ~4x below the weakest true positive. Midpoint rather than a tighter bound because phase 3 §5.1's cost asymmetry still holds: a marginal chunk is a minor annoyance, a false "I don't know" about a visible document is not. |
| `RETENTION_FRACTION` | — | `0.10` | Keeps candidates within one order of magnitude of the peak: the answer plus its nearest support rather than the whole tail. |

## 5. Regression this fix introduced, and its fix

Lowering the floor broke regression case 7 (`the` — "stopword-only query does not return
arbitrary content"), dropping the suite from 8/8 to 7/8. Investigation showed this is a
distinct defect that the old floor was masking by accident, not a mis-tuned constant:
`the` scores **0.911**, above even the old 0.15 threshold on the live corpus. Tracked and
fixed separately as [BUG-003](BUG-003-stopword-only-queries.md).

## 6. Verification

Live pipeline, `/api/search`, after the fix:

| Query | Class | Result |
|---|---|---|
| `what is the person's name` | Answerable | 8 kept, top 1.775e-3 |
| `whose resume is this and what is their name` | Answerable | 4 kept, top 2.182e-4 |
| `what is the email address and GPA of the candidate` | Answerable | 2 kept, top 4.332e-3 |
| `explain what happens when a transaction is rolled back` | Answerable | 4 kept, top 9.930e-1 |
| `what is the capital of France and its population` | Irrelevant | REFUSED, best 3.474e-6 |
| `how do I bake sourdough bread at home` | Irrelevant | REFUSED, best 1.429e-5 |
| `what were the best films released in 1994` | Irrelevant | REFUSED, best 1.619e-5 |

End to end through `/api/ask` — the two questions that opened this report:

```
=== what is the person's name
SOURCES: ['File Management (1).pdf', 'Mohd_Arham_Farooqui_latest (3) (1).pdf', 'Mohd_Taha_Rafi_Resume.pdf']
ANSWER: The person's name is **Mohd Arham Farooqui**【2】.
afterFloor=8 generateMs=825

=== whose resume is this and what is their name
SOURCES: ['Mohd_Arham_Farooqui_latest (3) (1).pdf', 'Mohd_Taha_Rafi_Resume.pdf']
ANSWER: The résumé belongs to **Mohd Arham Farooqui**【1†L1-L4】【2†L1-L4】.
afterFloor=3 generateMs=940
```

Regression suite (`RETRIEVAL_TEST_PACE_MS=9000`, against `cerebro_chunks_test`):

```
[retrieval.regression] recall@3 = 100.0% (8/8, threshold 85%)   PASS
[floor.test] ALL PASS
[scoping.test] PASS — 0 out-of-scope hits across 20 scoped searches
```

`floor.test.js` gained a BUG-002 regression case — an unquoted but answerable question
(`how much money did the company make last quarter`) must return results — which returns
1 result at top score 0.0156. Under the old floor it returned none.
