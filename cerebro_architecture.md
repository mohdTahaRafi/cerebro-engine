# Cerebro Architecture

This document has moved. The current, maintained architecture reference — vision, runtime
topology, data flow, tech stack, key design decisions, performance budget, and security
model — lives in **[`docs/planning/architecture.md`](docs/planning/architecture.md)**, with
phase-by-phase build history in `docs/planning/phase_1_foundation.md` through
`docs/planning/phase_6_polish_production.md`.

This file previously described an earlier, since-superseded design (a local MiniLM
embedding model, MongoDB `$vectorSearch` and `$text` lexical search fused with hand-rolled
RRF, and a C++ addon on the query serving path). None of that is how the system works
today — see `docs/planning/architecture.md` §5 for the current design decisions and why
each earlier choice was replaced.
