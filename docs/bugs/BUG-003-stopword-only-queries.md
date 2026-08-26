# BUG-003 — A stopword-only query returns arbitrary content, because the reranker scores it near-perfectly

| | |
|---|---|
| **Area** | `backend/src/retrieval/search.js`, `backend/src/retrieval/constants.js` |
| **Severity** | Medium — confident, well-cited answers to input that asked nothing |
| **Found** | 2026-08-18, while verifying [BUG-002](BUG-002-relevance-floor-absolute-threshold.md) |
| **Status** | **Fixed** |

## 1. Symptom

Typing a single function word returns a full result set from an arbitrary document:

```
"the"          -> 8 kept, top=9.113e-01 | Security.pdf
"a"            -> 8 kept, top=9.104e-01 | File Management (1).pdf
"of and the"   -> 8 kept, top=1.697e-01 | Security.pdf
```

Through `/api/ask` this becomes a fluent, cited answer about whichever document happened
to win — the worst failure shape for a RAG system, because it looks authoritative.

Surfaced as regression case 7 (`the` — "stopword-only query does not return arbitrary
content") failing after BUG-002 lowered `RELEVANCE_FLOOR`, dropping the suite from 8/8 to
7/8.

## 2. Root Cause

**Not a threshold problem.** The obvious reading is that BUG-002's lower floor let this
through, and the fix is to raise it back. That reading is wrong:

> `the` scores **0.911** — higher than nearly every genuine question measured in BUG-002,
> and well above the *old* 0.15 floor.

A cross-encoder is asked "how well does this passage match this query." A bare `the`
matches any English prose almost perfectly, because the token occurs in every candidate.
The score is not a mistake — it is the correct answer to a meaningless question. The old
floor only appeared to catch this on the small `cerebro_chunks_test` fixture; against the
live 56-chunk corpus it never would have.

Since no relevance threshold can separate a stopword from a real query, the rejection has
to happen **before retrieval**, on the query itself.

The existing guard was insufficient — `search.js` rejected only input that normalizes away
entirely:

```js
const query = normalize(rawQuery);
if (!query) return emptyResult('empty_query', t);
```

`normalize()` trims and collapses whitespace but does not remove function words, so `the`
survives as a real query.

## 3. Fix

A content-word check at the same guard point. A query is rejected when **every** token is
a closed-class function word:

```js
function hasContentWord(query) {
  const tokens = query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return tokens.some((tok) => !STOPWORDS.has(tok));
}
```

Reported as `empty_query` rather than a new reason code: it is the same class of problem
as an empty string — nothing was actually asked — and it keeps phase 3 §5.2's three-way
empty-state distinction intact rather than adding a fourth case for every consumer to
handle. The message was widened from "Query is empty after normalization." to "Query
contains no searchable terms.", which is accurate for both inputs. Nothing in the frontend
reads `empty.reason` or `empty.message` (the consumer path renders the graph's refusal
string instead), so this is contained to the API surface.

### 3.1 Design constraints on the stopword list

| Constraint | Decision |
|---|---|
| Corpus is multilingual (`embed-multilingual-v3.0`) | The list is **English-only, deliberately**. A query in any other language contains no token from it and is never rejected — the check fails safe rather than silently refusing Hindi or Spanish input. |
| Must not reject real questions | Rejection requires **every** token to be a stopword. `the transaction states` contains `transaction` and `states` and passes untouched. |
| Must not become a maintenance burden | 55 entries, closed-class only — articles, pronouns, prepositions, auxiliaries. No topic words, no attempt at IDF-style tuning. |
| Punctuation-only input | `...` produces zero tokens, so `.some()` is false and it is rejected. Previously it was searched as real query text. |

## 4. Verification

Live, after the fix:

```
"the"                        -> empty_query (Query contains no searchable terms.)
"of and the"                 -> empty_query (Query contains no searchable terms.)
"what is the person's name"  -> 8 results, top=1.775e-03
```

Tokenizer behaviour across scripts and shapes:

| Input | Result |
|---|---|
| `the` | rejected |
| `a` | rejected |
| `of and the` | rejected |
| `...` | rejected |
| `the transaction states` | passes |
| `¿cuál es el nombre?` | passes (no English stopword match — fails safe) |

Regression suite restored to full:

```
[retrieval.regression] recall@3 = 100.0% (8/8, threshold 85%)   PASS
  7 |  OK  | the | Stopword-only query does not return arbitrary content
```
