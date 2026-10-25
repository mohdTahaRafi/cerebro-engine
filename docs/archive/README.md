# Archive

Narrative write-ups from before the v2 platform work. They are kept for their
project-history value, but **they describe a superseded design and are not maintained**:
a local MiniLM embedding model, MongoDB `$vectorSearch` + `$text` fused with hand-rolled
RRF, a C++ SIMD kernel on the query path, and a single-tenant app with no accounts.

| File | What it was |
|---|---|
| `project-background.md` | Motivation and tech-stack deep dive for the original "fully offline" engine |
| `project-flow.md` | The original ingest → search → ask user journey and its engineering challenges |
| `interview-strategy.md` | Interview talking points, rewritten in v1 Phase 6 against the benchmark of that time |

For how the system works today, read [`../planning/v2/architecture.md`](../planning/v2/architecture.md)
(platform: auth, tenancy, observability) and [`../planning/architecture.md`](../planning/architecture.md)
(the retrieval engine underneath it).
