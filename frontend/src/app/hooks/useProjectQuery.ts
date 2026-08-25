// phase_4 §4.6 — the query beacon's submit. A fresh request each time, never re-fitting the
// projection (architecture §7.8) — this just transforms the query through the already-fitted
// model and returns a coordinate plus neighbors.
import { useCallback, useState } from 'react';
import { api } from '../../api';
import type { ProjectQueryResponse } from '../../api/contracts';

export type ProjectQueryStatus = 'idle' | 'loading' | 'ready' | 'error';

export function useProjectQuery() {
  const [status, setStatus] = useState<ProjectQueryStatus>('idle');
  const [response, setResponse] = useState<ProjectQueryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (contextId: string, query: string) => {
    setStatus('loading');
    setError(null);
    try {
      const res = await api.vectors.query({ contextId, query });
      setResponse(res);
      setStatus('ready');
      return res;
    } catch (err) {
      setResponse(null);
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Could not place the beacon.');
      return null;
    }
  }, []);

  const clear = useCallback(() => {
    setStatus('idle'); setResponse(null); setError(null);
  }, []);

  return { status, response, error, submit, clear };
}
