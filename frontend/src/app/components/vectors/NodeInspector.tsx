// phase_4 §4.7 — the evidence margin for /admin/vectors. Clicking a node fetches its real
// chunk text on demand (the projection payload carries no text — architecture §7.9). While
// the fetch is in flight the panel shows a skeleton WITH the metadata already known from the
// payload (filename, resolved via docIndex → the document legend), not a blank panel. On
// failure it shows the error and a retry, never a blank panel.
import { RotateCcw, X } from 'lucide-react';
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
  /** Supplied only where the panel is an overlay rather than a permanent column (below
   *  the `lg` breakpoint), where it has to be dismissible to give the canvas back. */
  onClose?: () => void;
}

export function NodeInspector({ selection, detail, status, error, onRetry, onClose }: NodeInspectorProps) {
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
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-graphite">Node inspector</h2>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close node inspector"
              className="-mr-1 -mt-1 shrink-0 rounded-md p-1 text-graphite outline-none transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:ring-[3px] focus-visible:ring-signal-ring"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
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

      {/* The chunk text is capped and independently scrollable: a chunk is ~1,300
          characters and an OCR page can be several thousand, which pushed the
          distance/rerank/status rows — the reason the panel opens during a beacon query
          at all — off the bottom of the column entirely. */}
      {status === 'ready' && detail && (
        <blockquote className="max-h-64 shrink-0 overflow-y-auto rounded-md border border-line-subtle bg-surface-sunken px-3 py-2 text-xs leading-relaxed text-ink-secondary">
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
          {/* `norm` and `neighborCount` were fetched on every click and then dropped on
              the floor — the endpoint computes both (a real vector magnitude, and a real
              tenant-scoped count of the other chunks in this node's document), and they
              are the two facts here that are about the EMBEDDING rather than the text. */}
          {detail?.norm != null && (
            <div className="flex items-center justify-between">
              <dt className="text-graphite">vector norm</dt>
              <dd className="font-medium tabular-nums text-ink">{detail.norm.toFixed(3)}</dd>
            </div>
          )}
          {detail?.neighborCount != null && (
            <div className="flex items-center justify-between">
              <dt className="text-graphite">same document</dt>
              <dd className="font-medium tabular-nums text-ink">
                {detail.neighborCount.toLocaleString()} chunk{detail.neighborCount === 1 ? '' : 's'}
              </dd>
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
