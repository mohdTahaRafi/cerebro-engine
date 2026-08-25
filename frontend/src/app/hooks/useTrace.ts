// phase_4 §3 — a single trace detail.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import type { TraceDetail } from '../../api/contracts';

export type TraceStatus = 'loading' | 'ready' | 'unavailable';

export function useTrace(id: string | undefined) {
  const [trace, setTrace] = useState<TraceDetail | null>(null);
  const [status, setStatus] = useState<TraceStatus>('loading');

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setStatus('loading');
    api.traces.get(id)
      .then((t) => { if (!cancelled) { setTrace(t); setStatus('ready'); } })
      .catch((err: unknown) => {
        void err;
        if (!cancelled) { setTrace(null); setStatus('unavailable'); }
      });
    return () => { cancelled = true; };
  }, [id]);

  return { trace, status };
}
