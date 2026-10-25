# Documentation

Cerebro was built in two spec-driven passes. **v1** built the retrieval engine (ingestion,
hybrid + visual retrieval, LangGraph generation). **v2** — the current version — layered a
multi-user platform on top of it: accounts, per-user tenancy, the React app, and the
observability consoles. Each pass has an architecture document followed by phase documents
that were implemented in order.

| Path | Contents |
|---|---|
| [`planning/v2/architecture.md`](planning/v2/architecture.md) | **Start here.** The v2 platform: topology, data flow, auth, tenancy, observability, budgets, security model |
| [`planning/v2/phase_1..8_*.md`](planning/v2/) | v2 phase specs, from the design system and auth UI through production hardening |
| [`planning/v2/deployment.md`](planning/v2/deployment.md) | Production deploy runbook (automated by [`deploy.sh`](../deploy.sh)) |
| [`planning/v2/measurements.md`](planning/v2/measurements.md) | Measured results against the v2 performance budget |
| [`planning/v2/alerts.yml`](planning/v2/alerts.yml) | Prometheus alert rules |
| [`planning/architecture.md`](planning/architecture.md) | The v1 retrieval engine the platform runs on |
| [`planning/phase_1..6_*.md`](planning/) | v1 phase specs, plus [`requirements.md`](planning/requirements.md), [`tech-stack-summary.md`](planning/tech-stack-summary.md) and the v1 [`deployment.md`](planning/deployment.md) (LLM provider decisions) |
| [`bugs/`](bugs/) | Bug register: defects found after the v1 merge, with evidence and fixes |
| [`manual-testing.md`](manual-testing.md) | Hands-on walkthrough of the core flows against a local stack |
| [`assets/`](assets/) | Screenshots of the v2 screens (auth, chat, contexts, traces, vector space, health) |
| [`archive/`](archive/) | Pre-v2 narrative write-ups; describe a superseded design |

The UI design system lives at the repo root in [`DESIGN.md`](../DESIGN.md); contributor and
agent rules are in [`AGENTS.md`](../AGENTS.md).
