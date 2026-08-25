// phase_4 §4.8 — the projection fetch. Two layers of state: this hook's own 'unavailable'
// (the endpoint doesn't exist yet — production, pre-Phase 7) versus the payload's own
// `staleness` field (fresh/rebuilding/absent — a real answer about a real cached projection).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import type { ProjectionResponse } from '../../api/contracts';

export type ProjectionStatus = 'loading' | 'ready' | 'unavailable';

export function useProjection(contextId: string | undefined) {
  const [projection, setProjection] = useState<ProjectionResponse | null>(null);
  const [status, setStatus] = useState<ProjectionStatus>('loading');

  const load = useCallback(() => {
    if (!contextId) { setStatus('unavailable'); return; }
    setStatus('loading');
    api.vectors.projection(contextId)
      .then((res) => { setProjection(res); setStatus('ready'); })
      .catch((err: unknown) => {
        void err;
        setProjection(null);
        setStatus('unavailable');
      });
  }, [contextId]);

  useEffect(() => { load(); }, [load]);

  return { projection, status, refresh: load };
}
