# Cerebro — Screen & Feature Specification

> **What this document is.** A complete description of every screen, state, component, and
> interaction in Cerebro v2 — what the interface *contains* and how it *behaves*.
>
> **What it deliberately does not contain.** Colors, typefaces, type scales, spacing values,
> radii, shadows, or any other visual styling. Those are left open so the UI can be generated
> or designed freely against this structure. Where a visual distinction carries *meaning*
> (a retrieved source must be distinguishable from an interactive control), the requirement is
> stated without prescribing how to satisfy it.
>
> **Related documents.** Engineering specs live in [`docs/planning/v2/`](docs/planning/v2/) —
> `architecture.md` for system design and `phase_1..8_*.md` for build order. Where this
> document and a phase doc disagree about layout or copy, **this document wins**; where they
> disagree about data or behavior, the phase doc wins.
>
> **How to use it.** §1–§4 apply everywhere: read once. §5 is the component inventory. §6 is the
> screen catalogue — each entry is self-contained and buildable in isolation. §7–§10 are the
> rules that keep independently-built screens behaving like one product.

---

## Table of contents

| § | Section |
|---|---|
| 1 | [What Cerebro is](#1-what-cerebro-is) |
| 2 | [Information architecture](#2-information-architecture) |
| 3 | [Layout structure](#3-layout-structure) |
| 4 | [Responsive behavior](#4-responsive-behavior) |
| 5 | [Component inventory](#5-component-inventory) |
| 6 | [Screens](#6-screens) |
| 7 | [Dialogs and overlays](#7-dialogs-and-overlays) |
| 8 | [Cross-cutting patterns](#8-cross-cutting-patterns) |
| 9 | [Copy voice](#9-copy-voice) |
| 10 | [Accessibility requirements](#10-accessibility-requirements) |
| 11 | [Screen index](#11-screen-index) |

---

## 1. What Cerebro is

A private, multi-tenant platform where a professional uploads their own documents into isolated
workspaces called **contexts**, asks questions in natural language, and gets answers grounded in
— and cited back to — the exact passages the answer came from.

Beyond that, it exposes its own machinery. For any question the user can inspect the full
execution trace (per-stage latency, what was retrieved, how reranking reordered it, the literal
prompt the model received) and view their document embeddings as a navigable 3D point cloud.

**Who uses it.** Two overlapping people, one interface:

- The **reader** — uploads documents, asks questions, checks citations. Wants confidence.
- The **inspector** — the same person in a different mood, or an engineer, asking *why did it
  answer that?* Wants mechanism.

Both get the same interface. There is no separate "pro mode."

### 1.1 Three product rules that govern the whole interface

**1. Evidence sits beside the claim.** Every content screen is organized so the answer and the
evidence for the answer are visible together, not one behind a link. This is realized as a
consistent spatial rule (§3.2).

**2. Retrieved things are visually distinct from interactive things.** A user must be able to
tell at a glance whether something is "a control I can press" or "a passage the system actually
retrieved." Use two clearly separated visual treatments and apply them consistently — never let
the treatment that marks retrieved evidence appear on a button, a nav item, or decoration. How
that distinction is drawn is a design decision; that it exists and is never muddied is a
product requirement.

**3. A number that wasn't measured is not displayed.** Missing data renders as an em dash, an
explicit "skipped" marker, or a stated unavailable state — never as `0`, never as a plausible
placeholder. A single invented number destroys trust in every other number on the page, which
for an observability product is the entire value proposition. This is elaborated in §8.1.

### 1.2 Tone

Precise, quiet, instrument-like. Closer to a well-set technical document or a lab instrument
than to a consumer chat app or a developer terminal.

Specifically **not**: neon-on-black hacker aesthetic, gradient heroes, playful illustrations,
emoji as UI furniture, or decorative animation.

---

## 2. Information architecture

### 2.1 Routes

| Route | Screen | Access |
|---|---|---|
| `/login` | Sign in | public |
| `/signup` | Create account | public |
| `/forgot-password` | Request a reset code | public |
| `/reset-password` | Enter code, set new password | public |
| `/chat` | Grounded conversation | authenticated |
| `/contexts` | Context list | authenticated |
| `/contexts/:id` | Context detail + document explorer | authenticated |
| `/admin/traces` | Trace list | authenticated |
| `/admin/traces/:id` | Trace detail | authenticated |
| `/admin/vectors` | 3D vector space | authenticated |
| `/admin/health` | Operations | **admin only** |
| `*` | Not found | — |

`/` redirects to `/chat`.

**`/admin/traces` and `/admin/vectors` are not admin-only** despite the path — a normal user
inspects *their own* queries and *their own* embeddings. Only `/admin/health` requires the admin
role.

### 2.2 Navigation

**Amended 2026-08-19.** A persistent left rail on every authenticated screen:

```
◈ CEREBRO
  Grounded answers. Full context.

┌────────────────────────┐
│  +  New chat            │
└────────────────────────┘

  Chat
  Contexts
────────── divider ──────────
  Traces
  Vector space
  Health              ← ADMIN ONLY — omitted entirely for everyone else, [Admin] badge for
                         those who do see it

Recent chats
  EMEA revenue in Q3 2024        10:14 AM
  What drove gross margin down?  Yesterday
  …
  View all chats ›

──────────────────────────
  ⬤ Aarav Rao            ▾
    aarav@acme.com
```

`+ New chat` starts a fresh thread in the active context and is the one prominent action in
the rail (pale `--signal-soft` fill, not a solid button — it sits inside the rail, not above
it as a page-level CTA). **Recent chats** lists threads for the active context, grouped
`Today / Yesterday / Previous 7 days / Older` per §8's cross-cutting pattern, capped to a
handful of rows with a `View all chats ›` link to the full history. The user account panel
(avatar, name, email, chevron opening the `UserMenu`, §5.14) anchors the bottom of the rail.

**There is no standalone "Documents" item.** Every document a user can see belongs to some
context and is reached through `/contexts` → `/contexts/:id` — a global document list would
either duplicate that per-context view or imply documents exist outside any context, which the
data model does not support. If a mockup or a future request adds a "Documents" nav item, that
is a mistake to correct, not a route to build.

The Health item is **absent** for non-admins, not disabled. A disabled control advertises a
capability the user does not have.

A non-admin who navigates directly to `/admin/health` gets the **404 screen**, not a "forbidden"
screen. A forbidden page confirms the route exists and is worth attacking.

### 2.3 What is not in the navigation

No settings screen, no profile screen, no billing, no notifications. Account actions (sign out)
live in the user menu. This is deliberate scope, not an omission.

---

## 3. Layout structure

### 3.1 The application shell

Every authenticated screen shares one frame.

```
┌──────┬─────────────────────────────────────────────────────────────┐
│      │  TOP BAR                                                    │
│ LEFT ├─────────────────────────────────────────────────────────────┤
│ RAIL │                                                             │
│      │                     ROUTE CONTENT                           │
│      │                                                             │
│      │                                                             │
└──────┴─────────────────────────────────────────────────────────────┘
```

**Left rail.** **Amended 2026-08-19: wide and always labeled** (≈260–270px), not a narrow
icon-only dock — the earlier "icon-only, expands on very wide viewports" description is
retired; every screenshot reviewed for this product, from the first reference through the
final auth screens, used the wide labeled form, never the icon dock. Contains the product mark
at top, then `+ New chat`, then the nav items from §2.2, then Recent Chats, then the user
account panel — the full structure is written out in §2.2 rather than duplicated here. The
active nav item is marked both by a visual treatment and by `aria-current="page"`. It collapses
only under real width pressure, per the Narrow/Mobile rows of §4 — never as a "wide viewport"
upgrade path, since wide is now the default.

**Top bar.**

| Slot | Content |
|---|---|
| Left | Context switcher (§5.3). On screens with no context concept: the page name. |
| Right | Health status indicator (§5.13) · Theme toggle (§5.2) · User menu (§5.14) |

**What the top bar must not contain: system metrics of any kind.** No CPU, no RAM, no
throughput, no engine status badges. A browser cannot know the server's CPU, and the metrics
that *could* be real belong on `/admin/health`, not in permanent chrome.

### 3.2 The three-column content grammar

The central structural rule, repeated on every content screen:
**the center holds the answer, the right margin holds the evidence for it.**

```
┌──────┬────────────────────────────────┬──────────────────────┐
│      │           PRIMARY              │   EVIDENCE MARGIN    │
│ NAV  │                                │                      │
│      │  /chat        → transcript     │  citation cards      │
│      │  /traces/:id  → waterfall +    │  raw payload drawer  │
│      │                 rerank matrix  │                      │
│      │  /vectors     → point cloud    │  node inspector      │
│      │  /contexts/:id→ document table │  upload + metadata   │
│      │                                │                      │
│      │          flexible              │      fixed width     │
└──────┴────────────────────────────────┴──────────────────────┘
```

The margin holds **the thing that justifies what is in the center.** It is never a settings
panel, never navigation, never promotional content.

Some screens add a left auxiliary column — `/admin/vectors` has a document legend. That column
is for **filtering what the center shows**, never for evidence.

### 3.3 Content measure

Prose (the chat transcript, descriptions, help text) is constrained to a readable measure.
Data (tables, the waterfall, the point cloud) fills its container. Applying a prose measure to a
data table makes it look like a document; letting prose run full-width on a wide monitor makes
it unreadable.

---

## 4. Responsive behavior

| Viewport | Behavior |
|---|---|
| Very wide | Rail at full width (§3.1). Evidence margin at max width. |
| Wide | Rail at full width. Full three-column. Rerank matrix side-by-side with connectors. |
| Medium | Rail at full width; three-column holds but the margin narrows. Rerank matrix columns stack; connectors are replaced by inline `rank 4 → 1` glyphs. |
| Narrow | **Rail collapses to icon-only** (the one place the retired icon-dock treatment survives — as a narrow-width fallback, not the default). **Evidence margin becomes a collapsible panel above the primary content** — an inline disclosure, expanded by default on `/chat`. Never a hidden off-canvas drawer. |
| Mobile | Rail becomes a bottom tab bar. Margin becomes a bottom sheet opened by a labeled trigger (`3 sources ▾`). Tables become stacked cards. |

**Two absolute rules.**

**The page body never scrolls horizontally at any width.** Wide content — tables, the waterfall,
code blocks, the rerank matrix — scrolls inside its own container.

**Evidence is never hidden.** At every width there is a visible, labeled affordance that reaches
the citations. Evidence the user cannot find is evidence that does not exist.

---

## 5. Component inventory

Each entry gives **anatomy** (what it's made of), **states**, and **behavioral rules**. Built on
accessible primitives — focus trap, roving tabindex, `aria-*` — which must not be hand-rolled.

### 5.1 Buttons

Four variants by role: **primary** (the one main action per screen or dialog), **secondary**
(cancel, alternate actions, OAuth buttons), **ghost** (row actions, icon buttons, toolbar
items), **destructive** (confirm-delete inside dialogs only).

**States.**

| State | Behavior |
|---|---|
| hover | a visible change of treatment |
| focus-visible | a clearly visible focus indicator, always present, never removed |
| disabled | reduced prominence, `cursor: not-allowed`, **and a tooltip stating why** (§8.5) |
| pending | label becomes a present-participle form (`Sign in` → `Signing in…`) with a spinner, **and the button keeps its width** so the layout does not jump |

### 5.2 ThemeToggle

A **three-state** control — Light / Dark / System — not a two-state switch. A switch cannot
represent "follow the system," which is the default state.

Selection persists across reloads. The theme change must complete within one frame with zero
layout shift, which requires that no component hard-codes a color outside the theme system.

### 5.3 ContextSwitcher

Lives in the top bar. A dropdown menu, **not** a native select — it needs a search field, a
scrollable list, a separator, and a create action, none of which a select can hold.

```
Trigger:
┌────────────────────────────────────┐
│  Q3 Reports  · 12 documents     ▾  │
└────────────────────────────────────┘

Open:
┌────────────────────────────────────┐
│  ⌕ Search contexts…                │  ← only when > 7 contexts exist
├────────────────────────────────────┤
│    All contexts                    │  ← only on cross-context screens
├────────────────────────────────────┤
│  ✓ Q3 Reports          12 docs     │  ← active row marked
│    Research Papers     47 docs     │
│    Contracts            3 docs     │
├────────────────────────────────────┤
│  + New context                     │
└────────────────────────────────────┘
```

The search field appears **only above 7 contexts** — a search box over three items is noise.

**`All contexts` — added 2026-08-19.** A scope value, not a context. It renders **only on
screens that can genuinely operate across every context**: `/contexts` (the list itself) and
`/admin/traces` (a user inspecting all of their own queries). It is **absent** on `/chat`,
`/contexts/:id`, `/admin/traces/:id`, and `/admin/vectors`, all of which require exactly one
context to mean anything — a chat turn retrieves against one corpus, a point cloud is one
projection. Selecting it sets the scope to all contexts and, on a screen where it is absent,
is not a reachable state at all rather than a state that silently falls back to the first
context. Its trigger label reads **"All contexts"** with **no document count** — a summed
count across contexts is a number nobody asked for and would imply a single searchable corpus
that does not exist.

`+ New context` opens the ContextFormDialog (§7.1) in place and **does not navigate away** —
the point of quick-create is that the user was mid-thought.

Contexts with status `deleting` are excluded from the list.

### 5.4 StageChip

A document's position in the ingestion lifecycle. Used in the document table.

| Stage | Marker | Label | Progress bar |
|---|---|---|---|
| `queued` | hollow / inactive | Queued | none — nothing is happening yet |
| `parsing` | in-progress | Parsing | determinate |
| `chunking` | in-progress | Chunking | determinate |
| `embedding` | in-progress | Embedding | determinate |
| `ready` | complete | Ready | none |
| `failed` | error | Failed | none |

**Anatomy.** A status marker + a text label + (when in progress) a determinate progress bar at
the real value, plus an optional second line of detail text built from real data (e.g.
`40 scanned pages`).

**Requirements.**
- The stage must be conveyed by **both** a marker and a word — never by color alone.
- Under reduced motion, any in-progress animation stops and the chip shows the percentage as
  text. The user still needs to know work is in flight.
- A `duplicate` document renders as **Ready** plus a `Duplicate` badge, styled as *evidence*
  (a statement about what the system found in its index) rather than as an interactive element.

### 5.5 BranchChip

Which retrieval branch produced a candidate: `dense` (semantic match), `sparse` (keyword match),
`both`, or `colpali` (visual page match). Appears in citation cards and the rerank matrix.

**Always carries its text label.** Color alone must not convey the branch.

### 5.6 CitationAccordion

The most important component in the product. Lives in the evidence margin.

```
Collapsed:
┌────────────────────────────────────────────────┐
│ ▸ ①  q3-earnings.pdf                    0.87   │
│      Revenue › Regional breakdown              │
└────────────────────────────────────────────────┘

Expanded:
┌────────────────────────────────────────────────┐
│ ▾ ①  q3-earnings.pdf                    0.87   │
│      Revenue › Regional breakdown · page 12    │
│   ┌──────────────────────────────────────────┐ │
│   │ "EMEA revenue for the third quarter was  │ │  ← the exact retrieved
│   │  $4.2M, up from $3.8M in Q2…"            │ │    chunk text
│   └──────────────────────────────────────────┘ │
│   [DENSE+SPARSE]  rank 4 → 1          ⧉ copy   │
└────────────────────────────────────────────────┘
```

**Anatomy.**

| Element | Content |
|---|---|
| Index badge | The citation number. The only numeric identity the user needs; matches the `[1]` in the answer text. |
| Filename | Truncated with ellipsis. |
| Score | Two decimals; four in the tooltip. Labeled **"rerank score"** — never "confidence." A cross-encoder score is not a probability and calling it confidence is a claim the number cannot support. |
| Location line | Heading path (`Revenue › Regional breakdown`), page number, or section anchor. |
| Quote block | The exact chunk text, visually set apart as retrieved evidence. |
| Rank movement | `rank 4 → 1` with the delta. This is the single most informative fact about a retrieval and it costs one line. |
| Page thumbnail | **Scanned-page sources only.** Clickable to a lightbox (§7.6). Text sources show **no image placeholder**. |
| Copy | Copies the chunk text, not the filename. |

**Linkage with the answer.** Hovering `[1]` in the answer highlights accordion 1; hovering the
accordion highlights every `[1]` in the answer. Clicking `[1]` scrolls the accordion into view
and expands it. A `[N]` whose number exceeds the source count renders as **plain text** — the
model occasionally cites a number it wasn't given, and a button that scrolls to nothing is worse
than an unstyled bracket.

**Three body states.**

1. **Live turn** — full quote text.
2. **Resumed conversation** — header, score, and thumbnail render; the body reads **"Text isn't
   stored for past conversations."** Not silently collapsed, not shown empty.
3. **Deleted source** — the whole card is de-emphasized and the filename suffixed `(deleted)`.
   It is **never removed**: the historical answer genuinely was grounded in it, and erasing the
   citation would misrepresent the record.

### 5.7 ProvenanceRibbon

The pipeline's measured latencies compressed to a single proportional strip. Appears under every
completed answer, atop every trace detail, and as each row of the trace list.

**One component, three densities.** Building it once is what makes it a recurring motif rather
than three separate latency visualizations.

```
  ┌──┬────────┬─┬──────────┬────────────────────────────────────┐
  └──┴────────┴─┴──────────┴────────────────────────────────────┘
   embed retrieve merge rerank            generate

  2,480ms · 3 sources · dense+sparse                  View trace ›
```

**Anatomy.** A thin track with one segment per measured stage, proportional to duration.
Beneath: total duration, source count, branch summary, and a `View trace ›` link.

**Three rules that make it honest.**

1. **Segment position comes from the measured start offset**, never from stacking durations.
2. **Segments deliberately do not sum to the total.** The gaps are real unaccounted time (node
   transitions, prompt assembly, persistence). The tooltip says so, so a reader does not mistake
   a gap for a rendering bug.
3. **A skipped stage contributes no segment at all** — it is listed in the tooltip as *skipped*
   with its reason. There is no honest position for a stage that did not run.

**Four states.**

| Turn state | Ribbon |
|---|---|
| streaming | an indeterminate track with **no numbers** — none have arrived yet |
| complete | the full ribbon; `View trace ›` enabled |
| refused | the full ribbon with `0 sources`; `View trace ›` **enabled** — a refusal is one of the most interesting things to inspect |
| error | **no ribbon** — nothing was measured |

It does not animate segments into place. The numbers were always what they were; animating them
would imply they were being measured live.

### 5.8 Waterfall

The expanded form of the ribbon, on the trace detail screen.

```
                0ms                                             2,480ms
  CONDENSE      │▨▨▨▨▨▨ skipped — first turn ▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨▨│
  EMBED         │  ▐▐▐▐▐▐▐▐▐▐▐                                 │   210ms
  SPARSE        │  ▐                                           │     3ms
  COLPALI       │  ▐▐▐▐▐▐▐▐                                    │   142ms
                │  └ parallel                                  │
  RETRIEVE      │             ▐▐▐▐▐▐▐▐▐                        │   180ms
  MERGE         │                      ▐                       │     2ms
  RERANK        │                       ▐▐▐▐▐▐▐▐▐▐▐▐           │   240ms
  GENERATE      │                                  ▐▐▐▐┋▐▐▐▐▐▐ │ 1,710ms
                │                                      ┋ first token 610ms
                └──────────────────────────────────────────────┘
  total 2,480ms · 138ms unaccounted (node transitions, prompt assembly)
```

**Anatomy per row.** A stage label · a bracket gutter used to group stages that ran in parallel ·
a flexible track · a right-aligned duration.

**Requirements.**

- A **skipped** stage gets a hatched band across the full track width with its reason inline —
  never a zero-width bar, never a positioned bar at a guessed offset.
- The `generate` bar carries a **first-token marker** with a label.
- The footer states the total **and** the unaccounted time **with its explanation**. Making the
  gap explicit turns it from an apparent bug into the most interesting number on the chart.
- A minimum bar width so a genuinely sub-millisecond stage renders as a visible sliver — it
  *was* measured, unlike a skip.

### 5.9 RerankMatrix

Side-by-side comparison of what retrieval found versus what reranking kept.

```
  RETRIEVED (fusion order)          →     RERANKED (final order)
  ┌────────────────────────┐              ┌────────────────────────┐
  │ 1  q3.pdf p12   [BOTH] │───────┐      │ 1  q3.pdf p12   0.87   │
  │ 2  notes.md §2  [SPRS] │────┐  └─────▶│ 2  q3.pdf p14   0.71 ▲+2│
  │ 3  q3.pdf p9    [DNSE] │──┐ │         │ 3  notes.md §2  0.44 ▼−1│
  │ 4  q3.pdf p14   [DNSE] │  │ └────────▶│ 4  q3.pdf p9    0.31 ▼−1│
  │ 5  scan.pdf p3  [COLP] │  └──────────▶│ ── relevance floor 0.15 ─│
  │ …                      │              │ ✕  scan.pdf p3  0.09    │
  └────────────────────────┘              └────────────────────────┘
       18 candidates                       4 survived · 14 below floor
```

**Connectors** are curves between the columns, visually distinguishing a promotion from a
demotion, at reduced opacity so eighteen of them do not become a solid block. Hovering a row
raises its own connector and dims the rest.

**The relevance floor** is an explicit labeled rule carrying its own value. Candidates below it
are shown **struck through, not omitted** — what was rejected is at least as informative as what
survived.

**Degraded state.** When reranking was unavailable, the right column renders as a single
message — **"Reranking was unavailable; results are in fusion order."** — and **no scores**.
Synthesizing a reranked order from fusion ranks would be exactly the failure this console exists
to expose.

On narrow viewports the columns stack and connectors are replaced by inline `rank 4 → 1` glyphs.

### 5.10 DocumentTable

| Column | Content | Sortable |
|---|---|---|
| Name | file-type glyph + filename, truncated **middle-out** so the extension stays visible | yes |
| Size | formatted bytes | yes |
| Stage | StageChip (§5.4) + detail line + progress | no |
| Chunks | count when ready, `—` otherwise | yes |
| Pages | count, with the text/visual split in the tooltip | no |
| Added | relative time, absolute in `title` | yes, default desc |
| ⋯ | row action menu | — |

**`—` for an unknown value, never `0`.** A document mid-ingest genuinely has no chunk count;
zero would be a claim.

**Row actions:** *Re-index* · *Delete* · *Copy document ID*.

**Selection** via a header checkbox enables **bulk delete only**. Bulk re-index is deliberately
absent — re-indexing 40 documents is twenty minutes of paid provider calls behind one click,
with no undo.

On mobile each row becomes a stacked card: filename as the title, stage below, remaining fields
as label/value pairs.

### 5.11 EmptyState

```
           No contexts yet
    A context holds a set of documents you want
    to ask questions about. Most people start
    with one per project.

         [ Create your first context ]
```

Centered in its container. **One action, never two.** No illustration — the empty state is an
invitation to act, and the action is the only thing in it.

### 5.12 Unavailable

Distinct from EmptyState, and the distinction matters. **Empty** = the system answered and there
is nothing. **Unavailable** = the system cannot answer yet.

```
   ┌─────────────────────────────────────────────────┐
   │  ⓘ  Trace history is recorded from Phase 7.     │
   │     The trace for your most recent query is     │
   │     available from the chat ribbon.             │
   │                                        [ Chat ] │
   └─────────────────────────────────────────────────┘
```

States what is missing in plain words and, where one exists, offers the path that does work.
**Never a placeholder chart, never a skeleton that never resolves, never invented numbers.**

### 5.13 HealthIndicator

A compact status marker in the top bar with three states (healthy / degraded / down). Its
tooltip lists every dependency with its real measured latency. Polls every 30 seconds.

### 5.14 UserMenu

Trigger: an avatar (image, or initials). Menu: name, email, an **admin** chip when the role
applies, a divider, then *Sign out*.

### 5.15 Toast

Corner-anchored, dismissible, with a severity indication. Auto-dismisses for success; **never**
auto-dismisses for errors. **One toast per batch operation, not one per item.**

### 5.16 Form fields

Label · input · optional help text. Error messages appear below the input with `role="alert"`.

**Requirements are stated before the user types**, not revealed as an error afterward:
**"At least 12 characters. Longer is better than more complicated."**

### 5.17 PasswordField

A form field plus a show/hide toggle that is a **real `<button>` with `aria-pressed`** — not a
div with a click handler.

On signup it adds a **three-segment strength meter** driven by length and character variety. The
meter is **advisory**: it never blocks submission except on the length minimum, because the real
check (a breached-password list) runs server-side, and a client pretending to enforce it would
be lying about the guarantee.

### 5.18 OtpInput

Six single-character boxes that behave as **one logical field**.

```
   ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐ ┌───┐
   │ 4 │ │ 1 │ │ 8 │ │   │ │   │ │   │
   └───┘ └───┘ └───┘ └───┘ └───┘ └───┘
```

Requirements:
- One `aria-label="Verification code"` on the group.
- `autocomplete="one-time-code"` — this is what makes iOS and Android offer the code from the
  SMS notification.
- `inputmode="numeric"`.
- Pasting a 6-digit string distributes across all six boxes.
- Backspace on an empty box moves focus left.
- Auto-submits when the sixth character is entered.
- Errors announced through an `aria-live="polite"` region — a visual-only error on a field that
  auto-submits is invisible to a screen reader.

### 5.19 Composer (chat input)

An auto-sizing textarea (1–8 rows) with a send button.

Enter sends, Shift+Enter newlines; the hint shows on first visit only. Files dropped on it upload
into the active context and appear as chips with live stage labels. During streaming the send
button is replaced by **Stop**.

### 5.20 PointCloud

A WebGL canvas filling its container.

| Element | Behavior |
|---|---|
| Nodes | one per chunk, colored per document, size scaled by perspective, alpha faded by depth so distant points recede rather than forming a flat wall |
| Beacon | the projected query position, visually marked as *retrieved evidence* and the only object in the scene using that treatment |
| Neighbor links | lines from beacon to nearest neighbors, fading by rank |
| Retrieved vs. kept | a neighbor that survived the relevance floor is marked with a ring; one retrieved but cut is enlarged **without** a ring. **This distinction is the most interesting thing the beacon can show**, and it must be a shape difference, not a color difference |
| Controls | orbit (drag), zoom (wheel), pan (right-drag), all damped, with camera distance bounded so the camera can neither fly inside the cloud nor be lost outside it. A *Reset view* control restores the initial framing |
| Status line | `5,412 chunks · 12 documents · fitted 2h ago` |

**No auto-rotation.** A slowly spinning point cloud is the genre's most common decorative tell
and it actively interferes with reading cluster structure.

---

## 6. Screens

Every entry is self-contained: purpose, structure, every state, and verbatim copy. Copy shown in
**bold quotes** is the literal string to render.

---

### 6.1 `/login` — Sign in

**Access:** public. **On success:** redirect to the captured return path, or `/chat`.

**Amended 2026-08-19: split-screen layout, superseding the centered-card-only version below
this note.** The original rule — a single centered card, no hero, no illustration, "the
product's whole thesis is that it does not decorate what it cannot prove, and that starts
here" — is retired for the auth surface specifically. The reasoning for the reversal: no
"proof" exists before sign-in (there are no citations, no retrieved evidence, nothing the
decorate-what-it-can't-prove thesis is protecting yet), so the thesis doesn't bind the same
way here, and every reference screen for this surface — `/login`, `/signup`,
`/forgot-password`, `/reset-password` — consistently uses the split-screen form, confirmed as
the deliberate direction, not four accidents.

```
┌──────────────────────────────────────────────────────────────────────────┐
│  ◈ CEREBRO                                    Don't have an account?     │
│  Grounded answers. Full context.                    Sign up  ☾/☀        │
│                                                                          │
│  Answers you can trust,                    ┌────────────────────────┐  │
│  grounded in your data.                    │  Welcome back           │  │
│                                             │  Sign in to your        │  │
│  Upload your documents, ask questions,     │  Cerebro account        │  │
│  and get answers backed by the exact       │                         │  │
│  passages that matter.                     │  Email                  │  │
│                                             │  ┌───────────────────┐  │  │
│  ▢ Cited answers                           │  └───────────────────┘  │  │
│    Every answer is linked to the exact     │  Password  Forgot pw?   │  │
│    source.                                 │  ┌───────────────────┐  │  │
│                                             │  └───────────────────┘  │  │
│  ▢ Full transparency                       │  ☐ Remember me          │  │
│    Inspect retrieval, rankings, prompts,   │  ┌───────────────────┐  │  │
│    and model behavior.                     │  │      Sign in      │  │  │
│                                             │  └───────────────────┘  │  │
│  ▢ Explore your data                       │  ──── or continue ────  │  │
│    Visualize document embeddings in        │  ┌───────────────────┐  │  │
│    interactive 3D.                         │  │ Sign in with Google│ │  │
│                                             │  └───────────────────┘  │  │
│  ▢ Private & secure                        │  Don't have an account? │  │
│    Your data stays isolated and            │           Sign up       │  │
│    encrypted.                              └────────────────────────┘  │
│                                                                          │
│  © 2024 Cerebro. All rights reserved.   Privacy · Terms · Security      │
└──────────────────────────────────────────────────────────────────────────┘
```

**Layout.** Two columns. **Left** (≈48–50% width): the product mark and tagline at the top,
a two-line headline with the second line in `--signal`, one supporting paragraph, four feature
rows (icon-in-a-tinted-square, title, one-line description), and a footer (copyright +
`Privacy · Terms · Security`) pinned to the bottom. **The four rows are context-specific, not
identical across screens** — `/login` and `/signup` use the product-level set (*Cited answers
· Full transparency · Explore your data · Private & secure*, order varies between the two);
`/forgot-password` and `/reset-password` use a reset-specific set instead (*Secure recovery ·
Private by design · You're in control · Need help?*), since "explore your data in 3D" is not a
relevant claim to make to someone who can't sign in. **Right** (≈50–52% width): the
auth card, vertically centered. The whole page sits on the `AtmosphericBackground` (below).
This is the one place in the product where the primary column is not "the answer" and the
right column is not "the evidence for it" — §3.2's three-column grammar does not apply to
public auth screens, which are outside the authenticated shell entirely.

**AtmosphericBackground.** A page-level (never card-level) treatment: a very low-opacity
radial wash plus a faint network/dot pattern (sparse nodes, thin connecting lines), concentrated
toward the lower-left and fading toward the edges. It sits behind all content, never touches
text contrast, and is the one deliberate exception to §1.2's "no gradient heroes" rule — it is
restrained enough (opacity low, no saturated color, no illustration of anything) that it reads
as atmosphere, not decoration, the same distinction the rest of this document draws between a
data point and a data point's frame. Applies to `/login`, `/signup`, `/forgot-password`,
`/reset-password` only; the authenticated shell has no equivalent.

**Header.** A slim top strip above both columns: the product mark at the far left (**not**
repeated inside the left column's hero block — it appears once, at the page level), and at the
far right a single contextual link (**"Don't have an account? Sign up"** on `/login`,
**"Already have an account? Sign in"** on `/signup`, **"Back to sign in"** on
`/forgot-password` and `/reset-password`) plus the `ThemeToggle` (§5.2). **No `UserMenu`, no
avatar** — these are public, signed-out routes.

**The email/password form renders first, OAuth second — corrected 2026-08-19.** The retired
centered-card version put OAuth first as "the path the product treats as primary." The
split-screen reference screenshots consistently order it the other way: Email → Password
(with an inline **"Forgot password?"** link next to the Password label) → a **Remember me**
checkbox → the **Sign in** submit button → a **"or continue with"** divider → one button per
**configured** OAuth provider → a footer link (**"Don't have an account? Sign up"**, repeating
the header link from inside the card). An unconfigured provider is **absent**, never a button
that fails. This is a real reversal of which path the product treats as primary, not a
cosmetic reorder — recorded here rather than silently applied, since "OAuth first" was a
deliberate earlier decision.

**Fields.** Email: `type="email"`, `autocomplete="username"`, `inputmode="email"`.
Password: `autocomplete="current-password"`, PasswordField with show/hide.

**States.**

| State | Rendering |
|---|---|
| default | as drawn |
| submitting | Primary shows **"Signing in…"** with a spinner, keeps its width; fields disabled |
| bad credentials | Form-level error: **"That email and password don't match an account."** — identical for a wrong password and a nonexistent account |
| rate limited | **"Too many attempts. Try again in 12 minutes."** |
| field error | inline under the input, `role="alert"` |
| backend unreachable | replaces the whole card with the unreachable screen (§6.12) |

The failed-sign-in copy does not say which of the two was wrong, and it does not apologize.

---

### 6.2 `/signup` — Create an account

Same split-screen shell as `/login` (§6.1), right-column card content differs. The left
column's four feature rows may render in a different order than `/login`'s (e.g. *Private &
secure* first instead of last) — the set of four is fixed, the order is not load-bearing.
Differences from `/login`'s card:

- Heading **"Create your account"**, sub-line **"Join Cerebro and start asking questions about
  your documents."** — **corrected 2026-08-19** to match the reference screenshot; the earlier
  *"Private workspaces for your own documents."* sub-line predates the split-screen review and
  is retired.
- Adds an optional **Name** field (`autocomplete="name"`), placed first.
- Password uses PasswordField **with the strength meter** and `autocomplete="new-password"`.
- Requirement text sits under the field *before* the user types: **"At least 12 characters.
  Longer is better than more complicated."** **Confirmed final 2026-08-19**, discarding a
  reference mockup that showed an 8-character minimum plus a hard checklist (length / number /
  uppercase, each with its own checkmark) — that pattern is explicitly rejected: the strength
  meter is **advisory only** and blocks submission **only on the length minimum**; the real
  check is a server-side breached-password list (§5.17), and a checklist implying the client
  enforces character-class rules would misrepresent what's actually guaranteed.
- Primary action: **"Create account"**.
- Footer: **"Already have an account? Sign in"**.

**One extra state: submitted, no session returned.** This means the address already exists — the
server responds identically either way, deliberately, so the client cannot tell. Route to
`/login` with a banner: **"An account already exists for that address. Sign in, or reset your
password."**

---

### 6.3 `/forgot-password` — Request a code

Same split-screen shell (§6.1); the right-column card adds a centered icon-in-a-circle
(a lock/security glyph) above its heading, which `/login` and `/signup` don't use — this
icon-in-circle treatment is shared between `/forgot-password` and `/reset-password`
specifically, since both are "action" cards rather than the plain heading-only cards of
`/login`/`/signup`.

**Left column, this screen only.** Headline **"Reset your password"** / **"we've got you."**
(second line in `--signal`), supporting line **"Enter your work email and we'll send you a
link to reset your password."**, and the reset-specific feature set from §6.1: **Secure
recovery** ("Password reset links expire for your protection."), **Private by design** ("Your
data stays isolated and encrypted."), **You're in control** ("Reset your password quickly and
get back to your work."), **Need help?** ("Contact our support team if you run into any
issues.").

```
                              ┌────────────────────────────────────┐
                              │              (⊙ lock)               │
                              │      Forgot your password?          │
                              │  No worries. Enter your work email  │
                              │  and we'll send you a secure link   │
                              │  to reset it.                       │
                              │                                     │
                              │  Work email                        │
                              │  ┌───────────────────────────────┐  │
                              │  └───────────────────────────────┘  │
                              │  ┌───────────────────────────────┐  │
                              │  │        Send reset link         │ │
                              │  └───────────────────────────────┘  │
                              │  ──── Remembered your password? ──  │
                              │  ┌───────────────────────────────┐  │
                              │  │         Back to sign in        │ │
                              │  └───────────────────────────────┘  │
                              └────────────────────────────────────┘
```

**Corrected 2026-08-19** to match the reference screenshot: heading is *"Forgot your
password?"* (not *"Reset your password"*, which belongs to the left column's headline, not the
card), field label is **"Work email"** (not "Email"), the submit button reads **"Send reset
link"** (not "Send code" — "code" is `/reset-password`'s language once the OTP step is
reached, not this screen's), and **"Back to sign in"** renders as a full-width secondary
button below a **"Remembered your password?"** divider, not a bare text link.

A channel selector (`( • ) Email` / `( ) Text message`) is **rendered only when more than one
OTP channel exists** — `capabilities.otpChannels`. A single-channel (email-only) deployment,
which is what the reference screenshot shows, renders no selector at all; this is why it does
not appear above.

**The response is always the same** whether or not the account exists. Navigate to
`/reset-password` and show:

> **Check your email.**
> If an account exists for `t••••@gmail.com`, a 6-digit code is on its way. It expires in 10
> minutes.

The masked address is passed in router state, **not the query string** — a masked address in a
URL ends up in browser history and server logs.

---

### 6.4 `/reset-password` — Enter the code, set a new password

Same split-screen shell (§6.1), same icon-in-circle card treatment as `/forgot-password`
(§6.3). The most stateful screen in the product. Build it as an explicit state machine below —
`AWAITING_CODE` and `SETTING_PASSWORD` are **mutually exclusive at runtime**; a reference
mockup showing the OTP boxes and the password form together in one screenshot was an
illustration of the whole flow, not a real simultaneous state. The resend control
(`Resend code (58s)`) stays positioned directly under the OTP row, paired with the expiry
countdown, and renders visibly disabled for the 60-second cooldown — not a free-standing,
always-enabled link elsewhere on the card.

```
        entry with no identifier in router state → redirect to /forgot-password
                                   │
                                   ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ AWAITING_CODE                                                    │
  │                                                                  │
  │   Enter your code                                                │
  │   Sent to t••••@gmail.com                                        │
  │                                                                  │
  │   ┌───┐┌───┐┌───┐┌───┐┌───┐┌───┐        ← OtpInput (§5.18)       │
  │   └───┘└───┘└───┘└───┘└───┘└───┘                                 │
  │                                                                  │
  │   Expires in 9:47              Resend code (58s)                 │
  │                     ↑ live countdown    ↑ disabled for 60s       │
  └───┬──────────┬───────────────┬───────────────┬──────────────────┘
      │ 6 chars  │ wrong code    │ 5 failures    │ countdown hits 0
      ▼          ▼               ▼               ▼
  VERIFYING   AWAITING_CODE   LOCKED          EXPIRED
  (inputs     attempts−−,     "Too many       "That code expired.
   disabled,  boxes clear,     attempts.       Request a new one."
   spinner)   focus box 1,     Request a new   → resend enabled
              aria-live         code."          immediately
      │                        → boxes hidden,
      │ success                  resend only
      ▼
  ┌─────────────────────────────────────────────────────────────────┐
  │ SETTING_PASSWORD                                                 │
  │   New password        [PasswordField + strength meter]           │
  │   Confirm password    [compared on BLUR, not per keystroke]      │
  │   ┌──────────────────────────────────┐                           │
  │   │      Update password             │                           │
  │   └──────────────────────────────────┘                           │
  │                                                                  │
  │   A page reload discards the reset token and returns to          │
  │   /forgot-password. This is correct: a single-use credential      │
  │   must not survive a refresh.                                    │
  └───┬─────────────────────────────────────────────────────────────┘
      │ success
      ▼
  DONE → toast "Password updated." → navigate to /login with replace,
         so Back does not return to a dead reset screen
```

**Copy per terminal state.** Interface voice — states the problem and the fix, no apology.

| State | Copy |
|---|---|
| wrong code | **"That code isn't right. {n} attempts left."** |
| expired | **"That code expired. Request a new one."** |
| locked | **"Too many attempts. Request a new code to try again."** |
| resent | **"New code sent."** — a toast, not a banner: it does not change what the user does next |
| network down | **"Cerebro is not reachable. Your code is still valid — try again in a moment."** |

The attempts-remaining count appears **only after the first failure**. Showing "5 attempts
remaining" before any attempt reads as a threat.

---

### 6.5 `/contexts` — Context list

**Access:** authenticated. **Purpose:** manage workspaces.

```
┌──────┬─────────────────────────────────────────────────────────────┐
│      │ [All contexts]                                    ⚙ ☾ (TR)  │
│ NAV  ├─────────────────────────────────────────────────────────────┤
│      │                                                             │
│      │  Contexts                             ┌────────────────┐    │
│      │  Each context is a separate,          │  + New context │    │
│      │  private document collection.         └────────────────┘    │
│      │  ─────────────────────────────────────────────────────────  │
│      │  ┌───────────────┐ ┌───────────────┐ ┌───────────────┐      │
│      │  │ Q3 Reports  ⋯ │ │ Research    ⋯ │ │ ● Deleting…   │      │
│      │  │               │ │ Papers        │ │ Scratch       │      │
│      │  │ Quarterly     │ │ ML papers,    │ │ —             │      │
│      │  │ earnings      │ │ 2024–25       │ │               │      │
│      │  │ ───────────── │ │ ───────────── │ │ ───────────── │      │
│      │  │ Documents  12 │ │ Documents  47 │ │ Documents   0 │      │
│      │  │ Chunks  1,840 │ │ Chunks  9,102 │ │ Chunks      0 │      │
│      │  │ Updated 2d ago│ │ Updated 1h ago│ │ Updated  now  │      │
│      │  └───────────────┘ └───────────────┘ └───────────────┘      │
│      │              responsive auto-fill grid                       │
└──────┴─────────────────────────────────────────────────────────────┘
```

**Card contents.** Title · description (with space reserved so cards with and without one
align) · a divider · three label/value rows where the values are right-aligned so a row of
cards has aligned numbers.

The whole card is a link; the `⋯` button stops propagation. Keyboard: the card is the tab stop
and Enter opens it; a second Tab reaches the menu. The `⋯` menu holds *Rename* · *Edit
description* · divider · *Delete*.

**Deleting state.** De-emphasized, **not clickable**, with a `● Deleting…` pill above the title.
The list polls every 2 seconds until the row disappears. Never silently absent (reads as data
loss); never still clickable (would 404 mid-delete).

**Empty state.**

> **No contexts yet**
> A context holds a set of documents you want to ask questions about. Most people start with one
> per project.
> `[ Create your first context ]`

---

### 6.6 `/contexts/:id` — Context detail and document explorer

```
┌──────┬──────────────────────────────────────┬────────────────────┐
│      │ [Q3 Reports ▾]                       │        ⚙ ☾ (TR)    │
│ NAV  ├──────────────────────────────────────┴────────────────────┤
│      │  Q3 Reports                        ⋯ │  ┌──────────────┐  │
│      │  Quarterly earnings                  │  │      ⇪       │  │
│      │  ─────────────────────────────────── │  │  Drop files  │  │
│      │  [⌕ search]  [Status ▾]  12 documents│  │      or      │  │
│      │  ┌─────────────────────────────────┐ │  │    browse    │  │
│      │  │NAME     SIZE  STAGE  CHUNKS  ⋯ │ │  └──────────────┘  │
│      │  ├─────────────────────────────────┤ │  PDF DOCX TXT MD   │
│      │  │q3.pdf  2.4MB  Ready    412   ⋯ │ │  CSV XLSX JSON     │
│      │  │scan.pdf 8.1MB Parsing   —    ⋯ │ │  Up to 50 MB       │
│      │  │        40 scanned pages ▓▓▓░░░ │ │  ────────────────  │
│      │  │notes.md  14KB Ready      22  ⋯ │ │  Created 12 Mar    │
│      │  │bad.pdf  1.2MB Failed     —   ⋯ │ │  1,840 chunks      │
│      │  │  Document contains no          │ │  Last query 2d ago │
│      │  │  extractable text…      [Retry]│ │                    │
│      │  └─────────────────────────────────┘ │                    │
└──────┴──────────────────────────────────────┴────────────────────┘
```

**The whole page is a drop target.** Dragging anywhere over the content area highlights the
margin target; only the target itself is clickable.

**Failed row.** Expands inline to show the backend's classified error message **verbatim**, with
a *Retry* action. The server's text is already written for a human (*"Document contains no
extractable text and no renderable pages."*); rewriting it on the client would create two sources
of truth for one failure.

**Upload behavior.**

- Client pre-flight rejects unsupported extensions and oversized files **before any request**,
  with a toast naming the file and the reason.
- Uploads run at **concurrency 3** — never more in flight at once.
- Optimistic rows appear immediately at the top with an indeterminate progress state.
- **One summary toast per batch:** **"3 documents ready. 1 failed."** — not four toasts.

**Polling.** The page polls the document **list** (one request), not one request per row, every
1.5 seconds **while any row is non-terminal**, and stops entirely when all rows are settled. A
settled page generates zero network traffic. Backgrounding the tab pauses the loop; returning
fires one poll immediately.

**Filters.** Search filters filenames as you type (debounced). Status filter:
All / Ready / In progress / Failed.

**Empty state:** **"{name} is empty"** / **"Drop a document here to start asking questions about
it."**

---

### 6.7 `/chat` — Grounded conversation

The product's primary surface.

```
┌──────┬────────────────────────────────────────┬────────────────────┐
│      │ [Q3 Reports · 12 documents ▾]          │        ⚙ ☾ (TR)    │
│ NAV  ├────────────────────────────────────────┴────────────────────┤
│      │                                        │  SOURCES           │
│      │        ┌──────────────────────────┐    │  ┌──────────────┐  │
│      │        │ What was EMEA revenue    │    │  │▾ ① q3.pdf .87│  │
│      │        │ in Q3?                   │    │  │  Revenue ›   │  │
│      │        └──────────────────────────┘    │  │  Regional    │  │
│      │                                        │  │ ┌──────────┐ │  │
│      │  EMEA revenue in Q3 2024 was $4.2M[1], │  │ │"EMEA rev…│ │  │
│      │  up from $3.8M in Q2[1]. This is       │  │ └──────────┘ │  │
│      │  roughly 10% higher than APAC[2].      │  │ [BOTH] 4 → 1 │  │
│      │                                        │  └──────────────┘  │
│      │  ┌──┬────┬─┬────┬──────────────────┐   │  ┌──────────────┐  │
│      │  └──┴────┴─┴────┴──────────────────┘   │  │▸ ② q3.pdf .71│  │
│      │  2,480ms · 3 sources    View trace ›   │  └──────────────┘  │
│      │                                        │  ┌──────────────┐  │
│      │  ↻ Regenerate                          │  │▸ ③ notes .44 │  │
│      │                                        │  └──────────────┘  │
│      ├────────────────────────────────────────┤                    │
│      │ ( Ask about Q3 Reports…            ) ▶ │                    │
└──────┴────────────────────────────────────────┴────────────────────┘
```

**Turn structure.** Question bubble (right-aligned) → answer body → ProvenanceRibbon →
*Regenerate* (last completed turn only).

**Answer rendering** supports full Markdown, GFM tables, **syntax-highlighted code blocks** with
a language label and a copy button, and **rendered LaTeX** for inline and display math.

The code copy button must be visible **on hover and on focus** — a hover-only reveal is
unreachable by keyboard.

**Three rules specific to streaming.**

1. Unclosed constructs are auto-closed while streaming, so a half-arrived code fence renders as
   a proper fenced block rather than swallowing the rest of the answer.
2. Currency in prose (`$4.2M`) must **not** be treated as math. Inline-math handling applies only
   when the buffer already contains a complete `$…$` pair.
3. **Markdown images are not rendered** — they resolve to their alt text. A `![](…)` inside
   retrieved document text is untrusted content pointing at an arbitrary URL, and rendering it is
   an outbound request from an authenticated browser.

**Streaming caret.** A caret at the end of the answer while tokens arrive. Under reduced motion
it stops blinking and stays solid — the user still needs to know the answer is arriving. It is
never written into the stored answer text.

**Wide tables** inside an answer scroll inside their own container; the page never scrolls
sideways.

**Refusal turns get their own treatment.** When nothing cleared the relevance floor, the answer
renders in a muted style with **no citation margin** (there is nothing to cite), **no
Regenerate** (re-running produces the identical fixed string and costs a retrieval), and an
inline suggestion to add a document or widen the scope. The ribbon **is** shown — retrieval
genuinely ran, and its timings are real.

**Threads live in the global rail, not in a second panel — corrected 2026-08-19.** This
section previously specified a *"collapsible panel left of the transcript"* holding the thread
list. That was written before §2.2's rail amendment, which puts **Recent chats** in the global
left rail on every authenticated screen. Two thread lists would be one too many, and no
reference screen shows a second panel on `/chat`. The rail's Recent Chats **is** the thread
list: threads for the active context, grouped **Today / Yesterday / Previous 7 days / Older**,
with inline rename and a single-step delete confirm that states the message count. `/chat`
therefore has no thread panel of its own — its primary column is the transcript, its right
margin is the citations, and the rail is where threads are switched.

**Composer states.**

| Condition | Behavior |
|---|---|
| ready | placeholder **"Ask about {context}…"** |
| streaming | Send becomes **Stop**; pressing it halts tokens within about a second |
| attachment ingesting | **"Waiting for 2 documents to finish indexing…"** — the question is **queued and sent automatically** when they settle, never sent against a corpus that provably lacks the file just attached |
| empty query | Send disabled, tooltip **"Type a question first."** |
| no context selected | Send disabled, tooltip **"Select a context first."** |
| context has no documents | Send disabled, tooltip **"Add a document to this context first."** |

Every disabled reason has its own tooltip. A control that is dead for an unstated reason is the
most common small failure in a chat UI.

**Boundary states.**

| Condition | Rendering |
|---|---|
| user has no contexts | Full-page EmptyState: **"Create a context to get started"**. **The composer is not rendered at all** — an input that cannot be submitted is worse than no input |
| context has no documents | **"{name} is empty"** + *Add documents* → `/contexts/:id`; composer rendered but disabled |
| documents present, no messages | Greeting + **three example questions built from the user's own real filenames** — *"What does q3-earnings.pdf say about EMEA?"* Never invented sample questions |
| error mid-stream | Turn goes to error with **the partial answer preserved** and a *Retry*. Partial text is never discarded — it is what the model actually said |

**Switching context with an open conversation** shows a confirm first:

> **Switch to Research Papers?**
> This starts a new conversation. *Q3 Reports* and its conversations stay where they are.
> `[ Cancel ] [ Switch ]`

Switching with an empty transcript skips the confirm entirely.

---

### 6.8 `/admin/traces` — Trace list

**Access:** authenticated. Not admin-only — a user inspects their **own** queries.

```
┌──────┬─────────────────────────────────────────────────────────────┐
│      │ [Q3 Reports ▾]                                    ⚙ ☾ (TR)  │
│ NAV  ├─────────────────────────────────────────────────────────────┤
│      │  Traces                    [Context ▾] [24h ▾] [Only slow]  │
│      │  Every query, with the latency of each pipeline stage.       │
│      │  ─────────────────────────────────────────────────────────  │
│      │  ┌───────────────────────────────────────────────────────┐  │
│      │  │ what was EMEA revenue in Q3?                 2,480ms  │  │
│      │  │ ▐▐▐▐▐▐▐▐░░░▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐  │  │
│      │  │ Q3 Reports · 3 sources · 2 minutes ago                │  │
│      │  ├───────────────────────────────────────────────────────┤  │
│      │  │ summarize the risk factors section             890ms  │  │
│      │  │ ▐▐▐▐▐▐░░▐▐▐▐▐▐▐▐▐▐                                   │  │
│      │  │ Q3 Reports · 0 sources · refused · 8 min ago  ⚠ 1     │  │
│      │  └───────────────────────────────────────────────────────┘  │
└──────┴─────────────────────────────────────────────────────────────┘
```

**Each row is a ProvenanceRibbon** at list density. Reusing it here and in chat and in the detail
header is what makes it a recurring motif rather than decoration.

**Row content.** Query (truncated to two lines) · ribbon · total duration · context chip (hidden
when a single-context filter is active) · source count, showing `0 sources · refused` when the
turn was refused · a warning marker with a count when warnings exist, listing them on hover ·
relative age with the absolute time in `title`.

**Filters.** Context (defaults to the active scope) · time window (1h / 24h / 7d / all) · an
*Only slow* toggle whose threshold is **computed from the rows actually loaded** and **displayed
in its own label** (`> 3,120ms`), never a hardcoded number. With too few rows to compute a
meaningful threshold the toggle is disabled with a tooltip saying so.

**Sort is fixed to newest first.** Sorting by duration is deliberately absent: it invites reading
the slowest query as the problem, when the interesting question is almost always *what changed
recently*.

**States.** Empty → **"No traces in the last 24 hours."** with a widen-the-window action.
Unavailable → **"Trace history is recorded from Phase 7. The trace for your most recent query is
available from the chat ribbon."** with a working link to `/chat`.

---

### 6.9 `/admin/traces/:id` — Trace detail

The inspector's main screen. Three regions in the standard grammar.

```
┌──────┬────────────────────────────────────────┬────────────────────┐
│      │ what was EMEA revenue in Q3, and how   │  RAW PAYLOAD       │
│ NAV  │ does it compare to APAC?               │  [Prompt][Sources] │
│      │ retrieval actually ran on: "How did    │  [Usage]           │
│      │ EMEA revenue in Q3 2024 compare to…"   │  ────────────────  │
│      │ ┌──┬───┬─┬────┬────────────────────┐   │  ┌ SYSTEM ──────┐  │
│      │ └──┴───┴─┴────┴────────────────────┘   │  │ ~118 tokens  │  │
│      │ runId 8f21c4a9 · Q3 Reports · 2m ago   │  │ You answer   │  │
│      │ ────────────────────────────────────── │  │ questions    │  │
│      │            0ms              2,480ms    │  │ using only…  │  │
│      │ CONDENSE  ▨▨ skipped — first turn ▨▨   │  └──────────────┘  │
│      │ EMBED     │ ▐▐▐▐▐▐▐            210ms   │  ┌ USER · text ─┐  │
│      │ SPARSE    │ ▐                    3ms   │  │ ~412 tokens  │  │
│      │ COLPALI   │ ▐▐▐▐▐              142ms   │  │ <source n="1"│  │
│      │           │ └ parallel                 │  │  file="q3.pdf│  │
│      │ RETRIEVE  │      ▐▐▐▐▐         180ms   │  │  section="Re…│  │
│      │ MERGE     │           ▐          2ms   │  │ EMEA revenue │  │
│      │ RERANK    │            ▐▐▐▐▐   240ms   │  │ for the third│  │
│      │ GENERATE  │              ▐▐┋▐▐ 1,710ms │  │ </source>    │  │
│      │           │                ┋ first tok │  └──────────────┘  │
│      │ total 2,480ms · 138ms unaccounted       │  ┌ USER · image ┐  │
│      │ ────────────────────────────────────── │  │ ~1,600 tokens│  │
│      │ RETRIEVED (fusion)  →  RERANKED (final)│  │ [thumb] p.3  │  │
│      │ 1 q3.pdf p12 [BOTH]──▶ 1 q3.pdf p12 .87│  │ /api/pages/… │  │
│      │ 2 notes §2 [SPRS]──┐   2 q3.pdf p14 .71│  └──────────────┘  │
│      │ 3 q3.pdf p9 [DNSE] └─▶ 3 notes §2   .44│                    │
│      │ 4 q3.pdf p14[DNSE]     4 q3.pdf p9  .31│                    │
│      │ 5 scan p3 [COLP]───────── floor 0.15 ──│                    │
│      │                        ✕ scan p3    .09│                    │
└──────┴────────────────────────────────────────┴────────────────────┘
```

**Header.** The query. Beneath it, when a condensation happened and differs from the original,
the line **"retrieval actually ran on: …"**. Then the ribbon, then a metadata strip: context ·
thread link · timestamp · run id · an external trace link when one exists.

The condense line is one of the highest-value facts on the page: a follow-up question that
retrieved badly is almost always a condensation that went wrong, and this is the only place a
user can see what was actually searched.

**Primary column.** Waterfall (§5.8), then RerankMatrix (§5.9).

**Evidence margin — the raw payload drawer.** Three tabs:

- **Prompt** — the assembled message as **labeled regions**, not one JSON blob. Each block
  carries its role (`SYSTEM` / `USER · text` / `USER · image`), its approximate token count, and
  its content. Image blocks show a **thumbnail plus the served URI** — **never base64**, which is
  hundreds of kilobytes of unreadable text that would dominate the drawer.
- **Sources** — the full pre-floor candidate set as collapsible JSON with a copy-all. The escape
  hatch: whatever the two visualizations above do not show, this does.
- **Usage** — provider, model, input and output tokens. When the provider did not report counts,
  the row reads **"not reported"**, never `0`.

Token counts are marked with a `~` and the panel states the method **once**: *"Estimated with
js-tiktoken (cl100k). The provider's own count is shown under Usage when reported."* An estimate
presented as exact is the same failure as an invented number, one order of magnitude smaller.

A truncated trace shows a warning band at the top of the drawer: **"This prompt exceeded the
256 KB capture limit and was truncated."**

---

### 6.10 `/admin/vectors` — 3D vector space

```
┌──────┬──────────┬────────────────────────────────┬──────────────────┐
│      │ DOCUMENTS│                                │  NODE INSPECTOR  │
│ NAV  │ ● q3.pdf │                                │  ──────────────  │
│      │     412  │        WebGL point cloud       │  notes.md        │
│      │ ● scan   │        + query beacon          │  § Regional      │
│      │      88  │        + neighbor links        │  breakdown       │
│      │ ● notes  │                                │  pos. 34         │
│      │      22  │                                │  ┌────────────┐  │
│      │          │                                │  │"…EMEA out- │  │
│      │ (toggle  │                                │  │ performed  │  │
│      │  dims a  │                                │  │ APAC by…"  │  │
│      │  doc in  │                                │  └────────────┘  │
│      │  place)  │  5,412 chunks · 12 documents   │  distance 0.042  │
│      │          │  · fitted 2h ago               │  rerank   0.87   │
│      │          ├────────────────────────────────┤  status   kept   │
│      │          │ (Ask a question…)  [Place ⌖]   │                  │
└──────┴──────────┴────────────────────────────────┴──────────────────┘
```

**Left column — document legend.** One row per document: a color swatch, the filename, its chunk
count, and a visibility toggle that **dims that document's points in place**. This column filters
what the center shows; it is not evidence.

**Center — the canvas** (§5.20) with the status line at the bottom and the beacon input beneath.

**Right margin — node inspector.** On clicking a node: filename, heading path, position, the
**real chunk text**, then a stat list — distance, rerank score, and `kept` / `cut` status when a
beacon is active. While the text loads, the panel shows a skeleton **with the metadata already
known**, not a blank panel. On failure it shows the error and a retry.

**Beacon input.** Placeholder: **"Ask a question to place it in this space."** Submitting drops a
beacon among the query's true nearest neighbors, with links fanning out and the rest of the field
dimmed. Neighbors that cleared the relevance floor are ringed; ones retrieved but cut are
enlarged **without** a ring.

**Four projection states.**

| State | Rendering |
|---|---|
| fresh | the cloud, plus **"fitted 2 hours ago"** in the status line |
| rebuilding | the cached cloud de-emphasized + a warning band: **"Rebuilding — 412 new chunks aren't plotted yet."** Beacon input disabled |
| absent | Unavailable with the reason + a *Rebuild projection* action |
| not yet implemented | Unavailable: **"Vector projections are computed from Phase 7."** — **never random points** |

A rebuild while a beacon is on screen **discards the beacon** with a toast: **"Projection rebuilt
— place the beacon again."** A beacon computed against a previous fit is meaningless on a new
one, and leaving it drawn would be the most convincing wrong picture this console could produce.

**What is deliberately absent.** No per-dimension "variance and contribution" panel — individual
dimensions of a learned 1024-dimensional embedding are not interpretable in the way such a panel
would imply. No similarity-formula display. Both were fabrications in the previous UI and are
replaced by the document legend, which is real data and directly serves the question *is my
clustering clean*.

---

### 6.11 `/admin/health` — Operations

**Access: admin only.** Non-admins get the 404 screen and the nav item is absent.

```
┌──────┬─────────────────────────────────────────────────────────────┐
│      │  System health                                              │
│ NAV  │  ┌───────────────────────────────────────────────────────┐  │
│      │  │ ● DEGRADED — llamaparse is not responding             │  │
│      │  └───────────────────────────────────────────────────────┘  │
│      │  DEPENDENCIES                                               │
│      │  ┌──────────┐┌──────────┐┌──────────┐┌──────────┐          │
│      │  │ mongo    ││ qdrant   ││ redis    ││llamaparse│          │
│      │  │ 4ms      ││ 11ms     ││ 2ms      ││ down     │          │
│      │  │ ╱╲╱╲╱╲__ ││ ╱╲__╱╲   ││ ______   ││          │          │
│      │  │ last 20  ││ last 20  ││ last 20  ││ timeout  │          │
│      │  └──────────┘└──────────┘└──────────┘└──────────┘          │
│      │  CIRCUIT BREAKERS          INGEST QUEUE      COLLECTIONS    │
│      │  qdrant       closed 2h    waiting     3     chunks 12,408  │
│      │  cohere       closed 2h    active      2     pages     340  │
│      │  llamaparse   open   4m    failed      1                    │
│      │                            4.2/min · 2 workers              │
│      │  PIPELINE ERRORS                     [All ▾]  [⏸ Pause]     │
│      │  ┌───────────────────────────────────────────────────────┐  │
│      │  │ PARSE   bad.pdf — no extractable text     2 min ago ▸ │  │
│      │  │ NOTIFY  SMTP connection refused          18 min ago ▸ │  │
│      │  └───────────────────────────────────────────────────────┘  │
└──────┴─────────────────────────────────────────────────────────────┘
```

**Status banner.** Healthy / degraded / down, **naming the degrading dependency**. A degraded
state that does not say *what* is degraded is a colored square.

**Dependency cards.** One per probe (mongo, qdrant, redis, vision, cohere, llamaparse, llm):
current latency, a 20-sample sparkline, and the error string on failure.

The sparkline is **honest about its own provenance** — labeled *"last 20 polls (5 min)"* and it
**starts empty on page load** rather than back-filling. There is no latency-history source;
drawing a line for a period the page did not observe would be an invention.

**Circuit breakers.** `closed` / `half-open` / `open`, with time-in-state.

**Queue.** Waiting / active / failed / completed, plus throughput per minute, worker concurrency,
and oldest-waiting age.

**Pipeline errors.** Reverse-chronological feed: a kind chip, the message, links to the document
and context, relative time, and an expandable stack trace. Filterable by kind, and **pausable** —
a feed that reorders while you are reading it is unusable. Pausing freezes the display while
polling continues.

**Polling:** dependencies every 15s, queue every 5s, errors every 15s. All three pause when the
tab is hidden.

---

### 6.12 Error and boundary screens

**404 / Not found.** Centered EmptyState: **"That page doesn't exist."** + *Go to chat*.
Also used for an admin-only route reached by a non-admin — **not** a "forbidden" screen, which
would confirm the route exists and is worth attacking.

**Backend unreachable.** Replaces the entire route content (including the login card) when the
session probe itself fails:

> **Cerebro is not reachable.**
> The app can't reach the server. This is usually a local backend that isn't running.
> `[ Try again ]`

This is a **different screen from signed-out**. Showing a login form to someone whose backend is
down is a dead end.

**Route loading.** A full-page centered spinner while the session resolves — never a flash of the
app shell followed by a redirect, which reads as a broken navigation.

---

## 7. Dialogs and overlays

All dialogs trap focus, close on Escape, and return focus to their trigger on close. Actions are
placed together with Cancel first.

### 7.1 ContextFormDialog — create / rename / edit description

Fields: **Name** (required, 1–80 characters, autofocused) and **Description** (optional, 280
maximum, with a live remaining count that appears only when approaching the limit).

Submit label: **"Create context"** / **"Save changes"**.

On rename, submit stays **disabled until the value differs** from the current one — a no-op save
that shows a success toast trains users to distrust the toast.

On create: the dialog closes, the new card enters at the head of the grid, a toast reads
**"Context created."**, and the router navigates straight to the new context. Navigating
immediately is deliberate — someone who just created a context wants to put something in it.

**Duplicate names are allowed.** Two contexts named `Drafts` are two contexts; ids identify a
context, not names.

### 7.2 DeleteContextDialog — typed confirmation

```
┌──────────────────────────────────────────────────────┐
│  Delete "Q3 Reports"                                 │
│                                                      │
│  This permanently deletes 12 documents, 1,840        │
│  indexed chunks, and 4 conversations. It cannot      │
│  be undone.                                          │
│                                                      │
│  Type the context name to confirm.                   │
│  ┌────────────────────────────────────────────────┐  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│                       [ Cancel ] [ Delete context ]  │
└──────────────────────────────────────────────────────┘
```

Counts are **read from the record**, never invented. An empty context reads **"This context is
empty. Deleting it cannot be undone."** and **still requires the typed name** — the muscle memory
is the point.

The confirm button stays disabled until the typed string matches **exactly** (case-sensitive,
trimmed of surrounding whitespace only).

### 7.3 DeleteDocumentDialog

Single-step confirm naming the file. On success the toast surfaces the real count returned by the
server: **"q3.pdf deleted. 412 indexed chunks removed."** That number is the only confirmation a
user gets that the vectors actually went with the file.

### 7.4 ReindexDialog — conditional

Shown **only** when the document is currently ready: **"Re-indexing replaces this document's
existing 412 chunks. It re-runs parsing and embedding."**

Re-indexing a **failed** document asks nothing — there is nothing to lose.

### 7.5 SwitchContextDialog

See §6.7. Skipped entirely when the transcript is empty.

### 7.6 PageImageLightbox

Full-screen overlay with the page image and a caption naming the file and page. Escape or a click
outside closes. Arrow keys move between page sources in the same turn when there is more than
one.

---

## 8. Cross-cutting patterns

### 8.1 The three data states — and never a fourth

Every panel renders exactly one of:

| State | Meaning | Rendering |
|---|---|---|
| **data** | real values | the component |
| **empty** | the system answered, there is nothing | EmptyState (§5.11) with an action |
| **unavailable** | the system cannot answer | Unavailable (§5.12) with the reason |

There is no fourth state. Specifically: **no placeholder charts, no lorem values, no
representative numbers, no skeletons that never resolve.**

Corollaries applied throughout:

- An unknown numeric value renders `—`, never `0`.
- A stage that did not run gets an explicit *skipped* marker with a reason, never a zero-width
  bar at a guessed position.
- A sparkline starts empty and fills as data arrives; it never back-fills a period the page did
  not observe.
- A score is labeled by what it is (*rerank score*), never upgraded to *confidence*.
- An estimate is marked `~` and its method stated once.
- A duration that was not measured is absent, not zero.

### 8.2 Loading

| Expected duration | Treatment |
|---|---|
| under ~300ms | nothing — a flash of spinner is worse than a brief wait |
| ~300ms to a few seconds | a skeleton matching the final layout's shape, **with any already-known metadata filled in** |
| longer or unbounded | progress with a real value where one exists, or a labeled indeterminate state naming what is happening (**"Computing projection…"**) |

Never a bare spinner in place of a whole screen when partial data is already available.

### 8.3 Errors

Three levels, three treatments:

- **Field** — inline under the input, with `role="alert"`.
- **Form / panel** — a banner at the top of the affected region.
- **Screen** — replaces the route content (§6.12).

**Server error text is rendered verbatim.** It is already written for a human, and rewriting it on
the client creates two sources of truth for one failure.

### 8.4 Destructive actions

| Reversibility | Treatment |
|---|---|
| trivially reversible | do it, offer Undo in the toast |
| irreversible, small blast radius | single-step confirm naming the target |
| irreversible, cascading | typed confirmation naming the target and enumerating real counts (§7.2) |

### 8.5 Disabled controls

A disabled control **always** has a tooltip stating why, and the reason is specific: **"Add a
document to this context first."** not **"Unavailable."**

Where the user has no capability at all — the Health nav item for a non-admin — the control is
**omitted entirely** rather than disabled. A disabled control advertises a capability the user
does not have.

### 8.6 Optimistic updates

Applied to: creating a context, uploading a document (an optimistic row), renaming, deleting a
thread. On failure the optimistic state is **rolled back** and the error shown — never left in
place with a silent error elsewhere.

Never applied to anything whose server-side result the user needs to see: ingest status, chunk
counts, retrieval results.

### 8.7 Polling

One loop per screen, not per row. Every loop pauses when the tab is hidden and fires once
immediately on return. Every loop **stops** when all its subjects reach a terminal state — a
settled page generates zero network traffic.

---

## 9. Copy voice

Words are design material. Bring the same intentionality to copy as to layout.

**Write from the user's side of the screen.** A person manages *documents* and *contexts*, not
*Qdrant payloads* or *BullMQ jobs*. Never expose an internal name in user-facing copy.

**Active voice; the control says what happens.** *Publish* produces a toast reading *Published*.
*Delete context* produces *Context deleted*. An action keeps the same name through the whole
flow.

**Errors explain what went wrong and how to fix it.** No apologies, no vagueness, no blame.

| ✗ Don't | ✓ Do |
|---|---|
| "Oops! Something went wrong." | "The upload queue is unavailable. Try again shortly." |
| "Invalid input." | "Use at least 12 characters." |
| "Unauthorized." | "Sign in to continue." |
| "Error 429" | "Upload limit reached. Try again in 12 minutes." |
| "Are you sure?" | "This permanently deletes 12 documents and 1,840 indexed chunks." |

**Empty states are invitations, not apologies.** *"No contexts yet"* plus one action, not *"You
don't have any contexts."*

**Be specific over clever.** *"3 documents ready. 1 failed."* beats *"Upload complete!"*

**Sentence case throughout** except short uppercase section labels. No exclamation marks. No
emoji in the interface.

**Never claim what isn't true.** In particular, do not describe Cerebro as operating offline or
keeping data local — documents are sent to third-party providers for parsing, embedding, and
generation. If a privacy statement is needed it belongs in a dedicated surface, stated
accurately.

---

## 10. Accessibility requirements

Not a review checklist — build to these.

| Area | Requirement |
|---|---|
| **Color independence** | Nothing conveys meaning by color alone. Branch chips carry text labels; the retrieved-vs-kept marker in the point cloud is a shape difference; stage chips carry both a marker and a word (WCAG 1.4.1) |
| **Contrast** | All text meets WCAG AA (4.5:1 body, 3:1 large), **in every theme**. Text below that threshold is restricted to non-essential content — placeholders, disabled controls, timestamps, units — and never used for body copy |
| **Focus** | Every interactive element has a visible focus indicator. Focus is never removed, only restyled. Dialogs trap focus and restore it to the trigger on close |
| **Keyboard** | Every flow completable by keyboard alone, including the full auth sequence and every dialog. The 3D canvas is skippable with one Tab |
| **OTP field** | One `aria-label` on the group, `autocomplete="one-time-code"`, paste distributes, Backspace navigates, errors announced via `aria-live="polite"` |
| **Transcript** | A labeled region with `aria-live="polite"` so an arriving answer is announced |
| **Waterfall** | Has a screen-reader-readable table equivalent — a bar chart alone is inaccessible |
| **Canvas** | Has a text alternative summarizing node count, document count, and cluster count |
| **Error feed** | `aria-live="polite"` when unpaused, silent when paused |
| **Tables** | A caption and scoped column headers; sortable headers expose `aria-sort` |
| **Reduced motion** | All transitions collapse. Two elements need a non-motion fallback rather than simply stopping: the **streaming caret** stays solid and present, and **in-progress stage chips** show the percentage as text |
| **Zoom** | Usable at 200% browser zoom with no content loss |
| **Forced colors** | Windows high-contrast mode: borders and focus indicators survive; nothing relies on a background color alone |
| **Touch targets** | At least 44×44px on the mobile bottom bar and every mobile row action |

---

## 11. Screen index

| Route | Screen | Access | § |
|---|---|---|---|
| `/login` | Sign in | public | 6.1 |
| `/signup` | Create account | public | 6.2 |
| `/forgot-password` | Request a reset code | public | 6.3 |
| `/reset-password` | Enter code, set password | public | 6.4 |
| `/contexts` | Context list | auth | 6.5 |
| `/contexts/:id` | Context detail + document explorer | auth | 6.6 |
| `/chat` | Grounded conversation | auth | 6.7 |
| `/admin/traces` | Trace list | auth | 6.8 |
| `/admin/traces/:id` | Trace detail | auth | 6.9 |
| `/admin/vectors` | 3D vector space | auth | 6.10 |
| `/admin/health` | Operations | **admin** | 6.11 |
| `*` | Not found / unreachable | — | 6.12 |
