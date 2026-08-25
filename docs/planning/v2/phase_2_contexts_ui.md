# Phase 2: Contexts & Document Explorer (UI)

> Depends on: Phase 1 (design tokens, `src/api/` boundary, auth guards, route table).
> Backend changes: **none**. Context CRUD is served by the mock adapter; every document
> operation runs against the **real** backend's existing flat global pool.

## 1. Objective

At the end of this phase `/contexts` is a working workspace manager: a user creates,
renames, and deletes knowledge contexts, opens one, drags a batch of files into it, and
watches each file advance through the five named lifecycle stages in a document table that
also supports re-indexing and deletion. Every column in that table is a real value from the
real backend.

By the end of this phase: a user creates a context named `Q3 Reports`, drops three PDFs and
a DOCX onto the drop target at once, and watches four rows appear and independently climb
**Queued → Parsing → Chunking → Embedding → Ready**, each landing on a real chunk count, with
one deliberately corrupt file stopping at **Failed** with the parser's actual reason next to
it.

**No chat integration, no context switcher in the chat header, no inspector consoles, and no
backend code.** Selecting a context does not yet scope retrieval — that is Phase 3's job on
the frontend and Phase 6's on the backend. This phase builds the workspace and the explorer.

### 1.1 The honest boundary this phase carries

Contexts do not exist server-side until Phase 6. Everything on `/contexts` that is *about a
context* — the list, the create dialog, the rename, the delete — talks to the mock adapter
and carries a `<MockBadge>`. Everything *about a document* — upload, status polling, chunk
counts, re-index, delete — is real, because those endpoints already exist.

The consequence a reviewer must understand: in this phase every document lands in the same
global pool regardless of which context page uploaded it, and the per-context document list
is filtered **client-side** from the full list by a `contextId` the mock assigned. That is a
development affordance, not a shipping behavior, and §7.3 specifies exactly how it is
labeled and how it is removed.

---

## 2. What a Context Is

A context is a named, isolated document collection owned by exactly one user. It is the unit
of retrieval scope (a question is answered from one context, never across two), the unit of
cascade deletion, and the unit of vector-space projection.

It is deliberately **not** a folder: contexts do not nest, a document belongs to exactly one
context, and there is no move-between-contexts operation. Nesting would make the retrieval
scope question ("does a query on the parent search the children?") a product decision with no
good answer, and a move would require re-writing the `contextId` on every one of a document's
Qdrant points — an operation with a partial-failure mode and no user demand behind it. A user
who wants a document in two contexts uploads it twice, which is honest about the cost.

The shape the UI consumes (from `contracts.ts`, Phase 1 §4.2):

```ts
interface KnowledgeContext {
  id: string;
  title: string;                 // 1–80 chars, required
  description: string | null;    // 0–280 chars
  documentCount: number;         // rows in `documents` for this context, any status
  chunkCount: number;            // sum of chunkCount over ready documents
  status: 'active' | 'deleting';
  createdAt: string; updatedAt: string;
}
```

`status: 'deleting'` exists because a cascade over 50 documents takes up to 20 seconds
([architecture.md §8](architecture.md)). A context in that state is rendered greyed with a
*"Deleting…"* chip and is not clickable — never silently absent, which would look like data
loss, and never clickable, which would 404.

---

## 3. `/contexts` — The Context List

### 3.1 Layout

A page header with the Display-role title *"Contexts"* (Inter Bold), a one-line description,
and a primary *New context* button, over a responsive card grid.

The **top bar on this route shows `All contexts`** in the `ContextSwitcher` (`DESIGN.md` §5.3)
— this screen is inherently cross-context, so pinning it to one named context would be a lie
about what is on screen. It is one of only two routes where that scope value renders; the
other is `/admin/traces`. Selecting a named context from it navigates to that context's
`/contexts/:id`, which is the only sensible destination for narrowing scope from a list page.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Contexts                                        ┌────────────────┐  │
│  Each context is a separate, private             │  New context   │  │
│  document collection.                            └────────────────┘  │
├──────────────────────────────────────────────────────────────────────┤
│  ┌────────────────────┐  ┌────────────────────┐  ┌────────────────┐ │
│  │ Q3 Reports      ⋯ │  │ Research Papers ⋯ │  │ Contracts   ⋯ │ │
│  │                    │  │                    │  │                │ │
│  │ Quarterly earnings │  │ ML papers, 2024–25 │  │ —              │ │
│  │                    │  │                    │  │                │ │
│  │ 12 documents       │  │ 47 documents       │  │ 3 documents    │ │
│  │ 1,840 chunks       │  │ 9,102 chunks       │  │ 0 chunks       │ │
│  │ Updated 2 days ago │  │ Updated 1 hr ago   │  │ Never used     │ │
│  └────────────────────┘  └────────────────────┘  └────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
     grid-template-columns: repeat(auto-fill, minmax(288px, 1fr))
     gap 16px · card padding 20px · radius --radius-lg · shadow-1
```

Card counts are set in **Data** type (Inter Medium, tabular figures) so a column of cards
has its numbers aligned; everything else is UI/Body weight. The `⋯` opens a Radix dropdown with
*Rename*, *Edit description*, and *Delete* (the last in `--critical`, separated by a rule).

The whole card is a link to `/contexts/:id`; the `⋯` button stops propagation. Keyboard: the
card is the tab stop and Enter opens it; the menu is reachable with a second Tab.

### 3.1a Toolbar — search, sort, and the view switcher

**Added 2026-08-19** from the reviewed `/contexts` reference screen; these three controls were
in the mockup but in no phase doc. A single row between the page header and the grid:

| Control | Behavior |
|---|---|
| Search | `⌕ Search contexts…`, ~320–360px, filters **client-side on title and description** as you type, debounced 150ms. Client-side is correct here: a user with 200 contexts is not this product's shape, and Phase 6's server-side search exists for documents, not contexts |
| Sort | `Sort by: Last updated ▾` — options **Last updated** (default), **Name (A–Z)**, **Document count**. No "Created" option: it answers a question nobody asks about a workspace |
| View | A two-button segmented control, **List** / **Grid**. Grid is the card layout drawn above; List is one row per context with the same fields laid out horizontally. The choice persists in `localStorage` under `cerebro.contexts.view` — it is a workspace preference, not session state |

Search filtering and the empty state interact: filtering to zero results shows
**"No contexts match `{query}`."** with a *Clear search* action — **not** the first-run
EmptyState from §3.2, which invites creating a context and would be wrong advice for someone
who has twelve and mistyped one.

### 3.1b Context accent tints

Each context card carries a folder glyph in a tinted rounded square. The tint is **derived
deterministically from the context id** (a stable hash into a fixed six-entry palette: pale
blue, green, lavender, amber, teal, slate) so a given context is the same color on every
screen and across reloads, without storing a color on the record.

**The tint carries no meaning.** It is a recognition aid — the same job a favicon does — not a
status, not a category, and not evidence. It is deliberately drawn from the *soft* end of each
hue so six cards side by side read as a quiet set rather than a rainbow, per `DESIGN.md`'s
restraint rule. Because it is decorative, it is never the only way to tell two contexts apart:
the title is always present and always the primary identifier.

### 3.2 The empty state

First-run is the most important screen on this page and gets the Display role:

> **No contexts yet**
> A context holds a set of documents you want to ask questions about. Most people start with
> one per project.
> `[ Create your first context ]`

No illustration. The empty state is an invitation to act, and the action is the only thing in
it.

### 3.3 Create

A Radix dialog, not a route. Two fields — *Name* (required, 1–80, autofocused) and
*Description* (optional, 280 max, with a live remaining-count that appears only past 240) —
and a *Create context* submit.

On success: the dialog closes, the new card animates in at the head of the grid
(`--motion-slow`, respecting reduced motion), a toast reads **"Context created."**, and the
router navigates straight to `/contexts/:id`. Navigating immediately is deliberate: a user
who just created a context wants to put something in it.

Duplicate names are **allowed**. Two contexts named `Drafts` are two contexts; enforcing
uniqueness would mean explaining a constraint that protects nothing (ids are what identify a
context, not names).

### 3.4 Rename and Edit description

Inline in the same dialog component, pre-filled. Submit is disabled until the value differs
from the current one — a no-op save that shows a success toast trains users to distrust the
toast.

### 3.5 Delete

Deleting a context destroys documents, vectors, page images, uploaded files, and every
conversation held in it. That is not recoverable, so the confirmation is a typed
confirmation, not a *Yes/No*:

```
┌─────────────────────────────────────────────────────────────┐
│  Delete "Q3 Reports"                                         │
│                                                              │
│  This permanently deletes 12 documents, 1,840 indexed        │
│  chunks, and 4 conversations. It cannot be undone.           │
│                                                              │
│  Type the context name to confirm.                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Q3 Reports                                             │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│                          [ Cancel ]  [ Delete context ]      │
└─────────────────────────────────────────────────────────────┘
```

The counts are read from the context record, not invented — an empty context's dialog says
*"This context is empty. Deleting it cannot be undone."* and still requires the typed name,
because the muscle memory is the point.

*Delete context* stays disabled until the typed string matches exactly (case-sensitive,
trimmed of leading/trailing whitespace only). On submit the card immediately renders in the
`deleting` state; the list polls at 2 s until the record disappears.

---

## 4. `/contexts/:id` — The Context Detail

### 4.1 Layout

Follows the phase-1 spatial grammar: primary column is the document table, the 380px evidence
margin holds the context's own metadata and the upload target.

```
┌────┬────────────────────────────────────────────┬────────────────────┐
│ N  │  Q3 Reports                             ⋯ │  ┌──────────────┐  │
│ A  │  Quarterly earnings                        │  │              │  │
│ V  │  ──────────────────────────────────────── │  │  Drop files  │  │
│    │  [search…]  [status ▾]        12 documents │  │      or      │  │
│    │  ┌──────────────────────────────────────┐ │  │   browse     │  │
│    │  │ NAME      SIZE  STAGE   CHUNKS   ⋯  │ │  │              │  │
│    │  ├──────────────────────────────────────┤ │  └──────────────┘  │
│    │  │ q3.pdf    2.4MB ●Ready    412    ⋯  │ │  PDF DOCX TXT MD   │
│    │  │ scan.pdf  8.1MB ◐Embedd…   —     ⋯  │ │  CSV XLSX JSON     │
│    │  │ notes.md   14KB ●Ready     22    ⋯  │ │  Up to 50 MB       │
│    │  │ bad.pdf    1.2MB ✕Failed   —     ⋯  │ │  ────────────────  │
│    │  └──────────────────────────────────────┘ │  Created 12 Mar    │
│    │                                            │  1,840 chunks      │
│    │                                            │  Last query 2d ago │
└────┴────────────────────────────────────────────┴────────────────────┘
```

Below 1024px the margin becomes a collapsible panel above the table, with the dropzone
reduced to a full-width *Add documents* button that opens the file picker. The dropzone
never disappears — it is the primary action of the page.

### 4.2 The whole page is a drop target

`react-dropzone` (already a dependency) wraps the entire content area with
`noClick: true, noKeyboard: true`, so dragging anywhere over the page highlights the margin
target; only the target itself is clickable. This is how the existing `GlobalDropzone`
already behaves on `/chat` and the interaction is kept consistent.

---

## 5. The Five-Stage Lifecycle

### 5.1 The gap, stated plainly

The PRD asks for `Queued → Parsing → Chunking → Embedding → Ready`. The backend reports three
statuses (`queued`, `processing`, `ready`, plus `failed`/`duplicate`) and an integer
`progress` whose checkpoints are set at exactly these points in
`backend/src/ingestion/ingestDocument.js`:

| `progress` | Set immediately after |
|---|---|
| `5` | job dequeued, `status: 'processing'` written |
| `15` | per-page classification complete (PDF only) |
| `45` | LlamaParse / loader parse complete |
| `75` | visual page render + OCR + ColPali embedding complete |
| `85` | text and OCR chunking complete |
| `95` | dense + sparse embedding and `cerebro_chunks` upsert complete |
| `100` | page multivector upsert complete, `status: 'ready'` |

### 5.2 The derivation, and the one place it is not one-to-one

A naive band mapping produces a **non-monotonic** stage sequence: 45→75 is ColPali page
embedding, which is literally embedding, but 75→85 is chunking, so the user would watch
*Parsing → Embedding → Chunking → Embedding*. Bouncing backwards through a named lifecycle
looks like a bug even when the underlying work is correct.

The decision: **the 45–75 band is presented as `parsing`**, on the grounds that from the
user's side of the screen, rendering and OCR-ing scanned pages is still the machine reading
the document. It is coarse, but it is not false, and it is monotonic.

That band is also the longest one for a scanned document (~6 s per page), so it gets a
sub-label built from `visualPageCount`, which the backend already wrote to the row at
progress 15:

```ts
// frontend/src/app/components/documents/stage.ts
//
// INTERIM (phase_2 §5.2). The backend does not yet report a lifecycle stage; this derives
// the five PRD-named stages from `status` + `progress`. Phase 7 adds a real `stage` field
// to the Document model and THIS ENTIRE FILE IS DELETED — the mapping is not a long-term
// abstraction, it is a bridge with a scheduled demolition date.
//
// Band boundaries mirror backend/src/ingestion/ingestDocument.js's updateProgress() calls.
// If those move, this moves. There is no test that can catch the drift, so the boundaries
// are named in both files with a pointer to the other.

export function deriveStage(doc: Pick<DocumentRecord,
  'status' | 'progress' | 'visualPageCount'>): IngestStage {
  switch (doc.status) {
    case 'queued':    return 'queued';
    case 'ready':     return 'ready';
    case 'failed':    return 'failed';
    case 'duplicate': return 'ready';   // resolved against an already-ready original
    case 'processing':
      if (doc.progress < 75)  return 'parsing';     // classify + parse + OCR/ColPali (§5.2)
      if (doc.progress < 85)  return 'chunking';
      return 'embedding';                            // 85 → 100
  }
}

/** Extra line under the stage chip. Real values only — returns null rather than
 *  inventing detail the row does not carry. */
export function stageDetail(doc: DocumentRecord): string | null {
  if (deriveStage(doc) !== 'parsing') return null;
  if (doc.progress >= 45 && doc.visualPageCount > 0) {
    return `${doc.visualPageCount} scanned page${doc.visualPageCount === 1 ? '' : 's'}`;
  }
  return null;
}
```

### 5.3 The stage chip

| Stage | Glyph | Color | Label | Progress bar |
|---|---|---|---|---|
| `queued` | ○ hollow ring | `--graphite` | Queued | none — nothing is happening yet |
| `parsing` | ◐ rotating half-ring | `--signal` | Parsing | determinate, `progress` |
| `chunking` | ◐ | `--signal` | Chunking | determinate |
| `embedding` | ◐ | `--signal` | Embedding | determinate |
| `ready` | ● filled | `--positive` | Ready | none |
| `failed` | ✕ | `--critical` | Failed | none |

The rotating half-ring is the one animated element on the page and is suppressed under
`prefers-reduced-motion`, where the chip instead shows the percentage as text — the user
still needs to know work is in flight.

A `duplicate` row renders as `Ready` with a neutral `--surface-sunken` / `--line` *Duplicate*
badge and a tooltip: *"Identical content was already ingested as {originalFileName}."*
(Amended 2026-08-19, replacing the retired `--evidence` amber — see architecture.md §7.4.)
It reads as a static label, not a button, because it carries no hover or focus state: it is
a statement about what the system found in its index, not an interaction.

### 5.4 Polling

One poll loop per page, not per row. `GET /api/documents/:id/status` is cheap but N rows × a
1.5 s interval is N requests per 1.5 s. Instead the page polls the **list** endpoint
(`GET /api/documents?contextId=…`) at 1.5 s **while any row is in a non-terminal state**, and
stops entirely when every row is `ready`, `failed`, or `duplicate`. A page of finished
documents generates zero traffic.

`document.visibilityState === 'hidden'` pauses the loop and an immediate poll fires on
return, so a backgrounded tab does not accumulate requests.

---

## 6. Upload

### 6.1 The flow

1. Files arrive by drop or picker. Each is validated client-side **before** any request: the
   extension is in the accepted set, and `file.size` is > 0 and ≤ 50 MB. A rejected file
   never leaves the browser and produces an immediate row-less error toast naming the file
   and the reason.
2. Accepted files are added to an **upload queue** rendered as optimistic rows at the top of
   the table with stage `queued` and an indeterminate bar.
3. The queue uploads at **concurrency 3**. Three is chosen against the backend's own limits:
   the upload rate limiter allows 10/hour and `express.json`/multer handle one 50 MB
   multipart body at a time comfortably, while a browser's 6-connection-per-origin budget
   must still leave room for the status poll. Six parallel 50 MB uploads would saturate it.
4. Each response replaces the optimistic row with the real `documentId`. From that point the
   row is driven by the page's poll loop, not by the upload.
5. The whole batch reports once when it settles: **"3 documents ready. 1 failed."** — one
   toast, not four.

### 6.2 Failure taxonomy

Every failure the user can see, with the copy shown and where it comes from:

| Condition | Source | Copy |
|---|---|---|
| Extension not accepted | client, pre-flight | *"{name} isn't a supported type. Cerebro reads PDF, DOCX, TXT, MD, CSV, XLSX, and JSON."* |
| Larger than 50 MB | client, pre-flight | *"{name} is {size}. The limit is 50 MB."* |
| Empty file | backend 400 | *"{name} is empty."* |
| Magic bytes disagree with the extension | backend 400 (`verifyType`) | the server's own reason, rendered verbatim |
| Queue unavailable | backend 503 | *"The upload queue is unavailable. Try again shortly."* — the row is removed and the file stays in the picker for a retry |
| Rate limited | backend 429 | *"Upload limit reached. Try again in {n} minutes."* |
| Duplicate content | backend 200, `status: 'duplicate'` | not an error — the row renders Ready with the Duplicate badge (§5.3) |
| Ingestion failed | poll, `status: 'failed'` | the backend's classified `error` string verbatim, in a `--critical-soft` cell with a *Retry* action |

The rule throughout: **the server's error text is rendered as-is**. It is already written for
a human (`"Document contains no extractable text and no renderable pages."`) and rewriting it
on the client would create two sources of truth for the same failure.

### 6.3 What the client does not do

No client-side PDF preflight (page counting, encryption detection). The bytes have to go to
the server anyway, and a browser-side PDF parser is a large dependency and a second place to
be wrong about a format. `verifyType` on the server is the single authority.

---

## 7. The Document Table

### 7.1 Columns

| Column | Content | Width | Sort |
|---|---|---|---|
| Name | filename, with a file-type glyph; truncated middle-out so the extension stays visible | flexible, min 220px | yes, A–Z |
| Size | `formatBytes` — `2.4 MB`, Data type | 88px | yes |
| Stage | the §5.3 chip + `stageDetail` sub-label + determinate bar | 180px | no |
| Chunks | `chunkCount` when ready, `—` otherwise, Data type, right-aligned | 88px | yes |
| Pages | `pageCount`, with `textPageCount`/`visualPageCount` in the tooltip | 72px | no |
| Added | relative (`2 days ago`), absolute in the `title` | 110px | yes, default desc |
| `⋯` | row actions | 44px | — |

`—` for an unknown value, never `0`. A document mid-ingest genuinely has no chunk count; a
zero would be a claim.

### 7.2 Filter, search and selection

- Search filters on filename, debounced 200 ms. It is **client-side** over the loaded page —
  the backend's `$text` index only matches whole words and a user typing `q3` expects `q3.pdf`
  to appear. Server-side search returns in Phase 6 with real pagination.
- Status filter: All / Ready / In progress / Failed. In progress unions `queued` and
  `processing`.
- Row selection with a header checkbox enables **bulk delete only**. Bulk re-index is
  deliberately absent: re-indexing 40 documents at concurrency 2 is 20 minutes of paid
  provider calls behind one click, and there is no undo.

### 7.3 Row actions

*Re-index* → `POST /api/documents/:id/reingest`, real, existing. It resets the row to
`queued` and restarts the poll. Confirmation is required only when the document is currently
`ready` (*"Re-indexing replaces this document's existing 412 chunks. It re-runs parsing and
embedding."*) — re-indexing a failed document needs no confirmation, because there is nothing
to lose.

*Delete* → `DELETE /api/documents/:id`, real, existing. Single-step confirm naming the file.
The response's `deletedPoints` count is surfaced in the toast: **"q3.pdf deleted. 412 indexed
chunks removed."** — it is a real number the endpoint already returns, and it is the only
confirmation a user gets that the vectors actually went with the file.

*Copy document ID* → clipboard. Useful when cross-referencing a trace in Phase 4.

### 7.4 The client-side context filter, and its removal

Documents have no `contextId` until Phase 6. The mock assigns one at upload time and holds
it in `localStorage` under `cerebro.mock.docContexts`; the detail page filters the real
document list through it.

This is labeled in three places so it cannot survive by accident:

1. A `<MockBadge>` on the table header reading *"Context assignment is local to this browser."*
2. A `// PHASE-6-REMOVE` comment on the filter function.
3. Task 6.x in the Phase 6 document explicitly deletes `mock/fixtures/docContexts.ts` and the
   filter, and the acceptance criterion is
   `grep -rn "PHASE-6-REMOVE" frontend/src/ | wc -l` returning 0.

---

## 8. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 2.1 | Implement `api/endpoints/contexts.ts` against `contracts.ts` | `tsc --noEmit` passes; every method has a mock counterpart |
| 2.2 | Implement the contexts mock with `localStorage` persistence | Creating a context, reloading the page, and returning to `/contexts` still shows it |
| 2.3 | Build `/contexts` grid, card, and empty state | With zero contexts the empty state renders; creating one replaces it with a single card |
| 2.3a | Build the §3.1a toolbar — search, sort, view switcher — and the `All contexts` top-bar scope (§3.1) | Typing `res` narrows six contexts to *Research Papers*; a query matching nothing shows **"No contexts match `zzz`."** with *Clear search*, **not** the first-run empty state; switching to List and reloading keeps List (`localStorage['cerebro.contexts.view']`); sorting by Name (A–Z) reorders without a refetch; the top bar reads **All contexts** with no document count, and picking a named context from it navigates to that context's `/contexts/:id` |
| 2.3b | Implement the §3.1b deterministic context tint | The same context renders the same tint across a reload and on both `/contexts` and `/contexts/:id`; six contexts produce at most six distinct tints; no tint is used to convey status anywhere |
| 2.4 | Build the create dialog | Submitting with an empty name keeps the button disabled; an 81-character name shows a field error and does not submit |
| 2.5 | Build rename / edit description | Opening rename and submitting without a change leaves the button disabled |
| 2.6 | Build the typed-confirm delete dialog | *Delete context* is disabled until the typed string matches exactly; `Q3 reports` (wrong case) does not enable it |
| 2.7 | Implement the `deleting` card state and its 2 s poll | A deleted context's card greys, becomes unclickable, and disappears within one poll cycle |
| 2.8 | Build `/contexts/:id` with the three-column layout | At 1920px the margin is 380px; at 1000px it becomes a panel above the table; at 375px there is no horizontal scroll |
| 2.9 | Implement whole-page drag with a margin-only click target | Dragging over the table highlights the margin target; clicking the table does not open a file picker |
| 2.10 | Implement `deriveStage` and `stageDetail` per §5.2 | Unit test: `{status:'processing',progress:60,visualPageCount:8}` → `'parsing'` + `'8 scanned pages'`; `progress:80` → `'chunking'` with null detail; `progress:95` → `'embedding'` |
| 2.11 | Build the stage chip with determinate progress and reduced-motion fallback | With reduced motion emulated, an in-flight row shows `62%` as text and no rotation |
| 2.12 | Implement list-level polling with terminal-state and visibility stops | With all rows ready, the network panel shows **zero** requests over 30 s; backgrounding the tab stops polling and returning fires one immediately |
| 2.13 | Implement the upload queue at concurrency 3 | Dropping 8 files shows at most 3 in-flight `POST /api/documents` at any instant in the network panel |
| 2.14 | Implement client pre-flight validation | A `.zip` and a 60 MB PDF both produce toasts without any network request |
| 2.15 | Render every §6.2 backend failure verbatim | A corrupt PDF's row shows the parser's own message, not a rewritten one |
| 2.16 | Implement the duplicate badge | Uploading the same file twice produces a second row marked Ready + Duplicate naming the original |
| 2.17 | Build the document table with all seven columns | An in-progress row shows `—` for Chunks, never `0` |
| 2.18 | Implement search, status filter, and multi-select | Typing `q3` matches `q3.pdf`; selecting two rows enables bulk delete and no bulk re-index control exists |
| 2.19 | Implement re-index with a conditional confirm | Re-indexing a `ready` document asks first and names its chunk count; re-indexing a `failed` one does not ask |
| 2.20 | Implement delete surfacing `deletedPoints` | The toast reads the real count returned by the endpoint |
| 2.21 | Implement the client-side context filter with all three removal markers | `grep -rn "PHASE-6-REMOVE" frontend/src/` returns exactly the sites listed in §7.4 |
| 2.22 | Keyboard and screen-reader pass | The whole page is operable by keyboard; stage changes are announced through an `aria-live="polite"` region; the table has a caption and scoped headers |

---

## 9. Milestone Definition

Phase 2 is **complete** when:

> A signed-in user opens `/contexts` and sees the empty state — a bold headline reading **"No
> contexts yet"** and one button. They click *Create your first context*, type `Q3 Reports`
> and the description `Quarterly earnings`, and submit. The dialog closes and they land
> directly on `/contexts/q3-…`, whose header carries the name and description and whose right
> margin shows an empty drop target listing the accepted formats and the 50 MB cap.
>
> They select four files at once — two ordinary PDFs, one 40-page scanned PDF with no text
> layer, and one file they truncated in a hex editor to corrupt it — and drop them anywhere on
> the page. The margin target highlights as they drag. Four rows appear immediately, each
> reading **Queued**. The network panel shows exactly three `POST /api/documents` requests in
> flight at once; the fourth starts when the first finishes.
>
> Within seconds the rows diverge. The two ordinary PDFs move **Parsing → Chunking →
> Embedding → Ready**, landing on `412` and `88` chunks in tabular monospace. The scanned PDF
> sits at **Parsing** with a second line reading *"40 scanned pages"* and a bar that climbs
> slowly for several minutes — the row is honest about being slow rather than pretending to be
> nearly done — then moves through Chunking and Embedding to **Ready** with a real chunk count
> and a Pages tooltip showing `0 text · 40 visual`. The corrupt file reaches **Failed** and its
> row shows, verbatim, the message the backend classified it with. Its `⋯` menu offers
> *Retry*; the ready ones offer *Re-index* and *Delete*.
>
> One toast summarizes the batch: **"3 documents ready. 1 failed."** From this moment the
> network panel shows **no further requests** — the poll loop stopped when the last row reached
> a terminal state.
>
> They re-drop one of the PDFs they already uploaded. A new row appears and resolves to
> **Ready** with a neutral **Duplicate** badge whose tooltip names the original file. They
> delete it; the toast reads **"q3.pdf deleted. 0 indexed chunks removed."** — zero, correctly,
> because a duplicate row never had its own vectors. They then delete a real document and the
> toast reads **"earnings.pdf deleted. 412 indexed chunks removed."**
>
> They return to `/contexts`, open the `⋯` menu on the `Q3 Reports` card, and choose *Delete*.
> The dialog states exactly what will be destroyed — *"This permanently deletes 3 documents,
> 500 indexed chunks, and 0 conversations."* — and the confirm button stays dead while they
> type `Q3 reports` with a lowercase r. They correct the case, the button enables, and on
> submit the card greys with a *Deleting…* chip before disappearing on the next poll.
>
> Throughout, the theme toggle from Phase 1 flips the entire page — cards, table, chips,
> dropzone, dialogs — between light and dark with no element left on a hardcoded color.

---

## 10. Files to Create

```
frontend/src/
├── api/
│   ├── endpoints/contexts.ts               # list, get, create, update, delete
│   └── mock/fixtures/
│       ├── contexts.ts                     # localStorage-backed context table
│       └── docContexts.ts                  # PHASE-6-REMOVE — client-side doc→context map
└── app/
    ├── pages/contexts/
    │   ├── ContextList.tsx                 # grid, empty state, create entry point
    │   └── ContextDetail.tsx               # header, table, margin, whole-page dropzone
    ├── components/contexts/
    │   ├── ContextCard.tsx                 # card + ⋯ menu + deleting state
    │   ├── ContextFormDialog.tsx           # create / rename / edit description
    │   ├── DeleteContextDialog.tsx         # typed-confirm, real counts
    │   └── ContextMetaPanel.tsx            # margin: counts, dates, last query
    ├── components/documents/
    │   ├── DocumentTable.tsx               # columns, sort, selection, row actions
    │   ├── DocumentRow.tsx
    │   ├── StageChip.tsx                   # §5.3, reduced-motion fallback
    │   ├── stage.ts                        # deriveStage + stageDetail — DELETED in Phase 7
    │   ├── UploadDropzone.tsx              # margin target + whole-page drag
    │   ├── UploadQueue.tsx                 # concurrency 3, optimistic rows, batch toast
    │   ├── DeleteDocumentDialog.tsx
    │   └── ReindexDialog.tsx               # DESIGN.md §7.4 — shown ONLY for a `ready`
    │                                       #   document (§7 above, task 2.19); a `failed`
    │                                       #   one re-indexes without asking
    └── hooks/
        ├── useContexts.ts                  # list + mutations, optimistic updates
        ├── useDocuments.ts                 # list + list-level poll (§5.4)
        └── useUploadQueue.ts               # queue, concurrency, pre-flight validation

frontend/test/
└── stage.test.ts                           # deriveStage band boundaries (task 2.10)
```

**Deleted this phase:** `IngestionZone.tsx` — its drop target, its stage labels, and its
duplicated poll loop are all superseded by `UploadDropzone` + `UploadQueue` + `useDocuments`.
The `/advanced` console that hosted it is itself replaced in Phase 4.

---

## 11. Performance Validation

| Metric | How to Measure | Target |
|---|---|---|
| Idle network traffic, all rows terminal | Network panel over 60 s on a settled context | 0 requests |
| Poll cost, 20 in-flight rows | Network panel | 1 request / 1.5 s total, not 20 |
| Table render, 200 rows | Performance recording of the first paint | < 120 ms; no virtualization needed below 200 rows, and 200 is enforced by the page limit |
| Upload concurrency | Network panel while dropping 8 files | never more than 3 in flight |
| Search input latency | Typing into the filter with 200 rows loaded | < 16 ms per keystroke (debounced filter, not re-fetch) |
| Drag highlight | Performance recording during a dragover | no layout thrash; the highlight is a border-color change, not a size change |

---

## 12. Estimated Complexity

| Component | LOC | Files | New deps |
|---|---|---|---|
| Contexts endpoints + mock | ~280 | 3 | 0 |
| `/contexts` list, card, dialogs | ~620 | 5 | 0 |
| `/contexts` toolbar (search, sort, view switcher) + context tints — §3.1a, §3.1b | ~210 | 2 | 0 |
| `ReindexDialog` — §7.4 | ~70 | 1 | 0 |
| `/contexts/:id` shell + meta panel | ~300 | 2 | 0 |
| Document table, row, stage chip, stage.ts | ~700 | 5 | 0 |
| Upload dropzone + queue + validation | ~430 | 3 | 0 |
| Hooks (contexts, documents, upload queue) | ~360 | 3 | 0 |
| Stage derivation test | ~90 | 1 | 0 |
| **Total** | **~3,060** | **25** | **0** |

`react-dropzone` and every Radix primitive used here are already dependencies.
