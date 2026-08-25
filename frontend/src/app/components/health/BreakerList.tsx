// phase_4 §5.1 — one row per named breaker, state colored positive/warn/critical, with
// time-in-state accumulated by the page itself (there is no history endpoint for this either).
import type { BreakerSince } from '../../hooks/useHealthHistory';

const STATE_CLASS: Record<string, string> = {
  closed: 'text-positive-text', 'half-open': 'text-warn-text', open: 'text-critical-text',
};

function formatDuration(ms: number): string {
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return '<1m';
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

export function BreakerList({ breakers, since }: { breakers: Record<string, 'closed' | 'half-open' | 'open'>; since: Record<string, BreakerSince> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-graphite">Circuit breakers</h2>
      {Object.entries(breakers).map(([name, state]) => (
        <div key={name} className="flex items-center justify-between text-xs">
          <span className="truncate text-ink">{name}</span>
          <span className="flex items-center gap-2">
            <span className={`font-medium ${STATE_CLASS[state]}`}>{state}</span>
            <span className="tabular-nums text-graphite">
              {since[name] ? formatDuration(Date.now() - since[name].since) : '—'}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
