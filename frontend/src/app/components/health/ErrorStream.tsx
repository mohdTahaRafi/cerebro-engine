// phase_4 §5.1 — reverse-chronological pipeline error feed. Filterable by kind, and
// pausable: pausing freezes the DISPLAYED list (a snapshot taken at the moment of pausing)
// while the underlying poll (usePipelineErrors) keeps running — a feed that reorders while
// you're reading it is unusable. `aria-live="polite"` only while unpaused (task 4.26): a
// paused, frozen list has nothing new to announce.
import { useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { PipelineErrorRecord } from '../../../api/contracts';
import { Link } from 'react-router';

const KIND_LABEL: Record<PipelineErrorRecord['kind'], string> = {
  parse: 'PARSE', embed: 'EMBED', vision: 'VISION', rerank: 'RERANK',
  generate: 'GENERATE', queue: 'QUEUE', notify: 'NOTIFY',
};

function relativeTime(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

function ErrorRow({ error }: { error: PipelineErrorRecord }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li className="border-b border-line-subtle py-2 last:border-b-0">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-start gap-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-signal-ring rounded-sm">
        <span className="mt-0.5 shrink-0 rounded-sm border border-line bg-surface-sunken px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-graphite">
          {KIND_LABEL[error.kind]}
        </span>
        <span className="min-w-0 flex-1 text-xs text-ink">{error.message}</span>
        <span className="shrink-0 text-[11px] text-graphite">{relativeTime(error.createdAt)}</span>
      </button>
      {(error.documentId || error.contextId) && (
        <div className="ml-[52px] mt-1 flex gap-2 text-[11px] text-graphite">
          {error.fileName && error.contextId && (
            <Link to={`/contexts/${error.contextId}`} className="text-signal hover:text-signal-hover">{error.fileName}</Link>
          )}
        </div>
      )}
      {expanded && error.stack && (
        <pre className="ml-[52px] mt-1.5 whitespace-pre-wrap break-words rounded-md border border-line-subtle bg-surface-sunken p-2 text-[10px] leading-relaxed text-graphite">
          {error.stack}
        </pre>
      )}
    </li>
  );
}

export function ErrorStream({ errors }: { errors: PipelineErrorRecord[] }) {
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<PipelineErrorRecord[] | null>(null);
  const [kindFilter, setKindFilter] = useState<PipelineErrorRecord['kind'] | 'all'>('all');

  const togglePause = () => {
    setPaused((wasPaused) => {
      if (!wasPaused) setFrozen(errors); else setFrozen(null);
      return !wasPaused;
    });
  };

  const source = paused && frozen ? frozen : errors;
  const visible = kindFilter === 'all' ? source : source.filter((e) => e.kind === kindFilter);
  const kinds = Array.from(new Set(errors.map((e) => e.kind)));

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-graphite">Pipeline errors</h2>
        <div className="flex items-center gap-2">
          <select
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as PipelineErrorRecord['kind'] | 'all')}
            className="rounded-md border border-line bg-surface-raised px-2 py-1 text-[11px] font-medium text-ink outline-none focus-visible:ring-[3px] focus-visible:ring-signal-ring"
          >
            <option value="all">All</option>
            {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
          </select>
          <button
            type="button"
            onClick={togglePause}
            aria-pressed={paused}
            className="flex items-center gap-1 rounded-md border border-line bg-surface-raised px-2 py-1 text-[11px] font-medium text-ink outline-none transition-colors hover:border-line-strong focus-visible:ring-[3px] focus-visible:ring-signal-ring"
          >
            {paused ? <Play className="size-3" aria-hidden="true" /> : <Pause className="size-3" aria-hidden="true" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>
      </div>

      <ul aria-live={paused ? 'off' : 'polite'} className="flex flex-col">
        {visible.map((e) => <ErrorRow key={e.id} error={e} />)}
        {visible.length === 0 && <li className="py-4 text-center text-xs text-graphite">No errors.</li>}
      </ul>
    </div>
  );
}
