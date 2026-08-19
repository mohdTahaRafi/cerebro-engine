// DESIGN.md §5.13 — a compact status marker in the top bar with three states
// (healthy / degraded / down). Its tooltip lists every dependency with its real
// measured latency. Real data from GET /api/health — never mocked (phase_1 §4.4).
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { useHealth } from '../../hooks/useHealth';
import { cn } from '../ui/utils';

const DOT_COLOR = { up: 'bg-positive', degraded: 'bg-warn', down: 'bg-critical' } as const;
const LABEL = { up: 'System healthy', degraded: 'System degraded', down: 'System down' } as const;

export function HealthIndicator() {
  const { health, error } = useHealth();

  if (!health) {
    return (
      <span className="flex items-center gap-1.5 text-xs text-graphite" title={error ? `/health unreachable: ${error}` : 'Checking system health…'}>
        <span className="size-2 rounded-full bg-graphite-faint" aria-hidden="true" />
        <span className="sr-only">Checking system health…</span>
      </span>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="flex items-center gap-1.5 rounded-md px-1.5 py-1 outline-none focus-visible:ring-[3px] focus-visible:ring-signal-ring" aria-label={LABEL[health.status]}>
          <span className={cn('size-2 rounded-full', DOT_COLOR[health.status])} aria-hidden="true" />
          <span className="text-xs font-medium text-positive-text data-[status=degraded]:text-warn-text data-[status=down]:text-critical-text">
            {LABEL[health.status]}
          </span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex flex-col gap-1 bg-surface-overlay text-ink border border-line shadow-2">
        {Object.values(health.dependencies).map((d) => (
          <div key={d.name} className="flex items-center justify-between gap-4 text-xs">
            <span className="text-graphite">{d.name}</span>
            <span className={d.status === 'up' ? 'text-positive-text' : 'text-critical-text'}>
              {d.status === 'up' ? `${d.latencyMs}ms` : 'down'}
            </span>
          </div>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
