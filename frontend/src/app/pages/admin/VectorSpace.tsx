// phase_4 §4 — the 3D vector space. This file (and everything it imports from
// components/vectors/) is the entire lazy-loaded chunk task 4.25 requires: routes.tsx only
// reaches this module via React.lazy, so /chat and /login never pull in `three` or
// `@react-three/fiber`.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { toast } from 'sonner';
import { useContextScope } from '../../context/ContextScopeContext';
import { useProjection } from '../../hooks/useProjection';
import { useProjectQuery } from '../../hooks/useProjectQuery';
import { useVectorNode } from '../../hooks/useVectorNode';
import { decodeProjection, type DecodedProjection } from '../../components/vectors/decodeProjection';
import { PointCloud, type PointCloudHandle } from '../../components/vectors/PointCloud';
import { QueryBeacon } from '../../components/vectors/QueryBeacon';
import { SceneControls, type SceneControlsHandle } from '../../components/vectors/SceneControls';
import { CAMERA_FOV } from '../../components/vectors/framing';
import { DocumentLegend } from '../../components/vectors/DocumentLegend';
import { NodeInspector, type NodeSelection } from '../../components/vectors/NodeInspector';
import { usePicking } from '../../components/vectors/usePicking';
import { Unavailable } from '../../components/design/Unavailable';
import { RotateCcw, RefreshCw } from 'lucide-react';

function PickingController({
  decoded, hiddenDocs, onPick,
}: { decoded: DecodedProjection; hiddenDocs: Set<number>; onPick: (index: number | null) => void }) {
  const { gl } = useThree();
  const { pick } = usePicking(decoded, hiddenDocs);
  const downPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = gl.domElement;
    const onDown = (e: PointerEvent) => { downPos.current = { x: e.clientX, y: e.clientY }; };
    const onUp = (e: PointerEvent) => {
      const down = downPos.current;
      downPos.current = null;
      if (!down) return;
      // A drag-to-orbit ending back over the canvas must not also register as a pick — only
      // a near-stationary pointerdown→pointerup pair counts as a click.
      if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
      onPick(pick(e.clientX, e.clientY, el));
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', onUp);
    return () => { el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', onUp); };
  }, [gl, pick, onPick]);

  return null;
}

function relativeAge(iso: string | null): string {
  // A row that has never been fitted has `fittedAt: null`. Substituting `now` there
  // rendered "fitted 0m ago" for a projection that was never fitted at all — a confident
  // statement of something untrue, which is worse than the missing value it papered over.
  if (!iso) return 'not yet fitted';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return 'fitted just now';
  if (mins < 60) return `fitted ${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `fitted ${hours}h ago`;
  return `fitted ${Math.round(hours / 24)}d ago`;
}

export function VectorSpace() {
  const { activeContext, status: scopeStatus } = useContextScope();
  const contextId = activeContext?.id;
  const { projection, status, rebuild, rebuilding: rebuildRequested } = useProjection(contextId);
  const projectQuery = useProjectQuery();
  const nodeQuery = useVectorNode();

  const [hiddenDocs, setHiddenDocs] = useState<Set<number>>(new Set());
  const [selection, setSelection] = useState<NodeSelection | null>(null);
  const [queryInput, setQueryInput] = useState('');

  const pointCloudRef = useRef<PointCloudHandle>(null);
  const sceneControlsRef = useRef<SceneControlsHandle>(null);
  const prevFittedAt = useRef<string | null>(null);

  // Memoized on `projection` identity, not recomputed on every render: decodeProjection
  // allocates fresh typed-array views every call, and PointCloud's geometry + the
  // imperative handle QueryBeacon/DocumentLegend mutate are BOTH keyed off this object's
  // identity (§4.3's "one attribute update, never a re-upload"). Without this memo, an
  // unrelated re-render (typing in the beacon box, a projectQuery status change) would hand
  // PointCloud a new `decoded` reference, rebuilding its geometry from scratch and silently
  // discarding whatever size/alpha/ring mutations the beacon or the document legend had just
  // applied — the beacon would compute correctly and then visibly never appear.
  const { decoded, decodeError } = useMemo(() => {
    try {
      // BOTH conditions are load-bearing. 'absent' means there is no valid projection to
      // draw even when the row still carries the coordinates of an older fit (a fit that
      // FAILED leaves the previous buffers in place) — rendering those would present a
      // stale cloud as the current one with nothing on screen saying otherwise. And a
      // nodeCount of 0 is a row mid-first-fit, whose empty buffers decode to a cloud with
      // degenerate bounds and no points.
      const usable = projection && projection.staleness !== 'absent' && projection.nodeCount > 0;
      const d = usable ? decodeProjection(projection) : null;
      return { decoded: d, decodeError: null as string | null };
    } catch (err) {
      return { decoded: null, decodeError: err instanceof Error ? err.message : 'Could not decode the projection payload.' };
    }
  }, [projection]);

  // architecture §7.8 — a rebuild invalidates every previously-issued beacon coordinate.
  // Discard it the moment the fitted model changes under us, rather than leaving a stale
  // marker drawn against a cloud it no longer corresponds to. The document legend's
  // selection goes with it: `hiddenDocs` holds INDICES into the old fit's document table,
  // and a refit can reorder or change that table, so carrying them over would dim
  // whichever documents happen to land on those indices next.
  useEffect(() => {
    const fittedAt = projection?.fittedAt ?? null;
    if (prevFittedAt.current != null && fittedAt !== prevFittedAt.current) {
      setSelection(null);
      setHiddenDocs(new Set());
      if (projectQuery.response != null) {
        projectQuery.clear();
        toast('Projection rebuilt — place the beacon again.');
      }
    }
    prevFittedAt.current = fittedAt;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projection?.fittedAt]);

  useEffect(() => {
    setHiddenDocs(new Set());
    setSelection(null);
    projectQuery.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextId]);

  // `decoded` is a dependency of BOTH of these, not just the state they push. A new
  // projection builds a brand-new geometry with default size/alpha/ring, so without
  // re-running them here every dimmed document and every beacon highlight silently
  // reverted the moment a background poll delivered a rebuilt fit — the legend still drew
  // the document as hidden while the cloud drew it at full strength.
  useEffect(() => { pointCloudRef.current?.setHiddenDocs(hiddenDocs); }, [hiddenDocs, decoded]);

  useEffect(() => {
    if (!pointCloudRef.current) return;
    if (projectQuery.response) {
      pointCloudRef.current.setBeacon(
        projectQuery.response.neighbors.map((n) => ({ index: n.index, kept: n.finalRank != null })),
      );
    } else {
      pointCloudRef.current.setBeacon(null);
    }
  }, [projectQuery.response, decoded]);

  const toggleDoc = useCallback((docIdx: number) => {
    setHiddenDocs((prev) => {
      const next = new Set(prev);
      if (next.has(docIdx)) next.delete(docIdx); else next.add(docIdx);
      return next;
    });
  }, []);

  const handlePick = useCallback((index: number | null) => {
    if (!decoded || !projection) return;
    // A click on empty space CLEARS the selection rather than silently leaving the last
    // one up. Keeping it made the inspector lie about what is selected — the cloud shows
    // nothing highlighted while the panel still describes a chunk — and left the overlay
    // on small screens with no way to dismiss it by tapping away from the point.
    if (index == null) { setSelection(null); return; }
    const pointId = decoded.pointIds[index];
    const doc = projection.documents[decoded.docIndex[index]];
    const neighbor = projectQuery.response?.neighbors.find((n) => n.index === index);
    setSelection({
      pointId, fileName: doc?.fileName ?? 'Unknown document',
      distance: neighbor?.distance, rerankScore: neighbor?.rerankScore, finalRank: neighbor?.finalRank,
    });
    void nodeQuery.fetchNode(pointId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, projection, projectQuery.response]);

  const canPlace = projection?.staleness === 'fresh' && !!decoded;
  const submitBeacon = () => {
    if (!contextId || !queryInput.trim() || !canPlace) return;
    void projectQuery.submit(contextId, queryInput.trim());
  };

  const nodeCount = projection?.nodeCount ?? 0;
  const documentCount = projection?.documents.length ?? 0;

  // ── Pre-cloud states ──────────────────────────────────────────────────────────────
  // Each of these is a different fact and gets different words. They used to collapse
  // into one "Vector projections aren't available right now." panel, which said the
  // endpoint was broken when the real answer was "you have no contexts yet" or "the
  // context list is still loading" — and, because ContextScope resolves asynchronously,
  // that wrong panel flashed on screen during every single page load.
  if (scopeStatus === 'loading' || status === 'idle') {
    return <div className="flex h-full items-center justify-center text-sm text-graphite">Loading workspace…</div>;
  }

  if (scopeStatus === 'none' || !contextId) {
    return (
      <div className="p-8">
        <Unavailable reason="Select or create a context to see its vector space. A projection is fitted per context, over that context's own documents." />
      </div>
    );
  }

  if (status === 'unavailable') {
    return (
      <div className="p-8">
        <Unavailable reason="Vector projections aren't available right now." />
      </div>
    );
  }

  if (status === 'loading') {
    return <div className="flex h-full items-center justify-center text-sm text-graphite">Loading projection…</div>;
  }

  // Nothing to draw yet. Two sub-cases, told apart by the server's own `pending` flag
  // rather than guessed at: a fit that is queued or running (the poll in useProjection is
  // already live, so this resolves on its own — say so and don't offer a button that
  // would only re-queue what is already queued), and a fit that failed and will never
  // complete without being asked again.
  if (!projection || !decoded) {
    const waiting = projection?.pending ?? false;
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        {decodeError ? (
          <Unavailable reason={`The projection payload could not be read: ${decodeError}`} />
        ) : (
          <Unavailable reason={projection?.reason ?? 'No projection is available for this context.'} />
        )}
        {waiting ? (
          <p className="flex items-center gap-2 text-xs text-graphite">
            <RefreshCw className="size-3.5 animate-spin" aria-hidden="true" />
            Fitting now — this page updates itself when it finishes.
          </p>
        ) : (
          <button
            type="button"
            onClick={() => void rebuild()}
            disabled={rebuildRequested}
            className="flex items-center gap-1.5 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-xs font-medium text-ink shadow-1 outline-none transition-colors hover:border-line-strong focus-visible:ring-[3px] focus-visible:ring-signal-ring disabled:opacity-50"
          >
            <RefreshCw className={`size-3.5 ${rebuildRequested ? 'animate-spin' : ''}`} aria-hidden="true" />
            Rebuild projection
          </button>
        )}
      </div>
    );
  }

  const isRebuilding = projection.staleness === 'rebuilding';

  return (
    <div className="flex h-full overflow-hidden bg-surface">
      <div className="w-[200px] shrink-0 overflow-y-auto border-r border-line px-4 py-4">
        <DocumentLegend documents={projection.documents} docIndex={decoded.docIndex} hidden={hiddenDocs} onToggle={toggleDoc} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {isRebuilding && (
          <div className="flex items-center gap-2 border-b border-warn-soft-line bg-warn-soft px-4 py-2 text-xs text-warn-text">
            <RefreshCw className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
            {projection.reason ?? "Rebuilding — new chunks aren't plotted yet."}
          </div>
        )}
        <div className="relative min-h-0 flex-1" style={{ opacity: isRebuilding ? 0.6 : 1 }}>
          <span className="sr-only" role="img">
            {`3D point cloud projection: ${nodeCount.toLocaleString()} chunks across ${documentCount} documents.`}
          </span>
          <Canvas camera={{ fov: CAMERA_FOV, near: 0.05, far: 1000 }} aria-hidden="true">
            <ambientLight intensity={1} />
            <PointCloud ref={pointCloudRef} decoded={decoded} />
            {projectQuery.response && <QueryBeacon beacon={projectQuery.response.beacon} neighbors={projectQuery.response.neighbors} decoded={decoded} />}
            <SceneControls ref={sceneControlsRef} bounds={decoded.bounds} />
            <PickingController decoded={decoded} hiddenDocs={hiddenDocs} onPick={handlePick} />
          </Canvas>

          <div className="absolute right-3 top-3 flex gap-2">
            <button
              type="button"
              onClick={() => void rebuild()}
              disabled={rebuildRequested || isRebuilding}
              title="Refit this context's projection from its current chunks"
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink shadow-1 outline-none transition-colors hover:border-line-strong focus-visible:ring-[3px] focus-visible:ring-signal-ring disabled:opacity-50"
            >
              <RefreshCw className={`size-3.5 ${rebuildRequested || isRebuilding ? 'animate-spin' : ''}`} aria-hidden="true" /> Rebuild
            </button>
            <button
              type="button"
              onClick={() => sceneControlsRef.current?.resetView()}
              className="flex items-center gap-1.5 rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink shadow-1 outline-none transition-colors hover:border-line-strong focus-visible:ring-[3px] focus-visible:ring-signal-ring"
            >
              <RotateCcw className="size-3.5" aria-hidden="true" /> Reset view
            </button>
          </div>

          {/* Below `lg` the inspector has no column to live in, so a click used to fetch
              the chunk and render it into a panel the viewport never showed — the single
              most central interaction on this page did nothing at all at that width.
              Here it is an overlay over the canvas, dismissible, mounted only when
              something is actually selected. */}
          {selection && (
            <div className="absolute bottom-3 left-3 right-3 max-h-[55%] overflow-y-auto rounded-lg border border-line bg-surface-raised px-3 py-2 shadow-2 lg:hidden">
              <NodeInspector
                selection={selection}
                detail={nodeQuery.detail}
                status={nodeQuery.status}
                error={nodeQuery.error}
                onRetry={() => selection && void nodeQuery.fetchNode(selection.pointId)}
                onClose={() => setSelection(null)}
              />
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-line px-4 py-3">
          <p className="mb-2 text-xs text-graphite">
            {nodeCount.toLocaleString()} chunks · {documentCount} documents · {relativeAge(projection.fittedAt)}
            {/* The 'fresh' reason is the downsample notice ("Showing 20,000 of 47,331
                chunks.") — the one line that tells the user the cloud is a representative
                sample rather than the whole corpus. It was computed server-side and then
                never rendered, so a downsampled projection silently read as complete. */}
            {projection.staleness === 'fresh' && projection.reason && ` · ${projection.reason}`}
          </p>
          <div className="flex gap-2">
            <input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitBeacon(); }}
              disabled={!canPlace}
              placeholder={canPlace ? 'Ask a question to place it in this space.' : 'Available once the projection is fitted.'}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm text-ink outline-none placeholder-graphite-faint focus-visible:ring-[3px] focus-visible:ring-signal-ring disabled:opacity-50"
            />
            <button
              type="button"
              onClick={submitBeacon}
              disabled={!canPlace || !queryInput.trim() || projectQuery.status === 'loading'}
              className="shrink-0 rounded-md bg-signal px-3.5 py-1.5 text-sm font-medium text-signal-on outline-none transition-colors hover:bg-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring disabled:opacity-50"
            >
              {projectQuery.status === 'loading' ? 'Placing…' : 'Place'}
            </button>
            {projectQuery.response && (
              <button
                type="button"
                onClick={() => projectQuery.clear()}
                className="shrink-0 rounded-md border border-line px-3 py-1.5 text-sm font-medium text-graphite outline-none transition-colors hover:border-line-strong hover:text-ink focus-visible:ring-[3px] focus-visible:ring-signal-ring"
              >
                Clear
              </button>
            )}
          </div>
          {projectQuery.status === 'error' && (
            <p className="mt-1.5 text-xs text-critical-text">{projectQuery.error}</p>
          )}
          {projectQuery.status === 'ready' && projectQuery.response && (
            <p className="mt-1.5 text-xs text-graphite">
              {projectQuery.response.neighbors.length} nearest neighbors ·{' '}
              {projectQuery.response.neighbors.filter((n) => n.finalRank != null).length} kept after reranking (ringed)
            </p>
          )}
        </div>
      </div>

      <div className="hidden w-[320px] shrink-0 overflow-y-auto border-l border-line px-4 py-4 lg:block">
        <NodeInspector
          selection={selection}
          detail={nodeQuery.detail}
          status={nodeQuery.status}
          error={nodeQuery.error}
          onRetry={() => selection && void nodeQuery.fetchNode(selection.pointId)}
        />
      </div>
    </div>
  );
}
