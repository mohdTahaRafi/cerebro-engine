// phase_1 §6 intro / DESIGN.md §6.1 — a page-level (never card-level) treatment: layered
// radial-gradient glows (pale blue center-left, lavender lower-left, faint blue upper-right)
// plus a semantic-network node/line pattern concentrated toward the center and lower-left.
// It sits behind all content, never touches text contrast, and is the one deliberate
// exception to the "no gradient heroes" rule — auth routes only, rendered once by
// AuthShell, never re-rendered inside the card.
interface NetNode {
  x: number;
  y: number;
  r: number;
  opacity: number;
}

/** Deterministic PRNG (mulberry32) — the network is generated, not hand-placed, but must
 *  render identically on every load rather than reshuffling on each mount. */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Builds the node/edge set once at module load. Three overlapping weighted regions
 *  (viewBox 1536×1024, matching the reference viewport) stand in for a soft density
 *  falloff: a broad faint scatter across the whole canvas for atmosphere, a denser
 *  cluster toward the lower-left where the reference concentrates its nodes, and a
 *  bridge cluster connecting the two so the graph reads as one organism, not two
 *  disjoint patches. Nodes near the hero text column (roughly x<750, y<650) are thinned
 *  by the region weighting rather than hard-excluded, so the pattern still reads as
 *  passing *behind* the copy instead of stopping abruptly at its edge. */
function buildNetwork(): { nodes: NetNode[]; edges: [number, number][] } {
  const rand = mulberry32(20260819);
  const nodes: NetNode[] = [];
  const REGIONS = [
    { cx: 780, cy: 440, sx: 560, sy: 340, count: 34 }, // broad center scatter
    { cx: 210, cy: 890, sx: 260, sy: 170, count: 32 }, // dense lower-left cluster
    { cx: 610, cy: 760, sx: 230, sy: 210, count: 18 }, // bridge between them
  ];

  for (const region of REGIONS) {
    for (let i = 0; i < region.count; i++) {
      // Sum of three uniforms approximates a soft (non-hard-edged) falloff from the
      // region center, cheaper than a real Gaussian and visually indistinguishable here.
      const gx = (rand() + rand() + rand() - 1.5) / 1.5;
      const gy = (rand() + rand() + rand() - 1.5) / 1.5;
      const x = Math.min(1536, Math.max(0, region.cx + gx * region.sx));
      const y = Math.min(1024, Math.max(0, region.cy + gy * region.sy));
      const bright = rand() > 0.88;
      nodes.push({
        x,
        y,
        r: bright ? 2.6 + rand() * 1.4 : 1.3 + rand() * 1.5,
        opacity: bright ? 0.28 + rand() * 0.12 : 0.09 + rand() * 0.12,
      });
    }
  }

  // Connect each node to its 1–2 nearest neighbors within range, so the graph reads as
  // organic local clusters rather than a uniform mesh or a literal graph visualization.
  const edges: [number, number][] = [];
  const seen = new Set<string>();
  nodes.forEach((n, i) => {
    const nearest = nodes
      .map((m, j) => ({ j, d: i === j ? Infinity : Math.hypot(n.x - m.x, n.y - m.y) }))
      .sort((a, b) => a.d - b.d);
    const linkCount = 1 + Math.floor(rand() * 2);
    for (let k = 0; k < linkCount; k++) {
      const { j, d } = nearest[k];
      if (d > 150) continue;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push([i, j]);
    }
  });

  return { nodes, edges };
}

const NETWORK = buildNetwork();

export function AtmosphericBackground() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute inset-0"
        style={{
          background: [
            'radial-gradient(circle at 44% 46%, rgb(188 211 255 / 0.38) 0%, rgb(188 211 255 / 0.20) 18%, rgb(188 211 255 / 0) 43%)',
            'radial-gradient(circle at 10% 92%, rgb(223 187 255 / 0.34) 0%, rgb(223 187 255 / 0.16) 24%, rgb(223 187 255 / 0) 48%)',
            'radial-gradient(circle at 92% 18%, rgb(214 226 255 / 0.22) 0%, rgb(214 226 255 / 0) 38%)',
          ].join(', '),
        }}
      />
      <svg className="absolute inset-0 h-full w-full" viewBox="0 0 1536 1024" preserveAspectRatio="xMidYMid slice">
        <g stroke="var(--signal)" fill="var(--signal)">
          <g strokeWidth="1">
            {NETWORK.edges.map(([a, b], i) => {
              const n1 = NETWORK.nodes[a];
              const n2 = NETWORK.nodes[b];
              return <line key={i} x1={n1.x} y1={n1.y} x2={n2.x} y2={n2.y} opacity={0.08} />;
            })}
          </g>
          <g>
            {NETWORK.nodes.map((n, i) => (
              <circle key={i} cx={n.x} cy={n.y} r={n.r} opacity={n.opacity} />
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}
