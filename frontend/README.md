# Cerebro — Frontend

The React client for Cerebro: sign-in, per-user document contexts, a streaming chat with
cited answers, and the inspector consoles (execution traces, the 3D vector space, system
health). Built in v2 phases 1–4 and 8 — see [`../docs/planning/v2/`](../docs/planning/v2/).
The visual system (tokens, type, motion, component rules) is specified in
[`../DESIGN.md`](../DESIGN.md).

## Stack

| Choice | Used for |
|---|---|
| React 18.3 + React Router 7 | UI and routing (`createBrowserRouter`, lazy routes) |
| Vite 6 | Dev server (proxies `/api` to the backend on :5000) and production build |
| Tailwind CSS 4 | Styling over the CSS-variable tokens in `src/styles/theme.css`; light/dark via `next-themes` |
| Radix UI (shadcn/ui wrappers in `components/ui/`) | Accessible dialogs, menus, selects, tooltips, tabs |
| react-markdown + remark-gfm/math, rehype-katex/highlight | Rendering streamed answers |
| three + @react-three/fiber/drei | The `/admin/vectors` point cloud (lazy-loaded chunk) |
| motion, lucide-react, sonner | Animation, icons, toasts |

## Routes

| Path | Access | Screen |
|---|---|---|
| `/login`, `/signup`, `/forgot-password`, `/reset-password` | public | Local password and Google/GitHub OAuth (buttons shown per `GET /api/auth/capabilities`) |
| `/chat` (`/` redirects here) | signed in | Threads sidebar, context switcher, streaming answers with citations and the provenance ribbon |
| `/contexts`, `/contexts/:id` | signed in | Context list; per-context documents, uploads and ingest progress |
| `/admin/traces`, `/admin/traces/:id` | signed in | Your own execution traces: stage waterfall, rerank matrix, exact prompt payload |
| `/admin/vectors` | signed in | UMAP projection of a context's chunks with the query beacon |
| `/admin/health` | admin (`ADMIN_EMAILS`) | Dependencies, breakers, queue, collections, pipeline errors |

`/advanced` and `/vector` (v1 paths) redirect to their v2 equivalents. Signed-out visits to
a guarded route go to `/login`, carrying `returnTo` for deep links (`lib/returnTo.ts`).

## Layout

```
src/
├── api/
│   ├── client.ts           # request() + SSE streamEvents(); attaches X-CSRF-Token from the cerebro.csrf cookie
│   ├── contracts.ts        # wire types shared by every endpoint module
│   ├── endpoints/          # one module per backend router (auth, contexts, documents, chat, threads, traces, vectors, admin, health)
│   └── index.ts            # `api` — the only import components use
├── app/
│   ├── routes.tsx          # the route table above
│   ├── guards/             # RequireAuth, RequireAdmin
│   ├── context/            # AuthContext, ContextScopeContext (active context), EngineContext (live chat state)
│   ├── hooks/              # data hooks: useCerebroChat (SSE), useContexts, useDocuments, useTraces, useProjection, ...
│   ├── pages/              # one component per route, grouped auth/ contexts/ admin/
│   ├── components/
│   │   ├── core/           # app shell: Sidebar, TopHeader, UserMenu, TelemetryTypes (mirrors backend PipelineTelemetry)
│   │   ├── chat/           # Composer, Transcript, Turn, citations, ProvenanceRibbon
│   │   ├── contexts/  documents/   # context cards/dialogs; document table, upload queue, stage chips
│   │   ├── trace/  vectors/  health/   # the three inspector consoles
│   │   ├── auth/  design/  # auth screens' shell; shared primitives (EmptyState, Unavailable, OtpInput, ...)
│   │   └── ui/             # shadcn/ui wrappers over Radix — only the ones in use
│   └── lib/                # small pure helpers
└── styles/                 # theme.css (tokens), tailwind.css, fonts.css
```

### Streaming chat

`useCerebroChat` posts to `/api/ask` and reads the SSE body frame by frame (`data: …\n\n`,
terminated by `[DONE]`). Each frame carries an explicit `event` — `threadId`, `sources`,
`token`, `telemetry`, `error` — and the `telemetry` frame is the same `PipelineTelemetry`
object `/api/search` returns, typed in `components/core/TelemetryTypes.ts`. Keep both sides
of that contract in sync with `backend/src/telemetry/pipelineTelemetry.js`. Stopping a
generation aborts the fetch, and the backend cancels the LangGraph run.

## Scripts

```bash
npm install
npm run dev         # http://localhost:5173 — needs the backend on :5000 (see ../AGENTS.md)
npm run build       # → dist/, served by Caddy in production (../docker-compose.prod.yml)
npm run typecheck   # tsc --noEmit
npm test            # every test:* script below
```

The tests are standalone Node scripts (no framework; `.ts` files run on Node 22's built-in
type stripping):

| Script | Checks |
|---|---|
| `test:render-inspector` | Server-renders the real Waterfall and RerankMatrix against fixture telemetry |
| `test:contrast`, `test:stage-colors` | Token contrast ratios; the eight stage colors stay distinguishable in both themes |
| `test:stream-safe-markdown` | Partial-markdown handling while an answer is still streaming |
| `test:refusals` | The refusal strings match the backend's |
| `test:waterfall` | Unaccounted-time math with parallel stages |
| `test:decode-projection` | Binary projection payload decoding and color resolution |
