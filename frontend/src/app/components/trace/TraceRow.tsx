// phase_4 §2.2, §2.3 — one list row. Wraps the same TelemetryTrack the chat ribbon and the
// trace detail header use (ProvenanceRibbon.tsx) so the three placements read as one motif;
// the footer around it is this screen's own (context chip, source/refused text, warning
// marker, age) because a list row's TraceSummary carries counts, not full ProvenanceSource
// objects — see contracts.ts's TraceSummary doc comment.
import { Link } from 'react-router';
import { AlertTriangle } from 'lucide-react';
import type { TraceSummary } from '../../../api/contracts';
import { TelemetryTrack } from '../chat/ProvenanceRibbon';
import { cn } from '../ui/utils';

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

interface TraceRowProps {
  trace: TraceSummary;
  /** Hidden when a single-context filter is active (§2.3) — it would repeat the filter on
   *  every row. Shown when the scope is "All contexts", the one screen where it's meaningful. */
  showContextChip: boolean;
}

export function TraceRow({ trace, showContextChip }: TraceRowProps) {
  const warnings = trace.telemetry.warnings;

  return (
    <Link
      to={`/admin/traces/${trace.id}`}
      className="block rounded-lg border border-line bg-surface-raised px-4 py-3 outline-none transition-colors hover:bg-surface-sunken focus-visible:ring-[3px] focus-visible:ring-signal-ring"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="line-clamp-2 flex-1 text-sm font-medium text-ink">{trace.query}</p>
        <span className="shrink-0 text-xs tabular-nums text-graphite">{trace.totalMs.toLocaleString()}ms</span>
      </div>

      <TelemetryTrack telemetry={trace.telemetry} className="mt-2" />

      <div className="mt-1.5 flex items-center gap-2 text-xs text-graphite">
        {showContextChip && (
          <span className="rounded-sm border border-line bg-surface-sunken px-1.5 py-0.5 text-[11px] font-medium text-graphite">
            {trace.contextTitle}
          </span>
        )}
        <span>
          {trace.refused ? '0 sources · refused' : `${trace.sourceCount} source${trace.sourceCount === 1 ? '' : 's'}`}
        </span>
        <span>·</span>
        <span title={new Date(trace.createdAt).toLocaleString()}>{formatRelativeTime(trace.createdAt)}</span>
        {warnings.length > 0 && (
          <span
            className={cn('ml-auto flex items-center gap-1 text-warn-text')}
            title={warnings.join('; ')}
          >
            <AlertTriangle className="size-3" aria-hidden="true" />
            {warnings.length}
          </span>
        )}
      </div>
    </Link>
  );
}
