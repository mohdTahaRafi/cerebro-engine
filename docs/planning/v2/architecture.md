# Cerebro v2 — Multi-Tenant Platform Architecture & Technical Design

> This document supersedes [../architecture.md](../architecture.md) for all work from this point forward.
> The v1 architecture and its `phase_1..6_*.md` set remain the accurate record of how the
> retrieval engine underneath this platform was built, and are not amended. Everything v1
> describes about ingestion, hybrid retrieval, vision RAG, and the LangGraph generation
> pipeline is still true; this document describes the platform that wraps it.
>
> Source requirements: the v2 PRD (Epics 1–6, US-1.1 … US-6.3).

---

## 1. Vision

Cerebro v2 is a self-serve, multi-tenant Retrieval-Augmented Generation platform whose
distinguishing feature is that **it refuses to be a black box about its own retrieval**. Any
authenticated user creates private workspaces called *contexts*, drops document libraries
into them, and asks grounded questions answered only from those documents — and then, for
the same query, can open the execution trace and watch the request move through query
condensation, dense and sparse retrieval, ColPali page matching, cross-encoder reranking,
and token generation, with every stage's real measured latency, every candidate's rank
before and after reranking, and the exact prompt bytes the model received. The same
embeddings that produced the answer can be viewed as a UMAP-projected 3D point cloud with
the live query vector plotted into it as a beacon among its nearest neighbors.

The non-obvious design commitment is that **the observability surface is built from the
system's own measurements or it is not built at all**. A stage that did not run reports
`null`, never `0`; a trace that was not recorded shows an empty state, never a plausible
number. This is a product decision, not an engineering nicety: the entire value proposition
of an inspector console evaporates the moment a single number in it is invented, because a
reviewer can no longer trust any of the others. The v1 codebase already learned this the
hard way — a fabricated hardware panel and a fabricated reliability console were deleted
rather than annotated — and v2 encodes the lesson as an architectural rule with a
build-level enforcement mechanism (§5.3).

The second commitment is that **tenant isolation is enforced at the storage adapter, not at
the call site**. Every Qdrant query function takes a required tenant argument; there is no
overload that omits it. A future contributor cannot forget to scope a query, because the
function will not compile a call that tries.

---

## 2. High-Level Architecture

```
                          ┌──────────────────────────────────┐
                          │  Browser — React 19 + Vite 6      │
                          │  :5173 dev / Caddy :443 prod      │
                          │                                   │
                          │  /login /signup /forgot-password  │
                          │  /contexts  /chat                 │
                          │  /admin/traces /vectors /health   │
                          │                                   │
                          │  ┌─────────────────────────────┐ │
                          │  │ src/api/  — ONE net boundary│ │
                          │  │ contracts.ts · client.ts    │ │
                          │  │ endpoints/* · mock/ (DEV)   │ │
                          │  └─────────────────────────────┘ │
                          │  ┌─────────────────────────────┐ │
                          │  │ @react-three/fiber WebGL    │ │
                          │  │ instanced point cloud       │ │
                          │  └─────────────────────────────┘ │
                          └───────────┬──────────────────────┘
                                      │ HTTPS · JSON · SSE (text/event-stream)
                                      │ Cookie: cerebro.sid (HttpOnly, SameSite=Lax, Secure)
                                      ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│                              Docker Compose Network                                   │
│                                                                                       │
│  ┌─────────────────────────────────────────────┐        ┌──────────────────────────┐ │
│  │  Node Backend  :5000                         │ HTTP   │  Python Vision Service   │ │
│  │  Express 5                                   │◄──────►│  FastAPI  :8100          │ │
│  │                                              │  JSON  │  PyMuPDF · Tesseract 5   │ │
│  │  ┌────────────────────────────────────────┐ │        │  ColPali v1.3 (torch)    │ │
│  │  │ auth/  passport + express-session      │ │        └──────────────────────────┘ │
│  │  │  ├ google-oauth20   ├ github2          │ │                                     │
│  │  │  ├ local (argon2id) └ otp service      │ │                                     │
│  │  └────────────────────────────────────────┘ │                                     │
│  │  ┌────────────────────────────────────────┐ │                                     │
│  │  │ requireAuth → requireTenant middleware │ │  ← every data route passes through  │
│  │  └────────────────────────────────────────┘ │                                     │
│  │  ┌────────────────────────────────────────┐ │                                     │
│  │  │ LangGraph RAG graph                    │ │                                     │
│  │  │ loadHistory→condense→retrieve→rerank→  │ │                                     │
│  │  │ generate  (+ noContext branch)         │ │                                     │
│  │  └────────────────────────────────────────┘ │                                     │
│  │  ┌────────────────────────────────────────┐ │                                     │
│  │  │ BullMQ ingest workers (concurrency 2)  │ │                                     │
│  │  └───────────────┬────────────────────────┘ │                                     │
│  │  ┌───────────────┴────────────────────────┐ │                                     │
│  │  │ projection worker (umap-js, per ctx)   │ │                                     │
│  │  └────────────────────────────────────────┘ │                                     │
│  └───┬──────────────────────┬──────────────────┘                                     │
│      │                      │                                                        │
│      │ ioredis              │ mongodb://                                             │
│      ▼                      ▼                                                        │
│  ┌────────────────┐   ┌──────────────────────────────────────────────────┐          │
│  │ Redis  :6379   │   │  MongoDB 7  :27017                                │          │
│  │                │   │                                                    │          │
│  │ • BullMQ queue │   │  users        · contexts    · documents            │          │
│  │ • sessions     │   │  conversations· messages    · traces               │          │
│  │   (connect-    │   │  usage_events · projections · pipeline_errors      │          │
│  │    redis)      │   └──────────────────────────────────────────────────┘          │
│  │ • OTP codes    │                                                                  │
│  │   (hashed,TTL) │   ┌──────────────────────────────────────────────────┐          │
│  │ • rate limits  │   │  Qdrant  :6333                                    │          │
│  └────────────────┘   │                                                    │          │
│                       │  cerebro_chunks                                    │          │
│      HTTP :6333       │    dense(1024,Cosine) + sparse(BM25,idf)          │          │
│  ────────────────────►│    payload idx: userId(is_tenant) contextId       │          │
│                       │                 documentId contentHash            │          │
│                       │  cerebro_pages                                     │          │
│                       │    colpali(128, multivector MAX_SIM, int8)        │          │
│                       │    payload idx: userId(is_tenant) contextId       │          │
│                       │                 documentId                        │          │
│                       └──────────────────────────────────────────────────┘          │
│                                                                                       │
│      file:// or s3://  ┌──────────────────────────────────────────────┐              │
│  ─────────────────────►│  Object Store                                 │              │
│                        │  dev: ./storage/{uploads,pages}/               │              │
│                        │  prod: MinIO :9000 (S3 API)                    │              │
│                        └──────────────────────────────────────────────┘              │
└───────────────────────────────────┬───────────────────────────────────────────────────┘
                                    │ HTTPS (external)
     ┌──────────────────────────────┼──────────────────────────────────────┐
     │            │           │     │      │           │          │        │
     ▼            ▼           ▼     ▼      ▼           ▼          ▼        ▼
  Google      GitHub      Cohere  Llama  Anthropic  LangSmith  SMTP /   Twilio
  OAuth 2.0   OAuth 2.0   embed+  Parse  claude-    traces     Resend   SMS
  (OIDC)                  rerank         sonnet-5              email    (optional)
```

**What each arrow carries.** Browser→Backend is JSON over HTTPS for everything except
`POST /api/ask`, which is `text/event-stream`. Every browser request carries the
`cerebro.sid` session cookie; there is no `Authorization` header anywhere in the browser,
because there is no token in the browser to put in one (§5.2). Backend→Qdrant is REST, not
gRPC — `@qdrant/js-client-rest` has no gRPC option (v1 architecture §5.11). Backend→Vision
is plain JSON with base64 image payloads. Backend→Redis carries three unrelated workloads on
one connection pool: the BullMQ queue, the session store, and OTP/rate-limit keys, namespaced
by key prefix (`bull:`, `sess:`, `otp:`, `rl:`).

---

## 3. Data Flow Summary

The single end-to-end walkthrough below is a **new user's first session**: sign up, create a
context, ingest a document, ask a question, and inspect the trace. It touches every
subsystem this platform adds.

1. **Browser** loads `/`, which is behind `<RequireAuth>`. `AuthContext` issues
   `GET /api/auth/session`; no cookie is present, so the backend answers `200 {user: null}`
   (never `401` — an unauthenticated *session probe* is a normal answer, not an error, and
   returning 401 here would make the console noisy on every cold load). The router redirects
   to `/login`.
2. **User** enters email + password on `/signup`. Browser `POST /api/auth/signup`
   `{email, password, name}`. Express validates: email parses, password ≥ 12 chars and not in
   the top-10k breached list (§7). `argon2.hash(password, ARGON2_OPTS)` produces the hash;
   a `users` row is inserted with `emailVerified: false`, `role: 'user'` (or `'admin'` if the
   address is in `ADMIN_EMAILS`).
3. **Express** calls `req.session.regenerate()` — a fresh session id, defeating fixation —
   writes `req.session.userId`, and `connect-redis` persists it at `sess:<sid>` with a 7-day
   TTL. The `Set-Cookie: cerebro.sid=…; HttpOnly; SameSite=Lax; Secure; Path=/` response
   header is the only place the session id ever appears.
4. **Browser** re-runs `GET /api/auth/session`, now receiving
   `{user: {id, email, name, avatarUrl, role, emailVerified}}`. `AuthContext` populates and
   `<RequireAuth>` releases the route. The user lands on `/contexts`.
5. **User** clicks *New context*, names it `Q3 Reports`. Browser
   `POST /api/contexts {title, description}`. `requireAuth` has already put `req.user` on the
   request; the handler inserts a `contexts` row with `userId: req.user._id`. **The client
   never sends a `userId` and the server never reads one from the body** — a client-supplied
   tenant id is the entire multi-tenancy bug class in one field (§5.1).
6. **User** drops `q3-earnings.pdf` onto the context's dropzone. Browser
   `POST /api/contexts/:contextId/documents` (multipart). Multer enforces the 50 MB cap and
   MIME allowlist before any byte is parsed. `verifyType()` confirms the magic bytes match
   the extension. SHA-256 of the bytes is computed; the duplicate check is
   `{contentHash, userId, contextId, status: 'ready'}` — **scoped**, because the same file
   uploaded by two different tenants is two independent documents, not a duplicate (§5.5).
7. **Express** enqueues BullMQ `ingest:document` with `{documentId}` only, then inserts the
   `documents` row with `status: 'queued'`, `stage: 'queued'`, `userId`, `contextId`. Enqueue
   precedes the row insert so a Redis outage cannot leave an orphan `queued` row no worker
   will pick up (v1 architecture §6.2). Response `202 {documentId, status: 'queued'}`.
8. **Browser** opens `GET /api/documents/:id/status` on a 1.5s poll and renders the stage
   chip: `Queued → Parsing → Chunking → Embedding → Ready`.
9. **Ingest worker** dequeues, loads the row, sets `status: 'processing'`, `stage: 'parsing'`.
   It calls the vision service `POST /classify` for a per-page text/visual verdict, then
   LlamaParse for text pages. `stage: 'chunking'` → the markdown-header + recursive splitter
   produces ≤480-token chunks. `stage: 'embedding'` → Cohere `embed-multilingual-v3.0` with
   `input_type: 'search_document'` plus the local BM25 sparse encoder.
10. **Worker** upserts to `cerebro_chunks`. Every point's payload now carries
    `{userId, contextId, documentId, contentHash, text, page, headingPath, position, fileName}`.
    `upsertChunks()` **requires** `userId` and `contextId` as arguments and throws if either
    is missing — the failure is loud at ingest time rather than silent at query time (§5.1).
    Visual pages take the same path into `cerebro_pages` with ColPali multivectors.
11. **Worker** sets `status: 'ready'`, `stage: 'ready'`, records `chunkCount`/`pageCount`,
    writes a `usage_events` row, and enqueues `projection:rebuild` for this context — the
    UMAP fit is now stale (§5.7). On any failure it deletes this document's points by filter
    across both collections, writes `status: 'failed'` with the classified error, and inserts
    a `pipeline_errors` row that `/admin/health`'s error stream reads.
12. **User** switches to `/chat`, selects `Q3 Reports` in the context switcher, and asks
    *"what was EMEA revenue in Q3?"*. Browser `POST /api/ask {query, contextId, threadId?}`
    with `Accept: text/event-stream`.
13. **Express** runs `requireAuth`, then verifies `contextId` belongs to `req.user`
    (`404`, not `403`, if it does not — a `403` confirms the context exists, which is a
    cross-tenant existence oracle). It opens the SSE response, emits `threadId` immediately,
    and invokes the graph with `{query, tenant: {userId, contextId}, threadId}`.
14. **Graph** runs `loadHistory` → `condense` (every turn since 2026-10-15; v1 architecture §5.6) → `retrieve`. `retrieve`
    calls `vectorStore.hybridQuery({tenant, denseVector, sparseVector, limit})`. Inside, the
    tenant becomes a Qdrant filter `must: [{key:'userId',match:{value}}, {key:'contextId',match:{value}}]`
    applied **inside each prefetch branch and again at the top level** — branch-level filtering
    is what stops a branch from spending its 50 candidate slots on out-of-scope points that
    fusion then discards.
15. **Graph** runs `rerank` (Cohere cross-encoder over chunks + page OCR text together), then
    the relevance gate. `generate` assembles the multimodal prompt, streams `sources` first,
    then `token` frames.
16. **Route** computes `totalMs` from its own request-entry timestamp, builds the
    `PipelineTelemetry` object (per-stage duration **and** start offset from one common
    origin), and emits the `telemetry` frame, then `[DONE]`.
17. **`persistTurn`** writes the user and assistant `messages` rows **and** a `traces` row
    holding the telemetry, the pre/post-rerank candidate ranks, the assembled system and user
    prompt, and the token counts. This is the single new write that makes `/admin/traces`
    possible: v1 discarded all of it the moment the stream closed.
18. **Browser** renders the answer with citation accordions in the evidence margin and a
    **provenance ribbon** — the waterfall compressed to a single proportional strip — under
    the answer. Clicking it navigates to `/admin/traces/:traceId`.
19. **`/admin/traces/:id`** issues `GET /api/traces/:id`, which is tenant-scoped by
    `requireAuth` + an ownership check. It renders the full waterfall (`ExecutionPlan`), the
    rerank delta matrix (`ProvenancePanel`), and the raw payload drawer — system prompt,
    assembled user message with the injected `<source>` blocks, and token counts.
20. **User** opens `/admin/vectors`, selects `Q3 Reports`. Browser
    `GET /api/vectors/projection?contextId=…`. The projection worker fit a UMAP model in
    step 11 and cached both the 3D coordinates and the **fitted model parameters** in the
    `projections` collection. The response streams ~5k `{pointId, x, y, z, documentId, page}`
    tuples as a packed `Float32Array` payload, not JSON objects (§5.8).
21. **User** types a test query into the beacon box. Browser
    `POST /api/vectors/project-query {contextId, query}`. The backend embeds the query with
    `input_type: 'search_query'` and runs it through the **same fitted** UMAP transform —
    re-fitting would place the beacon in a different coordinate space than the cloud it is
    being plotted into, which would look plausible and be meaningless (§5.8). It returns the
    beacon coordinate plus the ids and distances of its top-k neighbors and the reranked
    order, which the R3F scene draws as `--signal` links fading by rank — the beacon itself
    is the one `--signal`-filled point in the cloud (every other point is colored per its
    source document, per the legend); kept-vs-cut is a ring vs. no-ring shape difference,
    never a second color, per DESIGN.md §5.20.
22. **Admin** opens `/admin/health` (gated on `role === 'admin'`). It polls `/api/health` for
    dependency latency, breaker state, and queue depth, and `/api/admin/queue` and
    `/api/admin/errors` for throughput, worker concurrency, and the classified error feed
    written in step 11.

---

## 4. Tech Stack

| Layer | Choice | Justification |
|---|---|---|
| Frontend runtime | **React 19.2+**, **Vite 6.3.5** | Already in place. React 19's `use` and improved Suspense simplify the auth-session gate; Vite's `import.meta.env.DEV` is what tree-shakes the mock adapter out of production bundles (§5.3). |
| Routing | **react-router 7.13** (data router) | Already in place. Its `Component`/loader model gives route-level auth gating without a wrapper component per route. |
| Styling | **Tailwind CSS 4.1.12** with `@theme` tokens | Already in place. v4's CSS-variable-native theming is what makes a light/dark toggle a token swap rather than a class-name fork; `@custom-variant dark (&:is(.dark *))` is already declared in `theme.css`. |
| Theme control | **next-themes 0.4.6** | Already a dependency. Handles the system-preference third state and the first-paint flash without a custom `<script>` blocker. |
| Component primitives | **Radix UI** + local shadcn-style wrappers | Already in place — 40+ primitives. Accessible by construction (focus trap, roving tabindex, `aria-*`), which is the expensive part of a dialog/accordion/select to get right. |
| 3D rendering | **three 0.180+**, **@react-three/fiber 9+**, **@react-three/drei 10+** | The PRD names R3F. A single instanced `<Points>` draw call holds 60 fps at 50k nodes; the current hand-rolled 2D canvas projection repaints every point every frame on the main thread and cannot. |
| Markdown | **react-markdown 10** + **remark-gfm 4** + **remark-math** + **rehype-katex** + **rehype-highlight** | KaTeX and highlight.js are both **synchronous** — critical, because the answer re-renders on every streamed token and an async highlighter (Shiki) would either flash unstyled code or drop frames. |
| Backend runtime | **Node.js 22+**, **Express 5.2** | Already in place. Express 5's native async error propagation is what lets every route handler be a bare `async` function without a wrapper. |
| Auth — federated | **passport 0.7+**, **passport-google-oauth20 2.x**, **passport-github2 0.1.x** | Google is OIDC, GitHub is bare OAuth 2.0 with a proprietary userinfo call. One Passport strategy each normalizes both into the same profile shape; a pure OIDC client library cannot talk to GitHub at all. |
| Auth — local | **argon2 0.41+** (argon2id, m=19456 KiB, t=2, p=1) | argon2id is the current OWASP recommendation over bcrypt: memory-hard, so a GPU/ASIC attacker gains far less. The listed parameters are OWASP's minimum configuration. |
| Sessions | **express-session 1.18+** + **connect-redis 8+** | Server-side sessions give *real* revocation — logout and "sign out everywhere" delete a Redis key and the credential is dead instantly. A stateless JWT cannot be revoked before expiry without a server-side denylist, which is a session store with extra steps. Redis already runs for BullMQ. |
| OTP delivery | **nodemailer 7+** (SMTP/Resend) primary; **twilio 5+** SMS optional | Email costs nothing per message and needs no carrier registration. SMS is behind `TWILIO_*` config and the phone option is **absent from the UI** when unconfigured, never a button that fails. |
| Dimensionality reduction | **umap-js 1.4+** | Preserves local neighborhood structure, which is precisely the question "is my chunking producing coherent clusters" asks. PCA preserves global variance and would smear exactly the local structure being inspected. Runs on the backend because it is O(n log n) over 1024-dim float arrays. |
| Vector store | **Qdrant 1.12.4** (pinned) | Already in place. Native multi-tenancy via `is_tenant: true` payload indexes, server-side RRF fusion, and multivector MAX_SIM in one engine. |
| Document store | **MongoDB 7** + **Mongoose 9** | Already in place. Trace payloads are deeply nested, variably shaped documents (per-stage timings, per-candidate ranks, prompt blocks) — a document store is the honest fit; modeling them relationally would be six join tables for one read. |
| Queue | **BullMQ 6** on Redis | Already in place. Adds the `projection:rebuild` job class in Phase 7. |
| Metrics | **prom-client 15** | Already in place. Gains per-tenant labels in Phase 8. |

---

## 5. Why NOT These Alternatives

| Rejected | Reason |
|---|---|
| **JWT in `localStorage`** for sessions | Any XSS anywhere in a React app with 40 dependencies exfiltrates the token, and the token is valid until expiry with no server-side kill switch. An `HttpOnly` cookie is unreadable from JavaScript by construction, and a Redis-backed session is revocable in one `DEL`. |
| **Collection-per-tenant in Qdrant** | Each collection carries its own HNSW graph and segment set; memory overhead is per-collection, not per-vector. Qdrant's own guidance caps this pattern at low hundreds of collections. One collection with an `is_tenant: true` payload index on `userId` lets the engine group tenant points into contiguous segments, which is *faster* than the naive filtered search, not merely more compact. |
| **Auth0 / Clerk / Supabase Auth** | Correct for a product on a deadline, wrong for this one. The PRD's Epic 1 is a requirement to *build* tenant-isolated auth; outsourcing it removes the substance and adds a hard external dependency to the login path, which is the one path that must work when everything else is down. |
| **Row-level scoping enforced in route handlers** | This is the standard approach and it is how multi-tenant leaks happen: it is correct only as long as every present and future handler remembers. Pushing the filter into `vectorStore.js` — where the query is actually constructed and the tenant argument is required — makes the safe path the only path. |
| **Computing UMAP in the browser (`umap-js` client-side)** | 5,000 × 1024 floats is a 20 MB transfer before any projection runs, and the fit is 3–15 s of blocked main thread. Worse, each client would fit its *own* model, so two users looking at the same context would see two different-looking clouds and the query beacon could never be projected into a shared space. |
| **PCA instead of UMAP** | PCA is linear and preserves global variance. Embedding neighborhoods are non-linear manifolds; a PCA-3 projection of 1024-dim Cohere vectors typically explains under 15% of variance and collapses distinct topics onto each other. The console exists to answer "are my clusters clean" — PCA answers a different question badly. |
| **`three.js` `Points` with one mesh per node** | 5,000 meshes is 5,000 draw calls and ~8 fps. A single `InstancedBufferGeometry` with per-instance color and position attributes is one draw call. The PRD asks for a "high-performance" cloud; this is the difference. |
| **Shiki for syntax highlighting** | Shiki produces better output but initializes asynchronously and highlights asynchronously. The answer component re-renders on every SSE token; an async highlighter either renders unstyled code that pops later or serializes highlighting behind token arrival. `rehype-highlight` is synchronous and correct under streaming. |
| **Server-Sent Events replaced by WebSockets** | The stream is strictly server→client, one message type family, and must survive Caddy and corporate proxies. SSE is plain HTTP with automatic reconnect semantics; a WebSocket adds a protocol upgrade, a heartbeat protocol of its own, and no capability this pipeline uses. |
| **Storing OTP codes in MongoDB** | An OTP has a 10-minute lifetime and needs an atomic attempt counter. Redis gives TTL expiry and `INCR` natively; Mongo would need a TTL index (60-second sweep granularity, so codes outlive their stated lifetime) plus a `findOneAndUpdate` for every attempt. |

---

## 6. Project Directory Structure

Only files v2 **adds or materially rewrites** are shown with comments. Files carried over from
v1 unchanged are elided as `…` to keep the contract readable.

```
cerebro/
├── backend/
│   ├── src/
│   │   ├── api/
│   │   │   ├── index.js                       # [rewrite] session middleware, passport init,
│   │   │   │                                  #   auth+context routers, per-user rate limiting
│   │   │   ├── middleware/
│   │   │   │   ├── requireAuth.js             # NEW — 401 if no req.session.userId; loads req.user
│   │   │   │   ├── requireAdmin.js            # NEW — 403 unless req.user.role === 'admin'
│   │   │   │   ├── requireContext.js          # NEW — resolves :contextId, 404 if not owned
│   │   │   │   ├── rateLimit.js               # [extend] key by userId when authenticated, IP otherwise
│   │   │   │   └── upload.js                  # unchanged
│   │   │   └── routes/
│   │   │       ├── auth.js                    # NEW — OAuth start/callback, signup, login, logout, session
│   │   │       ├── password.js                # NEW — forgot / verify-otp / reset / resend
│   │   │       ├── contexts.js                # NEW — context CRUD + cascade delete
│   │   │       ├── traces.js                  # NEW — GET /api/traces, GET /api/traces/:id
│   │   │       ├── vectors.js                 # NEW — projection, project-query
│   │   │       ├── admin.js                   # NEW — /api/admin/queue, /api/admin/errors
│   │   │       ├── documents.js               # [extend] nested under a context; tenant-scoped
│   │   │       ├── ask.js                     # [extend] contextId required; writes a Trace
│   │   │       ├── threads.js                 # [extend] tenant-scoped list/read/delete
│   │   │       ├── search.js                  # [extend] tenant-scoped
│   │   │       └── health.js                  # unchanged
│   │   ├── auth/
│   │   │   ├── passport.js                    # NEW — strategy registration, serialize/deserialize
│   │   │   ├── strategies/
│   │   │   │   ├── google.js                  # NEW — passport-google-oauth20 + profile normalization
│   │   │   │   ├── github.js                  # NEW — passport-github2 + primary-email fetch
│   │   │   │   └── local.js                   # NEW — email+password, argon2id verify, timing-safe
│   │   │   ├── password.js                    # NEW — argon2id hash/verify, strength policy
│   │   │   ├── otp.js                         # NEW — generate/store/verify, Redis TTL + attempt counter
│   │   │   ├── linking.js                     # NEW — verified-email identity linking rules
│   │   │   └── session.js                     # NEW — express-session + connect-redis config
│   │   ├── notify/
│   │   │   ├── email.js                       # NEW — nodemailer transport + OTP template
│   │   │   ├── sms.js                         # NEW — twilio, no-op + `configured:false` when unset
│   │   │   └── templates/otpEmail.js          # NEW — plain-text + HTML OTP body
│   │   ├── models/
│   │   │   ├── User.js                        # NEW — identities[], passwordHash, role, verification
│   │   │   ├── Context.js                     # NEW — title, description, userId, counters
│   │   │   ├── Trace.js                       # NEW — telemetry + candidates + prompt + tokens, TTL
│   │   │   ├── Projection.js                  # NEW — cached UMAP coords + fitted model params
│   │   │   ├── PipelineError.js               # NEW — classified failures for the error stream
│   │   │   ├── Document.js                    # [extend] userId, contextId, stage
│   │   │   ├── Conversation.js                # [extend] userId, contextId
│   │   │   └── Message.js                     # [extend] userId, traceId
│   │   ├── providers/
│   │   │   └── vectorStore.js                 # [rewrite] tenant argument REQUIRED on every query/upsert
│   │   ├── projection/
│   │   │   ├── fit.js                         # NEW — umap-js fit over a context's dense vectors
│   │   │   ├── transform.js                   # NEW — project one new vector into a fitted space
│   │   │   └── worker.js                      # NEW — BullMQ 'projection:rebuild' consumer
│   │   ├── conversation/persistTurn.js        # [extend] also writes the Trace row
│   │   ├── graph/nodes/generate.js            # [extend] returns the assembled prompt for capture
│   │   └── telemetry/traceCapture.js          # NEW — assembles a Trace document from graph state
│   ├── scripts/
│   │   ├── migrate-to-tenancy.js              # NEW — backfill userId/contextId; dry-run by default
│   │   └── setup-qdrant.js                    # [extend] tenant payload indexes
│   └── test/
│       ├── auth/{otp,password,linking,session}.test.js   # NEW
│       ├── tenancy/{isolation,filterInjection}.test.js   # NEW — the security tests
│       └── projection/{fit,transform}.test.js            # NEW
│
├── frontend/
│   └── src/
│       ├── api/                               # NEW — the ONE network boundary
│       │   ├── contracts.ts                   #   every request/response type for the v2 surface
│       │   ├── client.ts                      #   request(), error normalization, SSE reader
│       │   ├── endpoints/
│       │   │   ├── auth.ts  contexts.ts  documents.ts
│       │   │   ├── chat.ts  threads.ts   traces.ts
│       │   │   └── vectors.ts  admin.ts  health.ts
│       │   └── mock/                          #   DEV-ONLY fixture adapter, tree-shaken in prod
│       │       ├── index.ts                   #   gated: import.meta.env.DEV && VITE_API_MOCK
│       │       └── fixtures/*.ts
│       ├── app/
│       │   ├── routes.tsx                     # [rewrite] the v2 route table + redirects
│       │   ├── context/
│       │   │   ├── AuthContext.tsx            # NEW — session, signIn/signOut, role
│       │   │   ├── ContextScopeContext.tsx    # NEW — the active knowledge context
│       │   │   └── EngineContext.tsx          # [rewrite] on top of src/api
│       │   ├── guards/{RequireAuth,RequireAdmin}.tsx      # NEW
│       │   ├── pages/
│       │   │   ├── auth/{Login,Signup,ForgotPassword,ResetPassword}.tsx   # NEW
│       │   │   ├── contexts/{ContextList,ContextDetail}.tsx               # NEW
│       │   │   ├── Chat.tsx                   # [rewrite] from ConsumerDashboard
│       │   │   └── admin/{TraceList,TraceDetail,VectorSpace,Health}.tsx   # NEW
│       │   ├── components/
│       │   │   ├── design/                    # NEW — the shared primitives of the new language
│       │   │   │   ├── ThemeToggle.tsx  StatDial.tsx  Ribbon.tsx
│       │   │   │   └── EmptyState.tsx  MockBadge.tsx  Unavailable.tsx
│       │   │   ├── chat/{Transcript,Turn,CitationAccordion,ContextSwitcher}.tsx  # NEW
│       │   │   ├── documents/{DocumentTable,UploadZone,StageChip}.tsx            # NEW
│       │   │   ├── trace/{Waterfall,RerankMatrix,PayloadDrawer}.tsx  # from ExecutionPlan/ProvenancePanel
│       │   │   └── vectors/{PointCloud,QueryBeacon,NodeInspector}.tsx            # NEW (replaces vector/)
│       │   └── hooks/{useSession,useContexts,useDocuments,useTraces,useProjection}.ts  # NEW
│       └── styles/
│           ├── theme.css                      # [rewrite] the v2 palette, light + dark
│           └── fonts.css                      # [rewrite] Inter, weights 400/500/600/700
│
└── docs/planning/v2/                          # this document set
```

---

## 7. Key Design Decisions

### 7.1 The Tenant Filter Lives in the Storage Adapter, Not the Call Site

Every exported query function in `vectorStore.js` takes a `tenant` object as a **required
first argument** and throws a `TypeError` if `tenant.userId` is absent. `hybridQuery`,
`multivectorQuery`, `countPoints`, `deleteByDocument`, `deletePagesByDocument`,
`upsertChunks`, and `upsertPages` all change shape in Phase 6.

The consequence is that a new route which forgets to scope its retrieval does not silently
return another tenant's data — it crashes on the first request in development. The category
of complexity this eliminates is *audit surface*: without it, proving isolation means reading
every call site forever, and re-proving it after every future change. With it, isolation is a
property of one file with two tests against it.

The cost accepted: seven call-site signatures change at once, and the v1
`test/retrieval/*.test.js` suite has to be updated in the same commit. That is a deliberate
one-time cost paid to make the property structural.

### 7.2 The Session Cookie Is the Only Credential the Browser Holds

There is no access token, no refresh token, and no `Authorization` header in the frontend.
`fetch` is called with `credentials: 'include'` and the browser attaches `cerebro.sid`
automatically. `GET /api/auth/session` is the only way the frontend learns who it is.

This eliminates the entire token-storage decision tree (localStorage vs. memory vs. cookie),
the refresh-rotation state machine, and the XSS-exfiltration class. It accepts one real cost:
CSRF becomes possible, because the browser attaches the cookie to cross-site requests too.
That is mitigated by `SameSite=Lax` (which alone blocks cross-site `POST`) plus an explicit
double-submit CSRF token on state-changing routes (Phase 8, §9).

### 7.3 An Unimplemented Endpoint Renders an Empty State, Never a Number

Frontend phases land before their backends. The mechanism that keeps this from producing
fabricated UI has three parts:

1. **One boundary.** Every network call goes through `src/api/`. There is no `fetch` in a
   component.
2. **The mock adapter is dev-only and gated.** `src/api/mock/index.ts` is imported behind
   `import.meta.env.DEV && import.meta.env.VITE_API_MOCK === '1'`. Vite's constant folding
   eliminates the entire branch — and the fixture modules it imports — from a production
   build. A production bundle grep for a fixture string is a build-time acceptance criterion.
3. **A component renders one of three states, never a fourth.** `data` (real), `empty`
   (the endpoint answered, with nothing), or `unavailable` (the endpoint does not exist yet
   or failed). `<Unavailable>` states what is missing in plain words — *"Projection not
   available for this context."* — and never a placeholder chart. When mocks are on, a
   `<MockBadge>` is visible in the panel corner.

This is the direct lesson of v1 commit `5ad604d`, which deleted two whole consoles rather
than keep documented placeholders.

### 7.4 Evidence Is Marked by Position and Container, Not by a Second Hue

**Amended 2026-08-19.** The original design carried two accent hues with disjoint jobs —
`signal` blue for *you can interact with this*, `evidence` amber for *the system actually
retrieved this* — so that a user learned, without being told, which color meant proof. That
scheme is retired in favor of the single-accent Cerebro palette (`cerebro-500` `#004FFE` as the only
interactive hue; emerald/amber/red reserved strictly for success/warning/error state, per
`phase_1` §2.1) shown in the reference screenshots. DESIGN.md §1.1's underlying requirement —
*"retrieved things are visually distinct from interactive things, and that distinction is
never muddied"* — still holds; it is now satisfied without a color budget, by three things
used together everywhere evidence appears:

1. **Position.** Evidence lives *only* in the evidence margin (§3.2's three-column grammar).
   Nothing rendered in the primary column is ever "the retrieved thing itself" — the primary
   column shows the model's answer, which *references* evidence, never the evidence directly.
2. **Container treatment.** A retrieved passage always sits inside a quote block: a
   `--surface-sunken` background with a `--line-strong` left rule, distinct from every
   interactive surface, which is either flat (`--surface-raised` with a `--line` border, for
   a card) or filled (`--signal`, for a button). A user does not need to know the rule exists
   to feel a card, a button, and a quote block as three different kinds of object.
3. **Behavior.** Interactive elements have a hover state, a focus ring, and a pointer cursor.
   The quote block itself does not — only the accordion header that discloses it does, and
   that header is styled as a disclosure control (chevron, hover background), not as the
   evidence.

The citation index badge (`①②③`) is filled `--signal`, the same blue as any other numbered
UI marker, rather than a reserved evidence hue — the reference product treats it as an
identity label (matching the answer's inline `[1]`), not as a claim about grounding, so it
carries the interactive palette like any other small filled chip.

**What this accepts.** A single accent asks less of a reviewer than two, but it also removes
one axis of the distinction: a screenshot cropped tightly enough to omit the evidence
margin's position and the quote block's border could, in principle, be ambiguous. This is
judged an acceptable trade because it is also how the reference product (and most
professional research tools) actually reads: no user has been observed confusing a citation
card for a button in the reference screenshots, and position + container is a stronger,
more consistently-applied signal in practice than a color a user might not consciously
register as "the grounding color" in the first place.

### 7.5 Duplicate Detection Is Scoped to the Tenant and the Context

v1's duplicate check is `{contentHash, status: 'ready'}` globally. Under multi-tenancy that
is a **cross-tenant information leak**: uploading a file and being told *"Identical content
was already ingested"* proves another user holds that exact file.

v2 scopes the check to `{contentHash, userId, contextId, status: 'ready'}`. Two tenants
uploading the same public PDF get two independent documents with two independent vector sets.
This accepts real storage duplication — the same bytes stored twice, the same chunks embedded
twice — as the price of not having a content-existence oracle. Deduplicating across tenants
by content hash while hiding that fact is possible in principle and is explicitly **not**
attempted: every scheme for it leaks timing or cost signals, and the storage saved does not
justify the analysis.

### 7.6 Contexts Cascade on Delete, Vectors First

Deleting a context deletes, in this order: (1) Qdrant points in `cerebro_chunks` by
`{userId, contextId}` filter, (2) Qdrant points in `cerebro_pages` by the same filter,
(3) page images under `pages/<documentId>/` for each document, (4) uploaded source files,
(5) `documents` rows, (6) `conversations` and their `messages` and `traces`, (7) the
`contexts` row itself.

Vectors first, registry last — the same ordering v1 uses for document deletion, for the same
reason: a failure midway leaves the context still visible and retryable, whereas the reverse
order would orphan points with no row pointing at them, which nothing would ever collect.
The context row is marked `status: 'deleting'` before step 1 and is excluded from list
queries, so a half-deleted context is never presented as usable.

### 7.7 A Context's Projection Is Cached and Invalidated, Never Computed On Request

Fitting UMAP over 5,000 × 1024 floats takes 3–15 seconds. Doing that inside a `GET` is a
timeout. Instead: ingest completion and document deletion enqueue `projection:rebuild` for
the affected context; the worker fits, and writes both the 3D coordinates **and the fitted
model's parameters** into `projections`.

`GET /api/vectors/projection` returns whatever is cached, plus a `staleness` field
(`fresh` | `rebuilding` | `absent`) so the console can say *"Rebuilding — 412 new chunks not
yet plotted"* instead of silently showing an old cloud. Failure mode: the projection job
fails → `staleness: 'absent'` with the error, the console shows `<Unavailable>` with the
reason, and chat is completely unaffected — the projection is an inspection artifact, never
on the retrieval path.

### 7.8 The Query Beacon Is Transformed Through the Fitted Model, Not Re-Fitted

This is the single easiest thing to get wrong in this feature and the failure is invisible.
UMAP is stochastic and its output space is arbitrary: fitting twice on the same data produces
two clouds that look equally reasonable and share no coordinate system. If the query vector
were projected by re-running UMAP over `[...chunkVectors, queryVector]`, the resulting beacon
coordinate would be in a *different space* than the cached cloud it is drawn into — the
beacon would land somewhere plausible and mean absolutely nothing.

So `projection/fit.js` persists the fitted model (`umap.transform`'s required state: the
learned embedding, the nearest-neighbor graph parameters, and the RNG seed), and
`projection/transform.js` runs the query vector through `transform()` against that stored
state. The seed is persisted with the model so a rebuild is reproducible.

The corollary: when a context's projection is rebuilt, every previously-issued beacon
coordinate is invalid. The console discards its beacon on a `staleness` change rather than
leaving a stale marker on a fresh cloud.

### 7.9 The 3D Payload Is a Packed Float Array, Not JSON Objects

5,000 nodes as `[{pointId, x, y, z, documentId, page, text}]` is roughly 2.4 MB of JSON and
~180 ms of `JSON.parse` on the main thread. The projection endpoint instead returns a small
JSON envelope plus a base64 `Float32Array` of interleaved `[x,y,z]` triples and a parallel
`Uint16Array` of document-index values, with the id/metadata table sent once as a
deduplicated dictionary. That is ~60 KB for the same 5,000 nodes, parses in under 5 ms, and
uploads to the GPU as an instance attribute buffer without a per-node object ever existing.

Per-node text is **not** in this payload at all — `NodeInspector` fetches one node's chunk
text on click (`GET /api/vectors/node/:pointId`), because 5,000 × 480 tokens of text is
megabytes nobody reads.

### 7.10 OTP Codes Are Hashed at Rest and Rate-Limited on Three Axes

A password-reset OTP is a password with a short life. It is stored in Redis as
`sha256(code + userId)` at `otp:pwreset:<userId>`, never plaintext — a Redis snapshot or an
`ioredis` debug log must not hand an attacker live reset codes.

Three independent limits apply: **per identifier** (5 requests/hour for a given email),
**per IP** (20 requests/hour), and **per code** (5 verification attempts, then the key is
deleted and a new request is required). A 6-digit code with 5 attempts is a 1-in-200,000
chance per issuance, which the per-identifier limit caps at 5 issuances/hour.

`POST /api/auth/password/forgot` **always returns `202 Accepted`** with the same body and
approximately the same latency whether or not the account exists. Anything else is an account
enumeration oracle. Failure mode: the mail provider is down → the endpoint still returns 202,
the failure is written to `pipeline_errors`, and `/admin/health`'s error stream shows it. The
user sees no code arrive and re-requests; an operator sees why.

---

## 8. Performance Budget

The v1 pipeline budgets ([../architecture.md §6](../architecture.md)) still hold and are not
restated. These are the budgets v2's own surfaces add.

| Metric | Target | Rationale |
|---|---|---|
| `GET /api/auth/session` | < 15 ms p95 | One Redis `GET` for the session plus one Mongo `findById`. Fires on every cold page load and every route change through a guard; anything slower makes the whole app feel gated. |
| OAuth callback round trip | < 800 ms p95 | Token exchange (~250 ms) + userinfo (~200 ms) + user upsert (~10 ms) + session write (~5 ms), plus headroom. Above ~1.5 s users click twice and generate duplicate callbacks. |
| `argon2id` hash | 250–500 ms | m=19456 KiB, t=2, p=1 (OWASP minimum). Below 250 ms the parameters are too weak; above 500 ms login feels broken and a login flood becomes a self-DoS. |
| OTP email delivery, enqueue→SMTP accept | < 2 s p95 | The send is awaited inside the request only to the point of SMTP acceptance; downstream delivery is out of our control and is not budgeted. |
| Tenant-filtered hybrid retrieval | < 550 ms p95 @ 100k chunks | v1's 500 ms budget plus ≤ 50 ms. With `is_tenant: true`, Qdrant groups a tenant's points into contiguous segments, so a filtered search touches fewer segments than an unfiltered one; the added cost is filter evaluation, not a scan. **This is a pass/fail gate on Phase 6 — the existing `test:retrieval` recall@3 must not move and p95 must stay under 550 ms.** |
| `POST /api/contexts` | < 50 ms p95 | One insert. Nothing else may creep into this path. |
| Context delete, 50 documents | < 20 s | Two Qdrant delete-by-filter calls (~1 s), 50 storage prefix deletes (~10 s on S3), and the Mongo cascade. Runs as a background job with the context marked `deleting`, not inside the request. |
| `GET /api/traces` (list, 50 rows) | < 100 ms p95 | Indexed on `{userId, createdAt: -1}` with a field projection — the list view never loads the prompt or candidate arrays. |
| `GET /api/traces/:id` | < 150 ms p95 | One document read; the prompt payload is capped at 256 KB per trace at write time. |
| Trace document size | ≤ 256 KB, hard cap | Assembled prompts with 8 sources run 20–40 KB typically; the cap truncates pathological cases with an explicit `truncated: true` flag rather than refusing the write. |
| Trace retention | 30 days (TTL index) | At 256 KB × 100 traces/user/day × 30 days ≈ 768 MB/user worst case. The TTL is the only thing standing between this feature and unbounded growth. |
| UMAP fit, 5,000 × 1024 | < 15 s | `nNeighbors: 15, minDist: 0.1, nComponents: 3`. Background job; never blocks a request. |
| `GET /api/vectors/projection`, 5,000 nodes | < 200 ms p95, ≤ 100 KB | Packed `Float32Array` payload (§7.9). JSON objects would be ~2.4 MB and blow this by an order of magnitude. |
| `POST /api/vectors/project-query` | < 400 ms p95 | One Cohere query embedding (~150–250 ms) + `umap.transform` of a single vector (~5 ms) + a k-NN lookup. |
| 3D scene frame rate | ≥ 55 fps @ 10,000 nodes, mid-range laptop iGPU | One instanced draw call. Below 50 fps the orbit control feels broken, which defeats the purpose of a spatial view. |
| Frontend production bundle, initial route | ≤ 250 KB gzip | R3F and `three` (~150 KB gzip) are **lazy-loaded** on `/admin/vectors` only; KaTeX fonts load on first math render. `/login` must not pay for either. |
| First contentful paint, `/login` | < 1.2 s on a 3G-fast profile | The login page is the first impression and needs neither the 3D stack nor the markdown stack. |
| Theme switch | < 1 frame, no layout shift | A CSS-variable swap on `:root`. Any component reading a hardcoded hex would flash — this budget is what makes the token migration non-optional. |

---

## 9. Security Model

The v1 model ([../architecture.md §7](../architecture.md)) still applies in full: prompt
injection containment, upload limits, out-of-process document parsing, provider key handling,
and deletion completeness. These are the concerns v2 introduces.

| Concern | Mitigation |
|---|---|
| **Cross-tenant vector retrieval** | The tenant filter is a required argument on every `vectorStore.js` query function and is applied inside each prefetch branch and at the top level (§7.1). `test/tenancy/isolation.test.js` asserts that user A's query against a corpus containing user B's documents returns zero of B's points; `filterInjection.test.js` asserts every exported query function throws when `tenant.userId` is absent. |
| **Cross-tenant record access via id guessing** | Every `:id` route resolves the document *and* checks ownership before acting, and returns **404** for a foreign id, never 403. A 403 confirms the resource exists, which is an existence oracle across the tenant boundary. |
| **Client-supplied tenant id** | `userId` is read only from `req.session`. No route reads a user id from a body, query string, or header. A request body containing `userId` is ignored, not honored and not rejected — rejecting it tells the sender the field was recognized. |
| **Session fixation** | `req.session.regenerate()` on every privilege transition: signup, login, OAuth callback, and password reset completion. |
| **Session hijacking** | `HttpOnly` (no JS access), `Secure` (HTTPS only), `SameSite=Lax`, 7-day rolling TTL, and a server-side store so logout is a real `DEL`. `POST /api/auth/logout-all` deletes every session for the user. |
| **CSRF** | `SameSite=Lax` blocks cross-site `POST` in every current browser. On top of that, state-changing routes require a double-submit token: a non-`HttpOnly` `cerebro.csrf` cookie echoed in an `X-CSRF-Token` header, compared with `crypto.timingSafeEqual`. `SameSite` alone is not relied upon because it is a browser policy, not an application control. |
| **Credential stuffing / brute force** | argon2id at OWASP parameters (250–500 ms per attempt) is itself a rate limit. On top: 10 login attempts per email per 15 minutes and 50 per IP per 15 minutes, both in Redis. A failed login and a nonexistent account return the **same** error text and are padded to the same latency band. |
| **Account enumeration** | `POST /api/auth/signup` with an existing email returns the same `202` as a new signup and sends a *"someone tried to sign up with your address"* email instead. `password/forgot` always returns `202` (§7.10). Login never distinguishes "no such user" from "wrong password". |
| **OTP brute force / interception** | 6 digits, 10-minute TTL, hashed at rest, 5 attempts then invalidated, 60 s resend cooldown, three-axis rate limiting (§7.10). Codes are single-use: a successful verification deletes the key before the password is written. |
| **Account takeover via unverified email linking** | An OAuth identity links to an existing local account **only** when the provider asserts `email_verified: true` *and* the local account's own email is verified. Otherwise a new account is created and the collision is surfaced to the user to resolve by signing in with the original method. |
| **Password quality** | Minimum 12 characters, checked against a bundled top-10k breached-password list. No composition rules (they push users toward `Password1!`), no maximum length below 128, no truncation. |
| **Secrets: OAuth client secrets, SMTP and Twilio credentials** | Server-side env only, validated at startup by `config/index.js`'s fail-fast REQUIRED list. `.env.example` gains the key names with empty values. The frontend bundle never contains a provider secret — only the public start URLs `/api/auth/google` and `/api/auth/github`. |
| **Open redirect on OAuth callback** | The post-login `returnTo` is validated against an allowlist of in-app paths (must start with `/`, must not start with `//` or contain `\`). An unrecognized value falls back to `/chat` silently. |
| **Trace payloads leaking document content across tenants** | `traces` rows carry `userId` and are filtered on it in both routes. The assembled prompt inside a trace contains the tenant's own document text by definition — that is the point of the inspector — but it is never joined into any cross-tenant aggregate, and LangSmith redaction (v1 §9.1) still strips chunk text from external traces. |
| **Admin surface exposure** | `requireAdmin` on `/api/admin/*`. `role` is settable only by the `ADMIN_EMAILS` allowlist at user creation or by a direct database change — there is no API that grants a role, because a role-granting API is a privilege-escalation target with no product need behind it. |
| **WebGL / CSP** | The vectors console needs `worker-src blob:` for R3F's internal workers. That directive is scoped to the `/admin/vectors` route's own response headers rather than widened globally, so the rest of the app keeps the tighter policy. |
| **Resource exhaustion via projection jobs** | `projection:rebuild` is deduplicated per context (a second enqueue while one is pending is dropped, not queued) and runs at concurrency 1 on its own queue, so a user re-uploading 50 documents produces one fit, not 50. |
| **Rate limiting keyed to identity** | Limits move from IP to `userId` once authenticated. IP-keyed limits punish everyone behind a corporate NAT and are trivially evaded by an authenticated attacker with a proxy pool; identity-keyed limits are the opposite on both counts. Unauthenticated routes stay IP-keyed. |

---

## 10. Phase Roadmap Summary

| Phase | Title | Outcome |
|---|---|---|
| **1** | Design System, Shell & Auth Surfaces | The app has one visual language with a working light/dark toggle, the v2 route tree, a single typed network boundary in `src/api/`, and every auth screen — sign in, sign up, forgot password, OTP entry, reset — rendered and validated against a mocked session |
| **2** | Contexts & Document Explorer (UI) | `/contexts` lists, creates, renames, and deletes contexts; a context page accepts drag-and-drop uploads and shows each document advancing through Queued → Parsing → Chunking → Embedding → Ready in a table with real chunk counts, re-index, and delete |
| **3** | Chat (UI) | `/chat` scopes to a context via a top-bar switcher with in-place creation, streams answers with syntax-highlighted code and rendered LaTeX, shows expandable citation cards carrying the exact grounding text, and puts a provenance ribbon under every answer that links to its trace |
| **4** | Inspector Consoles (UI) | `/admin/traces` lists and renders traces as a waterfall plus a rerank delta matrix plus a raw payload drawer; `/admin/vectors` renders a real WebGL instanced point cloud with a query beacon and a node inspector; `/admin/health` is a full admin-gated operations page. Every panel without a real backend shows an honest unavailable state |
| **5** | Accounts & Sessions (backend) | Sign up with email and password, sign out, reset the password with a code delivered to the inbox, and sign back in with Google — landing on the same account. Sessions live in Redis and revoke instantly |
| **6** | Tenancy, Contexts & Migration (backend) | Every record and every vector carries a `userId`; contexts persist and cascade correctly on delete; two users provably cannot see each other's documents, threads, or retrieval results; existing v1 data is migrated into a bootstrap user's Default context |
| **7** | Observability Data Plane (backend) | Every answer writes a trace containing its telemetry, candidate ranks, assembled prompt, and token counts; UMAP projections are fitted per context and cached, with query vectors transformed into the same fitted space; the queue and error-stream endpoints go live |
| **8** | Polish & Production | Every number in §8 is measured against the running system; the security controls in §9 are exercised; Caddy, Compose, and the deployment guide carry the OAuth callbacks, session store, and mail provider; per-tenant metrics and alert rules ship |

Each phase builds on the previous and produces a demonstrable milestone. Phases 1–4 are
frontend and must not be deployed publicly, because tenant isolation does not exist until
Phase 6. See the individual phase documents for detailed task breakdowns.
