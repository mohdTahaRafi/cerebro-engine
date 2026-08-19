import { Zap, ExternalLink, AlertTriangle } from 'lucide-react';
import type { PipelineTelemetry, LangSmithLink, StageSpec } from './TelemetryTypes';
import { STAGES, langSmithUrl } from './TelemetryTypes';

interface ExecutionPlanProps {
  telemetry?: PipelineTelemetry | null;
  isGenerating?: boolean;
  runId?: string | null;
  langsmith?: LangSmithLink | null;
}

interface Row {
  spec: StageSpec;
  startMs: number | null;
  durationMs: number | null;
  bracket: 'none' | 'top' | 'middle' | 'bottom';
}

// Every bar's position comes from the backend's MEASURED start offset (phase 6 §2.2) —
// nothing here reconstructs a position by stacking durations, which is the layout §2.2
// explicitly rules out. A consequence worth reading the waterfall for: gaps between bars
// are real unaccounted time (node transitions, prompt assembly, thread persistence), not a
// rendering artifact, and the bars deliberately do not sum to totalMs.
function buildRows(t: PipelineTelemetry): Row[] {
  return STAGES.map((spec, i) => {
    const group = spec.parallelGroup;
    const prev = STAGES[i - 1]?.parallelGroup;
    const next = STAGES[i + 1]?.parallelGroup;
    let bracket: Row['bracket'] = 'none';
    if (group) {
      if (group !== prev && group === next) bracket = 'top';
      else if (group === prev && group === next) bracket = 'middle';
      else if (group === prev && group !== next) bracket = 'bottom';
    }
    return {
      spec,
      startMs: t[spec.startKey] as number | null,
      durationMs: t[spec.durationKey] as number | null,
      bracket,
    };
  });
}

function StageRow({ row, totalMs, firstTokenMs }: { row: Row; totalMs: number; firstTokenMs: number | null }) {
  const { spec, startMs, durationMs, bracket } = row;
  // A stage is "skipped" when it has no duration. Its start offset is null too — the
  // backend refuses to invent one (pipelineTelemetry.js) — so there is no honest position
  // to place it at. It therefore gets a faint full-width hatch rather than a bar: the row
  // stays visible and its reason stays discoverable, while claiming no span on the
  // timeline. A zero-width bar would be invisible; a placed bar would be a fabrication.
  const skipped = durationMs == null || startMs == null;

  const pct = (ms: number) => (totalMs > 0 ? Math.min(100, Math.max(0, (ms / totalMs) * 100)) : 0);
  const leftPct = skipped ? 0 : pct(startMs!);
  // Floor at 0.4% so a genuinely sub-millisecond stage (merge, typically 0.02ms) still
  // renders as a visible sliver instead of vanishing — it IS measured, unlike a skip.
  const widthPct = skipped ? 100 : Math.max(pct(durationMs!), 0.4);

  const tokenMarkerPct = (!skipped && spec.durationKey === 'generateMs' && firstTokenMs != null)
    ? pct(startMs! + firstTokenMs)
    : null;

  return (
    <div className="flex items-center gap-2 h-7">
      <span className="w-28 shrink-0 text-gray-400 uppercase text-[10px] tracking-widest font-bold text-right">
        {spec.label}
      </span>

      {/* Fixed-width bracket gutter on EVERY row, grouped or not — this is what keeps the
          label and track columns aligned across the whole table. An earlier version
          indented grouped rows inside a wrapper div, which shifted them relative to
          ungrouped rows. */}
      <span className="w-3 shrink-0 self-stretch relative">
        {bracket !== 'none' && (
          <>
            <span className={`absolute left-0 w-[2px] bg-line-strong ${
              bracket === 'top' ? 'top-1/2 bottom-0' : bracket === 'bottom' ? 'top-0 bottom-1/2' : 'top-0 bottom-0'
            }`} />
            <span className="absolute left-0 top-1/2 w-2 h-[2px] bg-line-strong" />
          </>
        )}
      </span>

      <div className="flex-1 relative h-4 bg-surface-sunken border border-line-subtle">
        <div
          className={`absolute top-0 bottom-0 ${
            skipped
              ? 'bg-[repeating-linear-gradient(45deg,#2a2a2a,#2a2a2a_4px,#161616_4px,#161616_8px)] cursor-help'
              : 'bg-positive/70 border border-positive'
          }`}
          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
          title={skipped ? `skipped — ${spec.skippedReason}` : `starts at ${startMs}ms, runs ${durationMs}ms`}
        />
        {tokenMarkerPct != null && (
          <div
            className="absolute top-[-2px] bottom-[-2px] w-[2px] bg-white"
            style={{ left: `${tokenMarkerPct}%` }}
            title={`first token ${firstTokenMs}ms into generation`}
          />
        )}
      </div>

      <span className={`w-32 shrink-0 text-right font-bold text-xs ${skipped ? 'text-gray-600 italic' : 'text-positive'}`}>
        {skipped ? 'skipped' : `${durationMs}ms`}
      </span>
    </div>
  );
}

export function ExecutionPlan({ telemetry, isGenerating, runId, langsmith }: ExecutionPlanProps) {
  const hasData = telemetry != null;
  const link = hasData ? langSmithUrl(langsmith, runId) : null;

  return (
    <div className="border-b border-line bg-surface-sunken flex flex-col font-mono text-xs text-white relative overflow-hidden shrink-0">
      <div className="h-10 border-b border-line flex items-center justify-between px-4 uppercase font-bold text-gray-500 tracking-wider bg-surface-sunken shrink-0">
        <span className="flex items-center gap-2">
          <Zap size={12} className={hasData ? 'text-positive' : 'text-gray-600'} />
          Execution Plan
        </span>
        <div className="flex items-center gap-3">
          {hasData && (
            <span className="text-positive text-[10px] bg-positive/10 px-2 py-0.5 border border-positive/30">
              TOTAL: {telemetry!.totalMs}ms
            </span>
          )}
          {hasData && runId && (
            link ? (
              <a
                href={link}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-[10px] text-gray-400 hover:text-positive transition-colors normal-case tracking-normal"
                title="Open this run's full trace in LangSmith"
              >
                <ExternalLink size={11} /> LangSmith
              </a>
            ) : (
              <span
                className="flex items-center gap-1 text-[10px] text-gray-700 normal-case tracking-normal cursor-help"
                title="Set LANGSMITH_ORG_ID on the backend to enable this link"
              >
                <ExternalLink size={11} /> LangSmith
              </span>
            )
          )}
        </div>
      </div>

      <div className="p-4 flex flex-col gap-1.5">
        {!hasData ? (
          <div className="py-10 text-center text-gray-600 uppercase font-bold tracking-widest text-[11px]">
            {isGenerating ? 'Tracing in progress…' : 'Awaiting query — ask a question to draw the plan'}
          </div>
        ) : (
          <>
            {buildRows(telemetry!).map((row) => (
              <StageRow
                key={row.spec.durationKey}
                row={row}
                totalMs={telemetry!.totalMs}
                firstTokenMs={telemetry!.firstTokenMs}
              />
            ))}

            {/* Same grid as a StageRow (w-28 / w-3 / flex-1 / w-32) so the axis lines up
                under the bars rather than floating free of them. */}
            <div className="flex items-center gap-2 h-6 border-t border-line mt-1 pt-1">
              <span className="w-28 shrink-0 text-gray-500 uppercase text-[10px] tracking-widest font-bold text-right">total</span>
              <span className="w-3 shrink-0" />
              <div className="flex-1 flex justify-between text-[9px] text-gray-600">
                <span>0ms</span>
                <span>{telemetry!.totalMs}ms</span>
              </div>
              <span className="w-32 shrink-0 text-right font-bold text-xs text-white">{telemetry!.totalMs}ms</span>
            </div>

            <div className="flex flex-wrap gap-3 mt-1 text-[10px] text-gray-500 uppercase tracking-widest font-bold">
              <span>retrieved <span className="text-white">{telemetry!.candidatesRetrieved}</span></span>
              <span>after merge <span className="text-white">{telemetry!.candidatesAfterMerge}</span></span>
              <span>after floor <span className="text-white">{telemetry!.candidatesAfterFloor}</span></span>
              {telemetry!.firstTokenMs != null && (
                <span>first token <span className="text-white">{telemetry!.firstTokenMs}ms</span></span>
              )}
              {telemetry!.rerankSkipped && <span className="text-yellow-500">rerank degraded</span>}
            </div>

            {telemetry!.warnings.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                {telemetry!.warnings.map((w, i) => (
                  <div key={i} className="flex items-start gap-2 text-yellow-500 text-[10px] font-bold uppercase tracking-wide">
                    <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {w}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
