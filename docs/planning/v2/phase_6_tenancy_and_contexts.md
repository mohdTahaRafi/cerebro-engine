# Phase 6: Tenancy, Contexts & Migration (backend)

> Depends on: Phase 5 (a `User` exists and `req.user` is populated).
> This is the phase in which Cerebro stops being a single-tenant application. Everything
> before it is preparation; nothing before it may be deployed publicly.

## 1. Objective

At the end of this phase every record and every vector in the system belongs to exactly one
user and exactly one context, and the tenant filter is structurally impossible to omit. Two
users signing in with different accounts see disjoint documents, disjoint conversations, and
disjoint retrieval results — and that property is proved by a test, not by inspection.

By the end of this phase: user A uploads `secret.pdf` into their context, user B asks a
question whose text appears verbatim in `secret.pdf`, and B's retrieval returns **zero**
points from it — verified by a scoping test that fails loudly if the filter is ever dropped.

**No trace persistence, no projections, no admin queue or error endpoints.** Those are Phase
7. This phase is isolation and the data model that carries it.

---

## 2. The Central Change

### 2.1 The problem with the standard approach

The usual way to add tenancy is to add `userId` to each query in each route handler. It works
on the day it is written and fails the first time someone adds a route and forgets. There is
no compiler check, no test that covers a handler that does not exist yet, and the failure mode
is silent — the endpoint returns *more* data, not an error.

### 2.2 What is done instead

Every exported query function in `backend/src/providers/vectorStore.js` takes a `tenant`
object as its **first, required** argument and throws before issuing any request if it is
missing or incomplete:

```js
// backend/src/providers/vectorStore.js

/**
 * @typedef {{ userId: string, contextId: string }} Tenant
 */

// Called at the top of EVERY exported function that reaches Qdrant. The throw is a
// TypeError, not a returned error: a missing tenant is a programming defect, and a
// defect that returns an empty result set would look like "no matches" and ship.
function assertTenant(tenant, fn) {
  if (!tenant || typeof tenant.userId !== 'string' || !tenant.userId) {
    throw new TypeError(
      `vectorStore.${fn}: tenant.userId is required. Every Qdrant operation is ` +
      `tenant-scoped — see docs/planning/v2/phase_6_tenancy_and_contexts.md §2.`,
    );
  }
  if (tenant.contextId !== null && typeof tenant.contextId !== 'string') {
    throw new TypeError(`vectorStore.${fn}: tenant.contextId must be a string or null.`);
  }
  return tenant;
}

// The one place a tenant becomes a Qdrant filter. `contextId: null` is a DELIBERATE,
// explicit widening to "every context this user owns" — used only by the health
// collection counts and the migration script. It is not a default; a caller must pass
// null on purpose, and `assertTenant` still requires userId.
function tenantConditions({ userId, contextId }) {
  const must = [{ key: 'userId', match: { value: userId } }];
  if (contextId !== null && contextId !== undefined) {
    must.push({ key: 'contextId', match: { value: contextId } });
  }
  return must;
}

function scopedFilter(tenant, documentIds = null) {
  const must = tenantConditions(tenant);
  if (documentIds?.length) must.push({ key: 'documentId', match: { any: documentIds } });
  return { must };
}
```

Note that `scopedFilter` **always** returns a filter object. v1's `documentIdFilter` returned
`undefined` when no document scope was given, and `undefined` passed to Qdrant means "no
filter" — an unscoped search. Under tenancy there is no such thing as an unfiltered query, so
the function that could produce one is deleted.

### 2.3 The new signatures

Every one of these changes shape in a single commit. Seven call sites and four test files
change with them; that one-time cost is what buys the structural guarantee.

```js
export async function hybridQuery(tenant, { denseVector, sparseVector, limit, documentIds = null })
export async function multivectorQuery(tenant, { queryMultivector, limit, documentIds = null })
export async function countPoints(tenant, documentIds = null)
export async function countPagePoints(tenant)
export async function upsertChunks(tenant, chunks, denseVectors, sparseVectors)
export async function upsertPages(tenant, pages, documentId, fileName)
export async function deleteByDocument(tenant, documentId)
export async function deletePagesByDocument(tenant, documentId)
export async function deleteByContext(tenant)              // NEW — the cascade primitive
export async function countByDocument(tenant, documentId)
```

`deleteByDocument` taking a tenant is not redundant with `documentId`. A delete-by-filter with
only `documentId` would, given a guessed or leaked id, delete another tenant's points. The
tenant condition makes a cross-tenant delete a no-op that reports zero rather than a
successful attack.

### 2.4 Filter placement inside `hybridQuery`

The filter is applied **inside each prefetch branch and again at the top level** — carried
forward from v1 with the tenant conditions folded in, for the reason v1 already documented: a
branch-level filter is what stops each branch from spending its `PREFETCH_LIMIT` slots on
out-of-scope points that fusion then discards, leaving far fewer than `PREFETCH_LIMIT`
in-scope candidates to fuse.

The two membership-only queries that produce branch attribution take the **same** filter at
the **same** `PREFETCH_LIMIT`. A membership set drawn at a different scope than the fused
query would attribute branches to the wrong results.

---

## 3. Qdrant Schema

### 3.1 Payload indexes

```js
// backend/src/providers/vectorStore.js — ensureCollections()

const PAYLOAD_INDEXES = [
  // is_tenant tells Qdrant this field partitions the data. It physically groups a
  // tenant's points into contiguous segments, so a filtered search reads FEWER segments
  // than an unfiltered one — the filter makes retrieval faster, not slower. This is the
  // single reason a shared collection beats collection-per-tenant at this scale
  // (architecture §5).
  { field_name: 'userId',      field_schema: { type: 'keyword', is_tenant: true } },
  { field_name: 'contextId',   field_schema: 'keyword' },
  { field_name: 'documentId',  field_schema: 'keyword' },
  { field_name: 'contentHash', field_schema: 'keyword' },
];
```

Applied to both `cerebro_chunks` and `cerebro_pages`. `createPayloadIndex` is idempotent, so
`npm run setup:qdrant` remains safe to re-run.

### 3.2 Payload shape

Every point in `cerebro_chunks` gains two fields:

```js
{
  userId:      '66f1a…',   // ObjectId as a string — Qdrant keyword indexes are string-typed
  contextId:   '66f1b…',
  documentId:  '66f1c…',   // unchanged
  contentHash: 'a3f…',     // unchanged
  fileName, text, page, headingPath, position, sourceKind,   // unchanged
}
```

`cerebro_pages` gains the same two. Ids are stored as strings, not as Mongo `ObjectId`s: the
Qdrant client serializes an `ObjectId` to an opaque object and the keyword index would never
match it. This is stated because it is a silent failure — writes succeed, reads return
nothing.

### 3.3 Migration is not optional

Existing points have no `userId`. A tenant-filtered query returns zero results against them,
so **every pre-existing document becomes invisible the moment this phase ships**, until
`migrate-to-tenancy.js` (§7) runs. That is the correct failure direction — invisible rather
than cross-tenant visible — but it means the migration is part of the deploy, not a follow-up.

---

## 4. Mongo Schema Changes

### 4.1 `Context`

```js
const ContextSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  title:       { type: String, required: true, trim: true, minlength: 1, maxlength: 80 },
  description: { type: String, default: null, maxlength: 280 },

  // Denormalized counters. Recomputed on ingest completion and on delete rather than
  // aggregated per request: /contexts renders these for every card, and an aggregation
  // over `documents` per card is N queries for a grid.
  documentCount: { type: Number, default: 0, min: 0 },
  chunkCount:    { type: Number, default: 0, min: 0 },

  // 'deleting' is set BEFORE the cascade starts and the row is excluded from list
  // queries while it holds. A cascade over 50 documents takes up to 20s (architecture
  // §8); a context that vanishes and reappears would read as data loss, and one that
  // stays clickable would 404 mid-delete.
  status:      { type: String, enum: ['active', 'deleting'], default: 'active', index: true },
  lastQueryAt: { type: Date, default: null },
}, { timestamps: true });

// Every list query is (userId, updatedAt desc). No unique index on title: two contexts
// named "Drafts" are two contexts (phase_2 §3.3).
ContextSchema.index({ userId: 1, updatedAt: -1 });
```

### 4.2 Changes to existing models

| Model | Added | Index |
|---|---|---|
| `Document` | `userId` (req.), `contextId` (req.) | `{userId:1, contextId:1, createdAt:-1}`; the v1 `{contentHash}` index becomes `{userId:1, contextId:1, contentHash:1}` |
| `Conversation` | `userId` (req.), `contextId` (req.) | `{userId:1, lastMessageAt:-1}` replaces `{lastMessageAt:-1}` |
| `Message` | `userId` (req.) | `{conversationId:1, createdAt:1}` unchanged; `userId` is defense in depth, since `conversationId` already implies ownership |
| `UsageEvent` | `userId` (optional) | `{userId:1, createdAt:-1}` — null for ingest-time calls that predate the migration |

The v1 `DocumentSchema.index({ fileName: 'text' })` is **dropped**. A text index is global to
the collection and cannot be composed with a tenant equality prefix, so it would scan every
tenant's filenames and then filter. Filename search moves to a case-insensitive regex over the
tenant-scoped result set, which at per-tenant document counts (hundreds, not millions) is
faster as well as safer.

### 4.3 Duplicate detection is scoped

```js
// backend/src/api/routes/documents.js — the check that changes
const existing = await Document.findOne({
  contentHash, userId: req.user._id, contextId, status: 'ready',
});
```

v1 checked `{contentHash, status: 'ready'}` globally. Under tenancy that is a
content-existence oracle: uploading a file and being told *"Identical content was already
ingested"* proves another user holds that exact file
([architecture.md §7.5](architecture.md)). Scoping it means two tenants uploading the same
public PDF get two independent documents with two independent vector sets — real storage
duplication, accepted deliberately as the price of not leaking.

---

## 5. Route Changes

### 5.1 `requireAuth` everywhere

`requireAuth` is applied to `/api/documents`, `/api/search`, `/api/ask`, `/api/threads`,
`/api/pages`, and the new `/api/contexts`. `/health`, `/api/health`, `/metrics`, and
`/api/auth/*` stay public.

`/api/pages/:documentId/:page.jpg` matters more than it looks: it serves a **rendered page
image of a user's document** over a plain GET. Unauthenticated, a leaked or guessed
`documentId` exposes the page. It gains `requireAuth` plus an ownership check on the
document, and returns `404` for a foreign id.

### 5.2 `requireContext`

```js
// backend/src/api/middleware/requireContext.js
export async function requireContext(req, res, next) {
  const contextId = req.params.contextId ?? req.body?.contextId ?? req.query?.contextId;
  if (!contextId || !mongoose.Types.ObjectId.isValid(contextId)) {
    return res.status(400).json({ code: 'context_required', message: 'Select a context.' });
  }
  const ctx = await Context.findOne({ _id: contextId, userId: req.user._id }).lean();

  // 404, never 403. A 403 confirms the context exists, which is an existence oracle
  // across the tenant boundary (architecture §9). A foreign id and a nonexistent id are
  // indistinguishable from outside.
  if (!ctx) return res.status(404).json({ code: 'context_not_found', message: 'Context not found.' });
  if (ctx.status === 'deleting') {
    return res.status(409).json({ code: 'context_deleting', message: 'This context is being deleted.' });
  }

  req.context = ctx;
  req.tenant = { userId: String(req.user._id), contextId: String(ctx._id) };
  next();
}
```

`req.tenant` is constructed **here and only here**, from the session and a verified ownership
lookup. No route builds one from request input.

### 5.3 The client never supplies a tenant

Any `userId` in a request body is ignored — not rejected. Rejecting it tells the sender the
field was recognized, which is one bit of information about the model an attacker does not
otherwise have. Ignoring it is free.

### 5.4 Route table

| Method | Path | Middleware | Notes |
|---|---|---|---|
| `GET` | `/api/contexts` | `requireAuth` | `{userId, status: 'active'}`, sorted `updatedAt` desc |
| `POST` | `/api/contexts` | `requireAuth` | title 1–80, description ≤ 280 |
| `GET` | `/api/contexts/:contextId` | `requireAuth`, `requireContext` | |
| `PATCH` | `/api/contexts/:contextId` | `requireAuth`, `requireContext` | title / description |
| `DELETE` | `/api/contexts/:contextId` | `requireAuth`, `requireContext` | `202` — enqueues the cascade (§6) |
| `POST` | `/api/contexts/:contextId/documents` | + `requireContext`, `uploadLimiter` | replaces `POST /api/documents` |
| `GET` | `/api/contexts/:contextId/documents` | + `requireContext` | replaces the list endpoint's global scope |
| `GET/DELETE/POST` | `/api/documents/:id[/status\|/reingest]` | `requireAuth` + ownership | 404 on a foreign id |
| `POST` | `/api/search` | `requireAuth`, `requireContext` | `contextId` now required in the body |
| `POST` | `/api/ask` | `requireAuth`, `requireContext` | `contextId` now required |
| `GET` | `/api/threads` | `requireAuth` | filtered by `userId`; `contextId` optional query filter |

### 5.5 Rate limits move to identity

```js
// backend/src/api/middleware/rateLimit.js — the keyGenerator changes
keyGenerator: (req) => (req.user ? `u:${req.user._id}` : `ip:${ipKeyGenerator(req)}`),
```

IP-keyed limits punish everyone behind a corporate NAT and are evaded by an authenticated
attacker with a proxy pool. Identity-keyed limits are the opposite on both counts.
Unauthenticated routes (all of `/api/auth/*`) stay IP-keyed, because there is no identity yet.

---

## 6. Contexts: CRUD and the Cascade

### 6.1 Ordering

Delete order is fixed and is the same discipline v1 uses for documents — **vectors first,
registry last**:

```
1.  Context.status = 'deleting'          ← excluded from lists from this instant
2.  vectorStore.deleteByContext(tenant)  ← cerebro_chunks, by {userId, contextId}
3.  vectorStore.deletePagesByContext(tenant)
4.  for each document: storage.deletePrefix(`pages/${documentId}/`)
5.  for each document: unlink the uploaded source file
6.  Document.deleteMany({ userId, contextId })
7.  Message.deleteMany({ conversationId: { $in: threadIds } })
8.  Conversation.deleteMany({ userId, contextId })
9.  Trace.deleteMany({ userId, contextId })          // Phase 7 — no-op until then
10. Context.deleteOne()
```

A failure at any step leaves the context in `deleting` with the steps already done. The job is
**idempotent**: every step is a delete-by-filter that is a no-op the second time, so a retry
resumes rather than corrupting. The reverse order would orphan points with no row pointing at
them, which nothing would ever collect.

### 6.2 It runs as a job, not in the request

Deleting 50 documents means two Qdrant delete-by-filter calls, 50 S3 prefix deletes, and four
Mongo deletes — up to 20 seconds ([architecture.md §8](architecture.md)). `DELETE
/api/contexts/:id` sets `status: 'deleting'`, enqueues `context:delete` on a **new BullMQ
queue** at concurrency 1, and returns `202`. The frontend's 2-second poll (phase_2 §3.5)
watches the row disappear.

A separate queue, not the ingest queue: a 20-second delete occupying one of two ingest workers
stalls every upload in the system for that period.

### 6.3 Failure mode

The job fails after 3 attempts → the context stays at `status: 'deleting'`, a
`pipeline_errors` row is written with `kind: 'queue'`, and the UI shows *"Deletion didn't
finish. Retry."* with a button that re-enqueues. It is never silently marked deleted with
vectors still in Qdrant — orphaned points that still match a tenant filter would be returned
by that tenant's future queries, citing a document that no longer exists.

### 6.4 Counter maintenance

`documentCount` and `chunkCount` are updated at three points: on ingest completion
(`$inc`), on document delete (`$inc` negative), and by a `recomputeContextCounters(contextId)`
helper called after any bulk operation. The helper exists because `$inc` drifts under partial
failures, and a card showing "12 documents" over a context holding 11 is the kind of small
wrongness that erodes trust in every other number on the page.

---

## 7. Migration — `backend/scripts/migrate-to-tenancy.js`

### 7.1 What it does

```
1.  Resolve the bootstrap user:
      --user <email>  → must already exist (created through the normal signup flow)
      Refuses to run if the email does not resolve. It does NOT create a user: a
      migration that mints an account with no password is an account with no owner.

2.  Create (or reuse) a context titled "Default" owned by that user.

3.  Mongo backfill, in this order:
      Document.updateMany({ userId: {$exists:false} },
                          {$set:{ userId, contextId }})
      Conversation.updateMany(… same …)
      Message.updateMany({ userId: {$exists:false} },
                          {$set:{ userId }})

4.  Qdrant backfill, per collection, by scroll-and-set-payload:
      scroll with `filter: { must_not: [{ key: 'userId', match: { any: [userId] } }] }`
      → batches of 512 point ids
      → client.setPayload(collection, { payload: { userId, contextId }, points: [...] })
      setPayload is additive — it does NOT replace the existing payload, so text,
      page, headingPath and every other field survive. (overwritePayload would erase
      them, which is the mistake this comment exists to prevent.)

5.  Recompute the context's counters from the migrated documents.

6.  Verify: countPoints({userId, contextId: null}) must equal the pre-migration
    unfiltered total. A mismatch is reported and the script exits non-zero.
```

### 7.2 Dry run by default

Following `scripts/migrate-legacy.js`'s established pattern: without `--commit` the script
prints exactly what it would change — counts per collection, the target user and context, and
a sample of five point ids per Qdrant collection — and writes nothing. `--commit` is required
to mutate.

### 7.3 Idempotence

Every step is filtered on the absence of `userId`, so a second run is a no-op. This matters
because the Qdrant backfill over a large collection may be interrupted, and the correct
recovery is to run it again.

---

## 8. Tests

These two files are the deliverable that makes the phase's claim checkable. They are named in
the milestone and are not optional.

### 8.1 `backend/test/tenancy/filterInjection.test.js`

Static-shape test with no external dependencies. For every exported function of
`vectorStore.js` named in §2.3, calling it without a tenant, with `tenant = {}`, with
`tenant = {userId: ''}`, and with `tenant = {userId: 123}` must throw `TypeError` whose message
names the function. It runs offline in milliseconds and is what catches a future contributor
adding an eighth query function without the guard.

### 8.2 `backend/test/tenancy/isolation.test.js`

Live, against `cerebro_chunks_test` — never the real collection, following the discipline
`test/retrieval/scoping.test.js` already establishes.

```
setup:   two synthetic users A and B, one context each.
         A ingests a fixture containing the distinctive sentence
         "The quarterly pemmican allowance is fourteen units."
         B ingests an unrelated fixture.

assert 1 (retrieval):  search(B.tenant, "pemmican allowance") returns 0 results, and
                       telemetry.candidatesRetrieved === 0 — not "0 after the floor",
                       which would mean the points WERE retrieved and then filtered
                       downstream. The distinction is the whole test.
assert 2 (count):      countPoints(B.tenant) excludes every one of A's points.
assert 3 (delete):     deleteByDocument(B.tenant, <A's documentId>) reports
                       deletedPoints: 0, and A's points still exist afterwards.
assert 4 (pages):      multivectorQuery(B.tenant, …) returns none of A's pages.
assert 5 (ownership):  GET /api/documents/<A's id> as B returns 404, not 403.
assert 6 (context):    GET /api/contexts/<A's contextId> as B returns 404.
teardown: delete both users' points by tenant filter, drop the test rows.
```

Assert 1's insistence on `candidatesRetrieved === 0` is the load-bearing detail. A
naive implementation that retrieves across tenants and filters the results afterwards passes a
"did B see A's text" check while still sending A's chunk text to the reranker — a provider
call containing another tenant's document content.

---

## 9. Frontend Reconciliation

The Phase 2 and 3 mocks come out in the same commit as the backend that replaces them.

| Marker | Removed |
|---|---|
| `frontend/src/api/mock/fixtures/contexts.ts` | deleted |
| `frontend/src/api/mock/fixtures/docContexts.ts` | deleted |
| `PHASE-6-REMOVE` in `ContextDetail.tsx` (client-side context filter) | deleted |
| `PHASE-6-REMOVE` in `Sidebar.tsx` — the Recent Chats client-side thread filter (**corrected 2026-08-19**: this marker was previously listed as living in `ThreadSidebar.tsx`, which Phase 3 now deletes outright; the thread list moved into the global rail, so the marker moves with it) | deleted |
| `MOCKED_ENDPOINTS` entries for `contexts.*` | removed |

Acceptance: `grep -rn "PHASE-6-REMOVE" frontend/src/` returns 0 lines.

Document upload moves from `POST /api/documents` to
`POST /api/contexts/:contextId/documents` in `frontend/src/api/endpoints/documents.ts` — one
file, because the boundary established in Phase 1 is what makes an API reshape a one-file
change rather than a hunt.

---

## 10. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 6.1 | Implement `assertTenant`, `tenantConditions`, `scopedFilter`; delete `documentIdFilter` | `grep -n "documentIdFilter" backend/src/` returns 0; no code path can produce an undefined filter |
| 6.2 | Change all ten `vectorStore` signatures per §2.3 | `npm run test:retrieval` passes after the call-site updates; recall@3 is unchanged from the pre-change baseline |
| 6.3 | Apply the tenant filter in both prefetch branches and at top level, and in both membership queries | A traced query shows identical filters on all five Qdrant calls |
| 6.4 | Add `userId` (`is_tenant: true`) and `contextId` payload indexes to both collections | `npm run setup:qdrant` twice succeeds; `GET /collections/cerebro_chunks` shows `is_tenant: true` on `userId` |
| 6.5 | Add `userId`/`contextId` to both collections' payloads as **strings** | A freshly ingested document's points return matches for `{key:'userId', match:{value:'<hex string>'}}` |
| 6.6 | Implement the `Context` model with its indexes | Creating an 81-character title fails validation; two contexts named `Drafts` both save |
| 6.7 | Add `userId`/`contextId` to `Document`, `Conversation`, `Message`, `UsageEvent`; drop the `fileName` text index | `db.documents.getIndexes()` shows no text index and the new compound index |
| 6.8 | Scope duplicate detection to `{contentHash, userId, contextId}` | Users A and B uploading the identical file each get an independent `ready` document with its own chunk count |
| 6.9 | Implement `requireContext` returning 404 for foreign ids and 409 while deleting | As B, `GET /api/contexts/<A's id>` returns 404 with no body distinguishing it from a nonexistent id |
| 6.10 | Apply `requireAuth` to documents, search, ask, threads, and **pages** | Unauthenticated `GET /api/pages/<id>/1.jpg` returns 401; as a foreign user it returns 404 |
| 6.11 | Implement the full `/api/contexts` route table | Every row in §5.4 behaves as stated |
| 6.12 | Implement the cascade job on its own queue at concurrency 1 | Deleting a 50-document context returns `202` in < 100 ms; the job completes and `countPoints` for that context returns 0 |
| 6.13 | Make the cascade idempotent and verify the failure path | Killing the worker mid-cascade and restarting completes the delete; a permanently failing cascade leaves `status: 'deleting'` and writes a `pipeline_errors` row |
| 6.14 | Implement counter maintenance + `recomputeContextCounters` | After ingesting 3 and deleting 1, the card shows `2 documents` and a chunk count equal to the sum over the remaining rows |
| 6.15 | Re-key rate limits to `userId` when authenticated | Two users behind one IP each get their own `/api/ask` budget; `/api/auth/login` stays IP-keyed |
| 6.16 | Write `migrate-to-tenancy.js`, dry-run by default | Without `--commit` nothing changes and a full plan prints; with `--commit` every pre-existing document becomes visible to the bootstrap user |
| 6.17 | Verify the Qdrant backfill uses `setPayload`, not `overwritePayload` | After migration a migrated point still carries its `text`, `page`, and `headingPath` |
| 6.18 | Make the migration idempotent and self-verifying | A second `--commit` run reports 0 changes; a deliberately partial run reports the count mismatch and exits non-zero |
| 6.19 | Write `test/tenancy/filterInjection.test.js` | All ten functions throw `TypeError` for all four malformed tenants; adding a new export without a guard fails the test |
| 6.20 | Write `test/tenancy/isolation.test.js` with all six asserts | Assert 1 checks `candidatesRetrieved === 0`, not just an empty result list |
| 6.21 | Add `npm run test:tenancy` and include it in `npm test` | `npm test` runs both tenancy suites |
| 6.22 | Remove every Phase 2/3 mock and marker | `grep -rn "PHASE-6-REMOVE" frontend/src/` returns 0; `mock/fixtures/{contexts,docContexts}.ts` are gone |
| 6.23 | Re-point document upload to the nested route | Uploading from `/contexts/:id` lands in that context and appears in no other |

---

## 11. Milestone Definition

Phase 6 is **complete** when:

> An operator runs `node backend/scripts/migrate-to-tenancy.js --user taha@example.com` with no
> `--commit`. It prints a plan — *"41 documents, 6 conversations, 84 messages, 12,408 chunk
> points, 340 page points → user taha@example.com, context 'Default'"* — and changes nothing.
> They re-run with `--commit`; it completes, verifies that the tenant-filtered point count
> equals the pre-migration unfiltered total, and exits 0. Running it a second time reports
> **0 changes**.
>
> Two people sign in from two browsers. **A** creates a context `Private`, uploads a document
> containing the sentence *"The quarterly pemmican allowance is fourteen units."*, and asks
> *"what is the pemmican allowance?"* — the answer streams back citing that document. **B**
> creates their own context, uploads something unrelated, and asks the identical question. B
> gets the fixed refusal, and the trace shows `candidatesRetrieved: 0` — A's points were never
> retrieved at all, not retrieved and then filtered. Nothing of A's document text was ever sent
> to the reranker.
>
> B copies A's `documentId` out of A's screen and requests `GET /api/documents/<A's id>`. The
> response is **404**, byte-identical to the response for an id that never existed. They try
> `GET /api/pages/<A's id>/1.jpg` and get 404. They try `GET /api/contexts/<A's contextId>` and
> get 404. They `POST /api/ask` with A's `contextId` and get 404 before the graph is invoked.
> They add `"userId": "<A's id>"` to their own request body; it is ignored and the request runs
> as B, exactly as it would without it.
>
> Both users upload the identical public PDF into their own contexts. Neither is told it is a
> duplicate — each gets an independent document with its own chunk count — because duplicate
> detection is now scoped, and telling B that A already holds a file would be the leak this
> phase exists to close.
>
> A deletes a 50-document context. The request returns `202` in under 100 ms and the card
> immediately greys with *Deleting…*; the card disappears about eighteen seconds later. A
> direct `count` against `cerebro_chunks` filtered on that `contextId` returns **0**, the page
> images are gone from storage, and the conversations held in that context are gone from Mongo.
> Meanwhile B's upload, which was in flight throughout, completed normally — the cascade ran on
> its own queue and never touched an ingest worker.
>
> A developer opens `vectorStore.js`, adds a new query function, and forgets `assertTenant`.
> `npm run test:tenancy` fails on `filterInjection.test.js` naming the new function. They add
> the guard and it passes. They then run the full `npm test`: the v1 suites — breaker,
> ingestion, retrieval, vision, graph, telemetry, api — are all still green, and
> `npm run test:retrieval` reports the same recall@3 as before the tenant filter existed.
>
> Finally, `grep -rn "PHASE-6-REMOVE" frontend/src/` prints nothing, and `/contexts` is running
> entirely against the real backend with no `MOCK` badge anywhere on the page.

---

## 12. Files to Create

```
backend/src/
├── models/Context.js
├── providers/vectorStore.js          # [rewrite] assertTenant, scopedFilter, ten signatures
├── api/
│   ├── middleware/requireContext.js
│   ├── middleware/rateLimit.js       # [extend] identity-keyed
│   ├── routes/contexts.js            # CRUD + nested document routes
│   ├── routes/{documents,search,ask,threads,pages}.js   # [extend] tenant-scoped
│   └── index.js                      # [extend] mount contexts, apply requireAuth
├── contexts/
│   ├── cascade.js                    # the ten ordered steps (§6.1), idempotent
│   ├── queue.js                      # BullMQ 'context:delete', concurrency 1
│   └── counters.js                   # recomputeContextCounters
├── ingestion/ingestDocument.js       # [extend] pass tenant to every vectorStore call
└── scripts/
    ├── migrate-to-tenancy.js         # dry-run default, idempotent, self-verifying
    └── setup-qdrant.js               # [extend] is_tenant payload indexes

backend/test/tenancy/
├── filterInjection.test.js           # offline; all ten functions × four bad tenants
└── isolation.test.js                 # live against cerebro_chunks_test; six asserts

frontend/src/api/
├── endpoints/{contexts,documents}.ts # [rewrite] real endpoints, nested upload path
└── mock/fixtures/{contexts,docContexts}.ts   # DELETED
```

**No new dependencies.**

---

## 13. Performance Validation

| Metric | How to Measure | Target |
|---|---|---|
| Tenant-filtered hybrid retrieval | `npm run test:retrieval` timing, 100k chunks | < 550 ms p95 — **a hard gate**; v1's budget was 500 ms and the tenant filter may cost at most 50 ms |
| Recall@3 after the filter change | `npm run test:retrieval` regression suite | unchanged from the pre-change baseline |
| `is_tenant` segment benefit | Compare a filtered vs. unfiltered query at 100k points, 20 tenants | the filtered query is **not slower**; if it is, the payload index is misconfigured |
| `GET /api/contexts` | `autocannon`, 20 contexts | < 50 ms p95 (denormalized counters; no aggregation) |
| `POST /api/contexts` | `autocannon` | < 50 ms p95 |
| Context delete enqueue | Network panel | < 100 ms to `202` |
| Cascade, 50 documents | Worker log timestamps | < 20 s |
| Qdrant migration backfill | Script output, 12k points | < 60 s at batch size 512 |
| Ingest with tenant payloads | `cerebro_ingest_job_duration_seconds` | unchanged from v1 — two extra payload keys per point are noise |

---

## 14. Amendments (recorded during implementation, 2026-08-27)

Per CLAUDE.md §7.4, the spec is the source of truth and must not silently drift from the
shipped code. Three deviations from §2.3's exact text, decided and documented rather than
punted:

1. **`deletePagesByContext(tenant)` is an eleventh guarded function, not listed in §2.3's
   "new signatures" table.** §6.1's own cascade steps 2-3 already call it by name
   (`vectorStore.deleteByContext(tenant)` for `cerebro_chunks`, then
   `vectorStore.deletePagesByContext(tenant)` for `cerebro_pages`) — §2.3's list simply
   omitted it. It is tenant-guarded identically to `deleteByContext`, including the
   stricter "`contextId` must be a non-null string" check neither `assertTenant` nor
   §2.3 states explicitly: a context-delete cascade with a widened `contextId: null`
   would delete every context the user owns, not the one being deleted. Both `filterInjection.test.js` and `cascade.js` treat it as load-bearing, not incidental.

2. **`countAllPoints()` / `countAllPagePoints()` — two deliberately UNGUARDED, cross-tenant
   count functions, added to `vectorStore.js` and not in §2.3's list at all.** `GET
   /health` (phase 1 §8) reports whole-deployment collection sizes for operators — before
   this phase it called the then-unscoped `countPoints()`/`countPagePoints()`. Once those
   two became tenant-required (§2.3 lists both), `/health`'s legitimate cross-tenant use
   case had no function left to call. Minting a third pair of names, explicitly excluded
   from `assertTenant` and named so they cannot be confused with the guarded pair, keeps
   the "every Qdrant operation is tenant-scoped" claim intact for anything that returns
   document content while giving infra monitoring — which returns only a single integer,
   never content, never a per-tenant breakdown — a legitimate way to stay unscoped.
   `filterInjection.test.js`'s `UNGUARDED_ALLOWLIST` enumerates these by name specifically
   so a future contributor adding a new query function still can't slip past the guard
   silently — only these two pre-approved exceptions are exempt.

3. **The migration's verification (§7.1 step 6) compares against the pre-migration
   collection-wide total captured before any write, not `countPoints({userId,
   contextId: null})` computed fresh at verify time.** The two are equal on a first run
   against a genuinely single-tenant legacy corpus (the case §7 describes), but an exact
   pre/post comparison is only meaningful if "pre" is captured before the run mutates
   anything — computing it post-hoc from the same widened query the verification itself
   uses would make the check tautological. `migrate-to-tenancy.js` captures both chunk and
   page collection totals via `countAllPoints()`/`countAllPagePoints()` (amendment 2,
   above) at the very start, then asserts exact equality against them after the backfill.
