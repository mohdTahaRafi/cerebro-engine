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
import { DocumentLegend } from '../../components/vectors/DocumentLegend';
import { NodeInspector, type NodeSelection } from '../../components/vectors/NodeInspector';
import { usePicking } from '../../components/vectors/usePicking';
import { Unavailable } from '../../components/design/Unavailable';
import { RotateCcw } from 'lucide-react';

function PickingController({ decoded, onPick }: { decoded: DecodedProjection; onPick: (index: number | null) => void }) {
  const { gl } = useThree();
  const { pick } = usePicking(decoded);
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

function relativeAge(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function VectorSpace() {
  const { activeContext } = useContextScope();
  const contextId = activeContext?.id;
  const { projection, status } = useProjection(contextId);
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
      const d = projection && projection.staleness !== 'absent' ? decodeProjection(projection) : null;
      return { decoded: d, decodeError: null as string | null };
    } catch (err) {
      return { decoded: null, decodeError: err instanceof Error ? err.message : 'Could not decode the projection payload.' };
    }
  }, [projection]);

  // architecture §7.8 — a rebuild invalidates every previously-issued beacon coordinate.
  // Discard it the moment the fitted model changes under us, rather than leaving a stale
  // marker drawn against a cloud it no longer corresponds to.
  useEffect(() => {
    const fittedAt = projection?.fittedAt ?? null;
    if (prevFittedAt.current != null && fittedAt !== prevFittedAt.current && projectQuery.response != null) {
      projectQuery.clear();
      setSelection(null);
      toast('Projection rebuilt — place the beacon again.');
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

  useEffect(() => { pointCloudRef.current?.setHiddenDocs(hiddenDocs); }, [hiddenDocs]);

  useEffect(() => {
    if (!pointCloudRef.current) return;
    if (projectQuery.response) {
      pointCloudRef.current.setBeacon(
        projectQuery.response.neighbors.map((n) => ({ index: n.index, kept: n.finalRank != null })),
      );
    } else {
      pointCloudRef.current.setBeacon(null);
    }
  }, [projectQuery.response]);

  const toggleDoc = useCallback((docIdx: number) => {
    setHiddenDocs((prev) => {
      const next = new Set(prev);
      if (next.has(docIdx)) next.delete(docIdx); else next.add(docIdx);
      return next;
    });
  }, []);

  const handlePick = useCallback((index: number | null) => {
    if (index == null || !decoded || !projection) return;
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

  const submitBeacon = () => {
    if (!contextId || !queryInput.trim() || projection?.staleness !== 'fresh') return;
    void projectQuery.submit(contextId, queryInput.trim());
  };

  const nodeCount = projection?.nodeCount ?? 0;
  const documentCount = projection?.documents.length ?? 0;

  if (status === 'unavailable') {
    return (
      <div className="p-8">
        <Unavailable reason="Vector projections are computed from Phase 7." />
      </div>
    );
  }

  if (status === 'loading') {
    return <div className="flex h-full items-center justify-center text-sm text-graphite">Loading projection…</div>;
  }

  if (!projection || projection.staleness === 'absent') {
    return (
      <div className="p-8">
        <Unavailable reason={projection?.reason ?? 'No projection is available for this context.'} />
      </div>
    );
  }

  if (decodeError) {
    return (
      <div className="p-8">
        <Unavailable reason={`The projection payload could not be read: ${decodeError}`} />
      </div>
    );
  }

  if (!decoded) return null;

  const rebuilding = projection.staleness === 'rebuilding';

  return (
    <div className="flex h-full overflow-hidden bg-surface">
      <div className="w-[200px] shrink-0 overflow-y-auto border-r border-line px-4 py-4">
        <DocumentLegend documents={projection.documents} docIndex={decoded.docIndex} hidden={hiddenDocs} onToggle={toggleDoc} />
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {rebuilding && (
          <div className="border-b border-warn-soft-line bg-warn-soft px-4 py-2 text-xs text-warn-text">
            Rebuilding — new chunks aren't plotted yet.
          </div>
        )}
        <div className="relative min-h-0 flex-1" style={{ opacity: rebuilding ? 0.6 : 1 }}>
          <span className="sr-only" role="img">
            {`3D point cloud projection: ${nodeCount.toLocaleString()} chunks across ${documentCount} documents.`}
          </span>
          <Canvas camera={{ fov: 50, near: 0.05, far: 1000 }} aria-hidden="true">
            <ambientLight intensity={1} />
            <PointCloud ref={pointCloudRef} decoded={decoded} />
            {projectQuery.response && <QueryBeacon beacon={projectQuery.response.beacon} neighbors={projectQuery.response.neighbors} decoded={decoded} />}
            <SceneControls ref={sceneControlsRef} bounds={decoded.bounds} />
            <PickingController decoded={decoded} onPick={handlePick} />
          </Canvas>
          <button
            type="button"
            onClick={() => sceneControlsRef.current?.resetView()}
            className="absolute right-3 top-3 flex items-center gap-1.5 rounded-md border border-line bg-surface-raised px-2.5 py-1.5 text-xs font-medium text-ink shadow-1 outline-none transition-colors hover:border-line-strong focus-visible:ring-[3px] focus-visible:ring-signal-ring"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" /> Reset view
          </button>
        </div>

        <div className="shrink-0 border-t border-line px-4 py-3">
          <p className="mb-2 text-xs text-graphite">
            {nodeCount.toLocaleString()} chunks · {documentCount} documents · fitted {relativeAge(projection.fittedAt ?? new Date().toISOString())}
          </p>
          <div className="flex gap-2">
            <input
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitBeacon(); }}
              disabled={rebuilding}
              placeholder="Ask a question to place it in this space."
              className="min-w-0 flex-1 rounded-md border border-line bg-surface-raised px-3 py-1.5 text-sm text-ink outline-none placeholder-graphite-faint focus-visible:ring-[3px] focus-visible:ring-signal-ring disabled:opacity-50"
            />
            <button
              type="button"
              onClick={submitBeacon}
              disabled={rebuilding || !queryInput.trim()}
              className="shrink-0 rounded-md bg-signal px-3.5 py-1.5 text-sm font-medium text-signal-on outline-none transition-colors hover:bg-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring disabled:opacity-50"
            >
              Place
            </button>
          </div>
          {projectQuery.status === 'error' && (
            <p className="mt-1.5 text-xs text-critical-text">{projectQuery.error}</p>
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
