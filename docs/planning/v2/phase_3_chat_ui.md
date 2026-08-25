# Phase 3: Chat (UI)

> Depends on: Phase 1 (tokens, `src/api/`, auth), Phase 2 (contexts exist and hold documents).
> Backend changes: **none**. `POST /api/ask` and `/api/threads` are used exactly as they
> exist today; `contextId` is sent and the current backend ignores it, which is harmless and
> becomes load-bearing in Phase 6.

## 1. Objective

At the end of this phase `/chat` is the product's primary surface: a user picks a context
from a top-bar switcher (or creates one without leaving the page), asks a question, and
watches a grounded answer stream in with syntax-highlighted code and rendered mathematics.
Beneath every answer sits a **provenance ribbon** — the pipeline's real measured latencies
compressed into one proportional strip — and in the evidence margin sit **citation
accordions**, each expandable to the exact chunk of text the answer was grounded in.

By the end of this phase: a user selects `Q3 Reports`, asks *"what was EMEA revenue in Q3?"*,
sees the answer stream in with a `[1]` citation, expands the first accordion to read the
exact table text it came from, and clicks the ribbon to open that query's trace.

**No trace console, no vector space, no health page, no backend code.** The ribbon links to
`/admin/traces/:id`, which is still Phase 1's placeholder page until Phase 4. Retrieval is
not yet actually scoped to the selected context — that is Phase 6. This phase builds the
conversation surface.

### 1.1 What this replaces

`ConsumerDashboard.tsx` is 246 lines that simultaneously own turn assembly, live-stream
mirroring, thread loading, source projection, and layout. It works, but every one of those
concerns has to change this phase, and changing five things inside one component is how a
component becomes eight hundred lines. It is decomposed into `Chat` (page),
`Transcript`/`Turn` (rendering), and `useTranscript` (state) before anything new is added.

---

## 2. Context Scope

### 2.1 `ContextScopeProvider`

The active context is application state, not page state — Phase 4's vector console and trace
list read the same value. It is provided at `AppShell` and persisted:

```ts
interface ContextScope {
  contexts: KnowledgeContext[];
  activeContext: KnowledgeContext | null;
  status: 'loading' | 'ready' | 'none';   // 'none' = the user has zero contexts
  setActive: (id: string) => void;
  createAndActivate: (req: CreateContextRequest) => Promise<KnowledgeContext>;
}
```

Selection persists in `localStorage` under `cerebro.activeContext`. On load the stored id is
**validated against the fetched list** before use — a context deleted from another tab must
not leave the app pointing at a dead id. An invalid stored id falls back to the most recently
updated context, silently; there is nothing useful to tell the user about a workspace that no
longer exists.

`status: 'none'` is a distinct state because the entire chat page is meaningless without a
context, and the correct response is not an error but a redirect to the empty state built in
Phase 2 (§6.3).

### 2.2 The switcher

Lives in `TopHeader`, replacing Phase 1's static context name. A Radix `DropdownMenu`, not a
`Select`: it holds a search field, a scrollable list, a separator, and a *New context* action
— a native select can hold none of those.

```
┌─────────────────────────────────────────┐
│  Q3 Reports                          ▾  │   ← trigger: name + doc count
└─────────────────────────────────────────┘
     ▼
┌─────────────────────────────────────────┐
│  ⌕ Search contexts…                     │   ← autofocused; filters as you type
├─────────────────────────────────────────┤
│  ✓ Q3 Reports          12 docs          │
│    Research Papers     47 docs          │
│    Contracts            3 docs          │
├─────────────────────────────────────────┤
│  + New context                          │   ← opens Phase 2's ContextFormDialog
└─────────────────────────────────────────┘
```

The search field appears only when there are more than seven contexts — a search box above
three items is noise.

*New context* reuses `ContextFormDialog` unchanged from Phase 2. On success
`createAndActivate` sets it active and the dialog closes; the user stays on `/chat` with an
empty new context selected and an inline prompt to add documents. **It does not navigate
away** — the whole point of quick-create is that the user was mid-thought.

### 2.3 Switching contexts mid-conversation

Switching while a thread is open **starts a new thread**. A conversation's history was
condensed against one corpus; carrying it into another produces follow-up questions that
reference documents the new context does not contain, and the condense node would rewrite
them into standalone questions about material that isn't there.

This is stated to the user before it happens, once, in the switcher's confirm step when a
thread has at least one turn:

> **Switch to Research Papers?**
> This starts a new conversation. *Q3 Reports* and its conversations stay where they are.
> `[ Cancel ]  [ Switch ]`

Switching with an empty transcript skips the confirm entirely.

---

## 3. Transcript Architecture

### 3.1 Decomposition

| Unit | Owns |
|---|---|
| `Chat.tsx` | layout, scope guard, the three-column frame |
| `useTranscript.ts` | the turn array, live-stream mirroring, thread load/reset |
| `Transcript.tsx` | list rendering, scroll anchoring, the empty state |
| `Turn.tsx` | one question + one answer + ribbon + actions |
| `AnswerBody.tsx` | the markdown pipeline (§4) |
| `EvidenceMargin.tsx` | the citation column |
| `Composer.tsx` | input, attachments, send/stop |

### 3.2 The turn model

```ts
interface Turn {
  id: string;                    // 'live-<ts>' while streaming, the Message _id once persisted
  question: string;
  answer: string;
  sources: ProvenanceSource[];
  telemetry: PipelineTelemetry | null;
  traceId: string | null;        // from the telemetry frame; null on a resumed thread
  status: 'streaming' | 'complete' | 'error' | 'refused';
  error: string | null;
  createdAt: string;
}
```

`status: 'refused'` is separate from `'error'` and from `'complete'`. The backend's
`noContext` node returns a fixed string — *"I could not find anything in your documents
relevant to that question."* — which is a **correct, successful answer**, not a failure. v1
rendered it as ordinary answer text, which left users unsure whether the system had failed.
It gets its own treatment: no citation margin (there is nothing to cite), no regenerate
action (re-running produces the identical fixed string and costs a retrieval), and an inline
suggestion to widen the scope or add a document.

Detection is exact-match against the three known refusal strings, which are constants in
`backend/src/graph/prompts.js`. They are duplicated into
`frontend/src/app/components/chat/refusals.ts` with a comment naming the backend file, and
task 3.19's acceptance criterion is that the two lists match — a drift here degrades the UI
silently, so it is checked rather than assumed.

### 3.3 Live-stream mirroring

`useCerebroChat` (Phase 1 migrated it onto `streamEvents`) owns one in-flight exchange.
`useTranscript` mirrors it into the turn whose id matches `liveTurnId`. Two invariants
carried forward from v1 because they were each a real bug:

1. **A new question is refused while one is in flight.** Without the guard, reassigning
   `liveTurnId` orphans the previous turn at `status: 'streaming'` forever and its spinner
   never stops.
2. **`traceId` and `telemetry` arrive together**, in the `telemetry` frame, *after* the last
   token. The ribbon therefore renders in a skeleton state during streaming and fills in at
   the end. It does not animate its segments into place — the numbers were always what they
   were, and an animation would imply they were being measured live.

### 3.4 Scroll behavior

Anchored to the bottom **only while the user is already within 100px of the bottom**. A user
who has scrolled up to read a citation must not be yanked down by an arriving token. When
pinned-away and new content arrives, a *Jump to latest* pill appears above the composer.

Implemented with a scroll listener and a ref, not `scrollIntoView` on every token —
`scrollIntoView` at 30 tokens/second is a layout thrash and fights the user's own scrolling.

---

## 4. The Markdown Pipeline

### 4.1 Plugin chain

```tsx
<ReactMarkdown
  remarkPlugins={[remarkGfm, remarkMath]}
  rehypePlugins={[
    [rehypeKatex, { errorColor: 'var(--critical)', strict: false }],
    [rehypeHighlight, { detect: true, subset: HIGHLIGHT_SUBSET, languages: HIGHLIGHT_LANGUAGES, aliases: HIGHLIGHT_ALIASES }],
  ]}
  components={MARKDOWN_COMPONENTS}
>
  {safeMarkdown}
</ReactMarkdown>
```

**Amended 2026-08-25** — the two rehype option objects above were corrected against the
actually-installed `rehype-katex@7`/`rehype-highlight@7` APIs during Phase 3 implementation:

- `throwOnError` is not a real `rehype-katex` v7 option — its `Options` type is
  `Omit<KatexOptions, 'displayMode' | 'throwOnError'>`. The plugin always catches a malformed
  expression internally and renders it in `errorColor` rather than throwing, so the effect
  this doc wants (a partial formula renders in `--critical` for a few frames, then resolves
  once its closing delimiter arrives) is what `rehype-katex` already does by default —
  `errorColor` and `strict` are the only real knobs.
- `ignoreMissing` is not a real `rehype-highlight` v7 option either (it predates the current
  lowlight-based API). Its effect is already the default: a `code` block whose language isn't
  registered just renders unhighlighted rather than throwing.
- `subset` alone does **not** shrink the bundle — it only limits what `detect: true` guesses
  among. What a build actually ships comes from `languages` (default: highlight.js's ~37
  "common" languages, ~non-trivial on its own), so achieving the ~90 KB target requires
  explicitly passing a `languages` map of only the twelve registered grammars, built from
  individual `highlight.js/lib/languages/*` imports, plus `aliases` so `jsx`/`tsx` resolve to
  the `javascript`/`typescript` grammars (there is no separate JSX/TSX grammar — the
  JS/TS grammars already parse JSX syntax).

Both new plugins are **synchronous**, which is the whole reason for choosing them
([architecture.md §4](architecture.md)): this component re-renders on every streamed token,
and an async highlighter would either flash unstyled code or serialize highlighting behind
token arrival.

`HIGHLIGHT_SUBSET` restricts highlight.js to twelve languages —
`js ts jsx tsx python sql json yaml bash go rust java` — instead of its 190-language default.
Measured (esbuild, minified + gzipped) for the whole markdown pipeline — `remark-math` +
`rehype-katex` (which bundles `katex` itself) + `rehype-highlight` + the ten registered
grammars — the marginal cost is **~137 KB gzip**, under the < 200 KB target in §11 and task
3.8's acceptance criterion. `detect: true` over 190 candidate grammars on every render of a
growing code block would also be the single most expensive thing this pipeline could do,
which `subset` (in addition to `languages`) still guards against.

### 4.2 Mid-stream safety — the part that actually breaks

A partial markdown document is not a markdown document. Three constructs specifically produce
visible damage while a token stream is open:

| Construct | What happens without a guard |
|---|---|
| An unclosed ` ``` ` fence | Every remaining token renders as code, so the rest of the answer arrives inside a growing black block that snaps back to prose when the fence closes |
| An unclosed `$$` block | `remark-math` treats the rest of the buffer as one math expression; KaTeX renders a red wall |
| An unclosed `|` table row | GFM emits a one-cell table that reflows on every token |

The fix is a pure function applied to the buffer **only while streaming**, never to a
completed answer:

```ts
// frontend/src/app/components/chat/streamSafeMarkdown.ts
//
// Closes constructs that are still open at the end of a partial buffer, so a
// half-arrived answer renders as what it is becoming rather than as damage.
// Applied ONLY while status === 'streaming'; a completed answer is rendered raw.

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

export function streamSafeMarkdown(buffer: string): string {
  const lines = buffer.split('\n');
  let out = buffer;

  // 1. Code fences. Count openers/closers; an odd count means one is open.
  //    The closing token must match the opener's character and be at least as
  //    long — ```` ``` ```` does not close ```` ~~~~ ````.
  let open: string | null = null;
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (!m) continue;
    if (open === null) open = m[1][0].repeat(m[1].length);
    else if (m[1][0] === open[0] && m[1].length >= open.length) open = null;
  }
  if (open !== null) out += `\n${open}`;

  // 2. Display math. $$ pairs; an odd count means one is open. Counted only
  //    outside code spans, since $$ inside a fence is literal text.
  const outsideCode = stripFencedBlocks(out);
  if ((outsideCode.match(/\$\$/g)?.length ?? 0) % 2 === 1) out += '$$';

  // 3. Inline math. Single $ delimiters, same parity rule, but ONLY when the
  //    buffer contains at least one $$-free $ pair already — otherwise a lone
  //    dollar sign in prose ("costs $4.2M") would be treated as an opener and
  //    every subsequent token would render as math. Verified against the exact
  //    phrasing this app produces: financial figures are the most common source
  //    of a stray $ in a grounded answer about earnings documents.
  const inline = outsideCode.replace(/\$\$/g, '');
  const dollars = inline.match(/(?<!\\)\$/g)?.length ?? 0;
  if (dollars % 2 === 1 && /(?<!\\)\$[^$\n]+(?<!\\)\$/.test(inline)) out += '$';

  // 4. A trailing partial table row (a line starting with | and no newline yet)
  //    is dropped rather than closed — a half-written row has no honest
  //    rendering, and it will arrive complete within a few tokens.
  const last = out.slice(out.lastIndexOf('\n') + 1);
  if (/^\s*\|/.test(last) && !out.endsWith('\n')) out = out.slice(0, out.lastIndexOf('\n'));

  return out;
}
```

The inline-math guard in step 3 is the non-obvious one. A grounded answer about quarterly
earnings is full of strings like `$4.2M`; treating the first as a math opener turns the rest
of the answer into a red KaTeX error. The additional requirement — that a *complete* `$…$`
pair already exists in the buffer — means the guard only fires in a document that has
demonstrably been using inline math, which is the only case where the parity fix is correct.

### 4.3 Component overrides

| Element | Treatment |
|---|---|
| `code` (inline) | `--surface-sunken` background, `--radius-sm`, Data type at `0.875em` |
| `pre > code` | fenced block on `--surface-sunken` with a `--line` border, a language label in Micro type in the top-right, and a copy button that appears on hover **and on focus** (hover-only reveals are unreachable by keyboard) |
| `a` | `--signal`, underlined with a 2px offset. External links get `rel="noopener noreferrer"` and a trailing glyph |
| `table` | full-width, `--surface-sunken` header row, hairline rules, wrapped in an `overflow-x: auto` container so a wide table scrolls itself instead of the page |
| `blockquote` | 3px `--line-strong` left rule, `--ink-secondary` |
| `[N]` citation marker | intercepted before rendering — see §5.2 |
| `img` | not rendered as markdown. The model has no way to emit an image the app should trust, and a `![](…)` in retrieved document text is untrusted content pointing at an arbitrary URL. Rendered as its alt text in `--graphite-faint` |

The final row is a security decision, not a styling one: retrieved document text is
untrusted, an image URL is an outbound request, and a request to an attacker-chosen URL from
an authenticated user's browser is a tracking pixel at best.

### 4.4 The streaming caret

A `▍` appended while streaming, at `--signal` with a 1 Hz opacity step (`steps(2)`), not a
fade. Under `prefers-reduced-motion` it stops blinking and stays solid — a user who
suppresses motion still needs to see that the answer is still arriving. It is appended in the
component, never into `answer` state, so it never lands in the persisted text.

---

## 5. Citations

### 5.1 The evidence margin

Citations live in the 380px right margin established in Phase 1 §2.5, aligned to the top of
the turn they belong to. This is the design's central spatial claim — *center is the answer,
margin is the evidence* — and chat is where it is most legible.

Below 1024px the margin collapses to a **"3 sources"** disclosure under the answer that
expands in place. Never a hidden drawer: evidence the user cannot find is evidence that does
not exist.

### 5.2 `CitationAccordion`

```
┌──────────────────────────────────────────────┐
│ ▸ 1  q3-earnings.pdf                   0.87  │  ← collapsed
│      Revenue › Regional breakdown             │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│ ▾ 1  q3-earnings.pdf                   0.87  │  ← expanded
│      Revenue › Regional breakdown · page 12   │
│      ┌────────────────────────────────────┐  │
│      │ EMEA revenue for the third quarter │  │
│      │ was $4.2M, up from $3.8M in Q2…    │  │
│      └────────────────────────────────────┘  │
│      dense+sparse · rank 4 → 1        ⧉ copy │
└──────────────────────────────────────────────┘
```

- The index badge is `--signal` filled (Amended 2026-08-19 — see architecture.md §7.4: no
  hue is reserved for evidence, so the badge carries the same blue as any other numbered UI
  marker). It is the **only** numeric identity a user needs, and it matches the `[1]` in the
  answer text.
- The score is `relevanceScore` from the reranker, Data type, four decimals in the tooltip
  and two in the chip. It is labeled *rerank score* in the tooltip, not *confidence* —
  a cross-encoder score is not a probability and calling it confidence would be a claim the
  number cannot support.
- `rank 4 → 1` is `fusionRank → finalRank`, already carried on every source. It is the
  single most informative thing about a retrieval and it costs one line.
- The branch chip (`dense` / `sparse` / `both` / `colpali`) is a neutral `--surface-sunken`
  pill with a `--line` border and its text label in Micro type — no per-branch color
  (Amended 2026-08-19; the `--branch-*` token family from Phase 1 §2.1 is retired). The
  label is what carries the meaning, per DESIGN.md §5.5's "always carries its text label"
  requirement — this was already true before the amendment and remains the fallback that
  makes removing the color safe.
- A `kind: 'page'` source additionally renders its page image at 96px wide, clickable to the
  lightbox below. `imageUri` is already served by `/api/pages/:documentId/:page.jpg`. A
  `kind: 'text'` source shows **no image placeholder** — an empty frame implies a thumbnail
  failed to load rather than that none exists.

**`PageImageLightbox`** (`DESIGN.md` §7.6) — **added to this phase 2026-08-19; it was
specified in `DESIGN.md` but appeared in no phase doc.** A full-screen overlay showing the page
image at its natural size, with a caption naming the file and page (*"scan.pdf · page 3"*).
Escape or a click on the backdrop closes it and returns focus to the thumbnail that opened it.
When a turn cites **more than one** page source, Left/Right arrows move between them in
citation order and the caption updates; with a single page source the arrows are absent
rather than disabled, since there is nowhere to go. It uses the same focus-trap primitive as
every other dialog (§7 preamble in `DESIGN.md`) and is the one overlay in the product that is
not a decision — it has no confirm and no destructive action, so it takes no `Cancel`.
- Copy puts the chunk text on the clipboard, not the filename.

**Hover and click linkage.** Hovering `[1]` in the answer highlights accordion 1 with a
`--signal-soft` background (Amended 2026-08-19, replacing the retired `--evidence-soft`);
hovering the accordion highlights every `[1]` in the answer.
Clicking `[1]` scrolls the accordion into view and expands it. This is implemented by
rewriting `[N]` markers into a `<CitationRef>` button during markdown rendering, keyed to a
shared `hoveredCitation` state on the turn.

A `[N]` whose N exceeds the source count renders as plain text — the model occasionally cites
a number it was not given, and a button that scrolls to nothing is worse than an unstyled
bracket.

### 5.3 Resumed threads carry less, and say so

`GET /api/threads/:id` returns persisted sources carrying only
`{kind, pointId, documentId, page, score, available, fileName, imageUri}` —
`Message.sources` never stored chunk text ([backend/src/models/Message.js](../../backend/src/models/Message.js)),
so a reloaded conversation has no snippet to expand.

The accordion renders the header, the score, and the page thumbnail, with the body reading
*"Text isn't stored for past conversations."* in `--graphite-faint`. It is not silently
collapsed and not shown empty. A source whose document has since been deleted keeps
`available: false` and renders greyed with a *(deleted)* suffix — the historical answer
genuinely was grounded in it, and erasing the citation would misrepresent the record.

Phase 7's `Trace` model stores the full candidate set including text, so from Phase 7 a
resumed turn with a `traceId` can offer *"View the full sources in the trace"*. That link is
built here and simply renders disabled until then.

---

## 6. The Provenance Ribbon

### 6.1 What it is

The signature element ([architecture.md §7.4](architecture.md)): the pipeline waterfall
compressed to a single 6px strip under every completed answer, segments proportional to
measured duration.

```
  ┌──┬────────┬──┬──────────┬──────────────────────────────┐
  └──┴────────┴──┴──────────┴──────────────────────────────┘
   ▲     ▲      ▲     ▲                ▲
   │     │      │     │                └ generate  1,840ms
   │     │      │     └ rerank            240ms
   │     │      └ merge                     2ms
   │     └ retrieve                        180ms
   └ embed                                 210ms

   2,480ms · 8 sources · dense+sparse+colpali        View trace ›
```

Segments are laid out from `<stage>StartMs` and `<stage>Ms`, exactly as `ExecutionPlan`
does — **positions are measured, never reconstructed by stacking durations**. The gaps
between segments are therefore real unaccounted time (node transitions, prompt assembly,
persistence) and the segments deliberately do not sum to `totalMs`. This is called out in
the ribbon's tooltip so a reader does not mistake a gap for a rendering bug.

A skipped stage (`null` duration) contributes **no segment at all**. It is listed in the
tooltip as *skipped* with its reason. There is no honest position for a stage that did not
run, and a zero-width segment at a guessed offset would be a fabrication.

### 6.2 States

| Turn status | Ribbon |
|---|---|
| `streaming` | a 6px `--surface-sunken` track with an indeterminate `--signal` shimmer; no numbers, because none have arrived |
| `complete` | the full ribbon, `View trace ›` enabled when `traceId` is present |
| `refused` | ribbon shown (retrieval genuinely ran and its timings are real) with `0 sources`; `View trace` still enabled — a refusal is one of the most interesting things to inspect |
| `error` | no ribbon; there is nothing measured to show |

`View trace ›` links to `/admin/traces/:traceId`. Until Phase 7 emits `traceId` in the
telemetry frame the value is `null` and the link renders as disabled text with a tooltip:
*"Traces are recorded from Phase 7."* This is an `<Unavailable>`-class state, honestly
labeled, not a dead link.

### 6.3 Where else it appears

The same `<ProvenanceRibbon>` component is reused at the top of `/admin/traces/:id` in Phase
4 and above each row in the trace list. Building it here, driven by the same
`PipelineTelemetry` contract, is what makes it a motif rather than a one-off.

---

## 7. Composer and Thread Sidebar

### 7.1 Composer

`react-textarea-autosize` (already a dependency), 1–8 rows. Enter sends, Shift+Enter
newlines, and the hint is shown in `--graphite-faint` beneath on first visit only.

Attachments: files dropped on the composer upload into the **active context** through Phase
2's `useUploadQueue`, appearing as chips with live stage labels. A question asked while an
attachment is still ingesting is **queued, not blocked** — the composer shows *"Waiting for
2 documents to finish indexing…"* and sends as soon as they settle. Sending immediately
would run retrieval against a corpus that provably does not contain the file the user just
attached, which reads as the product being broken.

Send is disabled when: the query is empty, a stream is in flight, or there is no active
context. Each disabled reason has its own tooltip; a control that is dead for an unstated
reason is the most common small failure in a chat UI.

*Stop* replaces *Send* during streaming and aborts the `AbortController`, which the backend
already honors via `res.on('close')` — tokens stop server-side, not just client-side.

### 7.2 Recent Chats — extending the Phase 1 rail section

**Amended 2026-08-19.** This section previously described restyling v1's standalone
`ThreadSidebar` as a panel beside the transcript. Two things changed underneath it: the thread
list now lives in the **global left rail** (`DESIGN.md` §2.2, and §6.7's correction — there is
no separate thread panel on `/chat`), and **Phase 1 already built that rail section** as a
flat, newest-first, read-only list (`phase_1` §7.3).

So this phase **extends** what Phase 1 shipped rather than building a thread list. Exactly
four additions, none of which existed in Phase 1:

1. **Recency group headers** — *Today*, *Yesterday*, *Previous 7 days*, *Older*.
2. **Inline rename.**
3. **Delete**, confirming once and stating the message count.
4. **Filtering to the active context** — client-side this phase; server-side in Phase 6,
   marked `PHASE-6-REMOVE` like Phase 2 §7.4.

Phase 1's flat list, its row anatomy (icon · title · relative time), its cap and
`View all chats ›` link, and its selected-row treatment are all unchanged and are not rebuilt
here. v1's `ThreadSidebar.tsx` is **deleted**, not restyled — its replacement is the rail
section, which Phase 1 already created.

### 7.3 Empty and boundary states

| Condition | Rendering |
|---|---|
| No contexts at all | Full-page empty state: *"Create a context to get started"* + the create dialog. The composer is not rendered — an input that cannot be submitted is worse than no input |
| Active context, zero documents | Transcript area shows *"{name} is empty"* + *Add documents* linking to `/contexts/:id`. The composer **is** rendered but disabled with the tooltip *"Add a document to this context first."* |
| Documents present, no messages | The Phase-1 greeting with three example questions built from real document filenames in the context — *"What does q3-earnings.pdf say about EMEA?"* Real filenames, never invented sample questions |
| Backend unreachable mid-stream | The turn goes to `status: 'error'` with the partial answer preserved and a *Retry* action. Partial text is never discarded — it is what the model actually said |

---

## 8. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 3.1 | Build `ContextScopeProvider` with validated persistence | Deleting the active context in another tab and reloading falls back to the most recent context without an error |
| 3.2 | Build the context switcher with conditional search | With 3 contexts no search field renders; with 8 it does and filters as typed |
| 3.3 | Wire quick-create through `ContextFormDialog` | Creating from the switcher activates the new context and stays on `/chat` |
| 3.4 | Implement the switch-mid-conversation confirm | Switching with an empty transcript shows no dialog; switching with one turn does, and confirming clears the transcript and the thread id |
| 3.5 | Decompose `ConsumerDashboard` into `Chat`/`Transcript`/`Turn`/`useTranscript` | `ConsumerDashboard.tsx` no longer exists; every v1 behavior (multi-turn, resume, regenerate, stop) still works |
| 3.6 | Implement the in-flight guard | Submitting during a stream is a no-op; no turn is ever left at `streaming` after the stream ends |
| 3.7 | Implement scroll anchoring with the 100px threshold | Scrolling up 300px during a stream does not yank the view down; a *Jump to latest* pill appears |
| 3.8 | Add `remark-math` + `rehype-katex` + `rehype-highlight` with the 12-language subset | `$$E = mc^2$$` renders as typeset math; a `python` fence is highlighted; the built vendor chunk grows by < 200 KB gzip |
| 3.9 | Implement `streamSafeMarkdown` | Unit tests: an unclosed ` ``` ` gets a matching closer; ` ~~~ ` is not closed by ` ``` `; the buffer `costs $4.2M and` gains **no** trailing `$`; the buffer `$x$ and $y` gains one |
| 3.10 | Implement the markdown component overrides | A wide table scrolls inside its own container, not the page; the code copy button is reachable by Tab |
| 3.11 | Suppress markdown images per §4.3 | `![x](https://evil/p.gif)` in an answer produces no network request; the alt text renders |
| 3.12 | Implement the streaming caret with reduced-motion fallback | With reduced motion the caret is solid and present; `answer` state never contains `▍` |
| 3.13 | Build `CitationAccordion` with score, rank movement, branch chip, page thumbnail | A page source shows its image; a text source shows no image placeholder |
| 3.14 | Implement `[N]` ↔ accordion hover and click linkage | Hovering `[1]` tints accordion 1; clicking scrolls and expands it; `[9]` with 3 sources renders as plain text |
| 3.15 | Implement the resumed-thread accordion state | A reloaded thread's accordion expands to *"Text isn't stored for past conversations."*, not to an empty body |
| 3.16 | Implement deleted-source annotation | A cited document deleted after the fact renders greyed with *(deleted)*, never omitted |
| 3.17 | Build `<ProvenanceRibbon>` from measured offsets | A telemetry object with `rerankMs: null` renders **no** rerank segment and lists it as skipped in the tooltip; segments do not sum to `totalMs` and the tooltip says why |
| 3.18 | Implement the four ribbon states | A refused turn shows a ribbon with 0 sources; an errored turn shows none |
| 3.19 | Implement refusal detection against the backend's fixed strings | `frontend/…/refusals.ts` and `backend/src/graph/prompts.js`'s `MESSAGES` contain the identical three strings; a refused turn shows no citation margin and no regenerate |
| 3.20 | Implement composer attachment queueing | Asking a question with an attachment still ingesting waits and sends on completion, showing the waiting state |
| 3.21 | Implement the three disabled-send tooltips | Empty query, in-flight stream, and no-context each produce their own tooltip |
| 3.22 | Extend Phase 1's rail Recent Chats with grouping, rename, delete, and context filter (§7.2) | Threads group under Today / Yesterday / Previous 7 days / Older; renaming a thread inline persists; deleting confirms once and states the message count; the context filter carries a `PHASE-6-REMOVE` marker; `ls frontend/src/app/components/ui/ThreadSidebar.tsx` returns "No such file" — it is deleted, not restyled |
| 3.23 | Implement the four §7.3 boundary states | A context with zero documents disables the composer with its tooltip and shows *Add documents* |
| 3.24 | Implement `PageImageLightbox` (§5.2, `DESIGN.md` §7.6) | Clicking a page thumbnail opens a full-screen overlay captioned *"scan.pdf · page 3"*; Escape and a backdrop click both close it and return focus to the thumbnail; with two page sources in one turn, Left/Right move between them; with one, no arrows render; a text source shows no thumbnail at all |
| 3.25 | Accessibility pass | The transcript is a labelled `log` region with `aria-live="polite"`; citation buttons announce *"Source 1, q3-earnings.pdf"*; the whole flow is keyboard-operable |

---

## 9. Milestone Definition

Phase 3 is **complete** when:

> A user with two contexts opens `/chat`. The header shows **Q3 Reports · 12 documents** with
> a chevron; the transcript area greets them with three example questions built from their own
> filenames. They type *"what was EMEA revenue in Q3, and show me the formula you used?"* and
> press Enter.
>
> A ribbon appears under the empty answer as a shimmering track. Source accordions land in the
> right margin **before the first token** — three of them, numbered in blue, the top one
> reading `q3-earnings.pdf · Revenue › Regional breakdown · 0.87`. Then tokens begin. The
> answer streams in with a solid caret at its end, and midway through the model opens a code
> fence: for the two seconds before it closes, the block renders as a properly-fenced,
> syntax-highlighted `python` block rather than swallowing the rest of the answer — because
> `streamSafeMarkdown` closed it. A `$$` display formula does the same, rendering typeset the
> moment it completes rather than flashing red for the rest of the stream. The sentence *"EMEA
> revenue was $4.2M [1], up from $3.8M [1]"* renders with both dollar figures as plain text,
> not as math.
>
> When the last token lands, the ribbon fills in: five proportional segments over a 2,480 ms
> total, with `generate` occupying roughly three quarters of the width, and a line reading
> `2,480ms · 3 sources · dense+sparse`. Hovering the `rerank` segment shows `240ms, starts at
> 391ms`; hovering the gap between `merge` and `rerank` shows the tooltip explaining that gaps
> are real unaccounted time. They hover the `[1]` in the answer and accordion 1 in the margin
> tints a pale blue; they click it and it expands to show the exact table text the figure came from,
> with `dense+sparse · rank 4 → 1` beneath. `View trace ›` at the ribbon's right end is greyed
> with the tooltip *"Traces are recorded from Phase 7."*
>
> They ask *"what is our parental leave policy?"* — nothing in the corpus covers it. The
> answer arrives in a single frame as the fixed refusal, rendered in its own muted treatment
> with **no** citation accordions, **no** regenerate button, and an inline suggestion to add a
> document. The ribbon is still there, showing that retrieval genuinely ran and found nothing
> above the floor.
>
> They open the switcher, search `res`, and choose **Research Papers**. Because the transcript
> has two turns, a dialog asks first and says the current conversation stays where it is. They
> confirm; the transcript clears, Recent Chats in the rail re-filters, and the greeting now names
> filenames from the new context. They open the switcher again, click *New context*, create
> `Scratch`, and land back on `/chat` with an empty context selected, the composer disabled,
> and a tooltip reading *"Add a document to this context first."*
>
> They reload the browser and click their first conversation in the sidebar. Every turn
> returns with its question, its answer, and its citation chips — and expanding one shows
> *"Text isn't stored for past conversations."* rather than an empty box. They delete
> `q3-earnings.pdf` from `/contexts`, return, and the citation is still there, greyed, marked
> *(deleted)*.
>
> Finally they start a long answer, press **Stop** after two seconds, and the tokens halt
> within a second while the partial answer stays on screen with a *Retry* action. The backend
> log shows the abort. Throughout, flipping the theme changes every surface — code blocks,
> KaTeX output, accordions, the ribbon — with nothing left on a hardcoded color.

---

## 10. Files to Create

```
frontend/src/app/
├── pages/Chat.tsx                          # replaces ConsumerDashboard.tsx
├── context/ContextScopeContext.tsx         # active context, persistence, quick-create
├── components/chat/
│   ├── Transcript.tsx                      # list, scroll anchoring, empty states
│   ├── Turn.tsx                            # question + answer + ribbon + actions
│   ├── AnswerBody.tsx                      # the markdown pipeline (§4)
│   ├── streamSafeMarkdown.ts               # §4.2 — fence / math / table guards
│   ├── markdownComponents.tsx              # §4.3 overrides incl. image suppression
│   ├── CitationRef.tsx                     # the [N] button, hover linkage
│   ├── EvidenceMargin.tsx                  # the 380px column / mobile disclosure
│   ├── CitationAccordion.tsx               # §5.2
│   ├── PageImageLightbox.tsx               # §5.2 / DESIGN.md §7.6 — full-screen page image,
│                                           #   caption, arrows between page sources, focus trap
│   ├── ProvenanceRibbon.tsx                # §6 — reused by Phase 4
│   ├── Composer.tsx                        # textarea, attachments, send/stop
│   ├── ContextSwitcher.tsx                 # §2.2, lives in TopHeader
│   ├── SwitchContextDialog.tsx             # §2.3 confirm
│   └── refusals.ts                         # mirrors backend prompts.js MESSAGES
├── components/core/Sidebar.tsx             # [extend] Phase 1's rail Recent Chats section gains
│                                           #   recency groups, rename, delete, ctx filter (§7.2)
├── components/ui/ThreadSidebar.tsx         # [DELETE] superseded by the rail section
└── hooks/
    ├── useTranscript.ts                    # turn array, live mirroring, thread load
    └── useCitationHover.ts                 # shared [N] ↔ accordion state

frontend/test/
├── streamSafeMarkdown.test.ts              # task 3.9 — the six listed cases
└── refusals.test.ts                        # task 3.19 — parity with the backend constants
```

**Deleted this phase:** `ConsumerDashboard.tsx`, `AnswerBox.tsx` (superseded by
`AnswerBody` + `Turn`), `SourceChip.tsx` (superseded by `CitationAccordion`).

**New dependencies:** `remark-math`, `rehype-katex`, `rehype-highlight`, `katex` (peer of
`rehype-katex`, ships the CSS and fonts).

---

## 11. Performance Validation

| Metric | How to Measure | Target |
|---|---|---|
| Token render cost | Performance recording during a 900-token answer | < 8 ms per token commit; no frame over 50 ms |
| `streamSafeMarkdown` cost | Microbenchmark at a 6 KB buffer | < 0.5 ms per call (it runs once per token) |
| Highlight bundle | `npm run build` chunk report | highlight.js subset ≤ 90 KB gzip; total new deps ≤ 200 KB gzip |
| KaTeX font load | Network panel on the first math render | Fonts load once, lazily; no math on screen means no font request |
| Scroll during stream | Performance recording while scrolled up | Zero scroll-position mutations from the app |
| Time to first source chip | Network + Performance from submit | Matches the `sources` SSE frame within 50 ms — the chips must not wait for tokens |
| Ribbon layout | Performance recording at the telemetry frame | Single layout pass; no animation of segment widths |

---

## 12. Estimated Complexity

| Component | LOC | Files | New deps |
|---|---|---|---|
| Context scope + switcher + confirm | ~420 | 3 | 0 |
| Transcript decomposition (`Chat`, `Transcript`, `Turn`, `useTranscript`) | ~640 | 4 | 0 |
| Markdown pipeline (`AnswerBody`, overrides, `streamSafeMarkdown`) | ~480 | 3 | 4 |
| Citations (`EvidenceMargin`, `CitationAccordion`, `CitationRef`, hover) | ~520 | 4 | 0 |
| `PageImageLightbox` (§5.2) | ~140 | 1 | 0 |
| `ProvenanceRibbon` | ~260 | 1 | 0 |
| Composer + attachment queueing | ~330 | 1 | 0 |
| Recent Chats extension in `Sidebar` (grouping, rename, delete, ctx filter) — §7.2 | ~180 | 1 | 0 |
| Tests | ~200 | 2 | 0 |
| **Total** | **~3,170** | **20** | **4** |
