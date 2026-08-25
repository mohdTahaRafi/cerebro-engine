# Phase 4: Inspector Consoles (UI)

> Depends on: Phase 1 (tokens, `src/api/`, guards), Phase 2 (contexts), Phase 3
> (`ProvenanceRibbon`, `ContextScopeProvider`, `CitationAccordion` patterns).
> Backend changes: **none**. Live telemetry and `/api/health` are real; trace history,
> projections, queue throughput, and the error stream are mocked until Phases 6–7.

## 1. Objective

At the end of this phase all three inspector consoles exist in the v2 design language:
`/admin/traces` lists executions and renders one as a waterfall, a reranking delta matrix,
and a raw payload drawer; `/admin/vectors` renders a **real** WebGL instanced point cloud
with a live query beacon and a click-to-inspect node panel; `/admin/health` is a full
admin-gated operations page with dependency latency, breaker states, queue metrics, and a
pipeline error stream.

By the end of this phase: a user asks a question on `/chat`, clicks the provenance ribbon,
lands on a waterfall showing every measured stage against a real elapsed-time axis, opens the
payload drawer to read the exact system prompt and the `<source>` blocks the model received,
then switches to `/admin/vectors`, types the same question, and watches a beacon drop into
the point cloud with blue links to its nearest neighbors.

**No backend code.** This is the last frontend phase.

### 1.1 The fabrication that gets deleted

`VectorSpace3D.tsx` generates 3,000 points from `Math.random()`, hardcodes a `topResults`
array of ten invented distances, and labels the panel `3D UMAP PROJECTION · DIMENSIONS: 384 ·
REDUCTION: UMAP`. There is no UMAP anywhere in this codebase and the real embedding is
1024-dimensional. `DimensionAnalysis.tsx` renders a hardcoded eight-row `mockDimensions`
array with invented variance and contribution percentages. `VectorInspector.tsx` renders
`generateVector(42)` — a sine wave. `FormulaHUD.tsx` attributes the cosine formula to a "C++
CORE" that has not been on the query path since v1 Phase 3.

All four are **deleted**, not restyled. This is the same class of fabrication that commit
`5ad604d` removed from the Ingestion and Reliability consoles, and the replacement is built
against a real endpoint or it renders an honest empty state.

### 1.2 What is real in this phase, and what is not

| Surface | This phase | Becomes real in |
|---|---|---|
| Waterfall + rerank matrix for the **live** query | **Real** — the SSE `telemetry` and `sources` frames already carry everything | already real |
| Trace **list** and any past trace | mocked | Phase 7 |
| Raw payload drawer | mocked (the backend discards the assembled prompt today) | Phase 7 |
| 3D projection | `<Unavailable>` in production; mocked in dev | Phase 7 |
| Query beacon | `<Unavailable>` in production; mocked in dev | Phase 7 |
| Node inspector text | `<Unavailable>` in production; mocked in dev | Phase 7 |
| Health: dependencies, breakers, queue depth, collections | **Real** — `/api/health` serves all four today | already real |
| Health: throughput, worker concurrency, error stream | mocked | Phase 7 |

Every mocked panel carries a `<MockBadge>` in dev and renders `<Unavailable>` with a stated
reason in a production build ([architecture.md §7.3](architecture.md)).

---

## 2. `/admin/traces` — The List

### 2.1 Purpose and scope

A trace is one execution of the RAG pipeline. The list is scoped to the signed-in user and
filterable by context; it is **not** admin-only, because the PRD's Inspector journey is a
normal user inspecting their own queries.

### 2.2 Layout

```
┌────┬──────────────────────────────────────────────────────────────────┐
│ N  │  Traces                                    [context ▾] [24h ▾]   │
│ A  │  Every query, with the latency of each pipeline stage.            │
│ V  │  ──────────────────────────────────────────────────────────────  │
│    │  ┌────────────────────────────────────────────────────────────┐  │
│    │  │ what was EMEA revenue in Q3?                        2,480ms│  │
│    │  │ ▐▐▐▐▐▐▐▐░░░░▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐ │  │
│    │  │ Q3 Reports · 3 sources · 2 minutes ago                     │  │
│    │  ├────────────────────────────────────────────────────────────┤  │
│    │  │ summarize the risk factors section                    890ms│  │
│    │  │ ▐▐▐▐▐▐░░░▐▐▐▐▐▐▐▐▐▐▐▐▐▐▐                                  │  │
│    │  │ Q3 Reports · 0 sources · refused · 8 minutes ago  ⚠ 1      │  │
│    │  └────────────────────────────────────────────────────────────┘  │
└────┴──────────────────────────────────────────────────────────────────┘
```

Each row **is** a `<ProvenanceRibbon>` from Phase 3, at list density. Building it once and
reusing it in chat, the list, and the detail header is what makes it a motif; three separate
latency visualizations would make it decoration.

### 2.3 Row content and filters

| Element | Source | Notes |
|---|---|---|
| Query | `TraceSummary.query` | truncated to two lines; the condensed query is shown in the detail, not here |
| Ribbon | `telemetry` | proportional segments, measured offsets |
| Total | `totalMs` | Data type, right-aligned |
| Context | `contextTitle` | chip; hidden when a single-context filter is active |
| Sources | `sourceCount` | `0 sources · refused` when the turn was refused |
| Warnings | `warningCount` | `--warn` triangle with count; tooltip lists them |
| Age | `createdAt` | relative, absolute in `title` |

Filters: context (defaults to the active scope from Phase 3), time window (1h / 24h / 7d /
all), and an *Only slow* toggle at p95 of the loaded set — computed from the actual rows on
screen and labeled with the threshold it computed (`> 3,120ms`), never a hardcoded number.

**The context filter offers `All contexts`** (`DESIGN.md` §5.3, added 2026-08-19) — this and
`/contexts` are the only two screens where that scope value renders, because a trace list is
one of the few things in the product that is genuinely meaningful across every context.
Selecting it **omits `contextId`** from `GET /api/traces` rather than sending a sentinel
string; the route already treats the parameter as optional (`phase_7` §3), so no backend
change is needed. When `All contexts` is active the per-row context chip **is** shown; it is
hidden only when a single context is selected, where it would repeat the filter on every row.

Sort is by `createdAt` desc, fixed. Sorting by duration is deliberately absent: it invites
reading the slowest query as the problem, when the interesting question is almost always
*what changed recently*.

### 2.4 Empty and unavailable states

- Production, endpoint absent → `<Unavailable>`: *"Trace history is recorded from Phase 7. The
  trace for your most recent query is available from the chat ribbon."* — with a link to
  `/chat`, because the live path genuinely does work.
- Real endpoint, zero rows → `<EmptyState>`: *"No traces in the last 24 hours."* + widen the
  window.

---

## 3. `/admin/traces/:id` — The Detail

Three regions in the Phase-1 grammar: the header carries the query and the ribbon, the
primary column carries the waterfall and the rerank matrix, and the evidence margin carries
the raw payload.

### 3.1 Header

Query in the Display role (Inter Bold), condensed query beneath in `--graphite` when present and different
(*"retrieval actually ran on: …"*), then the ribbon, then a metadata strip: context, thread
link, timestamp, `runId`, and a LangSmith deep link when `langsmithUrl` is non-null.

The condense line is one of the highest-value pieces of information on the page and is
absent from v1's console entirely — a follow-up question that retrieved badly is almost
always a condensation that went wrong, and this is the only place a user can see what was
actually searched.

**The compact ribbon here renders only stages that contributed measured time — added
2026-08-19.** A skipped stage draws **no segment at all**, not even a hatched one: on this
trace `CONDENSE` is skipped (first turn), so the ribbon shows
`EMBED · SPARSE · COLPALI · RETRIEVE · MERGE · RERANK · GENERATE` and nothing for condense.
The **hatched skip treatment belongs exclusively to the expanded Waterfall below** (§3.2),
which has a labelled row per stage and therefore a place to say *why* it was skipped. The
compact strip has no room for a reason, and a hatched band without one is just an unexplained
gap. This is the same rule `DESIGN.md` §5.7 states for the ribbon generally — restated here
because the detail screen is the one place both forms appear on the same page, twelve
vertical pixels apart, and the difference between them is easy to mistake for an
inconsistency.

### 3.2 The Waterfall

`ExecutionPlan.tsx`'s **logic is preserved exactly**; its presentation is replaced. The three
honesty rules that made it correct are carried over verbatim and are acceptance criteria:

1. Every bar's left offset comes from the backend's measured `<stage>StartMs`. Nothing
   reconstructs a position by stacking durations.
2. Bars deliberately do not sum to `totalMs`; the gaps are real unaccounted time. This is
   stated in the axis label, not buried in a tooltip.
3. A stage with a `null` duration gets **no bar** — a hatched full-width band with its skip
   reason instead. There is no honest position for a stage that did not run, and a zero-width
   bar at a guessed offset is a fabrication.

What changes: tokens instead of hardcoded hex, Inter Medium for labels and Inter Medium with
tabular figures for durations, the parallel-group bracket redrawn as a hairline gutter, and a
first-token marker on the `generate` bar with its own label rather than a bare white line.

```
                0ms                                                    2,480ms
  condense      │                                          skipped — first turn
                ├▓▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
  embed         │  ▐▐▐▐▐▐▐▐▐▐▐                                        │   210ms
  sparse        │  ▐▐                                                 │     3ms
  colpali       │  ▐▐▐▐▐▐▐▐                                           │   142ms
                │  └ parallel                                         │
  retrieve      │             ▐▐▐▐▐▐▐▐▐                               │   180ms
  merge         │                      ▐                              │     2ms
  rerank        │                       ▐▐▐▐▐▐▐▐▐▐▐▐                  │   240ms
  generate      │                                   ▐▐▐▐▐▐▐▐┋▐▐▐▐▐▐▐▐ │ 1,840ms
                │                                           ┋ first token 610ms
                └─────────────────────────────────────────────────────┘
  total 2,480ms · 312ms unaccounted (node transitions, prompt assembly, persistence)
```

The `unaccounted` figure is computed as `totalMs − Σ(measured, non-overlapping stages)`,
accounting for the parallel group by taking the group's span rather than its sum. Stating it
explicitly turns the gaps from an apparent bug into the most interesting number on the chart.

### 3.3 The Reranking Delta Matrix

`ProvenancePanel.tsx`'s logic is likewise preserved and its presentation replaced. It already
does the hard part — `fusionRank → finalRank` with the delta, branch attribution from the
three concurrent Qdrant membership queries, and absorbed-OCR-chunk counts.

What this phase adds is the PRD's explicit **side-by-side** framing (US-4.2). A single table
sorted by final rank hides the movement; two columns make it legible:

```
   RETRIEVED (fusion order)              →   RERANKED (final order)
   ┌─────────────────────────────┐           ┌─────────────────────────────┐
   │ 1  q3.pdf p12    dense      │──────┐    │ 1  q3.pdf p12   0.87  ▲ +3  │
   │ 2  notes.md §2   sparse     │────┐ └───▶│ 2  q3.pdf p14   0.71  ▲ +2  │
   │ 3  q3.pdf p9     both       │──┐ │      │ 3  notes.md §2  0.44  ▼ −1  │
   │ 4  q3.pdf p14    dense      │  │ └─────▶│ 4  q3.pdf p9    0.31  ▼ −1  │
   │ 5  scan.pdf p3   colpali    │  └───────▶│ ── relevance floor 0.15 ──  │
   │ …                           │           │ ✕  scan.pdf p3  0.09  cut   │
   └─────────────────────────────┘           └─────────────────────────────┘
        18 candidates                             4 survived · 14 below floor
```

- Connector lines are drawn as SVG cubic Béziers between the two columns, `--signal` for a
  promotion, `--graphite-faint` for a demotion (Amended 2026-08-19, replacing the retired
  `--evidence`; emerald/`--positive` is not used here because it is reserved for the
  system-healthy semantic and a rank promotion is not that), at 40% opacity so 18 of them do
  not become a solid block. Hovering a row raises its own connector to full opacity and dims
  the rest.
- The **relevance floor** is drawn as an explicit rule with its own value. Candidates below
  it are shown struck through, not omitted — *what was rejected* is at least as informative
  as what survived, and v1's panel could not show it at all.
- With `rerankSkipped: true` the right column renders as a single message — *"Reranking was
  unavailable; results are in fusion order."* — and no scores. Fabricating a reranked order
  from fusion ranks would be exactly the failure this console exists to expose.
- Below 1280px the two columns stack and the connectors are replaced by the inline
  `rank 4 → 1` glyph Phase 3 already uses in the citation accordion.

### 3.4 The Raw Payload Drawer

Slides in from the evidence margin (US-4.3). Three tabs:

**Prompt** — the assembled message as an ordered list of `TracePromptBlock`s, rendered as
labeled regions rather than one JSON blob:

```
  ┌ SYSTEM ─────────────────────────────────────────────── ~118 tokens ┐
  │ You answer questions using only the sources provided below…        │
  └────────────────────────────────────────────────────────────────────┘
  ┌ USER · text ──────────────────────────────────────────── ~412 tokens ┐
  │ <source n="1" file="q3-earnings.pdf" section="Revenue › Regional">  │
  │ EMEA revenue for the third quarter was $4.2M, up from $3.8M in Q2… │
  │ </source>                                                           │
  └────────────────────────────────────────────────────────────────────┘
  ┌ USER · image ─────────────────────────────────────────── ~1,600 tokens ┐
  │  [thumbnail]  scan.pdf page 3 — /api/pages/66f…/3.jpg                │
  └──────────────────────────────────────────────────────────────────────┘
```

Image blocks carry the **served URI**, never base64. A base64 page image is ~350 KB of
unreadable text that would dominate the drawer and inflate the trace document past its cap;
the URI is what a reader can actually act on.

Token counts are marked `~` and the panel states the method once: *"Estimated with
`js-tiktoken` (cl100k). The provider's own count is shown under Usage when reported."* An
estimate presented as exact is the same failure as an invented number, one order of magnitude
smaller.

**Sources** — the full pre-floor candidate set as JSON, collapsible per node, with a
copy-all. This is the escape hatch: whatever the two visualizations above do not show, this
does.

**Usage** — provider, model, input tokens, output tokens, from the `UsageEvent` row the
backend already writes. When the provider did not report counts, the row reads *"not
reported"*, never `0`.

A `truncated: true` trace shows a `--warn` band at the top of the drawer: *"This prompt
exceeded the 256 KB capture limit and was truncated."*

---

## 4. `/admin/vectors` — The 3D Vector Space

### 4.1 Scene composition

```
┌────┬──────────────────────────────────────────┬────────────────────┐
│ N  │  ┌────────────────────────────────────┐  │  NODE INSPECTOR    │
│ A  │  │                                    │  │  ────────────────  │
│ V  │  │        R3F <Canvas>                │  │  q3-earnings.pdf   │
│    │  │        instanced point cloud       │  │  page 12 · pos 34  │
│    │  │        + beacon + links            │  │  Revenue › Region… │
│    │  │                                    │  │  ────────────────  │
│    │  │                                    │  │  "EMEA revenue…"   │
│    │  └────────────────────────────────────┘  │  ────────────────  │
│    │  [ ask a question to place a beacon…  ]  │  distance  0.042   │
│    │  5,412 chunks · 12 documents · fitted 2h │  rerank    0.87    │
└────┴──────────────────────────────────────────┴────────────────────┘
```

Context selection comes from Phase 3's `ContextScopeProvider` — the same switcher in the
header. A projection is per-context by definition; there is no "all contexts" view, because
UMAP fitted across two unrelated corpora produces a picture of nothing.

### 4.2 Decoding the packed payload

The endpoint returns interleaved coordinates as base64 rather than JSON objects
([architecture.md §7.9](architecture.md)). The decode is written out here because getting the
byte alignment wrong produces a cloud that looks plausible and is wrong:

```ts
// frontend/src/app/components/vectors/decodeProjection.ts

export interface DecodedProjection {
  positions: Float32Array;   // length = nodeCount * 3, interleaved [x,y,z]
  docIndex: Uint16Array;     // length = nodeCount, indexes response.documents
  colors: Float32Array;      // length = nodeCount * 3, RGB per instance
  pointIds: string[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function decodeProjection(res: ProjectionResponse): DecodedProjection {
  const posBuf = b64ToBuffer(res.positions);
  const idxBuf = b64ToBuffer(res.docIndex);

  // A Float32Array view REQUIRES 4-byte alignment and an exact length. Both are
  // asserted rather than assumed: a truncated or misaligned buffer would either
  // throw deep inside three.js on upload, or silently render a shifted cloud.
  if (posBuf.byteLength !== res.nodeCount * 3 * 4) {
    throw new Error(
      `projection: expected ${res.nodeCount * 3 * 4} position bytes, got ${posBuf.byteLength}`,
    );
  }
  if (idxBuf.byteLength !== res.nodeCount * 2) {
    throw new Error(
      `projection: expected ${res.nodeCount * 2} docIndex bytes, got ${idxBuf.byteLength}`,
    );
  }

  const positions = new Float32Array(posBuf);
  const docIndex = new Uint16Array(idxBuf);

  // Per-instance color, resolved once on decode rather than in the shader, so the
  // GPU never needs the document table and a re-color (on filter) is a single
  // attribute update rather than a re-upload of positions.
  const palette = res.documents.map((d) => hexToLinearRgb(d.color));
  const colors = new Float32Array(res.nodeCount * 3);
  for (let i = 0; i < res.nodeCount; i++) {
    const c = palette[docIndex[i]] ?? FALLBACK_RGB;
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
  }

  return { positions, docIndex, colors, pointIds: res.pointIds, bounds: res.bounds };
}
```

`hexToLinearRgb` converts sRGB to linear because R3F sets `THREE.ColorManagement.enabled =
true` by default; passing sRGB values straight into a vertex color attribute produces a cloud
that is visibly washed out relative to the same hex used in the surrounding CSS.

### 4.3 Rendering — one draw call

```tsx
// PointCloud.tsx — the entire cloud is ONE instanced draw call. The rejected
// alternative (one <mesh> per node) is 5,000 draw calls and ~8 fps; see
// architecture.md §5.
function PointCloud({ data, highlighted }: Props) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('color',    new THREE.BufferAttribute(data.colors, 3));
    // Per-instance size, mutated in place for highlight/dim rather than rebuilt.
    g.setAttribute('size',     new THREE.BufferAttribute(new Float32Array(data.pointIds.length).fill(BASE_SIZE), 1));
    g.computeBoundingSphere();   // REQUIRED — without it frustum culling drops the
                                 // whole cloud the moment the camera moves off origin
    return g;
  }, [data]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexColors: true, transparent: true, depthWrite: false,
    blending: THREE.NormalBlending,
    uniforms: { uPixelRatio: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: `
      attribute float size;
      varying vec3 vColor; varying float vAlpha;
      uniform float uPixelRatio;
      void main() {
        vColor = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        // Perspective-correct point size, clamped so a near point does not
        // become a screen-filling square.
        gl_PointSize = clamp(size * uPixelRatio * (300.0 / -mv.z), 1.0, 24.0);
        // Depth fade: distant points recede rather than forming a flat wall.
        vAlpha = clamp(1.0 - (-mv.z - 40.0) / 120.0, 0.15, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vColor; varying float vAlpha;
      void main() {
        // Round point sprite with a 1px soft edge — a square point reads as a
        // rendering artifact at this density.
        vec2 d = gl_PointCoord - vec2(0.5);
        float r = dot(d, d);
        if (r > 0.25) discard;
        gl_FragColor = vec4(vColor, vAlpha * smoothstep(0.25, 0.16, r));
      }`,
  }), []);

  return <points geometry={geometry} material={material} />;
}
```

`depthWrite: false` with `NormalBlending` is deliberate: with depth writing on, transparent
point sprites occlude each other in draw order and the cloud develops visible seams as the
camera rotates.

### 4.4 Picking — GPU color picking, not raycasting

`THREE.Points` raycasting tests every vertex against a threshold on the CPU. At 5,000 points
on every `pointermove` that is a measurable stall, and the threshold has to be tuned per zoom
level or the hit target is either unusable or grabs the wrong point.

Instead, an off-screen picking pass:

1. A second `WebGLRenderTarget` at 1×1 pixel, rendered only on click (not on move).
2. The camera is offset so the target pixel is at the cursor
   (`camera.setViewOffset(w, h, x, y, 1, 1)`), the cloud is drawn with a picking material that
   writes `gl_FragColor = vec4(id encoded as RGB, 1.0)`, and one pixel is read back.
3. The id is decoded as `r + g*256 + b*65536`, which addresses 16.7M nodes — comfortably above
   the 65,535 ceiling `Uint16Array` imposes on `docIndex` anyway.
4. `camera.clearViewOffset()` restores the normal camera.

Cost: one 1×1 render and one `readPixels` per click, roughly 0.4 ms. Hover highlighting uses
the same path throttled to 60 ms, and is disabled entirely below 30 fps — a hover affordance
is not worth the frame budget on a weak GPU.

### 4.5 Camera and controls

`OrbitControls` from drei, with damping, `minDistance`/`maxDistance` derived from the payload
`bounds` so the camera cannot be flown inside the cloud or lost outside it. Initial framing
fits the bounding sphere with a 1.2 margin. A *Reset view* control returns to it.

Auto-rotation is **off** by default and is not offered. A slowly spinning point cloud is the
single most common decorative tell in this genre and it actively interferes with reading
cluster structure.

### 4.6 The Query Beacon

Input under the canvas: *"Ask a question to place it in this space."* On submit,
`POST /api/vectors/project-query` returns the beacon coordinate, its k nearest neighbors with
distances, and the reranked order.

Rendering (Amended 2026-08-19 — the beacon was `--evidence` amber; that token is retired,
see [architecture.md §7.4](architecture.md)):
- The beacon is a `--signal` blue sphere at 3× base point size with a soft additive halo. It
  is the only point in the scene not colored by its source document (every other point takes
  its color from the document legend), which is what makes it read as "the thing I placed"
  rather than "the color of proof."
- Neighbor links are one `THREE.LineSegments` with per-vertex alpha falling off by rank, not
  N separate line objects.
- Neighbor nodes get their `size` attribute raised in place and every other node's alpha
  dropped, so the retrieved set reads instantly against a dimmed field.
- Nodes that survived reranking get a thin `--signal` ring; nodes retrieved but cut by the
  floor keep the raised size without the ring — **the difference between "retrieved" and
  "kept" is a shape difference (ring vs. no ring), never a color difference**, per DESIGN.md
  §5.20, and it costs one attribute.

A rebuild of the projection while a beacon is on screen **discards the beacon**, with a toast
*"Projection rebuilt — place the beacon again."* A beacon computed against a previous UMAP fit
is meaningless on a new one ([architecture.md §7.8](architecture.md)), and leaving it drawn
would be the most convincing wrong picture this console could produce.

### 4.7 Node Inspector

Click a node → the evidence margin fills with the real chunk: filename, page, heading path,
position, the chunk text, and, when a beacon is active, that node's distance and rerank score.
Text comes from `GET /api/vectors/node/:pointId` on demand — 5,000 chunks of text is megabytes
nobody reads, so it is not in the projection payload.

While the fetch is in flight the panel shows a skeleton with the metadata already known from
the payload. On failure it shows the error and a retry, never a blank panel.

### 4.8 Staleness and unavailability

| `staleness` | Rendering |
|---|---|
| `fresh` | the cloud, plus *"fitted 2 hours ago"* in the status line |
| `rebuilding` | the cached cloud at 60% opacity with a `--warn` band: *"Rebuilding — 412 new chunks aren't plotted yet."* The beacon input is disabled |
| `absent` | `<Unavailable>` with the server's reason, and a *Rebuild projection* action (enabled from Phase 7) |
| endpoint missing (this phase, production) | `<Unavailable>`: *"Vector projections are computed from Phase 7."* — never random points |

### 4.9 What replaces `DimensionAnalysis` and `FormulaHUD`

Nothing. Per-dimension "variance and contribution" over a 1024-dim Cohere embedding is not a
quantity this system computes, and individual dimensions of a learned embedding are not
interpretable in the way that panel implied. The cosine formula HUD described a C++ engine
that has not served a query since v1 Phase 3.

The left column instead holds a **document legend** — one row per document with its cloud
color, chunk count, and a visibility toggle that dims that document's points in place. That is
real data, it directly serves "is my clustering clean", and it is one attribute update.

---

## 5. `/admin/health` — Operations

Admin-gated (`RequireAdmin`). Promotes the 300px `SystemHealth` rail to a full page.

### 5.1 Sections

**Status banner** — `up` / `degraded` / `down` from `/api/health`, with the degrading
dependency named. A `degraded` state that does not say *what* is degraded is a colored square.

**Dependencies** — the seven probes (`mongo`, `qdrant`, `redis`, `vision`, `cohere`,
`llamaparse`, `llm`) as cards with current latency, a 20-sample sparkline built from the
poll history the page itself accumulates in memory, and the error string on failure.

The sparkline is honest about its own provenance: it is labeled *"last 20 polls (5 min)"* and
starts empty on page load rather than back-filling. There is no latency history endpoint;
inventing one would mean drawing a line for a period the page did not observe.

**Circuit breakers** — one row per named breaker with `closed`/`half-open`/`open` in
`--positive`/`--warn`/`--critical`, and time-in-state accumulated by the page.

**Ingest queue** — waiting / active / failed / completed from `/api/health` (real), plus
throughput per minute, worker concurrency, and oldest-waiting age from `/api/admin/queue`
(mocked this phase). Real and mocked panels are visually distinguished by the `<MockBadge>`,
not merged into one card.

**Collections** — point counts for `cerebro_chunks` and `cerebro_pages`, real today.

**Pipeline error stream** — reverse-chronological feed from `/api/admin/errors` (mocked this
phase): kind chip, message, document/context links, relative time, and an expandable stack
trace. Filterable by kind. Auto-refreshes with the page poll and can be paused, because a feed
that reorders while you are reading it is unusable.

### 5.2 Polling

One 15-second poll for `/api/health`, matching the existing `SystemHealth` interval and for
the same reason: the endpoint fans out to every provider concurrently and a cold LLM ping alone
can take seconds. `/api/admin/queue` polls at 5 s (cheap, Redis only) and `/api/admin/errors`
at 15 s. All three pause on `visibilitychange`.

---

## 6. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 4.1 | Delete the four fabricated vector components | `VectorSpace3D.tsx`, `DimensionAnalysis.tsx`, `VectorInspector.tsx`, `FormulaHUD.tsx` do not exist; `grep -rn "mockDimensions\|generateVector\|C++ CORE" frontend/src/` returns 0 |
| 4.2 | Build `/admin/traces` list with ribbon rows and filters | With the endpoint absent in a production build, the page renders `<Unavailable>` naming Phase 7 and linking to `/chat`; in dev with mocks it lists rows |
| 4.3 | Implement the *Only slow* toggle from the loaded set's p95 | The toggle's label shows the computed threshold in ms; with 3 rows loaded it is disabled with a tooltip explaining the sample is too small |
| 4.3a | Implement the `All contexts` scope in the trace-list context filter (§2.3) | Selecting *All contexts* issues `GET /api/traces` with **no** `contextId` parameter (verify in the Network panel — no sentinel string such as `all` or `*` is sent); rows from two different contexts appear together and each row shows its context chip; selecting a single context re-adds the parameter and hides the chip |
| 4.3b | Verify the compact ribbon omits skipped stages entirely (§3.1) | On a trace with `condenseMs: null`, the **compact** ribbon under the header renders 7 segments and no hatched band, while the **waterfall** below it renders 8 rows including the hatched `CONDENSE` band — both visible on the same screen, differing exactly as specified |
| 4.4 | Build the trace detail header with the condensed-query line | A trace whose `condensedQuery` differs shows both; one where it is null shows only the query |
| 4.5 | Port `ExecutionPlan` to the v2 waterfall preserving all three honesty rules | A telemetry object with `condenseMs: null` renders a hatched band reading "skipped — first turn" and **no** positioned bar; bar offsets equal `<stage>StartMs` exactly |
| 4.6 | Implement the `unaccounted` figure with parallel-group handling | For a telemetry set where embed/sparse/colpali overlap, `unaccounted` uses the group span, not the sum; the number is displayed with its explanation |
| 4.7 | Build the side-by-side rerank delta matrix with Bézier connectors | 18 candidates render without visual saturation; hovering a row isolates its connector |
| 4.8 | Draw the relevance floor and show cut candidates struck through | A query where 14 of 18 fall below the floor shows all 14, struck, under a labeled rule carrying the floor value |
| 4.9 | Implement the `rerankSkipped` degradation state | With `rerankSkipped: true` the right column shows the message and no scores; no order is synthesized |
| 4.10 | Build the payload drawer with three tabs | Image blocks show the served URI and a thumbnail, never base64; the token-estimate method is stated once |
| 4.11 | Implement the `truncated` warning band | A trace with `truncated: true` shows the 256 KB band |
| 4.12 | Implement `decodeProjection` with both length assertions | Unit test: a buffer one byte short throws with the expected/actual byte counts in the message |
| 4.13 | Build `PointCloud` as one instanced draw call | `renderer.info.render.calls` is 1 for the cloud (plus beacon/links/grid) with 5,000 nodes; `computeBoundingSphere` is called, and orbiting away from origin does not cull the cloud |
| 4.14 | Implement GPU color picking | Clicking a visibly distinct node selects that node, verified against a fixture with known coordinates; `pointermove` performs no picking pass |
| 4.15 | Implement camera bounds from the payload | The camera cannot be dollied inside the cloud or beyond `maxDistance`; *Reset view* restores the initial framing; no auto-rotation control exists |
| 4.16 | Implement the beacon, neighbor links, and the retrieved-vs-kept ring | Nodes cut by the floor are enlarged but unringed; kept nodes are ringed; the beacon is the only point not colored by the document legend |
| 4.17 | Discard the beacon on a staleness change | Simulating a `rebuilding` response with a beacon on screen removes it and toasts |
| 4.18 | Build the node inspector with on-demand text fetch | The projection payload contains no chunk text; clicking a node issues exactly one `GET /api/vectors/node/:id` |
| 4.19 | Implement all four staleness states | Each renders its stated treatment; `absent` never renders points |
| 4.20 | Build the document legend with per-document dimming | Toggling a document updates the color attribute in place; `renderer.info.memory.geometries` does not increase |
| 4.21 | Build `/admin/health` with all six sections behind `RequireAdmin` | As a non-admin, `/admin/health` renders the 404 page and the sidebar item is absent |
| 4.22 | Implement in-memory latency sparklines labeled with their window | The sparkline starts empty on load and fills over 20 polls; nothing is back-filled |
| 4.23 | Build the error stream with kind filter and pause | Pausing freezes the list while the poll continues; resuming shows the accumulated entries |
| 4.24 | Verify no mock reaches production | `npm run build && grep -rl "MOCKED_ENDPOINTS\|fixtures/" dist/` returns nothing; every mocked panel renders `<Unavailable>` in the production preview |
| 4.25 | Lazy-load the 3D stack | The `/login` and `/chat` route chunks contain neither `three` nor `@react-three`; `/admin/vectors` loads them on navigation |
| 4.26 | Accessibility pass on the consoles | The waterfall has a table-equivalent readable by a screen reader; the canvas has a text alternative summarizing node and document counts; the error stream is an `aria-live="polite"` feed when unpaused |

---

## 7. Milestone Definition

Phase 4 is **complete** when:

> A user asks a question on `/chat`, waits for the answer, and clicks **View trace ›** on the
> provenance ribbon. `/admin/traces/:id` opens on the query in bold with a second line beneath
> reading *"retrieval actually ran on: How did EMEA revenue in Q3 2024 compare to the 3.8M
> reported in Q2?"* — the condensation, visible for the first time in this product.
>
> Below it the waterfall draws eight rows against a real elapsed-time axis. `condense` has no
> bar at all: a hatched band across its row reads *"skipped — first turn"*. `embed`, `sparse`,
> and `colpali` start at the same offset under a hairline bracket marked *parallel*, and their
> bars are visibly different lengths — 210 ms, 3 ms, 142 ms — which is the whole reason those
> three were split apart. `generate` carries a marker at 610 ms labeled *first token*. Under
> the axis: **total 2,480ms · 312ms unaccounted (node transitions, prompt assembly,
> persistence)**. The bars do not sum to the total, and the chart says so rather than hiding
> it.
>
> They scroll to the delta matrix. Eighteen retrieved candidates sit on the left in fusion
> order, four survivors on the right in reranked order, joined by curves — blue where the
> reranker promoted a candidate, grey where it demoted one. Hovering row 4 on the left raises
> its curve to full opacity: it went from rank 4 to rank 1. Below the fourth survivor a labeled
> rule reads **relevance floor 0.15**, and beneath it fourteen struck-through rows show exactly
> what was thrown away — including a `colpali` page hit at 0.09 that the previous console could
> never have shown.
>
> They open the payload drawer. The **Prompt** tab shows the system prompt verbatim in its own
> labeled region at ~118 tokens, then the assembled user message with three `<source>` blocks
> exactly as the model received them, then an image block showing a page thumbnail and the URI
> `/api/pages/66f…/3.jpg` — not 350 KB of base64. A line states the counts are estimated with
> `js-tiktoken`. The **Usage** tab reports the provider's own input and output token counts.
>
> They navigate to `/admin/vectors` with `Q3 Reports` still selected. In a dev build with mocks
> on, five thousand points resolve into three visible clusters, colored by document, with a
> legend on the left; `renderer.info.render.calls` shows the cloud is a single draw call and the
> frame counter holds above 55 fps while they orbit. They click a point at the edge of a cluster
> and the right margin fills with the real chunk — `notes.md · § Regional breakdown · position
> 34` — and its text. They type *"EMEA revenue"* into the beacon box. A blue sphere drops into
> the cloud — the only point in the scene not colored by the document legend — ten links fan
> out to its nearest neighbors, the rest of the field dims, and four of the ten neighbors carry
> a thin ring: retrieved *and* kept, versus enlarged-but-unringed for retrieved and cut.
>
> They run `npm run build && npm run preview` and revisit both consoles. `/admin/traces` now
> reads *"Trace history is recorded from Phase 7. The trace for your most recent query is
> available from the chat ribbon."* with a working link. `/admin/vectors` reads *"Vector
> projections are computed from Phase 7."* Not one random point is drawn.
> `grep -rl "MOCKED_ENDPOINTS" dist/` prints nothing, and the `/chat` route chunk contains no
> `three`.
>
> Finally, signed in as an admin, they open `/admin/health`: seven dependency cards with live
> millisecond latencies and sparklines that began empty on load and are now twenty polls long,
> five circuit breakers all `closed`, real queue counts and collection sizes beside two
> `MOCK`-badged panels for throughput and the error stream. Signing in as a non-admin, the
> Health item is gone from the sidebar and `/admin/health` renders the 404 page — not a
> "forbidden" page that would confirm the route exists.

---

## 8. Files to Create

```
frontend/src/app/
├── pages/admin/
│   ├── TraceList.tsx            # list, filters, ribbon rows, unavailable state
│   ├── TraceDetail.tsx          # header + waterfall + matrix + drawer
│   ├── VectorSpace.tsx          # canvas + beacon input + legend + inspector
│   └── Health.tsx               # six sections, admin-gated
├── components/trace/
│   ├── Waterfall.tsx            # from ExecutionPlan.tsx — logic preserved, styling replaced
│   ├── waterfallLayout.ts       # row building, unaccounted-time computation (§3.2) — named
│   │                            #   waterfallLayout.ts, not waterfall.ts: that name collides
│   │                            #   with Waterfall.tsx on a case-insensitive filesystem
│   ├── RerankMatrix.tsx         # side-by-side columns + SVG Bézier connectors
│   ├── RelevanceFloorRule.tsx
│   ├── PayloadDrawer.tsx        # Prompt / Sources / Usage tabs
│   └── TraceRow.tsx             # list row wrapping ProvenanceRibbon
├── components/vectors/
│   ├── PointCloud.tsx           # instanced draw call, custom shaders (§4.3)
│   ├── decodeProjection.ts      # packed payload decode + assertions (§4.2)
│   ├── usePicking.ts            # GPU color picking (§4.4)
│   ├── QueryBeacon.tsx          # beacon sphere, links, retrieved-vs-kept rings
│   ├── NodeInspector.tsx        # margin panel, on-demand text
│   ├── DocumentLegend.tsx       # replaces DimensionAnalysis
│   └── SceneControls.tsx        # OrbitControls config, bounds, reset
├── components/health/
│   ├── DependencyCard.tsx  BreakerList.tsx  QueuePanel.tsx
│   ├── CollectionPanel.tsx ErrorStream.tsx  LatencySparkline.tsx
└── hooks/
    ├── useTraces.ts  useTrace.ts
    ├── useProjection.ts  useProjectQuery.ts  useVectorNode.ts
    └── useHealthHistory.ts  useQueueStats.ts  usePipelineErrors.ts

frontend/test/
├── decodeProjection.test.ts     # task 4.12
└── waterfall.test.ts            # task 4.6 — unaccounted time with a parallel group
```

**Deleted this phase:** `VectorSpace3D.tsx`, `DimensionAnalysis.tsx`, `VectorInspector.tsx`,
`FormulaHUD.tsx`, `VectorDebugger.tsx`, `CoreEngine.tsx`, `ExecutionPlan.tsx`,
`ProvenancePanel.tsx`, `SystemHealth.tsx`, `QueryConsole.tsx` — every one superseded by a
named component above.

**New dependencies:** `three`, `@react-three/fiber`, `@react-three/drei`.

---

## 9. Performance Validation

| Metric | How to Measure | Target |
|---|---|---|
| Cloud frame rate | drei `<Stats>` while orbiting, 10,000 nodes, integrated GPU | ≥ 55 fps |
| Draw calls | `renderer.info.render.calls` | ≤ 4 total (cloud, beacon, links, grid) |
| Projection decode | `performance.mark` around `decodeProjection`, 5,000 nodes | < 5 ms |
| Projection payload | Network panel | ≤ 100 KB for 5,000 nodes |
| Pick latency | `performance.measure` around one click | < 2 ms |
| Route chunk sizes | build report | `/chat` and `/login` contain no `three`; the vectors chunk is lazy |
| Waterfall render | Performance recording, 9 stages | < 16 ms, single layout pass |
| Matrix connectors | Performance recording, 18 candidates | < 16 ms; hover isolation is a class toggle, not a re-render of the SVG |
| Health page poll cost | Network panel over 60 s | 4 `/api/health` + 12 `/api/admin/queue` + 4 `/api/admin/errors`; zero while hidden |

---

## 10. Estimated Complexity

| Component | LOC | Files | New deps |
|---|---|---|---|
| Trace list + row + filters | ~420 | 2 | 0 |
| Trace detail shell + header | ~260 | 1 | 0 |
| Waterfall port + `waterfall.ts` | ~430 | 2 | 0 |
| Rerank matrix + connectors + floor rule | ~520 | 2 | 0 |
| Payload drawer (3 tabs) | ~380 | 1 | 0 |
| Point cloud + shaders + decode + picking | ~720 | 4 | 3 |
| Beacon, inspector, legend, controls | ~560 | 4 | 0 |
| Health page + six panels | ~740 | 7 | 0 |
| Hooks | ~460 | 8 | 0 |
| Tests | ~180 | 2 | 0 |
| **Total** | **~4,670** | **33** | **3** |

This is the largest frontend phase. It is not split further because the three consoles share
the `ProvenanceRibbon`, the `<Unavailable>` discipline, and the evidence-margin grammar, and
splitting them would mean establishing those three times.
