// phase_4 §3 — the inspector's main screen. Three regions in the Phase-1 grammar: header
// (query + ribbon + metadata), primary column (waterfall + rerank matrix), evidence margin
// (raw payload drawer).
import { useParams, Link } from 'react-router';
import { ExternalLink } from 'lucide-react';
import { useTrace } from '../../hooks/useTrace';
import { ProvenanceRibbon } from '../../components/chat/ProvenanceRibbon';
import { Waterfall } from '../../components/trace/Waterfall';
import { RerankMatrix } from '../../components/trace/RerankMatrix';
import { PayloadDrawer } from '../../components/trace/PayloadDrawer';
import { Unavailable } from '../../components/design/Unavailable';

export function TraceDetail() {
  const { id } = useParams<{ id: string }>();
  const { trace, status } = useTrace(id);

  if (status === 'loading') {
    return (
      <div className="flex h-full flex-col gap-4 overflow-hidden px-8 py-6">
        <div className="h-8 w-2/3 animate-pulse rounded bg-surface-sunken" />
        <div className="h-40 animate-pulse rounded-lg border border-line bg-surface-sunken" />
      </div>
    );
  }

  if (status === 'unavailable' || !trace) {
    return (
      <div className="p-8">
        <Unavailable
          reason="Trace history is recorded from Phase 7. The trace for your most recent query is available from the chat ribbon."
          action={{ label: 'Go to chat', to: '/chat' }}
        />
      </div>
    );
  }

  const keptSources = trace.candidates.filter((c) => !c.belowFloor);

  return (
    <div className="flex h-full overflow-hidden bg-surface">
      <div className="min-w-0 flex-1 overflow-y-auto px-8 py-6">
        <header className="mb-6 flex flex-col gap-2">
          <h1 className="text-2xl font-bold text-ink">{trace.query}</h1>
          {trace.condensedQuery && trace.condensedQuery !== trace.query && (
            <p className="text-sm text-graphite">
              retrieval actually ran on: <span className="italic">&ldquo;{trace.condensedQuery}&rdquo;</span>
            </p>
          )}

          <ProvenanceRibbon
            status={trace.refused ? 'refused' : 'complete'}
            telemetry={trace.telemetry}
            sources={keptSources}
            traceId={trace.id}
            hideTraceLink
          />

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-graphite">
            <span>{trace.contextTitle}</span>
            <span>·</span>
            <Link to={`/chat?threadId=${trace.threadId}`} className="text-signal hover:text-signal-hover">Open thread</Link>
            <span>·</span>
            <span title={new Date(trace.createdAt).toLocaleString()}>{new Date(trace.createdAt).toLocaleString()}</span>
            <span>·</span>
            <span>runId {trace.runId ?? '—'}</span>
            {trace.langsmithUrl && (
              <a href={trace.langsmithUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-signal hover:text-signal-hover">
                <ExternalLink className="size-3" aria-hidden="true" /> LangSmith
              </a>
            )}
          </div>
        </header>

        <div className="flex flex-col gap-8">
          <Waterfall telemetry={trace.telemetry} />
          <RerankMatrix candidates={trace.candidates} relevanceFloor={trace.relevanceFloor} rerankSkipped={trace.rerankSkipped} />
        </div>
      </div>

      <aside className="hidden w-full shrink-0 overflow-y-auto border-l border-line bg-surface px-5 py-6 custom-scrollbar lg:block lg:w-[400px] xl:w-[440px]">
        <PayloadDrawer trace={trace} />
      </aside>
    </div>
  );
}
