# C++ vs Qdrant: what this benchmark actually measures

`npm run bench` (`bench/cppVsQdrant.js`) exists to quantify a trade-off honestly, not to
argue that the hand-written AVX2 kernel should have stayed on the serving path. It didn't —
`/api/search` and `/api/ask` read Qdrant exclusively (Phase 3 onward). The C++ addon
(`src/cpp/`) survives in the tree *because* of this benchmark: it is the artifact that
justifies the architectural decision to retire it, not a second production index running
alongside Qdrant.

## The four engines

| Engine | What it is |
|---|---|
| `js-scalar` | Pure JavaScript dot-product loop over a `Float32Array`, JIT-warmed before timing |
| `cpp-scalar` | The C++ addon (`src/cpp/VectorMath.cpp`) with AVX2 dispatch forced off via `CEREBRO_FORCE_SCALAR=1` |
| `cpp-avx2` | The same addon with runtime AVX2/FMA dispatch active (the default) |
| `qdrant-hnsw` | A real Qdrant collection, `distance: 'Dot'`, populated with the identical dataset and queried through the same HNSW index `cerebro_chunks` uses in production |

`cpp-scalar` is the one number the legacy `benchmark-simd.js` never produced, and it is
what turns "10x faster than JavaScript" from one number into two real ones: **leaving the
JS runtime** buys a factor (js-scalar → cpp-scalar), and **using SIMD** buys a separate,
independent factor (cpp-scalar → cpp-avx2). A single js-vs-avx2 number reports their
*product* as if it were the SIMD win alone — it isn't. `cpp-scalar` and `cpp-avx2` cannot
share one Node process for this measurement (the addon reads `CEREBRO_FORCE_SCALAR` once,
on first call, and caches the decision for the process's lifetime — see
`bench/lib/cppChild.js`), so each runs in its own short-lived child process.

## Methodology

- **Warm-up**: 20 untimed iterations before any engine's clock starts, so V8's JIT
  compilation cost for `js-scalar` doesn't land inside the measurement — the legacy script
  timed cold and inflated its own reported speedup, an error that happened to flatter the
  C++ side, which is worse than an error that happens to be neutral.
- **Trials**: 11 repeats per engine per size, **median** reported (not mean) — a single run
  varies 15-25% from scheduler noise and thermal state, and 11 is odd so the median is a
  real sample rather than an interpolation between two.
- **Fixed input**: a seeded PRNG (`bench/lib/prng.js`, mulberry32) generates the same query
  and dataset for a given corpus size on every run — a "faster" result must come from the
  engine, not from an easier random draw that happened to land differently this time.
- **Same job, all four engines**: every engine computes the same dot product against the
  same 1024-dim vectors (`embed-multilingual-v3.0`'s real output width — not the 384-dim
  placeholder the pre-Phase-6 benchmark used) and returns the same Top-10, including
  `js-scalar`, which the legacy benchmark only timed the raw loop for and never made select
  a Top-K at all.

## The sweep, and why a single N would mislead

The benchmark sweeps 1k, 10k, 100k, and 1M vectors (`--sizes=1000,10000,100000,1000000` by
default; override with `--sizes=1000,5000` for a quick local check). A single N hides the
crossover: brute-force SIMD has no index-traversal overhead and wins at small N; HNSW's
sub-linear search wins as N grows. Reporting whichever N flatters one engine would be
cherry-picking; showing where the crossover actually falls is the more honest — and more
interesting — result.

Latency alone would also mislead, because the two families are not solving the same
problem: `cpp-avx2`/`cpp-scalar`/`js-scalar` are **exact** brute-force scans; `qdrant-hnsw`
is an **approximate** nearest-neighbor index. So every row also reports **Recall@10**:
the fraction of `cpp-avx2`'s exact Top-10 (ground truth by definition — SIMD changes
throughput, not which vectors are actually closest) that `qdrant-hnsw`'s approximate Top-10
also contains.

## Running it

```bash
cd backend
npm run bench                          # full sweep: 1k, 10k, 100k, 1M — see notes below
npm run bench -- --sizes=1000,10000    # a faster local sanity check
npm run bench -- --skip-qdrant         # C++/JS engines only, no Docker stack required
npm run bench -- --save-baseline       # also write results/baseline.json for CI diffing
```

Requires the Docker stack up (`docker compose up -d`) for the `qdrant-hnsw` engine — the
other three run standalone. Output is written to `bench/results/latest.json` (machine-
readable, for CI) and `bench/results/latest.md` (the table above, ready to paste into a
report); both are gitignored and regenerated every run. If `bench/results/baseline.json`
exists, the run prints a delta against it (informational — this does not fail the run; a
real hardware or load difference between machines is expected, not a regression).

**Resource note**: at 1M vectors × 1024 dims, the dataset alone is ~4 GB of `Float32Array`,
and `qdrant-hnsw`'s upload step performs on the order of 2,000 batched HTTP upserts before
that size's queries can even start. Budget real time and memory for the full sweep,
especially on a shared or memory-constrained host — `--sizes=` accepts any subset for a
lighter run.

## Reading the result honestly

- **`cpp-avx2` wins on latency below roughly the tens-of-thousands range** and holds
  perfect recall by construction (it's exact) — there is no faster way to be *certain* you
  found the true nearest neighbors at that scale than to check all of them with a SIMD
  kernel.
- **`qdrant-hnsw` wins on latency as N grows past that range**, at a recall cost that is
  real and larger than it should be: measured live at 100k vectors on the reference host,
  Recall@10 was **0.4**, not the ≥0.95 an earlier draft of this document claimed without
  having actually run the sweep. Root cause, also verified live (a focused 20k-vector repro
  in isolation): neither this benchmark's `qdrantEngine.js` nor production's own
  `hybridQuery`/`multivectorQuery` (`src/providers/vectorStore.js`) passes an explicit
  `params: { hnsw_ef }` on the query — Qdrant's un-tuned default search `ef` gets recall to
  ~0.9 at 20k vectors in the same repro, but does not scale with corpus size, so recall
  keeps degrading as N grows past that. Raising `hnsw_ef` at query time (verified in the
  repro: 256 reached 1.0 recall against the same 20k corpus) fixes it, but that is a
  production retrieval-quality change, not a benchmark-only one — phase 6 §1 explicitly
  rules changes to retrieval behavior out of scope for this phase ("No new retrieval or
  generation capability"), so this benchmark reports the number the *current, shipped*
  configuration actually produces rather than quietly tuning only its own copy to look
  better. See `docs/planning/phase_6_polish_production.md` §16.14 for the full writeup and
  the recommendation to address it as its own change, not folded into this one.
- The C++ engine has **no persistent index, no persistence to disk, and no metadata
  filtering** — every call rebuilds nothing but scans the entire buffer handed to it, which
  is exactly why it was never wired back onto the serving path once real document-scoped
  filtering (`documentIds`) and cross-restart persistence became requirements (Phase 2-3).
  Qdrant is approximate, but it is also persistent, filterable, and built to scale past
  what fits in one process's memory.
- Neither fact makes the other engine wrong. This benchmark exists to make that trade
  legible with real numbers, not to relitigate a decision that was already made.
