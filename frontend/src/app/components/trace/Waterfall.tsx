// phase_4 §3.2 — v2 presentation of the old ExecutionPlan.tsx, with its logic (waterfall.ts,
// ported verbatim) unchanged. Three honesty rules are acceptance criteria, not style choices:
//   1. Every bar's left offset is the backend's MEASURED <stage>StartMs — never reconstructed
//      by stacking durations.
//   2. Bars deliberately do not sum to totalMs; the gap is real unaccounted time, stated in
//      the axis label, not buried in a tooltip.
//   3. A stage with a null duration gets NO bar — a hatched full-width band with its skip
//      reason, never a zero-width or guessed-offset bar.
import type { PipelineTelemetry } from '../core/TelemetryTypes';
import { buildWaterfallRows, computeUnaccountedMs, type WaterfallRow } from './waterfallLayout';
import { cn } from '../ui/utils';

const HATCH = 'bg-[repeating-linear-gradient(45deg,var(--line-strong),var(--line-strong)_4px,var(--surface-sunken)_4px,var(--surface-sunken)_8px)]';

function pct(ms: number, totalMs: number): number {
  return totalMs > 0 ? Math.min(100, Math.max(0, (ms / totalMs) * 100)) : 0;
}

function WaterfallBar({ row, totalMs, firstTokenMs }: { row: WaterfallRow; totalMs: number; firstTokenMs: number | null }) {
  const { spec, startMs, durationMs, skipped, bracket } = row;

  // Floor at 0.4% so a genuinely sub-millisecond stage (merge, typically 0.02ms) still
  // renders as a visible sliver instead of vanishing — it WAS measured, unlike a skip.
  const leftPct = skipped ? 0 : pct(startMs!, totalMs);
  const widthPct = skipped ? 100 : Math.max(pct(durationMs!, totalMs), 0.4);

  const tokenMarkerPct = (!skipped && spec.durationKey === 'generateMs' && firstTokenMs != null)
    ? pct(startMs! + firstTokenMs, totalMs)
    : null;

  return (
    <div className="flex items-center gap-2" aria-hidden="true">
      <span className="w-28 shrink-0 text-right text-[11px] font-medium uppercase tracking-wide text-graphite">
        {spec.label}
      </span>

      {/* Fixed-width bracket gutter on EVERY row, grouped or not — keeps the label and track
          columns aligned across the whole table regardless of which rows are bracketed. */}
      <span className="relative w-3 shrink-0 self-stretch">
        {bracket !== 'none' && (
          <>
            <span className={cn(
              'absolute left-1 w-px bg-line-strong',
              bracket === 'top' ? 'top-1/2 bottom-0' : bracket === 'bottom' ? 'top-0 bottom-1/2' : 'top-0 bottom-0',
            )} />
            <span className="absolute left-1 top-1/2 h-px w-2 bg-line-strong" />
          </>
        )}
      </span>

      <div className="relative h-5 flex-1 border border-line bg-surface-sunken">
        <div
          className={cn('absolute inset-y-0', skipped ? cn(HATCH, 'cursor-help') : spec.colorVar)}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          title={skipped ? `skipped — ${spec.skippedReason}` : `starts at ${startMs}ms, runs ${durationMs}ms`}
        >
          {skipped && (
            <span className="flex h-full items-center justify-center px-2 text-[10px] font-medium text-graphite">
              skipped — {spec.skippedReason}
            </span>
          )}
        </div>
        {tokenMarkerPct != null && (
          <div
            className="absolute -top-0.5 -bottom-0.5 w-px bg-ink"
            style={{ left: `${tokenMarkerPct}%` }}
            title={`first token ${firstTokenMs}ms into generation`}
          >
            <span className="absolute left-1 top-full whitespace-nowrap text-[9px] text-graphite">
              first token {firstTokenMs}ms
            </span>
          </div>
        )}
      </div>

      <span className={cn('w-24 shrink-0 text-right text-xs font-medium tabular-nums', skipped ? 'italic text-graphite' : 'text-ink')}>
        {skipped ? 'skipped' : `${durationMs}ms`}
      </span>
    </div>
  );
}

/** sr-only table-equivalent (task 4.26) — the visual chart is `aria-hidden`, so a screen
 *  reader gets the same stage/start/duration/status data as a plain table instead. */
function WaterfallTable({ rows, totalMs }: { rows: WaterfallRow[]; totalMs: number }) {
  return (
    <table className="sr-only">
      <caption>Pipeline waterfall — {totalMs.toLocaleString()}ms total</caption>
      <thead>
        <tr><th>Stage</th><th>Status</th><th>Start offset</th><th>Duration</th></tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.spec.durationKey}>
            <td>{row.spec.label}</td>
            <td>{row.skipped ? `skipped — ${row.spec.skippedReason}` : 'measured'}</td>
            <td>{row.skipped ? '—' : `${row.startMs}ms`}</td>
            <td>{row.skipped ? '—' : `${row.durationMs}ms`}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Waterfall({ telemetry }: { telemetry: PipelineTelemetry }) {
  const rows = buildWaterfallRows(telemetry);
  const unaccountedMs = computeUnaccountedMs(telemetry);

  return (
    <section className="flex flex-col gap-1.5" aria-label="Pipeline waterfall">
      <WaterfallTable rows={rows} totalMs={telemetry.totalMs} />

      <div className="flex items-center gap-2 text-[10px] text-graphite" aria-hidden="true">
        <span className="w-28 shrink-0" />
        <span className="w-3 shrink-0" />
        <div className="flex flex-1 justify-between">
          <span>0ms</span>
          <span>{telemetry.totalMs.toLocaleString()}ms</span>
        </div>
        <span className="w-24 shrink-0" />
      </div>

      <div className="flex flex-col gap-1">
        {rows.map((row) => (
          <WaterfallBar key={row.spec.durationKey} row={row} totalMs={telemetry.totalMs} firstTokenMs={telemetry.firstTokenMs} />
        ))}
      </div>

      <div className="mt-1 flex items-center gap-2 border-t border-line pt-1.5 text-xs text-graphite" aria-hidden="true">
        <span className="w-28 shrink-0" />
        <span className="w-3 shrink-0" />
        <span className="flex-1">
          total <span className="font-medium tabular-nums text-ink">{telemetry.totalMs.toLocaleString()}ms</span>
          {' · '}
          <span className="font-medium tabular-nums text-ink">{unaccountedMs.toLocaleString()}ms</span> unaccounted
          {' '}(node transitions, prompt assembly, persistence)
        </span>
      </div>
    </section>
  );
}
