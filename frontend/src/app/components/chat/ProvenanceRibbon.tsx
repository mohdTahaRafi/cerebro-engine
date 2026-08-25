// DESIGN.md §5.7 — the pipeline's measured latencies compressed to a single proportional
// strip under every completed answer. Segment position comes from the measured start
// offset (never reconstructed by stacking durations); segments deliberately do not sum to
// totalMs (the gaps are real unaccounted time); a skipped stage contributes no segment at
// all, only a tooltip line. It does not animate into place — the numbers were always what
// they were.
import { Link } from 'react-router';
import type { PipelineTelemetry, ProvenanceSource } from '../../../api/contracts';
import { cn } from '../ui/utils';

export type TurnStatus = 'streaming' | 'complete' | 'refused' | 'error';

interface StageSpec {
  durationKey: keyof PipelineTelemetry;
  startKey: keyof PipelineTelemetry;
  label: string;
  colorVar: string;
  skippedReason: string;
}

// Order matches the Waterfall's row order (DESIGN.md §5.8) so the two motifs read as one
// system. --stage-* tokens are categorical, not semantic (theme.css) — a segment's color
// names which stage it is, never whether that stage went well.
const STAGE_SPECS: StageSpec[] = [
  { durationKey: 'condenseMs', startKey: 'condenseStartMs', label: 'condense', colorVar: 'bg-stage-condense', skippedReason: 'first turn — no history to condense' },
  { durationKey: 'embedMs', startKey: 'embedStartMs', label: 'embed', colorVar: 'bg-stage-embed', skippedReason: 'query embedding unavailable' },
  { durationKey: 'sparseMs', startKey: 'sparseStartMs', label: 'sparse', colorVar: 'bg-stage-sparse', skippedReason: 'sparse encoding unavailable' },
  { durationKey: 'colpaliMs', startKey: 'colpaliStartMs', label: 'colpali', colorVar: 'bg-stage-colpali', skippedReason: 'vision service unavailable or no visual corpus' },
  { durationKey: 'chunkRetrieveMs', startKey: 'chunkRetrieveStartMs', label: 'retrieve', colorVar: 'bg-stage-retrieve', skippedReason: 'chunk retrieval unavailable' },
  { durationKey: 'pageRetrieveMs', startKey: 'pageRetrieveStartMs', label: 'page-retrieve', colorVar: 'bg-stage-retrieve', skippedReason: 'no ColPali query vector to retrieve pages with' },
  { durationKey: 'mergeMs', startKey: 'mergeStartMs', label: 'merge', colorVar: 'bg-stage-merge', skippedReason: 'nothing to merge' },
  { durationKey: 'rerankMs', startKey: 'rerankStartMs', label: 'rerank', colorVar: 'bg-stage-rerank', skippedReason: 'reranker degraded — results are in fusion order' },
  { durationKey: 'generateMs', startKey: 'generateStartMs', label: 'generate', colorVar: 'bg-stage-generate', skippedReason: 'no sources cleared the relevance floor' },
];

const BRANCH_LABEL: Record<NonNullable<ProvenanceSource['branch']>, string> = {
  dense: 'dense', sparse: 'sparse', both: 'dense+sparse', colpali: 'colpali',
};

function branchSummary(sources: ProvenanceSource[]): string {
  const branches = new Set<string>();
  for (const s of sources) {
    if (!s.branch) continue;
    if (s.branch === 'both') { branches.add('dense'); branches.add('sparse'); }
    else branches.add(BRANCH_LABEL[s.branch]);
  }
  return [...branches].join('+');
}

/** The segmented proportional track alone — extracted so `TraceRow` (phase_4 §2.2) can
 *  reuse the exact same positioning math at list density without needing a full
 *  `ProvenanceSource[]` (a trace list row only has `sourceCount`, not the source objects the
 *  rest of this component's footer summarizes). This is the "one component, three
 *  densities" motif's actual shared core (DESIGN.md §5.7): the track, not the footer. */
export function TelemetryTrack({ telemetry, className }: { telemetry: PipelineTelemetry; className?: string }) {
  const totalMs = telemetry.totalMs;
  const segments = STAGE_SPECS.map((spec) => {
    const durationMs = telemetry[spec.durationKey] as number | null;
    const startMs = telemetry[spec.startKey] as number | null;
    return { spec, durationMs, startMs };
  }).filter((s) => s.durationMs != null && s.startMs != null);

  const pct = (ms: number) => (totalMs > 0 ? Math.min(100, Math.max(0, (ms / totalMs) * 100)) : 0);

  const skippedList = STAGE_SPECS.filter((spec) => telemetry[spec.durationKey] == null);
  const skippedTitle = skippedList.length
    ? `Skipped: ${skippedList.map((s) => `${s.label} (${s.skippedReason})`).join('; ')}`
    : undefined;

  return (
    <div
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken', className)}
      title={`Segments are positioned by measured start offset; gaps between them are real unaccounted time (node transitions, prompt assembly).${skippedTitle ? ` ${skippedTitle}` : ''}`}
    >
      {segments.map(({ spec, durationMs, startMs }) => {
        // Floor at 0.6% so a genuinely sub-millisecond stage (merge) still renders as a
        // visible sliver rather than vanishing — it WAS measured, unlike a skip.
        const widthPct = Math.max(pct(durationMs!), 0.6);
        return (
          <div
            key={spec.durationKey}
            className={cn('absolute inset-y-0 first:rounded-l-full last:rounded-r-full', spec.colorVar)}
            style={{ left: `${pct(startMs!)}%`, width: `${widthPct}%` }}
            title={`${spec.label}: ${durationMs}ms, starts at ${startMs}ms`}
          />
        );
      })}
    </div>
  );
}

interface ProvenanceRibbonProps {
  status: TurnStatus;
  telemetry: PipelineTelemetry | null;
  sources: ProvenanceSource[];
  traceId?: string | null;
  /** phase_4 §3.1 — the trace detail header renders this same ribbon above the waterfall
   *  that already IS that trace; a "View trace ›" link pointing at the page you're already
   *  on is not useful. Everything else about the footer (total, sources, branches) is still
   *  the same summary the chat and list placements show. */
  hideTraceLink?: boolean;
}

export function ProvenanceRibbon({ status, telemetry, sources, traceId, hideTraceLink }: ProvenanceRibbonProps) {
  if (status === 'error') return null; // nothing was measured — no ribbon (§5.7)

  if (status === 'streaming') {
    return (
      <div className="mt-3 flex flex-col gap-1.5">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-sunken">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-signal-soft-line" />
        </div>
      </div>
    );
  }

  // A resumed thread's persisted messages don't carry PipelineTelemetry (only a live
  // turn's SSE stream does) — nothing was measured for this render, so no ribbon, same
  // as the error case, rather than a shimmer that never resolves.
  if (!telemetry) return null;

  const branches = branchSummary(sources);
  const canViewTrace = traceId != null && traceId !== '';

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <TelemetryTrack telemetry={telemetry} />

      <div className="flex items-center justify-between text-xs text-graphite">
        <span>
          {telemetry.totalMs.toLocaleString()}ms
          {status === 'refused' ? ' · 0 sources' : ` · ${sources.length} source${sources.length === 1 ? '' : 's'}`}
          {branches && ` · ${branches}`}
        </span>
        {!hideTraceLink && (
          canViewTrace ? (
            <Link to={`/admin/traces/${traceId}`} className="font-medium text-signal outline-none hover:text-signal-hover focus-visible:ring-2 focus-visible:ring-signal-ring rounded-sm">
              View trace ›
            </Link>
          ) : (
            <span className="text-graphite-faint" title="Traces are recorded from Phase 7.">View trace ›</span>
          )
        )}
      </div>
    </div>
  );
}
