// phase_4 §2 — the trace list. Scoped to the signed-in user, not admin-only (a normal user
// inspecting their own queries). Sort is fixed to newest first — deliberately no
// sort-by-duration (§2.3): it invites reading the slowest query as the problem, when the
// interesting question is almost always what changed recently.
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useTraces } from '../../hooks/useTraces';
import { useContextScope } from '../../context/ContextScopeContext';
import type { TraceTimeWindow } from '../../../api/endpoints/traces';
import { TraceRow } from '../../components/trace/TraceRow';
import { Unavailable } from '../../components/design/Unavailable';
import { EmptyState } from '../../components/design/EmptyState';

const WINDOW_OPTIONS: Array<{ value: TraceTimeWindow; label: string }> = [
  { value: '1h', label: 'Last hour' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
  { value: 'all', label: 'All time' },
];

const MIN_SAMPLE_FOR_SLOW_TOGGLE = 5;

const selectClass = 'rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink outline-none transition-colors hover:border-line-strong focus-visible:ring-[3px] focus-visible:ring-signal-ring';

export function TraceList() {
  const { contexts, activeContext } = useContextScope();
  const [contextId, setContextId] = useState<string | undefined>(() => activeContext?.id);
  const [window, setWindow] = useState<TraceTimeWindow>('24h');
  const [onlySlow, setOnlySlow] = useState(false);
  const { traces, status } = useTraces(contextId, window);

  const { threshold, slowEnabled } = useMemo(() => {
    if (traces.length < MIN_SAMPLE_FOR_SLOW_TOGGLE) return { threshold: null, slowEnabled: false };
    const sorted = [...traces].map((t) => t.totalMs).sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
    return { threshold: sorted[idx], slowEnabled: true };
  }, [traces]);

  const visible = onlySlow && threshold != null ? traces.filter((t) => t.totalMs > threshold) : traces;
  const showContextChip = contextId === undefined;

  return (
    <div className="flex h-full flex-col overflow-y-auto px-8 py-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">Traces</h1>
          <p className="text-sm text-graphite">Every query, with the latency of each pipeline stage.</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={contextId ?? '__all__'}
            onChange={(e) => setContextId(e.target.value === '__all__' ? undefined : e.target.value)}
            className={selectClass}
            aria-label="Context"
          >
            <option value="__all__">All contexts</option>
            {contexts.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <select
            value={window}
            onChange={(e) => setWindow(e.target.value as TraceTimeWindow)}
            className={selectClass}
            aria-label="Time window"
          >
            {WINDOW_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button
            type="button"
            disabled={!slowEnabled}
            onClick={() => setOnlySlow((v) => !v)}
            aria-pressed={onlySlow}
            title={slowEnabled ? undefined : 'Load at least 5 traces to compute a meaningful slow threshold'}
            className={`rounded-md border px-2.5 py-1.5 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-signal-ring disabled:cursor-not-allowed disabled:opacity-50 ${
              onlySlow ? 'border-signal-soft-line bg-signal-soft text-signal' : 'border-line bg-surface-raised text-ink hover:border-line-strong'
            }`}
          >
            Only slow{threshold != null ? ` (> ${threshold.toLocaleString()}ms)` : ''}
          </button>
        </div>
      </div>

      {status === 'loading' && (
        <div className="flex flex-col gap-2">
          {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-lg border border-line bg-surface-sunken" />)}
        </div>
      )}

      {status === 'unavailable' && (
        <Unavailable
          reason="Trace history isn't available right now. The trace for your most recent query is still available from the chat ribbon."
          action={{ label: 'Go to chat', to: '/chat' }}
        />
      )}

      {status === 'empty' && (
        <EmptyState
          title="No traces"
          description={`No traces in the ${WINDOW_OPTIONS.find((o) => o.value === window)?.label.toLowerCase() ?? 'selected window'}.`}
          action={window !== 'all' ? { label: 'Widen to all time', onClick: () => setWindow('all') } : undefined}
        />
      )}

      {status === 'ready' && (
        <div className="flex flex-col gap-2">
          {visible.map((trace) => <TraceRow key={trace.id} trace={trace} showContextChip={showContextChip} />)}
          {visible.length === 0 && (
            <p className="py-8 text-center text-sm text-graphite">
              No traces above the slow threshold. <Link to="#" onClick={() => setOnlySlow(false)} className="text-signal">Clear the filter</Link>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
