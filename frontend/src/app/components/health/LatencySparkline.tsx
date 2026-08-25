// phase_4 §5.1 — honest about its own provenance: labeled "last 20 polls (5 min)" and starts
// empty rather than back-filling. `NaN` in `samples` marks a poll where the dependency was
// down (no latency to plot) — drawn as a gap in the line, not a zero.
const WIDTH = 100;
const HEIGHT = 28;
const MAX_SAMPLES = 20;

export function LatencySparkline({ samples }: { samples: number[] }) {
  if (samples.length === 0) {
    return (
      <div className="flex h-7 items-center">
        <div className="h-px w-full bg-line-subtle" />
      </div>
    );
  }

  const finite = samples.filter((s) => Number.isFinite(s));
  const max = finite.length > 0 ? Math.max(...finite, 1) : 1;
  const min = finite.length > 0 ? Math.min(...finite, 0) : 0;
  const range = Math.max(max - min, 1);

  // Pad to MAX_SAMPLES worth of x-space so the line grows left-to-right as it fills,
  // rather than stretching a partial history across the full width.
  const points = samples.map((s, i) => {
    const x = (i / (MAX_SAMPLES - 1)) * WIDTH;
    if (!Number.isFinite(s)) return null;
    const y = HEIGHT - ((s - min) / range) * (HEIGHT - 4) - 2;
    return `${x},${y}`;
  });

  // Split into contiguous runs so a down-poll (null) breaks the line instead of the
  // polyline interpolating straight through a gap.
  const segments: string[] = [];
  let current: string[] = [];
  for (const p of points) {
    if (p == null) { if (current.length > 1) segments.push(current.join(' ')); current = []; }
    else current.push(p);
  }
  if (current.length > 1) segments.push(current.join(' '));

  return (
    <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="h-7 w-full" preserveAspectRatio="none" aria-hidden="true">
      {segments.map((seg, i) => (
        <polyline key={i} points={seg} fill="none" stroke="var(--signal)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </svg>
  );
}
