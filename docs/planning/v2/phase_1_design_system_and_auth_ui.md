# Phase 1: Design System, Shell & Auth Surfaces

> Depends on: nothing. This is the first v2 phase.
> Backend changes: **none**. Every endpoint this phase touches either already exists or is
> served by the dev-only mock adapter.

## 1. Objective

At the end of this phase Cerebro has **one visual language** — a token-driven palette and
type system that works in light and dark mode with a toggle in the header — the **v2 route
tree**, a **single typed network boundary** at `frontend/src/api/`, the **full application
shell** (the wide labeled rail with `+ New chat`, navigation, a flat Recent Chats list, and
the account panel, plus the top bar), **every authentication screen** — sign in, sign up,
forgot password, OTP entry, password reset — and the **three boundary screens** (404, backend
unreachable, route loading). The four existing inline-`fetch` call sites are migrated onto the
new boundary with zero behavior change, and the two remaining fabricated UI elements in the
shell are deleted.

By the end of this phase: a visitor loads the app, is redirected to `/login`, signs up with
an email and password against the mock session adapter, lands on `/chat`, flips the theme
from dark to light in the header, and every surface — including the chat page carried over
from v1 — changes with it in a single frame.

**No contexts, no document explorer, no chat rework, no inspector consoles, and no backend
code whatsoever.** The auth screens talk to a mock. Chat still works exactly as it does
today, just restyled. Recent Chats is a **flat, read-only list** here — its recency grouping,
rename, delete, and context filter are Phase 3's (§7.3). This phase builds the frame and
proves the design system on the hardest small surface there is — a form.

---

## 2. The Design Language

The full rationale is in [architecture.md §7.4](architecture.md). This section is the
implementable specification.

### 2.1 Color Tokens

**Amended 2026-08-19, values locked 2026-08-19 (second pass).** The original two-hue-family
scheme (`signal` blue for interaction, `evidence` amber for grounding, on a warm-paper base)
is retired. It is replaced by a single-accent palette shown in the reference screenshots:
near-white surfaces with a hairline cool cast, a dedicated navy `ink` scale, and **one brand
blue, `cerebro-500` (`#004FFE`), as the only accent** — not a generic Tailwind blue, a named
brand color with its own shade scale, because a generated screen substituting `blue-500` for
`cerebro-500` produces a visibly different, off-brand blue. Emerald/amber/red remain generic
status semantics (success/warning/error) only, never decoration, never a stand-in for "this
was retrieved." Token *names* are kept from the original scheme wherever the concept survives
(`--surface`, `--ink`, `--line`, `--signal`, `--positive` / `--warn` / `--critical`) so the
rest of this document, and phases 2–4, do not need a token-by-token rewrite — only their
**values**, and the removal of the `--evidence` / `--branch-*` families, changed. See
architecture.md §7.4 for why the evidence-vs-interactive distinction moves from color to
layout and container treatment.

`frontend/src/styles/theme.css` — replaces the existing placeholder shadcn defaults entirely:

```css
@custom-variant dark (&:is(.dark *));

:root {
  /* ── Surfaces ─────────────────────────────────────────────────────────── */
  --surface:            #FBFBFE;  /* app background, near-white with a hairline cool cast */
  --surface-raised:     #FFFFFF;  /* cards, the composer, the evidence margin — pure white */
  --surface-sunken:     #F5F7FD;  /* wells: code blocks, table headers, quote blocks */
  --surface-overlay:    #FFFFFF;  /* dialogs, popovers, dropdowns */
  --scrim:              rgb(8 13 28 / 0.45);   /* ink-950 based modal backdrop */

  /* ── Ink ──────────────────────────────────────────────────────────────── */
  --ink:                #080D1C;  /* ink-950 — primary text, page titles */
  --ink-secondary:      #293858;  /* ink-700 — body copy that is not the headline */
  --graphite:           #64779A;  /* ink-500 — labels, metadata, captions */
  --graphite-faint:     #8B9AB8;  /* one step past ink-500 — placeholder/disabled ONLY, see §2.2 */

  /* ── Lines ────────────────────────────────────────────────────────────── */
  --line-subtle:        #EAEFF7;
  --line:               #DFE5F2;  /* default border */
  --line-strong:        #CBD5E5;  /* focused control, emphasized dividers */

  /* ── Signal: the one accent, used for everything interactive ──────────── */
  --signal:             #004FFE;  /* cerebro-500 — primary buttons, links, active nav, focus */
  --signal-hover:       #0046E8;  /* cerebro-600 */
  --signal-active:      #003CC7;  /* cerebro-700 — pressed/active state */
  --signal-soft:        #EFF5FF;  /* cerebro-50 — selected row, active nav pill */
  --signal-soft-line:   #DDE9FF;  /* cerebro-100 — border paired with signal-soft */
  --signal-on:          #FFFFFF; /* text on a signal-filled surface */
  --signal-ring:        rgb(0 79 254 / 0.10);   /* focus ring, matches `ring-cerebro-500/10` */

  /* ── State (semantic ONLY — never decorative, never used to mark evidence) */
  --positive:           #059669;  /* emerald-600 — icons, dots, large text */
  --positive-text:      #047857;  /* emerald-700 — small text on `-soft`, see §2.2 */
  --positive-soft:      #ECFDF5;  --positive-soft-line: #D1FAE5;
  --warn:               #D97706;  /* amber-600 */
  --warn-text:          #B45309;  /* amber-700 */
  --warn-soft:          #FFFBEB;  --warn-soft-line:     #FEF3C7;
  --critical:           #DC2626;  /* red-600 */
  --critical-text:      #B91C1C;  /* red-700 */
  --critical-soft:      #FEF2F2;  --critical-soft-line: #FEE2E2;

  /* ── Pipeline stage identity ──────────────────────────────────────────────
     Categorical, NOT semantic: these name a stage, they never mean good/bad.
     Used ONLY by the ProvenanceRibbon and the Waterfall (phase_3 §6, phase_4
     §3.2). Added 2026-08-19 — previously eyeballed per screen, which is how a
     "restrained set" becomes seven unrelated hues. Chosen to sit at similar
     saturation and lightness so no single stage reads as the important one;
     `--stage-embed` is deliberately NOT --signal, so a ribbon segment is never
     mistaken for an interactive element. Distinguishable under the common
     red-green deficiencies; the ribbon also carries text labels, so color is
     never the only channel (DESIGN.md §5.7).                              ── */
  --stage-condense:     #7C8AA8;   /* muted slate — the stage most often skipped */
  --stage-embed:        #3B7DD8;
  --stage-sparse:       #2E9E7A;
  --stage-colpali:      #8B5CD6;
  --stage-retrieve:     #D9822B;
  --stage-merge:        #C2568F;
  --stage-rerank:       #4B6FD6;
  --stage-generate:     #1FA6A6;

  /* ── Type ─────────────────────────────────────────────────────────────── */
  --font-sans: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif;

  /* ── Geometry — mapped onto Tailwind's own scale, not a bespoke one ────── */
  --radius-sm:  6px;    /* chips, badges, inline code — ~rounded-md */
  --radius:     8px;    /* buttons, inputs — rounded-lg */
  --radius-lg:  12px;   /* cards, dialogs, panels — rounded-xl */
  --radius-pill: 999px;

  /* ── Elevation. Borders carry most separation; shadow is a light finish. ── */
  --shadow-1: 0 1px 2px rgb(15 23 42 / 0.04);                                  /* shadow-sm */
  --shadow-2: 0 4px 20px rgb(15 23 42 / 0.04);                                 /* major panels */
  --shadow-3: 0 4px 20px rgb(15 23 42 / 0.08), 0 1px 3px rgb(15 23 42 / 0.06); /* dialogs only */
}

.dark {
  --surface:            #0B1224;  /* ink-900 — app background */
  --surface-raised:     #17213A;  /* ink-800 — cards sit ABOVE by getting LIGHTER, not by shadow */
  --surface-sunken:     #080D1C;  /* ink-950 — darker than the page, wells */
  --surface-overlay:    #17213A;
  --scrim:              rgb(8 13 28 / 0.66);   /* ink-950 based */

  --ink:                #F1F5FB;  /* near-white, cool cast to match the light-mode surface tint */
  --ink-secondary:      #C7D0E0;
  --graphite:           #8B9AB8;
  --graphite-faint:     #64779A;  /* ink-500 — flips light mode's graphite/graphite-faint pair */

  --line-subtle:        #17213A;
  --line:               #17213A;
  --line-strong:        #293858;  /* ink-700 */

  --signal:             #4F82FF;  /* cerebro-400 — brighter than light mode for dark-bg contrast */
  --signal-hover:       #8FB2FF;  /* cerebro-300 */
  --signal-active:      #BDD2FF;  /* cerebro-200 */
  --signal-soft:        rgb(79 130 255 / 0.16);   /* alpha, not hex — see note below */
  --signal-soft-line:   rgb(79 130 255 / 0.32);
  --signal-on:          #FFFFFF;
  --signal-ring:        rgb(79 130 255 / 0.45);

  --positive:           #34D399;  /* emerald-400 */
  --positive-text:      #6EE7B7;  /* emerald-300 */
  --positive-soft:      rgb(52 211 153 / 0.15);  --positive-soft-line: rgb(52 211 153 / 0.30);
  --warn:               #FBBF24;  /* amber-400 */
  --warn-text:          #FCD34D;  /* amber-300 */
  --warn-soft:          rgb(251 191 36 / 0.15);  --warn-soft-line:     rgb(251 191 36 / 0.30);
  --critical:           #F87171;  /* red-400 */
  --critical-text:      #FCA5A5;  /* red-300 */
  --critical-soft:      rgb(248 113 113 / 0.15); --critical-soft-line: rgb(248 113 113 / 0.30);

  /* Stage hues lifted toward the light end for a dark ground — same hue order,
     same relative spacing, so a ribbon reads identically in both themes.
     Amended 2026-08-19 (implementation): --stage-rerank's straight lift
     (#8AA6F0) measured ΔE 7.21 from --stage-embed — below task 1.3a's own
     ΔE-10 requirement, caught by running the ΔE script the task specifies
     against these exact values. Shifted further toward indigo, continuing
     the same direction light mode's rerank already leans relative to embed
     (this block, three rows up); the new pair clears ΔE 22. */
  --stage-condense:     #94A3BE;
  --stage-embed:        #6BA3F0;
  --stage-sparse:       #5CC8A0;
  --stage-colpali:      #B18CEC;
  --stage-retrieve:     #F0A65C;
  --stage-merge:        #E086B4;
  --stage-rerank:       #6C63D6;
  --stage-generate:     #4FC9C9;

  --shadow-1: 0 1px 2px rgb(0 0 0 / 0.40);
  --shadow-2: 0 4px 20px rgb(0 0 0 / 0.35);
  --shadow-3: 0 16px 40px rgb(0 0 0 / 0.60);
}
```

> **Why dark mode's `-soft` tokens are alpha, not hex.** The original scheme hand-picked a
> hex value for each dark `-soft` token and warned that copying the light value (or lightening
> it) produces a selected-row background that is 90% white on a near-black page — the value had
> to be manually pushed toward `--surface` instead of toward `--signal`. Using `rgb(<hue> / 0.16)`
> composites the accent directly over whatever `--surface` already is, so it is correct by
> construction and there is no hex to get wrong. This applies to every `-soft` token in `.dark`.

> **Retired: the `--evidence` and `--branch-*` families.** There is no longer a dedicated hue
> for "this was retrieved," and the rerank-matrix branch chips (`dense` / `sparse` / `both` /
> `colpali`) no longer carry individual colors. Both are covered in architecture.md §7.4 and
> phase_4 §5 — the short version: evidence is marked by the evidence margin's position, the
> `--surface-sunken` + `--line-strong` quote-block container, and the citation index badge
> (filled `--signal`, same as any other numbered UI marker); branch identity is marked by its
> text label alone, on a neutral `--surface-sunken` pill.

> **Why `--stage-*` is categorical but `--branch-*` was retired.** These look like the same
> decision made twice in opposite directions, so the distinction is worth stating. A **stage**
> is a position in a fixed, ordered, eight-long pipeline that every query walks in the same
> sequence — the color is a legend for a chart axis, and the ribbon would be an undifferentiated
> bar without it. A **branch** is a property of an individual retrieved candidate, which puts it
> on the evidence side of §7.4's evidence/interactive split, where the whole argument was that
> color is the wrong channel and the label is the right one. One is charting a fixed process;
> the other is annotating a variable result.

Then the Tailwind v4 bridge, so `bg-surface` / `text-graphite` / `border-line` work as
ordinary utilities instead of arbitrary-value escapes:

```css
@theme inline {
  --color-surface:            var(--surface);
  --color-surface-raised:     var(--surface-raised);
  --color-surface-sunken:     var(--surface-sunken);
  --color-surface-overlay:    var(--surface-overlay);
  --color-ink:                var(--ink);
  --color-ink-secondary:      var(--ink-secondary);
  --color-graphite:           var(--graphite);
  --color-graphite-faint:     var(--graphite-faint);
  --color-line-subtle:        var(--line-subtle);
  --color-line:               var(--line);
  --color-line-strong:        var(--line-strong);
  --color-signal:             var(--signal);
  --color-signal-hover:       var(--signal-hover);
  --color-signal-active:      var(--signal-active);
  --color-signal-soft:        var(--signal-soft);
  --color-signal-soft-line:   var(--signal-soft-line);
  --color-positive:           var(--positive);
  --color-positive-text:      var(--positive-text);
  --color-positive-soft:      var(--positive-soft);
  --color-warn:               var(--warn);
  --color-warn-text:          var(--warn-text);
  --color-warn-soft:          var(--warn-soft);
  --color-critical:           var(--critical);
  --color-critical-text:      var(--critical-text);
  --color-critical-soft:      var(--critical-soft);
  --color-stage-condense:     var(--stage-condense);
  --color-stage-embed:        var(--stage-embed);
  --color-stage-sparse:       var(--stage-sparse);
  --color-stage-colpali:      var(--stage-colpali);
  --color-stage-retrieve:     var(--stage-retrieve);
  --color-stage-merge:        var(--stage-merge);
  --color-stage-rerank:       var(--stage-rerank);
  --color-stage-generate:     var(--stage-generate);
  --font-sans:                var(--font-sans);
  --radius-sm:                var(--radius-sm);
  --radius:                   var(--radius);
  --radius-lg:                var(--radius-lg);
}
```

### 2.2 Contrast Verification

**Amended 2026-08-19, target lowered from AAA to AA; values recomputed 2026-08-19 (second
pass) for the locked `cerebro`/`ink` scale.** The retired warm-paper scheme was tuned to hit
AAA (7:1) on body text. The reference palette targets AA (4.5:1 normal text, 3:1 large text /
UI) instead — matching the locked hex table exactly is worth more than clearing a bar the
reference screenshots do not clear. Pairs below are computed with the WCAG 2.1
relative-luminance formula against `--surface-raised` (`#FFFFFF`), since that is where most
text sits (cards, the evidence margin, the composer):

| Pair | Ratio | Required | Verdict |
|---|---|---|---|
| `ink` (#080D1C) on white | 19.4:1 | ≥ 4.5:1 (AA body) | pass, wide margin |
| `ink-secondary` (#293858) on white | 7.82:1 | ≥ 4.5:1 | pass |
| `graphite` (#64779A) on white | 4.52:1 | ≥ 4.5:1 | pass, **narrowly** |
| `graphite-faint` (#8B9AB8) on white | 2.83:1 | ≥ 3:1 (AA large/non-text) | **fails** — see restriction below |
| `signal` (#004FFE) on white | 5.92:1 | ≥ 4.5:1 | pass |
| `signal-on` (#FFFFFF) on `signal` | 5.92:1 | ≥ 4.5:1 | pass (same pair, inverted) |
| `positive-text` (#047857) on `positive-soft` (#ECFDF5) | 5.21:1 | ≥ 4.5:1 | pass |
| `positive` (#059669) on `positive-soft` | 3.58:1 | ≥ 4.5:1 | **fails for body text** — see restriction below |
| `line` (#DFE5F2) on white | 1.18:1 | non-text separator — no minimum | n/a |

Two restrictions follow directly from the failing rows, both enforced by review rather than
tooling, the same discipline the retired scheme used:

1. **`graphite-faint` is never used for text a user must read.** It is restricted to
   decorative and non-essential marks: divider glyphs, disabled-control placeholders, and the
   `title`-attribute timestamp (not its visible label). Any *visible* metadata label (a
   document's "Added" column, a citation's location line) uses `graphite` (4.52:1), never
   `graphite-faint`.
2. **A status color's `-600` value is for icons, dots, and bold/large text only.** Small body
   text on that status's `-soft` background uses the `-text` variant instead (`positive-text`,
   `warn-text`, `critical-text` — the `-700` shade), which is what makes the "System healthy"
   label, badge text, and inline error copy pass AA. The `HealthIndicator` (§5.13) top-bar
   dot is a `-600`-filled circle (large/non-text, 3:1 suffices); its adjacent label text is
   `-text`.

**The `--stage-*` tokens are deliberately absent from this table.** They color ribbon and
waterfall segments, which are graphical objects — WCAG 1.4.11 requires 3:1 against adjacent
colors only for graphics **required to understand the content**. Here they are not required:
every segment carries its stage label, and the waterfall additionally carries a per-row
duration, so a reader who perceives no color difference at all still gets stage name and
timing (the §1.4.1 redundancy `phase_8` §6 verifies). What the stage hues must satisfy is
**mutual** distinguishability rather than contrast against a background — eight adjacent
segments that read as eight things — which is what task 1.3a's ΔE check enforces instead.

Dark-mode pairs are not re-tabulated here: they follow the same lightness relationship as
light mode, one or two stops up the `cerebro`/`emerald`/`amber`/`red` scales
(`cerebro-400`, `emerald-400`, etc.) against the `ink-900`/`ink-800` dark surfaces. Task 1.3's
acceptance criterion is running
an automated contrast check (e.g. `axe-core`) against both themes and confirming zero
violations outside the two restricted tokens above, which are asserted by lint rule (§8) not
by the contrast checker.

### 2.3 Elevation Is Lightness First, Shadow Second

**Amended 2026-08-19.** The retired scheme used lightness-as-elevation only in dark mode,
because its light-mode page and card were both near-white. That is no longer true: light
mode now has a real gap between `--surface` (near-white, the page) and `--surface-raised`
(pure white, cards) — the same atmospheric-background-vs-card contrast the reference screenshots
show. So **both modes now use the same ordering**, `--surface-sunken` < `--surface` <
`--surface-raised` < `--surface-overlay`, and shadow is a restrained finishing touch on top
of that gap rather than the primary separator — per the visual spec, "the border should
usually provide most of the visual separation." Concretely: cards use `border border-line`
plus `shadow-1` (`shadow-sm`); only dialogs and the command palette use `shadow-3`, the one
"major floating surface" shadow. `shadow-2` exists solely for the evidence margin's raised
panel and the top bar's bottom edge when content scrolls beneath it.

The practical rule for every component: set a `bg-surface-*` token, a `border-line`, **and**
the shadow appropriate to its elevation tier. Never rely on shadow alone — a border must
always be present, since shadow is the part most likely to be invisible at low opacity or on
a printed/high-contrast override.

### 2.4 Typography

**Amended 2026-08-19: one family, not three.** The retired scheme used a display serif
(IBM Plex Serif) for headlines and a separate monospace (JetBrains Mono) for tabular data —
an editorial, instrument-panel voice. The reference screenshots use **one sans family (Inter)
everywhere**, differentiated by weight and size only, which is also what DESIGN.md §9 calls
for ("avoid excessive bold text"). The six roles below keep their original names — phase 2–4
prose refers to "the Display role" or "Data type," and those references still resolve
correctly — but every role now renders in Inter:

```
Display  Inter   700   Page titles, empty-state headlines, auth screen headings
                       text-2xl → text-3xl (1.5rem → 1.875rem), line-height 1.2

Section  Inter   600   Panel headers, card titles, section headings
                       text-lg (1.125rem), line-height 1.35

Body     Inter   400   Everything readable — prose, descriptions, chat answers
                       text-sm → text-base (0.875rem → 1rem), line-height 1.6

UI       Inter   500   Buttons, nav items, tabs, form labels, card titles
                       text-sm (0.875rem), line-height 1.2

Micro    Inter   500   Eyebrows, table headers, badges, StageChip labels
                       text-xs (0.75rem), letter-spacing 0.04em, UPPERCASE

Data     Inter   500   Latencies, scores, ranks, ids, vector values, token counts
                       text-sm (0.8125rem), font-variant-numeric: tabular-nums
```

**No display face is reserved for "the voice of the product" anymore** — Display is Inter
Bold at a larger size, nothing more. This is a direct consequence of the single-font-family
rule: introducing a second face specifically to carry tone is exactly the kind of "another
typography system" DESIGN.md's future-screen rules forbid.

`font-variant-numeric: tabular-nums` on the Data role is unchanged and still load-bearing:
the waterfall, the rerank matrix, and the queue counters all put numbers in vertical columns,
and Inter's proportional figures make a column of latencies unreadable without it. Inter
supports `tabular-nums` natively — dropping the monospace face does not lose this property.

`fonts.css`:

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
```

### 2.5 Spacing, Density and Layout Grammar

A 4px base scale: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 64`. Nothing between.

The one spatial rule that repeats on every content page — **center is the answer, right
margin is the evidence for it**:

```
┌─────┬─────────────────────────────────────┬─────────────────────┐
│     │                                     │                     │
│ N   │            PRIMARY                  │   EVIDENCE MARGIN   │
│ A   │                                     │                     │
│ V   │  /chat      → the transcript        │  citations          │
│     │  /traces/:id→ waterfall + matrix    │  raw payload        │
│ 260 │  /vectors   → the point cloud       │  node inspector     │
│ px  │  /contexts  → the document table    │  context metadata   │
│     │                                     │                     │
│     │            flexible                 │      380px          │
└─────┴─────────────────────────────────────┴─────────────────────┘
     ↑ collapses to an overlay drawer < 1024px; the margin becomes a
       bottom sheet < 768px, never a hidden pane
```

Content max-width is `72ch` for prose (the chat transcript) and unconstrained for data
(tables, the cloud). Mixing those two is what makes a data table look like a document.

### 2.6 Motion

Three durations and one easing curve. Anything else is a special case that must justify
itself in a comment.

| Token | Value | Used for |
|---|---|---|
| `--motion-fast` | 120 ms | hover, focus, color change |
| `--motion` | 200 ms | dropdown, accordion, tab |
| `--motion-slow` | 320 ms | dialog, drawer, route transition |
| `--ease` | `cubic-bezier(0.2, 0, 0, 1)` | all of the above |

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

The streaming caret in the answer box is the one deliberate exception and is implemented as
an opacity step rather than an animation, so it survives reduced-motion without vanishing —
a user who suppresses motion still needs to know the answer is still arriving.

---

## 3. Theme Mechanics

`next-themes` 0.4.6 is already a dependency. It is mounted at the root, above the router:

```tsx
// frontend/src/main.tsx
import { ThemeProvider } from 'next-themes';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider
      attribute="class"          // toggles `class="dark"` on <html> — matches theme.css's
                                 //   @custom-variant dark (&:is(.dark *))
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange  // suppresses the 200ms color transition DURING the swap,
                                 //   otherwise every element on the page animates at once
                                 //   and the switch reads as a 200ms smear
      storageKey="cerebro-theme"
    >
      <RouterProvider router={router} />
    </ThemeProvider>
  </StrictMode>,
);
```

**The flash problem.** This is a client-rendered SPA with no SSR, so the first paint happens
after JavaScript runs — `next-themes` sets the class before React's first commit and there is
no server-rendered HTML to mismatch. The one remaining flash source is `index.html`'s own
background painting white before the bundle loads. Fixed with a blocking inline script and a
matching CSS default:

```html
<!-- frontend/index.html, inside <head>, before any stylesheet -->
<script>
  (function () {
    try {
      var t = localStorage.getItem('cerebro-theme');
      var dark = t === 'dark' ||
        ((!t || t === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
      if (dark) document.documentElement.classList.add('dark');
      document.documentElement.style.background = dark ? '#0B1224' : '#FBFBFE';
    } catch (e) { /* private mode: fall through to the CSS default */ }
  })();
</script>
```

The two hex values are duplicated from `theme.css` on purpose — this script runs *before*
any stylesheet is parsed, so it cannot read a CSS variable. The duplication is annotated in
both files with a pointer to the other.

**The migration rule.** Every component in `frontend/src/app/` currently uses hardcoded hex
in Tailwind arbitrary values: `bg-[#020617]`, `text-[#00FF41]`, `border-[#333]`. Task 1.4
replaces all of them with token utilities. The acceptance criterion is mechanical:

```bash
grep -rnE '(bg|text|border|from|to|via|ring|shadow|fill|stroke)-\[#' frontend/src/app/ | wc -l
# must be 0
```

Exactly two exemptions are allowed and both must carry an inline comment naming this section:
the pre-boot script above, and any `<meta name="theme-color">` value.

---

## 4. The API Boundary — `frontend/src/api/`

### 4.1 Why This Exists Now

Today there are four independent `fetch` call sites with four different error conventions:
`EngineContext.ingestFile` throws `new Error(data.error)`, `IngestionZone.ingest` throws the
same but formats it differently, `SystemHealth` swallows into a state string, and
`useThreads` does its own thing. Phases 2–4 add roughly twenty more endpoints. Establishing
the boundary now costs one afternoon; establishing it in Phase 4 costs a rewrite of three
pages.

It is also the mechanism that makes frontend-first honest — see
[architecture.md §7.3](architecture.md).

### 4.2 `contracts.ts` — The Full v2 Surface

Every type the frontend will ever need, including for endpoints that do not exist yet. This
file is the contract Phases 5–7 are built to satisfy; a backend change that breaks it is a
breaking change by definition.

```ts
// ── Envelope ────────────────────────────────────────────────────────────────
export interface ApiError {
  status: number;
  code: string;          // machine-readable: 'invalid_credentials', 'otp_expired', …
  message: string;       // human-readable, already user-safe — rendered verbatim
  fields?: Record<string, string>;   // field-level validation, keyed by input name
}

export interface Paginated<T> {
  items: T[];
  page: number; limit: number; total: number; totalPages: number;
}

// ── Auth (Epic 1) ───────────────────────────────────────────────────────────
export type Role = 'user' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  role: Role;
  identities: Array<'google' | 'github' | 'local'>;
  phone: string | null;
  phoneVerified: boolean;
  createdAt: string;
}

/** GET /api/auth/session — 200 with `user: null` when signed out, never 401. */
export interface SessionResponse { user: SessionUser | null; }

export interface SignupRequest { email: string; password: string; name?: string; }
export interface LoginRequest  { email: string; password: string; }

/** Which OTP channels the server can actually deliver on. Drives whether the
 *  UI offers "send to my phone" at all — an unconfigured channel is ABSENT,
 *  never a button that fails (architecture §4). */
export interface AuthCapabilities {
  providers: Array<'google' | 'github'>;
  otpChannels: Array<'email' | 'sms'>;
  passwordMinLength: number;
}

export type OtpChannel = 'email' | 'sms';

export interface ForgotPasswordRequest { identifier: string; channel: OtpChannel; }
/** Always 202 with this body, whether or not the account exists (architecture §7.10). */
export interface ForgotPasswordResponse {
  sent: true;
  channel: OtpChannel;
  maskedDestination: string;   // "t••••@gmail.com" / "+1 ••• ••• 4471"
  expiresInSeconds: number;    // 600
  resendAfterSeconds: number;  // 60
}
export interface VerifyOtpRequest  { identifier: string; code: string; }
export interface VerifyOtpResponse { resetToken: string; expiresInSeconds: number; }
export interface ResetPasswordRequest { resetToken: string; password: string; }

// ── Contexts (Epic 2) ───────────────────────────────────────────────────────
export interface KnowledgeContext {
  id: string;
  title: string;
  description: string | null;
  documentCount: number;
  chunkCount: number;
  status: 'active' | 'deleting';
  createdAt: string;
  updatedAt: string;
}
export interface CreateContextRequest { title: string; description?: string; }

// ── Documents (Epic 2) ──────────────────────────────────────────────────────
export type DocumentStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'duplicate';
/** The five PRD-named lifecycle stages. Interim: derived on the client from
 *  status + progress until Phase 7 adds a real `stage` field (phase_2 §5.3). */
export type IngestStage = 'queued' | 'parsing' | 'chunking' | 'embedding' | 'ready' | 'failed';

export interface DocumentRecord {
  id: string; contextId: string;
  fileName: string; mimeType: string; sizeBytes: number;
  status: DocumentStatus;
  stage: IngestStage;
  progress: number;              // 0–100
  chunkCount: number; pageCount: number;
  textPageCount: number; visualPageCount: number;
  error: string | null; warnings: string[];
  createdAt: string;
}

// ── Chat (Epic 3) ───────────────────────────────────────────────────────────
export type SourceKind = 'text' | 'page';
export type SourceBranch = 'dense' | 'sparse' | 'both' | 'colpali';

/** Unchanged from v1's toPublicResult projection (backend/src/retrieval/search.js).
 *  Re-declared here rather than imported so the boundary owns its own contract. */
export interface ProvenanceSource {
  pointId: string; kind: SourceKind; text: string | null; score: number | null;
  documentId: string; fileName: string | null; page: number | null;
  headingPath: string | null; position: number | null;
  imageUri: string | null; ocrQuality: string | null;
  absorbedChunks: string[] | null;
  branch: SourceBranch | null; fusionRank: number | null; finalRank: number | null;
}

/** Unchanged from v1's buildTelemetry (backend/src/telemetry/pipelineTelemetry.js).
 *  A stage that did not run is `null`, NEVER 0 — see architecture §1. */
export interface PipelineTelemetry {
  condenseMs: number | null;      condenseStartMs: number | null;
  embedMs: number | null;         embedStartMs: number | null;
  sparseMs: number | null;        sparseStartMs: number | null;
  colpaliMs: number | null;       colpaliStartMs: number | null;
  chunkRetrieveMs: number | null; chunkRetrieveStartMs: number | null;
  pageRetrieveMs: number | null;  pageRetrieveStartMs: number | null;
  mergeMs: number | null;         mergeStartMs: number | null;
  rerankMs: number | null;        rerankStartMs: number | null;
  generateMs: number | null;      generateStartMs: number | null;
  firstTokenMs: number | null;
  totalMs: number;
  candidatesRetrieved: number; candidatesAfterMerge: number; candidatesAfterFloor: number;
  rerankSkipped: boolean; warnings: string[];
}

export interface AskRequest {
  query: string; contextId: string;
  threadId?: string; scopeDocumentIds?: string[];
}

export type AskEvent =
  | { event: 'threadId';  threadId: string }
  | { event: 'sources';   sources: ProvenanceSource[] }
  | { event: 'token';     token: string }
  | { event: 'telemetry'; telemetry: PipelineTelemetry; runId: string;
                          traceId: string | null;
                          langsmith: { orgId: string | null; project: string } | null }
  | { event: 'error';     error: string };

// ── Traces (Epic 4) ─────────────────────────────────────────────────────────
export interface TraceSummary {
  id: string; threadId: string; messageId: string; contextId: string; contextTitle: string;
  query: string; totalMs: number; sourceCount: number;
  rerankSkipped: boolean; warningCount: number; createdAt: string;
}
export interface TracePromptBlock {
  role: 'system' | 'user'; kind: 'text' | 'image';
  content: string;            // image blocks carry the served page URI, never base64
  approxTokens: number | null;
}
export interface TraceDetail extends TraceSummary {
  condensedQuery: string | null;
  telemetry: PipelineTelemetry;
  candidates: ProvenanceSource[];      // full pre-floor set, with fusionRank + finalRank
  prompt: TracePromptBlock[];
  tokens: { input: number; output: number; provider: string; model: string } | null;
  runId: string | null;
  langsmithUrl: string | null;
  truncated: boolean;                  // prompt exceeded the 256KB cap (architecture §8)
}

// ── Vectors (Epic 5) ────────────────────────────────────────────────────────
export type ProjectionStaleness = 'fresh' | 'rebuilding' | 'absent';
/** Packed payload — architecture §7.9. `positions` is base64 of a Float32Array of
 *  interleaved [x,y,z]; `docIndex` is base64 of a Uint16Array indexing `documents`. */
export interface ProjectionResponse {
  staleness: ProjectionStaleness;
  reason: string | null;              // populated when staleness !== 'fresh'
  nodeCount: number;
  positions: string;
  docIndex: string;
  pointIds: string[];
  documents: Array<{ id: string; fileName: string; color: number }>;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  fittedAt: string | null;
}
export interface ProjectQueryRequest  { contextId: string; query: string; }
export interface ProjectQueryResponse {
  beacon: [number, number, number];
  neighbors: Array<{ pointId: string; index: number; distance: number;
                     rerankScore: number | null; finalRank: number | null }>;
}
export interface VectorNodeDetail {
  pointId: string; text: string; documentId: string; fileName: string;
  page: number | null; headingPath: string | null; position: number;
  norm: number; neighborCount: number;
}

// ── Admin (Epic 6) ──────────────────────────────────────────────────────────
export interface HealthResponse {
  status: 'up' | 'degraded' | 'down';
  version: string;
  breakers: Record<string, 'closed' | 'half-open' | 'open'>;
  dependencies: Record<string, { name: string; status: 'up' | 'down';
                                 latencyMs: number; error?: string }>;
  queue: { waiting: number; active: number; failed: number; completed: number } | null;
  collections: Record<string, number> | null;
  timestamp: string;
}
export interface QueueStats {
  depth: { waiting: number; active: number; failed: number; completed: number };
  throughputPerMin: number; workerConcurrency: number; activeWorkers: number;
  oldestWaitingAgeMs: number | null;
}
export interface PipelineErrorRecord {
  id: string; kind: 'parse' | 'embed' | 'vision' | 'rerank' | 'generate' | 'queue' | 'notify';
  message: string; documentId: string | null; fileName: string | null;
  contextId: string | null; stack: string | null; retryable: boolean; createdAt: string;
}
```

### 4.3 `client.ts` — One Request Path

```ts
import type { ApiError } from './contracts';

const BASE = '/api';

export class CerebroApiError extends Error implements ApiError {
  status: number; code: string; fields?: Record<string, string>;
  constructor(e: ApiError) { super(e.message); Object.assign(this, e); }
}

/** Thrown when an endpoint does not exist yet (404 with no JSON body) or the
 *  network is unreachable. Components render <Unavailable> for this and a normal
 *  error state for everything else — the distinction is what keeps a
 *  not-yet-built panel from looking like a broken one. */
export class EndpointUnavailableError extends CerebroApiError {}

export async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  const csrf = readCookie('cerebro.csrf');            // Phase 8 wires the server side;
  if (csrf) headers.set('X-CSRF-Token', csrf);        //   harmless until then

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...rest,
      headers,
      credentials: 'include',                          // the session cookie, always
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (cause) {
    throw new EndpointUnavailableError({
      status: 0, code: 'network_unreachable',
      message: 'Cerebro is not reachable. Check that the backend is running.',
    });
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON: handled below */ }

  if (!res.ok) {
    // A 404 with an HTML body is Vite's dev server or Caddy's SPA fallback answering
    // for a route the backend does not serve — i.e. an endpoint that does not exist yet.
    // A 404 with a JSON body is a real "not found" for a resource that could exist.
    if (res.status === 404 && body === null) {
      throw new EndpointUnavailableError({
        status: 404, code: 'endpoint_unavailable',
        message: 'This is not available yet.',
      });
    }
    const e = body as Partial<ApiError> | null;
    throw new CerebroApiError({
      status: res.status,
      code: e?.code ?? 'unknown_error',
      message: e?.message ?? (e as any)?.error ?? `Request failed (${res.status}).`,
      fields: e?.fields,
    });
  }
  return body as T;
}
```

The SSE reader is lifted verbatim from `useCerebroChat.ts`'s buffer loop — that code is
correct (it handles partial frames across chunk boundaries, which is the part people get
wrong) and only moves file:

```ts
export async function* streamEvents<E>(path: string, json: unknown, signal: AbortSignal)
  : AsyncGenerator<E> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', credentials: 'include', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json),
  });
  if (!res.ok || !res.body) throw await toApiError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf('\n\n')) !== -1) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 2);
      if (!line.startsWith('data: ')) continue;        // ': keepalive' comment frames
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;
      try { yield JSON.parse(payload) as E; }
      catch { console.warn('[api] unparseable SSE frame', payload); }
    }
  }
}
```

### 4.4 The Mock Adapter and Its Gate

```ts
// frontend/src/api/index.ts — the only module components import from
import * as real from './client';

const MOCK_ON = import.meta.env.DEV && import.meta.env.VITE_API_MOCK === '1';

export const api = MOCK_ON
  ? (await import('./mock')).mockApi   // top-level await; Vite folds this branch away
  : real;

export const IS_MOCKED = MOCK_ON;
```

Because `import.meta.env.DEV` is `false` at production build time, Vite's constant folding
removes the entire `MOCK_ON` branch, and with it the dynamic import — so `src/api/mock/**`
and every fixture it references is absent from the production bundle. That is verified
mechanically in task 1.17.

Per-endpoint, the mock declares whether it is standing in for something real:

```ts
// frontend/src/api/mock/index.ts
export const MOCKED_ENDPOINTS = new Set([
  'auth.session', 'auth.signup', 'auth.login', 'auth.logout', 'auth.capabilities',
  'auth.forgotPassword', 'auth.verifyOtp', 'auth.resetPassword',
]);
// Phase 1 mocks ONLY auth. documents/threads/health/ask stay on the real backend.
```

`<MockBadge>` reads `MOCKED_ENDPOINTS` and renders a small `MOCK` chip in the corner of any
panel whose data came from it. In a production build `IS_MOCKED` is `false` and the badge
compiles to `null`.

---

## 5. Auth State, Guards and the Route Table

### 5.1 `AuthContext`

```tsx
interface AuthState {
  user: SessionUser | null;
  status: 'loading' | 'authenticated' | 'anonymous' | 'unreachable';
  capabilities: AuthCapabilities | null;
  signIn: (req: LoginRequest) => Promise<void>;
  signUp: (req: SignupRequest) => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}
```

`status` has four values, not three, and the fourth is the important one. `'unreachable'`
means the session probe itself failed — the backend is down. That is a different screen from
`'anonymous'`: an anonymous user should see the login form, but a user whose backend is
unreachable should see *"Cerebro is not reachable"* and a retry, because showing them a login
form they cannot possibly complete is a dead end.

The probe runs once at mount. It does **not** re-run on every route change — the guard reads
context state, it does not fetch.

### 5.2 Guards

```tsx
// RequireAuth: status 'loading' → full-page spinner (no layout shift into the app shell)
//              status 'anonymous' → <Navigate to="/login?returnTo={encoded}" replace />
//              status 'unreachable' → <BackendUnreachable onRetry={refresh} />
//              status 'authenticated' → <Outlet />
//
// RequireAdmin: wraps RequireAuth, then user.role !== 'admin' → 404 page, NOT a
//   "forbidden" page. A forbidden page confirms the route exists and is worth
//   attacking; a 404 says nothing (architecture §9).
```

`returnTo` is captured on redirect and consumed after a successful sign-in. It is validated
before use — must start with a single `/`, must not contain `\` or begin with `//` — and
falls back to `/chat`. The validation lives in the frontend here *and* is repeated on the
backend in Phase 5; neither is trusted alone.

### 5.3 The Route Table

```tsx
export const router = createBrowserRouter([
  { path: '/login',           Component: Login },            // public
  { path: '/signup',          Component: Signup },           // public
  { path: '/forgot-password', Component: ForgotPassword },   // public
  { path: '/reset-password',  Component: ResetPassword },    // public
  {
    path: '/', Component: AppShell,                          // Sidebar + TopHeader + Outlet
    children: [
      { element: <RequireAuth />, children: [
        { index: true,            element: <Navigate to="/chat" replace /> },
        { path: 'chat',           Component: Chat },
        { path: 'contexts',       Component: ContextList },       // Phase 2
        { path: 'contexts/:id',   Component: ContextDetail },     // Phase 2
        { path: 'admin/traces',       Component: TraceList },     // Phase 4
        { path: 'admin/traces/:id',   Component: TraceDetail },   // Phase 4
        { path: 'admin/vectors',      Component: VectorSpace },   // Phase 4
        { element: <RequireAdmin />, children: [
          { path: 'admin/health',     Component: Health },        // Phase 4
        ]},
      ]},
    ],
  },
  // v1 → v2 redirects. Kept permanently: these URLs are in the README and in
  // screenshots, and a 404 on a documented URL is a worse outcome than a redirect.
  { path: '/advanced', element: <Navigate to="/admin/traces"  replace /> },
  { path: '/vector',   element: <Navigate to="/admin/vectors" replace /> },
  { path: '*',         Component: NotFound },
]);
```

Phase 1 creates every one of these files. The Phase 2–4 pages are real components rendering
a single `<EmptyState>` that names the phase — *"The document explorer arrives in Phase 2."*
This is deliberate: a route that 404s during development hides routing bugs until the page
lands, and a placeholder that states its own status is not a fabrication.

---

## 6. The Auth Screens

**Amended 2026-08-19: split-screen layout, per `DESIGN.md` §6.1's amendment.** All four share
one shell: a left column (product mark + tagline, a two-line headline with its second line in
`--signal`, one supporting paragraph, four feature rows, a footer) and a right column holding
the auth card (`min(420px, 100%)` wide, `--surface-raised`, `--line` border, `--shadow-1`),
vertically centered, on the page-level `AtmosphericBackground`. The centered-card-only version
(no hero, no illustration) below individual screen sections in this doc is retired — see
`DESIGN.md` §6.1 for the full reasoning and the reference ASCII layout, not repeated here.

### 6.1 `/login`

| Element | Spec |
|---|---|
| Header link (page-level, not card) | *"Don't have an account? Sign up"* → `/signup`, top-right, next to the `ThemeToggle` — part of the split-screen shell (§6 intro), not this card |
| Card heading | *"Welcome back"* — Display role, 1.875rem — **Amended 2026-08-19**, matches the reference screenshot copy; the earlier *"Sign in to Cerebro"* heading is retired |
| Card sub-line | *"Sign in to your Cerebro account"* — Body role |
| Email | `type="email"`, `autocomplete="username"`, `inputmode="email"`, required |
| Password | `type="password"`, `autocomplete="current-password"`, required, with a show/hide toggle that is a real `<button>` with `aria-pressed`. **"Forgot password?"** renders inline, right-aligned next to the *Password* label — not in the footer — and links to `/forgot-password` |
| Remember me | A checkbox, unchecked by default, sits between the password field and the submit button |
| Submit | *"Sign in"* — signal-filled, full width. Disabled while pending; label becomes *"Signing in…"* with a spinner, and the button keeps its width so the layout does not jump |
| Divider | Hairline with a centered `--surface` label *"or continue with"* in Micro type, below the submit button |
| OAuth block | One button per `capabilities.providers`, below the divider. Full width, `--surface-raised` with a `--line` border, provider mark + *"Sign in with Google"*. An unconfigured provider is **absent**, never a button that fails |
| Card footer | *"Don't have an account? Sign up"* → `/signup` — repeats the header link inside the card itself, matching the reference screenshot |
| Errors | Field errors from `ApiError.fields` render under their input in `--critical`, `role="alert"`. A form-level error (bad credentials) renders in a `--critical-soft` band above the fields |

Failed sign-in copy is exactly: **"That email and password don't match an account."** It does
not say which of the two was wrong, and it is identical for a nonexistent account
([architecture.md §9](architecture.md)). It does not apologize.

### 6.2 `/signup`

Same shell. Adds a name field (optional, `autocomplete="name"`) and replaces the password
input with a strength-gated one:

- `autocomplete="new-password"`, minimum `capabilities.passwordMinLength` (12).
- A three-segment strength meter driven by length and character-class variety. It is
  **advisory** — it never blocks submission on anything except the length minimum, because
  the real check (the breached-password list) runs server-side in Phase 5 and a client that
  pretends to enforce it would be lying about the guarantee.
- Requirement text is stated **before** the user types, not revealed as an error afterward:
  *"At least 12 characters. Longer is better than more complicated."*

On success the mock returns a `SessionUser`, `AuthContext` refreshes, and the router
navigates to `returnTo` or `/chat`.

### 6.3 `/forgot-password`

Card heading **"Forgot your password?"** below the centered icon-in-circle (§6 intro), sub-line
**"No worries. Enter your work email and we'll send you a secure link to reset it."** — **not**
*"Reset your password"* / *"Enter your email and we'll send a code"*, which is the left
column's headline for this screen, not the card copy. One input, labeled **"Work email"**
(`identifier` — email address, or phone if `capabilities.otpChannels` includes `sms`) and a
channel selector that is **rendered only when more than one channel exists**. A single-channel
deployment (email-only, matching the reference screenshot) shows no selector at all. Submit
button reads **"Send reset link"**. Below a **"Remembered your password?"** divider, a
full-width secondary button reads **"Back to sign in"** — a button, not a bare link, matching
`DESIGN.md` §6.3.

The response is always the same, and the copy says so plainly without being coy:

> **Check your email.** If an account exists for `t••••@gmail.com`, a 6-digit code is on its
> way. It expires in 10 minutes.

Then it navigates to `/reset-password?identifier=…&channel=…` carrying
`maskedDestination`, `expiresInSeconds`, and `resendAfterSeconds` in router state (not the
query string — a masked address in a URL ends up in browser history and server logs).

### 6.4 `/reset-password` and the OTP State Machine

This is the most stateful screen in the phase and is specified as an explicit machine rather
than a pile of booleans.

```
                    ┌──────────────────────────────────────────┐
                    │ entry: no `identifier` in router state    │
                    │ → redirect to /forgot-password            │
                    └──────────────────┬───────────────────────┘
                                       ▼
   ┌──────────────────────────────────────────────────────────────────────┐
   │ AWAITING_CODE                                                         │
   │  • 6 single-character inputs (Radix input-otp, already a dependency)  │
   │  • countdown: "Expires in 9:47"  ← ticks from expiresInSeconds        │
   │  • resend button, disabled for resendAfterSeconds, then enabled       │
   │  • attemptsRemaining shown only after the FIRST failure — showing     │
   │    "5 attempts remaining" before any attempt reads as a threat        │
   └───┬──────────────┬───────────────┬───────────────┬───────────────────┘
       │ 6 chars      │ verify 400    │ verify 429    │ countdown hits 0
       │ entered      │ otp_invalid   │ otp_locked    │
       ▼              ▼               ▼               ▼
   VERIFYING      AWAITING_CODE   LOCKED           EXPIRED
   (auto-submit,   attempts--,    "Too many        "That code expired.
    inputs         inputs clear,   attempts.        Request a new one."
    disabled)      focus index 0,  Request a new     → resend enabled
       │           announce via    code."            immediately
       │ 200       aria-live       → resend only
       ▼
   SETTING_PASSWORD
    • resetToken held in component state ONLY — never localStorage, never the
      URL. A page reload discards it and returns to /forgot-password, which is
      correct: a single-use credential must not survive a refresh.
    • new password field, same strength affordance as /signup
    • confirm field, compared on blur not on every keystroke
       │ 200
       ▼
   DONE → toast "Password updated." → navigate('/login', {replace:true})
          (replace, so Back does not return to a dead reset screen)
```

Copy for each terminal state, in the interface's voice — states the problem and the fix,
does not apologize:

| State | Copy |
|---|---|
| `otp_invalid` | *"That code isn't right. {n} attempts left."* |
| `otp_expired` | *"That code expired. Request a new one."* |
| `otp_locked` | *"Too many attempts. Request a new code to try again."* |
| resend sent | *"New code sent."* (toast, not a banner — it does not change what the user does next) |
| network down | *"Cerebro is not reachable. Your code is still valid — try again in a moment."* |

**Accessibility of the OTP input.** The six boxes are one logical field: a single
`aria-label="Verification code"` on the group, `autocomplete="one-time-code"` (which is what
makes iOS and Android offer the SMS code from the notification), `inputmode="numeric"`, paste
of a 6-digit string distributes across all six, and Backspace on an empty box moves focus
left. Errors are announced through an `aria-live="polite"` region, because a visual-only
error on a field that auto-submits is invisible to a screen reader.

### 6.5 Boundary Screens

**Added 2026-08-19.** `DESIGN.md` §6.12 specifies three boundary screens; `NotFound.tsx` and
`BackendUnreachable.tsx` were already in §11's file list and referenced by the route table and
the guards, but **their content was never specified in any phase doc**. All three are built
here, because all three are reachable before any Phase 2–4 surface exists.

**404 / Not found** (`NotFound.tsx`, the `*` route). A centered `<EmptyState>`:

> **That page doesn't exist.**
> `[ Go to chat ]`

**This is also what a non-admin gets at `/admin/health`** — `RequireAdmin` renders this exact
component, not a "forbidden" screen. A 403 confirms the route exists and is worth attacking;
a 404 says nothing. The rendering must therefore be **byte-identical** in both cases: no
"you don't have access" variant, no different heading, no telltale difference in the page
title. This is the one screen where a cosmetic difference would be a security bug.

**Backend unreachable** (`BackendUnreachable.tsx`, rendered by `RequireAuth` when
`status === 'unreachable'`, and by the auth screens when the probe fails). Replaces the entire
route content, **including the login card** — showing a sign-in form to someone whose backend
is down is a dead end:

> **Cerebro is not reachable.**
> The app can't reach the server. This is usually a local backend that isn't running.
> `[ Try again ]`

*Try again* calls `AuthContext.refresh()`; it does not reload the page, which would discard
any unsaved form state and re-run the whole bundle for what is usually a two-second outage.

**Route loading.** While `status === 'loading'`, a full-page centered spinner — **never** a
flash of the app shell followed by a redirect, which reads as a broken navigation. The shell
does not mount until the session resolves.

---

## 7. Shell Chrome

### 7.1 `AppShell`

Replaces `RootLayout`. **Amended 2026-08-19, matching `DESIGN.md` §3.1's rewrite: the left
rail is wide and always labeled (~260–270px), not the narrow icon-only dock this section
originally specified** — that treatment is retired as the default and survives only as the
Narrow-viewport fallback (§4's responsive table; see task 1.22 below for the breakpoint).
Top header (56px), content outlet. `EngineProvider` and `ContextScopeProvider` mount here;
`AuthProvider` mounts above the router in `main.tsx` because `/login` needs it too.

### 7.2 `TopHeader` — What Gets Deleted

The current header renders `CPU: 12%`, `RAM: 4.2/16GB`, `IOPS: 1.2k/s`, and a
`C++ Addon: Active` badge. Every one of those is a hardcoded string. The C++ addon has not
been on the query path since Phase 3 of v1. **All four are deleted**, not replaced with real
equivalents — a browser cannot know the server's CPU, and the two that could be made real
(queue depth, dependency status) belong on `/admin/health`, not in permanent chrome.

What replaces them:

| Slot | Content |
|---|---|
| Left | Product mark + the active context name (Phase 3 makes it a switcher; Phase 1 renders the name or *"No context"*) |
| Right | Status dot — one `GET /api/health` poll at 30 s, `--positive` / `--warn` / `--critical`, with the dependency summary in a tooltip. This is **real** and already available |
| Right | `<ThemeToggle>` — a 3-state segmented control (Light / Dark / System), not a 2-state switch, because `next-themes` has three states and a 2-state switch cannot represent "follow the system" |
| Right | User menu — avatar (or initials), name, email, *Sign out*. Shows the `admin` role as a Micro-type chip when present |

### 7.3 `Sidebar`

**Amended 2026-08-19, full rewrite matching `DESIGN.md` §2.2.** The original version of this
section specified only the six nav rows below the divider — it omitted the `+ New chat`
button and the entire Recent Chats section, both of which `DESIGN.md` §2.2 now specifies as
part of the canonical rail. Full structure, top to bottom:

```
◈ CEREBRO
  Grounded answers. Full context.

┌──────────────────────────┐
│  +  New chat              │
└──────────────────────────┘

Chat            /chat            MessageSquare
Contexts        /contexts        Library
──────────────────────────────────────────────
Traces          /admin/traces    Activity
Vector space    /admin/vectors   Scatter3D
Health          /admin/health    HeartPulse     ← rendered only when role === 'admin'

Recent chats
  EMEA revenue in Q3 2024        10:14 AM
  What drove gross margin down?  Yesterday
  …
  View all chats ›

──────────────────────────
⬤ Aarav Rao                  ▾
  aarav@acme.com
```

**There is no "Documents" row.** Every document belongs to a context and is reached through
`/contexts` → `/contexts/:id`; a standalone Documents item would either duplicate that view or
imply documents can exist outside a context, which the data model doesn't support
(`DESIGN.md` §2.2).

Active state is `--signal-soft` background with a 2px `--signal` left rule and
`aria-current="page"`. The health item is **omitted entirely** for non-admins rather than
disabled — a disabled control advertises a capability the user does not have.

**`+ New chat`** starts a fresh thread in the active context. It renders as a pale
`--signal-soft`-filled row *inside* the rail (not a solid `--signal` button standing above
it as a page-level primary action) — visually it's the most prominent row in the nav block,
but it is still a nav-block element, not a competing CTA.

**Recent Chats — Phase 1 builds the list; Phase 3 extends it.** This is a deliberate
foundation/extension split, stated explicitly here because the sequencing law forbids one
feature living in two phases without saying which part belongs to which.

*This phase* renders the section wired to the real `api.threads.*` endpoints (already migrated
in §8, table row `useThreads`) — not mocked, since threads already work against the real
backend pre-Phase-1. A **flat list, newest first**, capped to roughly 7 visible rows with a
`View all chats ›` link. Each row: a small chat-bubble icon, the thread title (truncated), and
a relative timestamp. The selected thread (active route `/chat` with a matching `threadId`)
gets the same `--signal-soft` + left-rule treatment as an active nav item.

*Phase 3 extends it* with the recency **group headers** (`Today / Yesterday / Previous 7 days /
Older`), **inline rename**, the **delete confirm** that states the message count, and
**filtering to the active context**. None of those four are in scope here — Phase 1 ships a
flat, read-only, click-to-open list. `// Phase 3: recency grouping, rename, delete, context
filter` marks the component.

**There is no separate thread panel on `/chat`.** `DESIGN.md` §6.7 originally specified a
collapsible thread panel left of the transcript; that was superseded when the rail gained
Recent Chats (`DESIGN.md` §2.2, §6.7's correction note). This rail section is the only thread
list in the product.

**The account panel** anchors the bottom of the rail: avatar (image, or initials on
`--signal-soft`), name, email, a chevron opening the `UserMenu` (§7.2's user-menu content —
name, email, admin chip when applicable, divider, *Sign out*) as a popover anchored to this
row rather than the top bar. `DESIGN.md` §5.14 describes `UserMenu`'s content once; this is
just a second anchor point for the same component, not a second implementation.

### 7.4 The Other Deletion

[ConsumerDashboard.tsx:237](../../frontend/src/app/pages/ConsumerDashboard.tsx) renders
*"Cerebro Engine operates entirely offline. No data leaves your machine."* This is false:
Cohere, LlamaParse, Anthropic, and LangSmith are all live network calls, as
[AGENTS.md](../../AGENTS.md) states explicitly. It is deleted. Nothing replaces it — the chat
input needs no disclaimer, and an accurate version (*"Your documents are sent to Cohere and
Anthropic for processing"*) belongs in a settings/privacy surface, which is not in scope for
any phase of this plan.

---

## 8. Migrating the Existing Components

Four components hold inline `fetch` calls. Each moves to `src/api/` with **no behavior
change** — this is a refactor, and any behavior difference is a bug in the refactor.

| Component | Current call | Becomes |
|---|---|---|
| `EngineContext.ingestFile` | `POST /api/documents` + poll loop | `api.documents.upload()` + `api.documents.pollUntilSettled()` |
| `IngestionZone.ingest` | the same two calls, duplicated | the same two functions — the duplication disappears |
| `SystemHealth` | `GET /api/health` on a 15 s interval | `api.health.get()` via a `useHealth()` hook |
| `useThreads` | `GET/PATCH/DELETE /api/threads` | `api.threads.*` |
| `useCerebroChat` | `POST /api/ask` + its SSE buffer loop | `api.chat.ask()` over `streamEvents` |

The poll loop currently exists twice, in `EngineContext` (`pollDocumentStatus`) and in
`IngestionZone` (an inline `while (true)`), with different timeout handling. Consolidating
them is in scope; changing the 1500 ms interval or the 5-minute timeout is not.

Every component in `app/components/ui/` (the 40 Radix wrappers) is re-pointed from the old
shadcn variable names onto the v2 token names. Their structure, props, and accessibility
behavior are untouched.

---

## 9. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 1.1 | Write `theme.css` light + dark token blocks per §2.1 | `document.documentElement` toggling `.dark` changes `getComputedStyle(document.body).backgroundColor` from `rgb(251, 251, 254)` to `rgb(11, 18, 36)` |
| 1.2 | Verify every `-soft` token in the dark block is expressed as an alpha-blended `rgb(<hue> / <alpha>)`, never a flat hex | `grep -c 'rgb(.*\/ 0\.' theme.css` inside the `.dark` block returns 4 (signal, positive, warn, critical) |
| 1.3 | Verify every contrast pair in §2.2 | A script prints the computed ratio for all 9 light-mode pairs; every one meets its stated minimum except the two explicitly documented failures (`graphite-faint`, bare `positive`/`warn`/`critical` on `-soft`), which the same script confirms are absent from any component's visible-text usage |
| 1.3a | Define the eight `--stage-*` tokens in both themes and bridge them (§2.1) | `getComputedStyle` resolves all eight in light and dark; the `@theme` block exposes each as a `--color-stage-*` utility; a script confirms no two stage hues in the same theme are within ΔE 10 of each other, so eight segments remain distinguishable side by side |
| 1.4 | Migrate every component off hardcoded hex onto tokens | `grep -rnE '(bg\|text\|border\|from\|to\|via\|ring\|shadow\|fill\|stroke)-\[#' frontend/src/app/` returns 0 lines |
| 1.5 | Add Inter to `fonts.css`; wire the six type roles | `/login`'s `h1` computes to `font-family: "Inter"` at `font-weight: 700`; a waterfall duration cell computes to `"Inter"` at `font-weight: 500` with `font-variant-numeric: tabular-nums` |
| 1.6 | Mount `ThemeProvider` and the pre-boot inline script | With `localStorage['cerebro-theme']='dark'`, a hard reload throttled to Slow 3G shows **no** white flash before first paint (recorded via DevTools screenshot filmstrip) |
| 1.7 | Build `<ThemeToggle>` as a 3-state segmented control | Selecting System, then changing the OS to dark, flips the app without a reload; the selection survives a reload |
| 1.8 | Add `prefers-reduced-motion` suppression per §2.6 | With the emulation enabled, opening a dialog produces no transition; the streaming caret still toggles visibility |
| 1.9 | Write `api/contracts.ts` covering the full v2 surface | `tsc --noEmit` passes; every type in §4.2 is exported |
| 1.10 | Write `api/client.ts` with `request`, `streamEvents`, and the two error classes | A request to a nonexistent path throws `EndpointUnavailableError`; a 400 with a JSON body throws `CerebroApiError` carrying `code` and `fields` |
| 1.11 | Write the mock adapter and its `import.meta.env` gate | With `VITE_API_MOCK=1 npm run dev`, `/login` signs in against the mock; without it, the same submit throws `EndpointUnavailableError` |
| 1.12 | Migrate all five existing call sites onto `src/api/` | `grep -rn "fetch('/api\|fetch(\`/api" frontend/src/app/` returns 0 lines; uploading a document from `/chat` still works end to end against the real backend |
| 1.13 | Build `AuthContext` with the four-value `status` | With the backend stopped, `/chat` renders "Cerebro is not reachable" with a retry, **not** the login form |
| 1.14 | Build `RequireAuth` / `RequireAdmin` and the route table | Signed out, `/chat` redirects to `/login?returnTo=%2Fchat`; signing in lands back on `/chat`. As a non-admin, `/admin/health` renders the 404 page |
| 1.14b | Build the three §6.5 boundary screens | `/nonsense-route` renders **"That page doesn't exist."** with a *Go to chat* action; as a non-admin, `/admin/health` renders **byte-identical** markup to it (diff the two `document.body.innerHTML` values — they match); with the backend stopped, `/login` renders **"Cerebro is not reachable."** instead of the sign-in card, and *Try again* re-probes without a page reload |
| 1.15 | Build `/login` and `/signup` per §6.1–6.2, including the shared split-screen shell and `<AtmosphericBackground>` (§6 intro, `DESIGN.md` §6.1) | A wrong password shows exactly "That email and password don't match an account."; a nonexistent email shows the identical string; both routes render the left hero column (headline, four feature rows, footer) and the right auth card side by side above 1024px, and the atmospheric background is present but page-level only — never re-rendered inside the card |
| 1.16 | Build `/forgot-password` and `/reset-password` with the §6.4 machine | All six states reachable in the mock: entering a wrong code decrements the counter and clears the inputs; after 5 wrong codes the screen reads "Too many attempts."; reloading during `SETTING_PASSWORD` returns to `/forgot-password` |
| 1.17 | Verify the mock is absent from production builds | `npm run build && grep -rl "MOCKED_ENDPOINTS" frontend/dist/` returns nothing; `du -sh` of the mock fixtures does not appear in the bundle analysis |
| 1.18 | Build `AppShell`, `Sidebar`, `TopHeader` per §7 | The header shows a live health dot; `grep -n "CPU:\|IOPS\|C++ Addon" frontend/src/app/` returns 0 lines; the rail renders `+ New chat`, all six labeled nav rows, a Recent Chats section, and the account panel at full width by default (not icon-only); `grep -rn "Documents" frontend/src/app/components/core/Sidebar.tsx` returns 0 lines |
| 1.19 | Delete the "operates entirely offline" line | `grep -rn "entirely offline" frontend/src/` returns 0 lines |
| 1.20 | Add `<EmptyState>`, `<Unavailable>`, `<MockBadge>` and the Phase 2–4 placeholder pages | `/contexts`, `/admin/traces`, `/admin/vectors` each render a named placeholder naming their phase; none 404 |
| 1.21 | Keyboard pass over the whole auth flow | Sign-up → forgot → OTP → reset is completable with keyboard only; every focused control has a visible `--signal-ring`; the OTP group accepts a pasted 6-digit code |
| 1.22 | Responsive pass at 375 / 768 / 1024 / 1920 | No horizontal scroll at any width; **Amended 2026-08-19** — the left rail stays wide/labeled at 1920 and 1024 (the old "collapses below 1280" behavior is retired along with the icon-only default, `DESIGN.md` §4), collapses to icon-only at the Narrow tier (below 1024), and to a bottom bar below 768; `/login` is usable at 375px |

---

## 10. Milestone Definition

Phase 1 is **complete** when:

> A developer runs `VITE_API_MOCK=1 npm run dev` and opens `http://localhost:5173/chat` in a
> browser whose OS is set to dark mode. The page renders dark from the very first frame — no
> white flash — and immediately redirects to `/login?returnTo=%2Fchat`. The split-screen shell
> sits on an ink-900 `#0B1224` ground: the left column carries the headline and four feature
> rows, the right column holds the sign-in card — heading *"Welcome back"* in Inter Bold, an
> email field, a password field with an inline *"Forgot password?"* link, a *Remember me*
> checkbox, the *Sign in* button, a hairline *"or continue with"* divider, and one button per
> configured provider below it — `capabilities.providers` drives the same set on `/login` and
> `/signup` alike, so a user who joined via GitHub can sign back in via GitHub, not just
> Google. They type a wrong password and get exactly **"That email and password don't match an
> account."** in
> red beneath the form; they type an email that has never existed and get the *identical*
> sentence. They click *Sign up* in the header, enter
> `dev@example.com` and a 14-character password — the strength meter fills to its third
> segment as they type — submit, and land on `/chat`, which now shows the v1 chat interface
> restyled: white would be wrong here, so it is `--surface` dark, the answer text in Inter
> Regular, and any latency figure in Inter Medium with tabular figures.
>
> They click the theme control in the header and choose **Light**. In a single frame every
> surface in the application inverts — the shell, the sidebar, the chat transcript, the
> thread list, and every one of the forty Radix primitives — with no element left behind on a
> hardcoded color and no layout shift. They choose **System**, change the OS appearance to
> light, and the app follows without a reload.
>
> With the real backend running (`npm run dev` in `backend/`), they drag a PDF onto the chat
> input. It uploads and ingests exactly as it did before this phase — the same 1.5-second
> poll, the same progress bar — because that path was refactored onto `src/api/` without a
> behavior change. The health dot in the header is green and its tooltip lists mongo, qdrant,
> redis, vision, cohere, llamaparse, and llm with real millisecond latencies.
>
> They sign out, click *Forgot your password?*, enter `dev@example.com`, and land on the code
> screen, which reads **"If an account exists for d••@example.com, a 6-digit code is on its
> way. It expires in 10 minutes."** with a live countdown and a *Resend* button greyed for 60
> seconds. They type `000000`; the inputs clear, focus snaps to the first box, and a line
> appears reading **"That code isn't right. 4 attempts left."** They do it four more times and
> the screen becomes **"Too many attempts. Request a new code to try again."** with the code
> inputs gone. They resend, enter the code the mock prints to the browser console, set a new
> password, and are returned to `/login` with a toast reading **"Password updated."** Pressing
> Back does not return them to the reset screen.
>
> Finally they run `npm run build` and then `grep -rl "MOCKED_ENDPOINTS" dist/`, which prints
> nothing at all — the mock adapter and every fixture behind it are absent from the production
> bundle. `grep -rnE '(bg|text|border)-\[#' src/app/` also prints nothing: there is not one
> hardcoded color left in the application.

---

## 11. Files to Create

```
frontend/
├── index.html                                  # [extend] pre-boot theme script (§3)
└── src/
    ├── main.tsx                                # [extend] ThemeProvider + AuthProvider
    ├── styles/
    │   ├── theme.css                           # [rewrite] v2 tokens, light + dark, @theme bridge
    │   └── fonts.css                           # [rewrite] Inter, weights 400/500/600/700
    ├── api/
    │   ├── index.ts                            # the mock gate; the only module components import
    │   ├── contracts.ts                        # every v2 request/response type (§4.2)
    │   ├── client.ts                           # request(), streamEvents(), the two error classes
    │   ├── endpoints/
    │   │   ├── auth.ts                         # session, signup, login, logout, capabilities, password/*
    │   │   ├── documents.ts                    # upload, list, get, status, poll, reingest, delete
    │   │   ├── threads.ts                      # list, get, rename, delete
    │   │   ├── chat.ts                         # ask() over streamEvents
    │   │   ├── health.ts                       # get()
    │   │   ├── contexts.ts                     # [stub, Phase 2 wires the UI]
    │   │   ├── traces.ts                       # [stub, Phase 4]
    │   │   ├── vectors.ts                      # [stub, Phase 4]
    │   │   └── admin.ts                        # [stub, Phase 4]
    │   └── mock/
    │       ├── index.ts                        # mockApi + MOCKED_ENDPOINTS (auth only this phase)
    │       └── fixtures/{users,otp}.ts         # in-memory user table, deterministic OTP
    └── app/
        ├── routes.tsx                          # [rewrite] the v2 route table (§5.3)
        ├── context/AuthContext.tsx             # session, capabilities, signIn/signUp/signOut
        ├── guards/{RequireAuth,RequireAdmin}.tsx
        ├── pages/
        │   ├── AppShell.tsx                    # replaces RootLayout
        │   ├── auth/{Login,Signup,ForgotPassword,ResetPassword}.tsx
        │   ├── NotFound.tsx
        │   └── {contexts,admin}/*.tsx          # placeholder pages naming their phase (task 1.20)
        ├── components/
        │   ├── design/
        │   │   ├── ThemeToggle.tsx             # 3-state segmented control
        │   │   ├── EmptyState.tsx              # Display-role headline + one action
        │   │   ├── Unavailable.tsx             # "not available yet", with the reason
        │   │   ├── MockBadge.tsx               # compiles to null in production
        │   │   ├── BackendUnreachable.tsx      # status === 'unreachable' screen
        │   │   ├── PasswordField.tsx           # show/hide toggle + strength meter
        │   │   ├── OtpInput.tsx                # 6-box group, paste, backspace nav, aria-live
        │   │   └── AtmosphericBackground.tsx   # [new] page-level radial wash + network pattern,
        │   │                                   #   auth routes only (§6 intro, DESIGN.md §6.1)
        │   ├── auth/AuthShell.tsx               # [new] the split-screen layout: hero column +
        │   │                                   #   feature rows + footer, wraps the card slot
        │   ├── core/{Sidebar,TopHeader}.tsx    # [rewrite] per §7.2, §7.3 — Sidebar now includes
        │   │                                   #   `+ New chat`, Recent Chats, and the account panel
        │   └── ui/*.tsx                        # [extend] 40 Radix wrappers re-pointed to v2 tokens
        └── hooks/{useSession,useHealth}.ts
```

**Deleted this phase:** the fabricated header metrics block in `TopHeader.tsx`, the
"entirely offline" line in `ConsumerDashboard.tsx`, `RootLayout.tsx` (replaced by
`AppShell.tsx`), and the duplicated poll loop in `IngestionZone.tsx`.

---

## 12. Performance Validation

| Metric | How to Measure | Target |
|---|---|---|
| Theme switch cost | DevTools Performance recording across one toggle | < 1 frame (16 ms), zero layout shift |
| `/login` FCP | Lighthouse, Slow 4G + 4× CPU throttle | < 1.2 s |
| `/login` initial JS | `npm run build` bundle report for the login route chunk | ≤ 250 KB gzip; contains neither `three` nor `katex` |
| Theme flash | DevTools screenshot filmstrip, Slow 3G, dark preference | Zero frames of light background |
| Session probe | Network panel, `GET /api/auth/session` against the mock | < 15 ms |
| Route transition | Performance recording, `/chat` → `/contexts` | < 100 ms to first paint of the new route |

---

## 13. Estimated Complexity

**Amended 2026-08-19:** two rows bumped for the split-screen auth shell (`AuthShell`,
`AtmosphericBackground`) and the wider `Sidebar` scope (`+ New chat`, Recent Chats, the
account-panel `UserMenu` anchor) added by the layout amendments in §6 and §7.3.

| Component | LOC | Files | New deps |
|---|---|---|---|
| Design tokens + fonts + motion | ~260 | 3 | 0 |
| `src/api/` (contracts, client, endpoints, mock) | ~900 | 16 | 0 |
| Auth context, guards, routes | ~340 | 5 | 0 |
| Auth screens + `OtpInput` + `PasswordField` + `AuthShell` + `AtmosphericBackground` | ~1,050 | 9 | 0 |
| Shell (`AppShell`, `Sidebar` incl. Recent Chats, `TopHeader`, `ThemeToggle`) | ~560 | 4 | 0 |
| Design primitives (`EmptyState`, `Unavailable`, `MockBadge`) | ~180 | 3 | 0 |
| Boundary screens (`NotFound`, `BackendUnreachable`, the loading state) — §6.5 | ~120 | 2 | 0 |
| Token migration across existing components | ~40 files touched, mostly one-line class swaps | 45 | 0 |
| **Total** | **~3,410 new + 45 files migrated** | **~89** | **0** |

Zero new dependencies. `next-themes`, `input-otp`, and every Radix primitive this phase needs
are already in `frontend/package.json`. The first new dependencies arrive in Phase 3
(`remark-math`, `rehype-katex`, `rehype-highlight`) and Phase 4 (`three`, R3F, drei).
