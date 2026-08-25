// phase_4 §4.7 — on-demand chunk text for the clicked node. The projection payload carries
// no text (architecture §7.9), so this is the one fetch NodeInspector makes, exactly once per
// click.
import { useCallback, useState } from 'react';
import { api } from '../../api';
import type { VectorNodeDetail } from '../../api/contracts';

export type VectorNodeStatus = 'idle' | 'loading' | 'ready' | 'error';

export function useVectorNode() {
  const [status, setStatus] = useState<VectorNodeStatus>('idle');
  const [detail, setDetail] = useState<VectorNodeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchNode = useCallback(async (pointId: string) => {
    setStatus('loading');
    setError(null);
    try {
      const node = await api.vectors.node(pointId);
      setDetail(node);
      setStatus('ready');
    } catch (err) {
      setDetail(null);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not load this node.');
    }
  }, []);

  return { status, detail, error, fetchNode };
}
