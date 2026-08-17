# 🧠 Cerebro Engine: Frontend Architecture

<div align="center">
  <img src="https://img.shields.io/badge/React-19.0-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" />
  <img src="https://img.shields.io/badge/Vite-6.0-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-v4.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white" alt="Tailwind" />
  <img src="https://img.shields.io/badge/Framer_Motion-12.0-0055FF?style=for-the-badge&logo=framer&logoColor=white" alt="Framer Motion" />
</div>

<br />

> **Rewritten phase 6 (§9, task 6.22).** The previous version of this document described
> Redis cache hit rates and RRF scores read directly off the C++ bridge — neither exists.
> Retrieval telemetry comes from the real pipeline (`backend/src/telemetry/
> pipelineTelemetry.js`) over `/api/search` and `/api/ask`'s SSE `telemetry` event; the C++
> addon has not been on the query path since Phase 3.

This is the client for **Cerebro**, a document RAG (Retrieval-Augmented Generation) system:
hybrid dense+sparse retrieval fused server-side by Qdrant, a second retrieval path for
scanned pages via ColPali, and a LangGraph-driven conversational pipeline that streams
grounded, cited answers over Server-Sent Events.

---

## 🎯 Dual-Tier UI Architecture

Two different audiences, two different views onto the **same** live conversation state
(`EngineContext`, mounted once in `RootLayout` and shared across both routes).

### 1. The Consumer Dashboard (`/`)
*The everyday chat experience.*
- **Centralized input** — an expansive, auto-resizing text area (`react-textarea-autosize`).
- **Streaming answers** — tokens arrive over SSE and append to React state as they land;
  `AnswerBox` renders the growing markdown incrementally.
- **Source chips** — retrieved chunks/pages condense into clickable citations
  (`SourceChip.tsx`, Radix UI `HoverCard`) rather than raw JSON.
- **Ambient ingestion** — dropping a file anywhere (`GlobalDropzone.tsx`) or attaching it in
  the chat input enqueues it through `POST /api/documents` and polls
  `GET /api/documents/:id/status` until it's ready; the toast tracks real progress, not a
  simulated timeout sequence.

### 2. The Advanced Console (`/advanced`)
*A live per-query trace of the same pipeline `/` uses — not a separate search tool.*
- **Execution Plan** (`ExecutionPlan.tsx`) — a real-time waterfall of
  `PipelineTelemetry` (`TelemetryTypes.ts`): condense, embed/sparse/colpali (drawn under a
  shared brace — they run concurrently, not sequentially), chunk/page retrieve, merge,
  rerank, generate, with a first-token marker. A skipped stage (first-turn condense, no
  visual corpus) renders as a hatched bar labeled *skipped*, never a misleading `0ms`.
- **Source Provenance Panel** (`ProvenancePanel.tsx`) — which branch (`dense` / `sparse` /
  `both` / `colpali`) produced each result, and how far reranking moved it (fusion rank →
  final rank) — the reranker's contribution rendered as movement, not just asserted.
- **LangSmith deep link** — every query's `runId` links straight into the full trace.

---

## 🛠️ Tech Stack

| Technology | Purpose |
| :--- | :--- |
| **React 19** | Concurrent rendering for non-blocking UI during heavy SSE streaming. |
| **Vite 6** | Fast dev server and production bundling. |
| **Tailwind CSS v4** | Utility classes, customized via CSS variables for the console's dark/neon theme. |
| **Framer Motion** | Layout and micro-interaction animation. |
| **Radix UI** | Unstyled, accessible primitives (Dialogs, Tooltips, HoverCards, ScrollAreas). |
| **Lucide React** | Iconography. |
| **Recharts** | Charting where it's still real data (see Known Placeholders below). |
| **react-markdown** + **remark-gfm** | Streamed answer rendering. |

---

## 📡 The Network Layer: Custom Data Hooks

Cerebro avoids a global state library in favor of a small number of purpose-built hooks,
composed together in `EngineContext`.

### `useCerebroChat.ts` (the SSE engine)
The one live pipeline both routes read from.
1. `POST /api/ask` with `{ query, threadId?, scopeDocumentIds? }`.
2. Reads the response body as a stream, decodes UTF-8 incrementally, and splits on `\n\n`
   frame boundaries.
3. Switches on each frame's `event` field (`threadId` / `sources` / `token` / `telemetry` /
   `error`) rather than sniffing which fields are present — every frame's shape is explicit.
4. `telemetry` carries the full `PipelineTelemetry` object, the LangSmith `runId`, and org/
   project info for the deep link — read by both `ConsumerDashboard` and `CoreEngine`.
5. An `AbortController`, wired through `stopGenerating()`/superseding queries, cancels the
   fetch — the backend's own `res.on('close')` handler (not `req.on('close')` — see
   `backend/src/api/routes/ask.js`'s comment for why that distinction is load-bearing)
   aborts the LangGraph run so a stopped question doesn't keep burning generation tokens.

### `useThreads.ts` (conversation history)
Plain `GET`/`PATCH`/`DELETE` against `/api/threads` — no separate caching layer; the
sidebar list is small enough to refetch on the actions that change it.

### `EngineContext`'s `ingestFile`
`POST /api/documents`, then polls `GET /api/documents/:id/status` until `ready` or `failed`
— the returned promise resolves once the document is actually searchable, not merely
accepted, so a question asked right after an attachment can be scoped to it
(`scopeDocumentIds`) without a race.

---

## 🎨 Styling

### The Palette
The developer console keeps a deliberately dense, dark terminal aesthetic:
- **Backgrounds**: `#020617` (deep obsidian), `#0A0A0A` (true black).
- **Accent**: `#00FF41` (terminal green) for active/successful data; branch-specific
  colors (blue/orange/purple) distinguish dense/sparse/ColPali provenance at a glance.
- **Typography**: `font-mono`, `tracking-widest` — mechanical, not decorative.

### Custom Scrollbars
```css
.custom-scrollbar::-webkit-scrollbar { width: 8px; }
.custom-scrollbar::-webkit-scrollbar-track { background: #000; }
.custom-scrollbar::-webkit-scrollbar-thumb { background: #333; }
```

---

## ⚠️ Known Placeholders

Not every panel in `/advanced` is wired to real data yet — `HardwareStats.tsx`'s Redis
cache-hit-rate and C++ exec-time charts are illustrative mock series (`recharts` fed static
arrays), inherited from the console's original design and out of this phase's explicit
scope (`docs/planning/phase_6_polish_production.md` §12 lists `ExecutionPlan.tsx`,
`ProvenancePanel.tsx`, `TelemetryTypes.ts`, and `CoreEngine.tsx` as the console files this
phase rewrites — `HardwareStats.tsx` isn't one of them). Treat that one panel as decorative
until it's wired to `/health`'s real queue/collection counts or `/metrics`.

---

## 🚀 Setup & Developer Workflow

### Prerequisites
- Node.js 22+
- Backend running on `localhost:5000` (`cd ../backend && npm run dev`), which itself needs
  the Docker stack up (`docker compose up -d` from the repo root) — see `../AGENTS.md`.

### Installation
```bash
npm install
```

### Development
```bash
npm run dev
```
Vite proxies `/api/*` to `localhost:5000`, so the dev server needs no CORS configuration.

### Production Build
```bash
npm run build
```
Output goes to `dist/` — in production this is bind-mounted into the Caddy container
(`../docker-compose.prod.yml`, `../Caddyfile`), not served by Vite or a Node process of its
own. There is currently no `npm run preview` script; use `docker compose -f
../docker-compose.prod.yml up` to verify the built bundle end-to-end.
