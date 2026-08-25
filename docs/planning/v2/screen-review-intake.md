# Screen Review Intake — Running Notes

> **What this is.** A working log of every mockup screenshot reviewed against `DESIGN.md` and
> `docs/planning/v2/*` during the visual-refresh pass, started 2026-08-19. Each entry records
> what the screen confirmed, what it changed, and what's still an open question. This file is
> the source of truth for the eventual consolidated amendment — nothing here is implemented
> yet; `phase_1`'s color/typography tokens are the only part already written back into the
> spec proper (see §1 below), because they were foundational and low-risk to lock early.
>
> **Status: intake closed 2026-08-19.** The user sent a "CEREBRO — FINAL UI DESIGN DECISIONS"
> message resolving every open question in §3 below. Those decisions are now written back into
> `DESIGN.md` (§2.2, §3.1, §4, §6.1–§6.4) and `phase_1` (§6). §3 is kept below as a historical
> record of what was resolved and how, not as a live blocker — Phase 1 implementation can
> proceed.

---

## 1. Palette — DONE, already written into the spec files

Superseded the original `signal`/`evidence` two-hue scheme and its warm-paper base. Locked
values (`cerebro-500 #004FFE`, the `ink`/`surface`/`line` scales) are already edited into
`architecture.md` §7.4 and `phase_1` §§2.1–2.4, §6, plus token-name references in `phase_2`,
`phase_3`, `phase_4`, `phase_7`, `phase_8`. See those files directly for the current values —
not repeated here to avoid a second place they can drift out of sync.

Key resulting decisions, for quick reference:
- One accent (`cerebro-500`) for everything interactive. No hue reserved for "this was
  retrieved" — evidence is marked by position (right margin only) + container treatment
  (`--surface-sunken` + `--line-strong` quote block), not color. Citation badges, rerank-matrix
  promotion connectors, and the vector-space beacon all use `--signal` blue, not a separate
  evidence hue.
- One typeface (Inter) everywhere, no display serif, no monospace data face — tabular figures
  via Inter's own `tabular-nums`.
- Contrast target is AA, not AAA (the real palette doesn't clear AAA). `graphite-faint` and a
  status color's bare `-600` are restricted from body text — see `phase_1` §2.2.

---

## 2. Screens reviewed

### 2.1 `/chat` (populated + empty state) — reference screenshots, session start
Establishes the baseline visual language: white/near-white surfaces, `cerebro-500` blue,
right-margin evidence panel, execution-trace card. No conflicts — this is what the palette
lock-in in §1 was built to match.

### 2.2 `/login`, `/signup` — reviewed 2026-08-19
- Confirmed the locked palette (§1).
- **Open conflict, unresolved:** split-screen layout (left hero/feature-list/network
  illustration, right card) directly contradicts `DESIGN.md` §6.1's explicit rule: *"A single
  centered card. No split-screen hero, no illustration, no marketing panel... that starts
  here."* Three auth screens now (`/login`, `/signup`, `/forgot-password`) consistently use
  the split-screen treatment, which reads as deliberate, not accidental. **Leaning toward
  amending `DESIGN.md` §6.1** to make the auth surface the one documented exception (no
  "proof" exists before sign-in, so the "does not decorate what it cannot prove" thesis
  doesn't bind the same way here) — but this reverses a stated product thesis, so it needs an
  explicit yes from the user before I touch `DESIGN.md`, not just the phase docs.
- Atmospheric radial-gradient + faint network-node background is new — not in `DESIGN.md` at
  all currently. Needs a real component spec (probably a `<AtmosphericBackground>` in §5 of
  `DESIGN.md`, since it recurs on every auth screen and apparently persists into `/contexts`
  too per §2.4 below) once intake closes.

### 2.3 `/forgot-password` — reviewed 2026-08-19
- Same split-screen pattern, reinforcing the conflict in §2.2.
- **Resolved:** screenshot incorrectly showed a signed-in avatar in the header on this public
  route. Confirmed with the user this is a mockup artifact — no avatar/user menu on
  `/login`, `/signup`, `/forgot-password`, `/reset-password`, consistent with `DESIGN.md`'s
  existing rule for signed-out screens. No spec change needed, just don't replicate the
  artifact.

### 2.4 `/contexts` — reviewed 2026-08-19
- **Open conflict, unresolved:** the sidebar shown (wide ~270px, always-labeled, "New chat"
  button, full nav text, Recent Chats list, account panel at the bottom) contradicts
  `DESIGN.md` §3.1's current description: *"Narrow, icon-only with tooltips; expands to show
  labels on very wide viewports."* Every screenshot since the session started (`/chat`
  included) shows the wide labeled version, never the narrow icon dock. This needs a real
  §3.1 rewrite, not a phase-doc tweak, once intake closes.
- **Open question, unresolved:** sidebar nav includes a **"Documents"** item between `Contexts`
  and the divider. `DESIGN.md` §2.1's route table has no standalone `/documents` route — only
  `/contexts` and `/contexts/:id`. Asked the user whether this is a real new page (needs its
  own §6 entry + route) or should just alias into something that already exists. **Still
  waiting on an answer.**
- Additive, no conflict: search box, "Sort by" control, List/Grid view toggle on `/contexts` —
  not in the current spec for that screen, but don't contradict anything. Fold in at
  consolidation.
- Tinted folder icons per context (pale blue/green/lavender/amber/teal/slate) — additive,
  no conflict, matches the "restrained, not a rainbow UI" instruction given alongside it.

### 2.5 `/contexts/:id` — reviewed 2026-08-19
- Terminology self-correction confirmed by the user's own prompt text: use `DESIGN.md`'s real
  `StageChip` vocabulary (`Ready / Queued / Parsing / Chunking / Embedding / Failed`, filter
  labeled "All stages") — **not** the stale "Indexed / Pending / Indexing" / "All status" text
  visible in the actual reference screenshot pixels. Following the text instruction over the
  image on this one point.
- **Open question, unresolved:** `DESIGN.md`'s `DocumentTable` component (§5.10) specifies
  **Pages** and **Added** columns — Pages exists specifically to surface the scanned-vs-text
  split for the vision/ColPali pipeline (e.g. "40 scanned pages"); Added is the sortable
  ingestion timestamp. This screen's column set (checkbox / Name / Size / Stage / Chunks /
  Actions) omits both, and the prompt explicitly says not to add them back. **Asked the user
  whether this is an intentional simplification (amend §5.10, move scan info into a row-detail
  expansion instead) or an oversight while trimming the mockup. Still waiting on an answer.**
- "New context" button present on the context-detail page itself (not just the `/contexts`
  list) — unusual but not a conflict; it duplicates the `ContextSwitcher`'s existing
  quick-create entry point (§5.3), just surfaced as a second button. No spec change needed.

### 2.6 `/admin/traces` — reviewed 2026-08-19
**The reference image and its own accompanying prompt text disagree with each other**, not
just with `DESIGN.md` — the largest gap seen so far, on two axes:

1. **Row layout.** The prompt text says the defining motif is the `ProvenanceRibbon` compressed
   into each row (query → ribbon strip → `2,480ms · 3 sources · dense+sparse  View trace →`),
   matching `DESIGN.md` §6.8 exactly. The actual image instead renders a conventional data
   table (`Question | Context | Model | Latency | Status | Created` column headers, a
   select-all checkbox) with plain text/badge cells — **no ribbon graphic appears under any
   row.**
2. **Filter bar.** The text has an explicit "Do NOT add" list — Model filter, Export button,
   Search bar, Sort dropdown, Status filter, Filters button, Analytics cards/summary metrics —
   and specifies the time window defaults to `24h`. The image shows a search box, "Last 7
   days" (not 24h), an "All models" dropdown, a generic "Filters" button, *and* an "Export"
   button — i.e. nearly everything the text just banned.

**Resolved 2026-08-19 by a follow-up screenshot:** the user sent a corrected reference image
matching the text exactly — ribbon-row list (query → labeled 5-segment stage strip →
`2,480ms · 3 sources · dense+sparse · View trace →`), and the minimal filter bar (`Q3 Reports`
context filter, `24h` window, "Only slow" toggle showing its *computed* threshold `> 3,120ms`
with an info icon) with no search box, Model filter, Export button, or generic Filters button.
Confirms: the first image was the stale/generic one. Refused-state row also confirmed correct
(full ribbon still drawn, `0 sources · refused`, `View trace →` stays enabled, `⚠ 1` warning
marker shown) — matches §6.8's "a refusal is one of the most interesting things to inspect"
rule precisely.

**Half-resolved by a follow-up text-only message (no new image), same day:** the user's own
spec text confirms the ribbon keeps categorical color explicitly — *"Stage segments should
have different subtle accent colors... restrained Cerebro-compatible colors... keep them
visually cohesive."* So the ribbon side of the tension is settled: `EMBED`/`RETRIEVE`/`MERGE`/
`RERANK`/`GENERATE` each get their own restrained hue, harmonized with (not clashing against)
`cerebro-500`. **Still open:** whether branch chips (`dense`/`sparse`/`both`/`colpali`) stay
neutral/monochrome as currently written in `phase_3`, or get color back to match. Nothing sent
so far has touched branch chips directly, so this half is still an assumption, not a
confirmation — leaning toward leaving them neutral (branch identity is a property of a
*retrieved item*, closer to the evidence side of §7.4's evidence/interactive split, where color
was deliberately removed) unless told otherwise.

This same message also elaborates the ribbon's honesty rules in detail — skipped stage draws
no segment (never `0ms`), refused trace keeps its full ribbon, error trace draws no ribbon at
all, streaming trace shows an indeterminate track with no numbers yet — all verbatim matches
for `DESIGN.md` §5.7's existing rules, not new information. No conflicts in this message; it's
the confirmed final word on the trace-list row design, superseding both earlier reference
images.

Additive, no conflict either way: per-row **Model** display (which LLM answered — `gpt-4o`,
`claude-3.5-sonnet`, etc.) isn't in `DESIGN.md`'s §6.8 row anatomy but doesn't contradict
anything; worth adding to the row's metadata line (not a new table column) if the ribbon-row
version is confirmed. "All contexts" as a context-switcher value (top bar) — new state not in
the current `ContextSwitcher` (§5.3) spec, which only lists named contexts + "+ New context";
needed here and on `/contexts` since both are cross-context pages. Needs a §5.3 addition at
consolidation, not a conflict.

Everything else — sidebar (same open question as §2.4), "Traces" active-nav treatment, no
system metrics in the top bar, sort fixed newest-first with no duration-sort option (matches
`DESIGN.md`'s explicit reasoning verbatim), refused/error/streaming state handling, data-honesty
rules (em dash not fake `0ms`) — matches the spec cleanly.

### 2.7 `/admin/traces/:id` — reviewed 2026-08-19
**Largest and most comprehensive image/text mismatch of the whole intake — flagged as an open
decision, not defaulted on, because unlike the earlier stale-image cases this reads as a
second, coherent, deliberately-designed alternative rather than a sloppy leftover.** The text
matches `DESIGN.md` §6.9 / `phase_4` closely (Waterfall + Rerank Matrix in the primary column,
a Raw Payload drawer with `Prompt`/`Sources`/`Usage` tabs in the evidence margin, the
"retrieval actually ran on: …" condensation line, an explicit "do not add" list: no Export, no
Notes panel, no Actions panel, no Share/Copy link/Add to collection/Delete trace, no
`Answer & Citations`/`Retrieved`/`Model Output`/`Events` tabs). The attached image instead
shows:
- A tab bar — `Answer & Citations | Retrieved (50) | Reranked (10) | Prompt | Model Output |
  Events` — with `Answer & Citations` active, rendering an actual answer + citation cards
  (i.e. it reuses the Chat screen's content shape, which §19 of the text explicitly says not
  to do).
- A plain `STAGE | DURATION | START OFFSET | STATUS | DETAILS` data table in place of the
  graphical Waterfall — no skip-band for `CONDENSE`, no parallel-execution bracket for
  `SPARSE`/`COLPALI`, no first-token marker.
- No Rerank Matrix component at all (its content becomes two more tabs instead).
- A right margin of `Trace details` / `Notes` (textarea + Save) / `Actions` (Share trace, Copy
  link, Add to collection, red Delete trace) — no Raw Payload drawer anywhere.
- An `Export` button and an `Asked <timestamp> · 2.48s total · 3 sources` header line not in
  the text.

**Resolved 2026-08-19 by a corrected screenshot, same session.** The updated reference image
matches the text/`DESIGN.md` version precisely: graphical Waterfall with a hatched `CONDENSE`
skip-band, a `parallel` bracket over `SPARSE`/`COLPALI`, a first-token marker on `GENERATE`;
Rerank Matrix with curved connectors, `relevance floor 0.15`, and the below-floor candidate
kept visible struck-through; right margin is `RAW PAYLOAD` with `Prompt`/`Sources`/`Usage`
tabs — no Notes, Actions, Export, Share, Delete, or extra tabs anywhere. The tabbed
"Answer & Citations" version from the first image is confirmed as the discarded alternative,
not new scope.

**One genuinely new clarifying rule this corrected version establishes** (not explicit in
`DESIGN.md`'s prose before, though consistent with its own §6.9 ASCII diagram): the **compact**
ProvenanceRibbon directly under the trace header omits `CONDENSE` entirely — it shows only
stages that contributed measured time (`EMBED · SPARSE · COLPALI · RETRIEVE · MERGE · RERANK ·
GENERATE`). The hatched "skipped" treatment is reserved for the **expanded Waterfall only**;
the compact ribbon never draws a segment, hatched or otherwise, for a stage that didn't run.
Worth writing into `phase_4`/`DESIGN.md` §5.7 explicitly at consolidation, since the prose
version of that rule was implicit at best.

Stage-color legend used here (7 stages, since `SPARSE`/`COLPALI` are broken out separately in
the detail view, unlike the 5-segment trace-list ribbon): embed blue, sparse green, colpali
purple, retrieve orange, merge pink, rerank blue, generate teal. Needs an actual named
token/hex assignment at consolidation (`phase_1`/`phase_4`) rather than being re-eyeballed
per screen.

### 2.8 `/admin/vectors` — reviewed 2026-08-19
**Open conflict, unresolved — an explicit named rule, not an ambiguous style call.**
`DESIGN.md` §5.20 states the kept-vs-cut distinction on `PointCloud` neighbors *"must be a
shape difference, not a color difference"* (ring = survived the relevance floor, enlarged
without a ring = retrieved but cut). This image's own canvas-top legend instead encodes it by
color: `● Query (blue) · ● Top result (green) · ● Other results (purple) · ○ Documents
(gray)`. That legend also displaces the *other* core requirement — points colored per source
document, which is what makes the left-column document legend able to answer "is my
clustering clean" (§6.10's stated reason the legend exists at all) — with a retrieval-role
coloring instead. The left legend still lists 3 named documents (`q3.pdf`, `scan.pdf`,
`notes.md`), but the canvas shows 4 saturated cluster colors plus a separate gray
"Documents" catch-all, which doesn't map cleanly onto 3 per-document swatches either way.
**Leaning toward `DESIGN.md`'s version** (points colored per document; kept-vs-cut shown only
via ring/no-ring shape; no color used for retrieval role) since this is an explicit, named
rule rather than a style preference — but held open rather than silently overridden, since
the image otherwise reads as deliberate, not a stale leftover.

Smaller, non-blocking notes: a `View in context` button on the node inspector isn't in
`DESIGN.md`'s node-inspector field list (filename, heading path, position, chunk text,
distance, rerank score, kept/cut status) — new scope, not previously specified. An "All
chunks" dropdown and a generic "Filters" button in the top toolbar aren't in `DESIGN.md` §6.10
or this message's own text either — same "stray generic control" pattern as the first
`/admin/traces` draft (§2.6).

Confirmed correct, no conflict: the beacon renders `--signal` blue, matching the §7.4
amendment already made (not the retired amber) — first cross-screen confirmation that
decision reads right in practice. No auto-rotation. Fresh-state status line
(`"5,412 chunks · 12 documents · fitted 2h ago"`) matches §6.10's format exactly. Beacon input
placeholder verbatim. Neighbor links fading by rank. No per-dimension variance/contribution
panel, no similarity-formula display — both explicitly and deliberately absent per §6.10.

### 2.9 `/admin/health` — reviewed 2026-08-19
**Largest mismatch of the whole intake — the image is essentially the generic SaaS analytics
dashboard both the text and `DESIGN.md` explicitly warn against building.** The text's own
"Do NOT include" list bans KPI cards (`Ingestion 24h`, `Chat queries 24h`, `P95 latency 24h`),
a "Recent traces" panel, a "Background jobs" panel, and a services/uptime/version table — the
image contains all four, plus a "Pipeline health" per-*stage* latency table (Condense/Embed/
Sparse retrieval/ColPali retrieval/Retrieve(merge)/Rerank/Generate — P50/P95/error-rate
columns) that matches neither the text nor `DESIGN.md` §6.11, which specifies per-*dependency*
cards (`mongo`/`qdrant`/`redis`/`vision`/`cohere`/`llamaparse`/`llm`), not per-pipeline-stage
rows.

Nearly everything the text and `DESIGN.md` §6.11 actually require is **absent** from the
image:
- No DEGRADED banner naming the failing dependency — text was explicit this is the state to
  demonstrate (`"● DEGRADED — llamaparse is not responding"`); image shows a generic green
  "Healthy" banner instead.
- No per-dependency latency + sparkline cards, no `"last 20 polls (5 min)"` sparkline label
  (the data-honesty rule that the sparkline starts empty and never back-fills fake history).
- No Circuit Breakers section (`qdrant closed 2h`, `cohere closed 2h`, `llamaparse open 4m`).
- No Ingest Queue section (`waiting 3 · active 2 · failed 1 · 4.2/min · 2 workers`).
- No Pipeline Errors feed (filter `[All ▾]`, pause `[⏸ Pause]`, `PARSE bad.pdf — no
  extractable text — 2 min ago`, `NOTIFY SMTP connection refused — 18 min ago`, expandable
  stack-trace chevrons).

Top bar also shows a `Q3 Reports` context switcher where the text and `DESIGN.md` §3.1 both
call for the page name (`Health / Operations`) — this page has no context concept, it's
system-wide and admin-only.

**Default applied with higher confidence than earlier big mismatches, but still logged as
pending, not silently assumed:** build the `DESIGN.md`/text version (DEGRADED banner,
per-dependency cards with bounded sparklines, Circuit Breakers, Ingest Queue, Pipeline Errors
feed, page-name top bar) — every prior big mismatch this session that got a follow-up
correction landed on the text/`DESIGN.md` side, and here the text's own explicit warnings
(*"Do NOT design this as a generic SaaS dashboard"*) describe exactly what the image is. If
a corrected screenshot doesn't arrive, treat this default as final at consolidation.

### 2.10 `/reset-password` — reviewed 2026-08-19
Reinforces the split-screen auth layout for the 5th consecutive screen (`/login`, `/signup`,
`/forgot-password`, `/contexts`'s sidebar pattern, now this) — no new flag, see open question
1. Confirms two things cleanly: no avatar/user menu on this public route (only the theme
toggle shown, consistent with the rule confirmed in §2.3); the icon-in-circle card-header
treatment is shared between `/forgot-password` and `/reset-password` specifically (both
"action" cards, as opposed to `/login`/`/signup`'s plain heading-only cards) — a useful
clarification of a pattern first noticed in §2.2/§2.3, not a conflict.

**Not a conflict — explicit demo composite.** The image shows the OTP boxes and the
password-setting form simultaneously in one card. The prompt text itself says this is
deliberate: *"show the AWAITING_CODE state progressing into the password-setting form, so the
screen clearly communicates the complete reset flow"* — a one-image illustration of a
multi-state flow, not the literal runtime UI. `DESIGN.md`'s actual state machine (§6.4) keeps
`AWAITING_CODE` and `SETTING_PASSWORD` mutually exclusive at runtime. Note for
implementation: the resend-code control also needs repositioning — the image places a plain,
seemingly-always-enabled `Resend code` link at the very bottom of the card, but `DESIGN.md`/
the text want it directly under the OTP row, paired with the countdown, and visibly disabled
during the 60-second cooldown.

**Real conflict, and not a one-off — needs an explicit call.** The password-requirement
pattern shown (`"At least 8 characters"` as a live 3-item checklist: length / number /
uppercase, each with its own checkmark) contradicts `DESIGN.md` §5.17 directly: the spec calls
for **one static hint line** (`"At least 12 characters. Longer is better than more
complicated."`) plus an *advisory-only* strength meter that blocks submission **only on the
length minimum** — reasoned explicitly that a character-class checklist would be "pretending
to enforce" rules the client can't actually guarantee, since the real check is a server-side
breached-password list. The earlier `/signup` screenshot (session start) showed the same
8-character pattern too (`"Min. 8 characters with a number and a symbol"`), so this reads as a
consistent, probably intentional new direction rather than a fluke — but it overrides a
reasoned, named rule, so it needs an explicit answer: adopt the 8-char/checklist pattern
(amend §5.17 and §6.2's copy), or keep `DESIGN.md`'s 12-char/advisory-meter/length-only-block
design?

**This closes out `DESIGN.md`'s screen catalogue (§6) except dialogs/overlays (§7).**

---

## 3. Open questions — ALL RESOLVED 2026-08-19 by "CEREBRO — FINAL UI DESIGN DECISIONS"

1. **Split-screen auth layout** → confirmed, applies to all four public auth routes.
   Implemented: `DESIGN.md` §6.1 (full rewrite + `AtmosphericBackground` treatment), §6.2–§6.4
   (shell references updated), `phase_1` §6. (§2.2)
2. **"Documents" nav item** → not a real route; removed from the canonical nav. Implemented:
   `DESIGN.md` §2.2 (explicit negative-scope line added so it doesn't recur). (§2.4)
3. **`DocumentTable` Pages/Added columns** → keep them; the mockups that dropped them were
   wrong, `DESIGN.md` §5.10 already specified both correctly and needed no edit. (§2.5)
4. **Sidebar shape** → wide/labeled confirmed as canonical, with `+ New chat`, Recent Chats,
   and the account panel all specified. Implemented: `DESIGN.md` §2.2 (full structure),
   §3.1 (width), §4 (responsive table — icon-dock demoted to a narrow-viewport fallback only).
   (§2.4)
5. `/admin/traces` ribbon-row list — **resolved earlier** by a corrected screenshot, reconfirmed
   here. (§2.6)
6. **Branch-chip color** → confirmed neutral/monochrome, labels remain the only signal.
   Ribbon stage colors stay categorical. No `DESIGN.md` edit needed (§5.5 was already
   color-agnostic); `phase_3`'s neutral-chip amendment stands as final. (§2.6)
7. `/admin/traces/:id` Waterfall/Rerank Matrix/Raw Payload — **resolved earlier** by a
   corrected screenshot, reconfirmed here. Stage-color hex values still need assigning at
   implementation time, not a spec question. (§2.7)
8. **`/admin/vectors` `PointCloud` coloring** → confirmed `DESIGN.md` §5.20's version (color =
   document, kept/cut = shape only); the retrieval-role-colored mockup is discarded. No
   `DESIGN.md` edit needed — §5.20/§6.10 already specified this correctly. (§2.8)
9. **`/admin/health`** → confirmed the DEGRADED/Dependencies/Circuit-Breakers/Ingest-Queue/
   Pipeline-Errors console; the generic KPI-cards/Recent-traces/Background-jobs/Services-uptime
   mockup is discarded. No `DESIGN.md` edit needed — §6.11 already specified this correctly.
   (§2.9)
10. **Password-requirement pattern** → confirmed `DESIGN.md` §5.17's version (12-char hint
    line, advisory-only meter, blocks on length only); the 8-char/hard-checklist mockups are
    discarded. No `DESIGN.md` edit needed — §5.17/§6.2 already specified this correctly;
    `phase_1` §6.2 now has an explicit note recording the rejected alternative so it doesn't
    recur.

## 4. Not yet reviewed

Only dialogs/overlays (`DESIGN.md` §7) remain unreviewed against a reference screenshot — every
screen in the §6 catalogue has been sent and resolved at least once. Given intake is closed,
dialogs/overlays will be built directly from `DESIGN.md` §7's existing text at implementation
time unless the user sends reference screens for them first.

## 5. Amendments actually written back into the spec (2026-08-19)

- `DESIGN.md` §2.2 — full nav rewrite: `+ New chat`, Recent Chats, account panel, explicit
  "no Documents item" note.
- `DESIGN.md` §3.1 — rail width (wide/labeled, not icon-only-by-default).
- `DESIGN.md` §4 — responsive table updated so the icon-dock is a narrow-viewport fallback,
  not the wide-viewport default.
- `DESIGN.md` §6.1 — full split-screen rewrite, new `AtmosphericBackground` treatment,
  header/footer structure.
- `DESIGN.md` §6.2, §6.3, §6.4 — shell references updated to point at §6.1's split-screen
  version; §6.2 records the rejected 8-char/checklist password alternative.
- `phase_1` §6 — auth-screen intro rewritten to match the split-screen shell.
- (From earlier in the session, unrelated to this final-decisions message: `architecture.md`
  §7.4, `phase_1` §§2.1–2.4/§6, and token references across `phase_2`/`phase_3`/`phase_4`/
  `phase_7`/`phase_8` for the `cerebro-500` palette and single-typeface system — see §1 above.)

No other `DESIGN.md` edits were needed: §5.5 (BranchChip), §5.10 (DocumentTable), §5.17
(PasswordField), §5.20 (PointCloud), and §6.11 (`/admin/health`) were already correct — the
conflicts were in generated mockups, not the spec, so those get discarded rather than the doc
amended.

## 6. Phase-coverage audit (2026-08-19, after consolidation)

Audited every screen, dialog, and boundary state in `DESIGN.md` §6/§7 against the eight phase
docs, plus every item this file marked *"fold in at consolidation."* All 11 routes were already
assigned (Phase 1 auth + shell, Phase 2 contexts, Phase 3 chat, Phase 4 inspector consoles).
**Eight gaps found and closed:**

| # | Gap | Fixed in |
|---|---|---|
| 1 | **Phase-overlap violation** — the §2.2 rail amendment gave Phase 1 a Recent Chats list while Phase 3 still owned `ThreadSidebar`, putting one feature in two phases against the sequencing law | `phase_1` §7.3 (builds a flat list, declares the boundary), `phase_3` §7.2 (rewritten as an *extension*: grouping, rename, delete, ctx filter only) |
| 2 | **Design conflict the overlap exposed** — `DESIGN.md` §6.7 still specified a thread panel left of the transcript, contradicting the rail's Recent Chats; no reference screen ever showed both | `DESIGN.md` §6.7 (panel retired; the rail is the only thread list) |
| 3 | `PageImageLightbox` (§7.6) — specified in `DESIGN.md`, in **no** phase | `phase_3` §5.2 + task 3.24 + file list |
| 4 | `ReindexDialog` (§7.4) — behavior was covered but the component had no file entry | `phase_2` §10 file list |
| 5 | **404 / `NotFound` content** — file listed and route wired, but the screen was never specified anywhere, despite being the security-relevant response for admin routes | `phase_1` §6.5 + task 1.14b (incl. a byte-identical-markup criterion) |
| 6 | `/contexts` search, sort, and List/Grid switcher — logged here as "fold in at consolidation," never folded in | `phase_2` §3.1a + task 2.3a |
| 7 | `/contexts` per-context tints — same | `phase_2` §3.1b + task 2.3b |
| 8 | `ContextSwitcher` "All contexts" scope value; compact-ribbon skipped-stage rule; `--stage-*` color tokens — all logged as fold-ins, none folded in | `DESIGN.md` §5.3; `phase_4` §3.1; `phase_1` §2.1 (8 tokens, both themes, `@theme` bridge) |

Also folded in while auditing: the `--stage-*` vs retired `--branch-*` rationale (`phase_1`
§2.1), since those read as the same decision made twice in opposite directions.

**Not folded in, deliberately:** per-row Model display on the trace list (§2.6). It is real
data (`TraceDetail.tokens.model`) and would be additive, but `DESIGN.md` §6.8's row anatomy
doesn't include it and nothing has asked for it — noting it as available rather than
smuggling it in.

## 7. Phase-readiness audit — all eight phases (2026-08-19)

Checked every phase for the CLAUDE.md §4.2 required sections, anti-punting violations
(§5.1), and — the real risk — downstream breakage from the UI amendments, since phases 5–8
were written before any of them.

**Structure:** all eight carry Objective (with a bold negative-scope line), a Tasks &
Acceptance Criteria table, and a Milestone Definition. Phase 8 has no *Files to Create* tree,
which is correct rather than missing — it ships deployment configs (§4) instead of new
components, and CLAUDE.md lists that closer as "include the ones that apply." Zero
anti-punting violations across all eight plus `architecture.md`.

**Four downstream breaks found and fixed** (all caused by the amendments, all in later phases
that nobody had re-read since):

| Break | Fixed in |
|---|---|
| `phase_6` §9 planned to strip a `PHASE-6-REMOVE` marker from `ThreadSidebar.tsx` — a file `phase_3` now deletes outright. The marker moved into `Sidebar.tsx` with the thread list | `phase_6` §9 |
| `phase_8` §6's forced-colors note named **branch chips** as the color-dependent a11y risk. They are now neutral/monochrome; the real risks are the new `--stage-*` segments and the point-cloud ring | `phase_8` §6 |
| `phase_8` §6's width row checked only the evidence margin — not the rail's three-tier collapse, and not the new split-screen auth shell at narrow widths | `phase_8` §6 (row rewritten + a new auth-widths row) |
| `phase_1`'s Objective and negative-scope line still described the old scope — no shell, no boundary screens, and silent on how much of Recent Chats belongs to Phase 1 vs Phase 3 | `phase_1` §1 |

**Verified sound, no change needed:** `phase_5`'s `PASSWORD_MIN = 12` matches the confirmed
password rule; `phase_7`'s projection payload already carries per-document `color`, which is
what the confirmed "color = document" `PointCloud` rule needs; `phase_7`'s `GET /api/traces`
already treats `contextId` as optional, so the new `All contexts` scope needs no backend
change (recorded explicitly in `phase_4` §2.3 so the implementer doesn't invent a sentinel
value); `phase_4` §5's health console already matches `DESIGN.md` §6.11's five regions, so the
rejected dashboard mockup never leaked into it.

### 7.1 Second pass — phases 1–4 (same day, after a correct challenge)

The audit above deep-checked phases 5–8 on the assumption that 1–4 were already clear from the
§6 screen-coverage sweep. That was wrong: §6 checked *which phase owns which screen*, not
whether the day's edits left 1–4 internally consistent — and 1–4 are where nearly every edit
landed. Re-audited properly; **five more gaps**, all self-inflicted, all the same class as the
phase 5–8 breaks:

| Gap | Fixed |
|---|---|
| `phase_4`: the `All contexts` trace filter got prose but **no acceptance criterion** — nothing checked that it omits `contextId` rather than sending a sentinel | new task 4.3a |
| `phase_4`: the compact-ribbon skipped-stage rule got prose but no criterion either. Task 4.5 checks the *waterfall's* hatched band; nothing checked that the *compact* ribbon draws no segment — precisely the distinction §3.1 calls easy to mistake for a bug | new task 4.3b |
| `phase_3`: complexity total said ~3,090 but the rows summed to 3,030 after the ThreadSidebar row shrank, and `PageImageLightbox` was in the file tree but in no complexity row | row added, total → ~3,170 / 20 files |
| `phase_2`: complexity accounted for none of the toolbar, tints, or `ReindexDialog` | two rows added, total → ~3,060 / 25 files |
| `phase_1`: the eight new `--stage-*` tokens had **no acceptance criterion at all**, and §2.2 never said why they are exempt from the contrast table | new task 1.3a (ΔE mutual-distinguishability check) + a §2.2 paragraph explaining the WCAG 1.4.11 reasoning; complexity row split so the boundary screens are named rather than hidden behind an ellipsis |

Verified clean on this pass: task numbering is contiguous in all four (including the inserted
`1.14b` / `2.3a` / `2.3b` / `3.24`); no dangling prose reference to a renumbered task (`3.24`
→ `3.25` broke nothing); every section number cited by new prose resolves; and every feature
added today now has both a task row and a complexity line. `phase_1`'s complexity arithmetic
was hand-verified (260+900+340+1050+560+180+120 = 3,410) after an automated check
false-flagged it by reading "~40 files touched" as a LOC figure.

**Conclusion: all eight phases are implementable in order.** Phase 1 is the next thing to
build.
