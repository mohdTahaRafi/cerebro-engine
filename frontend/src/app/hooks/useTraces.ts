// phase_4 §2, task 4.2 — the trace list's data. Three states only (architecture §7.3):
// 'ready' (rows), 'empty' (the endpoint answered with nothing), 'unavailable' (the endpoint
// doesn't exist yet — Phase 7 — or failed). Never a fourth.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api';
import type { TraceSummary } from '../../api/contracts';
import type { TraceTimeWindow } from '../../api/endpoints/traces';

export type TracesStatus = 'loading' | 'ready' | 'empty' | 'unavailable';

export function useTraces(contextId: string | undefined, window: TraceTimeWindow) {
  const [traces, setTraces] = useState<TraceSummary[]>([]);
  const [status, setStatus] = useState<TracesStatus>('loading');

  const load = useCallback(() => {
    setStatus('loading');
    api.traces.list({ contextId, window })
      .then(({ traces: list }) => {
        setTraces(list);
        setStatus(list.length === 0 ? 'empty' : 'ready');
      })
      .catch((err: unknown) => {
        // Not distinguishing further here — whether the route genuinely doesn't exist yet
        // or a real network error occurred, the correct UI response is the same honest
        // <Unavailable>, never a fabricated list. Same rule ContextScopeContext applies.
        void err;
        setTraces([]);
        setStatus('unavailable');
      });
  }, [contextId, window]);

  useEffect(() => { load(); }, [load]);

  return { traces, status, refresh: load };
}
