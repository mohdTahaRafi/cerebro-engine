// phase_4 §4.7 — the evidence margin for /admin/vectors. Clicking a node fetches its real
// chunk text on demand (the projection payload carries no text — architecture §7.9). While
// the fetch is in flight the panel shows a skeleton WITH the metadata already known from the
// payload (filename, resolved via docIndex → the document legend), not a blank panel. On
// failure it shows the error and a retry, never a blank panel.
import { RotateCcw } from 'lucide-react';
import type { VectorNodeDetail } from '../../../api/contracts';

export interface NodeSelection {
  pointId: string;
  fileName: string;
  /** Present only when a beacon is active and this node was one of its neighbors. */
  distance?: number;
  rerankScore?: number | null;
  finalRank?: number | null;
}

interface NodeInspectorProps {
  selection: NodeSelection | null;
  detail: VectorNodeDetail | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  onRetry: () => void;
}

export function NodeInspector({ selection, detail, status, error, onRetry }: NodeInspectorProps) {
  if (!selection) {
    return (
      <aside className="flex h-full flex-col gap-2 px-1 py-2" aria-label="Node inspector">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-graphite">Node inspector</h2>
        <p className="text-sm text-graphite">Click a point in the cloud to inspect it.</p>
      </aside>
    );
  }

  return (
    <aside className="flex h-full flex-col gap-3 px-1 py-2" aria-label="Node inspector">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-graphite">Node inspector</h2>
        <p className="mt-1 truncate text-sm font-medium text-ink" title={selection.fileName}>{selection.fileName}</p>
        {status === 'ready' && detail && (
          <p className="text-xs text-graphite">
            {detail.headingPath ?? (detail.page != null ? `page ${detail.page}` : 'text chunk')}
            {detail.headingPath && detail.page != null && ` · page ${detail.page}`}
          </p>
        )}
        {status === 'loading' && <div className="mt-1 h-3.5 w-2/3 animate-pulse rounded bg-surface-sunken" />}
      </div>

      {status === 'loading' && (
        <div className="flex flex-col gap-1.5">
          <div className="h-3 w-full animate-pulse rounded bg-surface-sunken" />
          <div className="h-3 w-full animate-pulse rounded bg-surface-sunken" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-surface-sunken" />
        </div>
      )}

      {status === 'error' && (
        <div className="flex flex-col gap-2 rounded-md border border-critical-soft-line bg-critical-soft px-3 py-2 text-xs text-critical-text">
          <span>{error ?? 'Could not load this node.'}</span>
          <button
            type="button"
            onClick={onRetry}
            className="flex w-fit items-center gap-1 rounded-sm text-critical-text underline outline-none hover:text-critical focus-visible:ring-2 focus-visible:ring-signal-ring"
          >
            <RotateCcw className="size-3" aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {status === 'ready' && detail && (
        <blockquote className="rounded-md border border-line-subtle bg-surface-sunken px-3 py-2 text-xs leading-relaxed text-ink-secondary">
          &ldquo;{detail.text}&rdquo;
        </blockquote>
      )}

      {status === 'ready' && (selection.distance != null || detail) && (
        <dl className="flex flex-col gap-1.5 border-t border-line pt-2 text-xs">
          {selection.distance != null && (
            <div className="flex items-center justify-between">
              <dt className="text-graphite">distance</dt>
              <dd className="font-medium tabular-nums text-ink">{selection.distance.toFixed(3)}</dd>
            </div>
          )}
          {selection.rerankScore != null && (
            <div className="flex items-center justify-between">
              <dt className="text-graphite">rerank</dt>
              <dd className="font-medium tabular-nums text-ink">{selection.rerankScore.toFixed(2)}</dd>
            </div>
          )}
          {selection.distance != null && (
            <div className="flex items-center justify-between">
              <dt className="text-graphite">status</dt>
              <dd className="font-medium text-ink">{selection.finalRank != null ? 'kept' : 'cut'}</dd>
            </div>
          )}
        </dl>
      )}
    </aside>
  );
}
