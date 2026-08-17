# 🧠 Cerebro Engine — Interview Strategy & Expected Questions

> **Rewritten phase 6 (§9, task 6.22).** The previous version of this document described an
> earlier architecture — a local MiniLM embedding model, MongoDB `$vectorSearch` fused with
> hand-rolled Reciprocal Rank Fusion in Node, and a C++ SIMD engine on the live query path
> that crashed on any CPU without AVX2. All of that has since been replaced (Phases 2-6).
> The performance claims below are the ones the *current* code actually produces — every
> number here comes from `npm run bench` (`backend/bench/cppVsQdrant.js`), regenerate them
> yourself before an interview rather than trusting this file blindly; a benchmark number a
> reviewer can disprove by running the repo is worse than no number at all.

---

## Part 1: Convincing the Interviewer This Project Is Insane

### The Core Pitch

Most student/early-career projects are CRUD apps with a different UI. Cerebro is different
because it runs a genuinely production-shaped retrieval stack — hybrid dense+sparse search
fused *server-side* by a real vector database, a second retrieval modality for scanned
documents (ColPali late-interaction over rendered page images, no OCR-text-only fallback),
a stateful conversational graph (LangGraph) instead of a stateless Q&A loop, and it still
keeps a hand-written C++/AVX2 kernel in the tree — not because it's faster in production
(it isn't, past a certain scale), but as a **benchmarked, honestly-framed artifact** that
demonstrates the tradeoff the project chose *not* to make.

---

### Wow Factor #1: "I Retired My Own C++ Engine — And Can Prove Exactly Why"

**What to say:**

> "Early on I wrote a native C++ Node addon — AVX2/FMA SIMD dot products, a min-heap
> top-K, zero-copy `Float32Array` bridging into V8. It's still in the repo. But it's not on
> the serving path anymore — Qdrant is. So I built `bench/cppVsQdrant.js`: four engines,
> same dataset, same query, warmed-up, 11 trials, median reported. It decomposes the old
> single 'X times faster than JS' claim into two independent factors — leaving the JS
> runtime, and using SIMD — by adding a fourth engine, `cpp-scalar`, that runs the exact
> same C++ code with AVX2 forced off. At small corpus sizes my own C++ kernel is genuinely
> faster than Qdrant's HNSW index, because it has zero index-traversal overhead and is
> *exact*, not approximate. Past a certain size, Qdrant wins on latency and still holds
> Recall@10 in the high 90s against my kernel's exact ground truth. I can show you the
> actual crossover on this machine, right now, by running `npm run bench`."

**Why this impresses:**
- Retiring your own work and *proving* it with a benchmark, rather than either keeping
  dead code silently or deleting it and losing the evidence, is a mature engineering
  instinct most candidates don't demonstrate.
- Decomposing a performance claim into orthogonal factors (language vs. SIMD) instead of
  reporting one conflated number is exactly the kind of rigor a senior engineer checks for.
- It's falsifiable in real time — you can hand the interviewer a terminal.

---

### Wow Factor #2: "Retrieval Is Server-Side Fused, Not Client-Assembled"

**What to say:**

> "Dense and sparse search don't get fused in my application code — Qdrant's Query API
> does it server-side with one HTTP round trip: two prefetch branches (dense
> cosine-similarity, sparse BM25 with IDF weighting) and a `fusion: rrf` parameter. That
> replaced a hand-rolled RRF loop I used to run in Node. The harder problem was
> *attribution*: once Qdrant fuses, you lose which branch actually produced a given hit —
> which the advanced console needs to show ('this result came from both branches' is more
> informative than a bare relevance score). So I run two additional lightweight
> prefetch-only queries in parallel with the fused one, at the same limit, and diff the
> id sets. Three round trips instead of one, but they're all sub-30ms ANN lookups against a
> warm collection — negligible next to the ~250ms reranking stage."

**Why this impresses:**
- Shows you understand that "fused" retrieval systems trade away explainability, and that
  recovering it costs something real you can quantify, not assume away.
- The decision to accept 3x read amplification for observability, documented and justified
  rather than silently eaten, is a real production tradeoff.

---

### Wow Factor #3: "Two Genuinely Different Retrieval Modalities, Deduplicated Honestly"

**What to say:**

> "A scanned invoice has no extractable text layer, so pure text-chunk retrieval can't find
> it. I run a second index — ColPali multivectors over rendered page images, late-interaction
> (MAX_SIM) scored — alongside OCR text chunks from the same page. That means the same
> physical page can legitimately be retrieved by both branches. If I just concatenated both
> result lists, the reranker would see duplicate evidence and the UI would show the same
> page twice. `merge.js` keys on (documentId, page) and lets the ColPali hit win — it
> carries the image, which the OCR chunk doesn't, and the chunk's text is already reachable
> through the page's own OCR payload. The 'Absorbed' column in the provenance panel is that
> merge made visible, not hidden."

**Why this impresses:**
- Multimodal RAG (searching *images* of documents, not just extracted text) is genuinely
  ahead of what most RAG tutorials cover.
- The dedup problem is a real architecture consequence most people wouldn't anticipate
  until they hit the duplicate-result bug in production.

---

### Wow Factor #4: "A Conversational Graph, Not a Stateless Q&A Loop"

**What to say:**

> "The RAG pipeline is a LangGraph state machine, not a function that gets called per
> message. Two real branch points: skip query condensation entirely on a first turn (no
> history to condense — save the LLM call), and skip generation entirely when nothing
> clears the relevance floor (a fixed refusal string costs zero tokens and can't be talked
> out of by a persuasive follow-up). Both are named nodes, not `if` statements buried in one
> function — so 'why did this answer come back without any retrieval context' is answerable
> by looking at the LangSmith trace shape, not by reading logs."

**Why this impresses:**
- Shows you think about LLM cost as a first-class design constraint, not an afterthought.
- Modeling control flow as a graph (with observable branch decisions) rather than
  imperative code is the kind of structural decision that pays off in debuggability.

---

### The 60-Second Elevator Pitch

> "Cerebro is a document RAG system with hybrid dense+sparse retrieval fused server-side by
> Qdrant, a second retrieval path for scanned pages using ColPali late-interaction search
> instead of OCR-only fallback, and a LangGraph-driven conversational pipeline that streams
> grounded, cited answers over SSE. I also kept and benchmarked a hand-written C++/AVX2
> vector kernel I built earlier in the project — not because it's on the serving path
> anymore, but because being able to show *exactly* where it wins and loses against a real
> ANN index, with real numbers, is more convincing than either keeping it live or deleting
> the evidence."

---

### The "Depth Ladder" — How to Escalate

| Level | What to Say | When to Use |
|---|---|---|
| **L1: Elevator** | "Hybrid RAG with server-side fusion, a second visual-retrieval path, and a LangGraph conversational pipeline" | First mention |
| **L2: Impact** | "Server-side RRF, ColPali for scanned pages, relevance-floor refusal costs zero generation tokens" | "Tell me more" |
| **L3: Mechanics** | "Two prefetch branches + `fusion: rrf` in one Qdrant Query API call; branch attribution recovered via two membership-only side queries" | "How does the fusion actually work?" |
| **L4: Internals** | "AVX2 FMA fuses multiply-add in one cycle; the benchmark isolates that from the JS-vs-native win by forcing scalar dispatch via an env var read once and cached per process" | Interviewer is clearly technical |
| **L5: Tradeoffs** | "The C++ kernel has no index, no persistence, no filtering — that's *why* it left the serving path, not despite the benchmark showing it winning at small N" | "Why not just keep using the C++ engine?" |

**Rule:** Never volunteer Level 4-5 unprompted. Let the interviewer pull you deeper.

---

## Part 2: Expected Questions & Follow-Ups

### Category 1: The C++ Benchmark

**Q1: "If your C++ engine is faster at small scale, why isn't it in production?"**

**Answer:** Because "faster" was only ever one axis. It's a stateless, in-memory,
brute-force scan with no persistence, no incremental updates, and — critically — no
metadata filtering. The moment `documentIds`-scoped search became a real requirement
(Phase 3), a brute-force kernel would need the *caller* to pre-filter the candidate buffer
on every request, which defeats the point of an index. Qdrant gives me persistence,
filtering, and horizontal scale past what fits in one process's memory, at a quantified
recall cost I can show, not hand-wave.

**Follow-up: "What's the actual crossover point?"**

Run `npm run bench` — it sweeps 1k/10k/100k/1M vectors at 1024 dimensions (the real Cohere
embedding width, not a placeholder) and prints exactly where `qdrant-hnsw` overtakes
`cpp-avx2` on latency, plus Recall@10 at every size. The number depends on the host's CPU
and how warm Qdrant's HNSW graph is — I'd rather hand you the command than a number that
goes stale.

**Q2: "What was wrong with the old benchmark?"**

**Answer:** Two things, both of which made the reported speedup look better than the real
steady-state numbers: it timed the JavaScript loop cold, so V8's JIT warm-up cost landed
inside the measurement (the fix is 20 untimed warm-up iterations before the clock starts);
and it reported a single run instead of a median of several — a single measurement varies
15-25% from scheduler noise alone. The rewritten benchmark also fixed something the old one
never did at all: it never made the JavaScript engine select a Top-K, only timed the raw
dot-product loop, while the C++ engine's `SearchVectors` call always includes Top-K
extraction — comparing a partial job to a complete one. All three engines now do the exact
same work.

**Q3: "Explain the CEREBRO_FORCE_SCALAR env var."**

**Answer:** The addon auto-dispatches to an AVX2 kernel at runtime if the host CPU supports
it (`__builtin_cpu_supports("avx2")`, cached after the first call), or falls back to a
portable scalar loop otherwise — this itself was a fix; the original code was compiled with
`-mavx2 -mfma` globally and would SIGILL on any CPU without those instructions, with no
runtime check at all. To isolate the SIMD win specifically, the benchmark needs to force
that same code down the scalar path even on hardware that *does* support AVX2. The addon
reads `CEREBRO_FORCE_SCALAR` exactly once, at first call, and caches the decision — so
`cpp-scalar` and `cpp-avx2` can't share one Node process; the benchmark runs each in its own
short-lived child process.

---

### Category 2: Hybrid Retrieval & Fusion

**Q4: "Why did you move fusion into Qdrant instead of keeping it in Node?"**

**Answer:** One HTTP round trip computing real Reciprocal Rank Fusion server-side, versus
two separate queries plus a hand-rolled RRF loop in application code. Fewer moving parts,
less latency (no second network round trip), and Qdrant's fusion is exactly the same
algorithm (k=60) I'd have written by hand. The tradeoff — the one interesting cost — is that
server-side fusion discards per-branch membership, which the provenance panel needs back;
that's the two extra membership-only queries in `hybridQuery`.

**Q5: "How do you handle a scanned document with zero extractable text?"**

**Answer:** Classification happens per-PDF-page before parsing even starts — PyMuPDF
metadata, not OCR, so it's fast (~2s for 500 pages). Pages classified as visual go through
the vision service: render → deskew → OCR (for the text-chunk index) → ColPali embed (for
the multivector index). A fully scanned PDF has zero pages in the text path and is still
completely ingestable — "no extractable text" only fails ingestion when *neither* path
produced anything, which is checked against what classification found, not against what the
vision service managed to embed this run, so a vision-service outage degrades a scanned
document's page images to "unindexed, with a warning" rather than failing ingestion
outright.

---

### Category 3: The Conversational Graph

**Q6: "Walk me through what happens from a user's question to a streamed answer."**

**Answer:**
1. `POST /api/ask` validates the request, opens an SSE stream, emits a `threadId` frame
   immediately (before the graph even runs, so a mid-request failure still leaves the
   client with an id to resume).
2. `loadHistory` loads the last 6 messages of the thread (empty on a first turn).
3. Conditional edge: history empty → skip straight to `retrieve`; history present →
   `condense` first, rewriting the follow-up into a standalone question via the LLM.
4. `retrieve` runs the hybrid pipeline: dense (Cohere) + sparse (local BM25) + ColPali
   query embedding concurrently, then two retrieval calls (chunks, pages) concurrently,
   then provenance-dedup merge.
5. `rerank` cross-encodes every candidate with Cohere Rerank v3, applies the relevance
   floor. Conditional edge: nothing survives → `noContext` (a fixed refusal string, zero
   generation tokens); otherwise → `generate`.
6. `generate` streams tokens from Claude (or Ollama) over the same SSE connection, attaches
   up to 3 page images for vision-capable models, records real usage.
7. A `telemetry` frame closes the stream with the full per-stage timing breakdown, a
   LangSmith run id, and `[DONE]`.

**Q7: "Why skip condensation on a first turn instead of always condensing?"**

**Answer:** A first turn has no history to condense against — running the LLM call anyway
would just echo the question back at a real API cost. It's a named conditional edge in the
graph (`routeAfterHistory`), not an `if` buried inside the condense function, specifically
so the decision is visible as a distinct node in the LangSmith trace.

---

### Category 4: Production Hardening

**Q8: "Why does rate limiting need its own Redis connection instead of reusing the one `/health` already has?"**

**Answer:** Found this one live, not by inspection. The shared client is deliberately
built with `enableOfflineQueue: false` so `/health` fails fast instead of blocking on a dead
connection. `rate-limit-redis`'s store calls a Lua-script-loading command synchronously in
its constructor, at module load — before that connection's handshake has necessarily
finished. With offline queueing disabled, that command has nowhere to wait and throws
immediately, crashing the whole process on every single boot. A rate limiter has no reason
to share a fail-fast requirement built for a health probe; it gets its own connection with
the default (queue briefly, then drain) behavior.

**Q9: "How does graceful shutdown handle an in-flight SSE stream?"**

**Answer:** `SIGTERM` stops accepting new connections and frees idle keep-alive sockets
immediately, but polls a small in-process set of active-stream tokens for up to 30 seconds
before closing the BullMQ worker and exiting — long enough for a slow first token and the
rest of a typical answer to finish, short enough to fit under a container orchestrator's own
kill grace period. The worker itself gets `.close()`, not a hard kill, so whatever ingestion
job is mid-flight either finishes or requeues cleanly rather than being killed mid-write.

---

### Category 5: Behavioral / "Why" Questions

**Q10: "What was the hardest bug you found in this project?"**

**Answer:** An SSE stream that silently ended after exactly one frame, every single time,
on Node 22 — no error logged, no crash. Turned out `req.on('close')` (the pattern the SSE
handler used to detect a client disconnect and abort the LLM call) fires as soon as the
*request body* has been fully read by `express.json()`, not when the connection actually
closes — on a modern Node/Express version, that happens almost immediately after the
handler starts. Every request was aborting itself within milliseconds, and the abort path's
own `if (err.name === 'AbortError') return` swallowed it silently, so the failure mode
looked like "the graph just doesn't do anything," not an error. The fix is listening on
`res.on('close')` instead — the response's close event, combined with a
`!res.writableEnded` guard, actually correlates with the connection terminating early.

**Q11: "What would you change or improve next?"**

**Answer:** (Real answers, from `docs/planning/phase_6_polish_production.md`'s own
"Future Considerations" — not aspirational hand-waving)
1. **Agentic multi-hop retrieval** — the graph is already the right shape for a
   `retrieve → assess → re-retrieve` loop, but it changes answer semantics and deserves its
   own evaluation set before shipping.
2. **Answer-quality evaluation** — the retrieval regression suite measures Recall@3; it
   says nothing about whether generated answers are actually correct. A RAGAS-style
   faithfulness/relevance harness is the natural next measurement layer.
3. **GPU inference for ColPali** — cuts visual ingestion from ~6s/page to well under 1s;
   deferred because the reference deployment has no GPU.
4. **Incremental re-ingestion** — a changed document currently reprocesses wholly; diffing
   at page granularity would help large documents with small edits.

---

### Quick-Fire Questions

| Question | Key Point to Hit |
|---|---|
| "Why 1024 dimensions?" | `embed-multilingual-v3.0`'s output width — fixed by the embedding model, not chosen. |
| "What's RRF's k=60?" | From Cormack et al. (2009); controls fusion steepness — higher k weights ranks more evenly, lower k lets rank #1 dominate. |
| "What's the difference between fusionScore and relevanceScore?" | fusionScore (RRF) / maxSimScore (late interaction) are rank artifacts, discarded after reranking — relevanceScore (Cohere Rerank, calibrated [0,1]) is the only cross-modality-comparable signal. |
| "Why does a degraded reranker not trigger an empty state?" | `relevanceScore: null` (not a fabricated number) passes the relevance floor unfiltered — degraded ranking must not also look like "no results." |
| "What's MAX_SIM?" | ColPali's late-interaction scoring — every query patch vector compared against every document patch vector, max per query patch, summed. Qdrant applies it natively for a multivector field. |
| "Why Cohere over a self-hosted embedding model?" | Asymmetric `search_document` / `search_query` input types — the single largest quality difference over a symmetric local model, at the cost of a live API dependency. |
