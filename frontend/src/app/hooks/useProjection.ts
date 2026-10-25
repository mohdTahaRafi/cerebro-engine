// phase_4 §4.8 — the projection fetch. Two layers of state: this hook's own 'unavailable'
// (the endpoint doesn't exist yet — production, pre-Phase 7) versus the payload's own
// `staleness` field (fresh/rebuilding/absent — a real answer about a real cached projection).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { ProjectionResponse } from '../../api/contracts';

// 'idle' is NOT 'unavailable'. With no context selected there is nothing to ask for, which
// is a different fact from "the projection endpoint could not answer" and needs different
// words on screen. Reporting the second for the first also produced a guaranteed flash of
// the unavailable panel on every load, because ContextScope resolves the active context
// asynchronously and this hook runs first with `contextId === undefined`.
export type ProjectionStatus = 'idle' | 'loading' | 'ready' | 'unavailable';

// A fit is a 5–15s CPU-bound job on the projection queue (backend fit.js), so the console
// is polling for something that takes a handful of these. 4s keeps the wait feeling
// answered without making a queued fit noticeably slower to notice.
const POLL_MS = 4_000;

export function useProjection(contextId: string | undefined) {
  const [projection, setProjection] = useState<ProjectionResponse | null>(null);
  const [status, setStatus] = useState<ProjectionStatus>('loading');
  const [rebuilding, setRebuilding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Guards against a reply for a context the user has already navigated away from
  // overwriting the current one — the poll makes overlapping requests routine, not rare.
  const requestFor = useRef<string | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
  }, []);

  const load = useCallback((opts: { silent?: boolean } = {}) => {
    clearTimer();
    if (!contextId) { setProjection(null); setStatus('idle'); return; }
    requestFor.current = contextId;
    // A poll must not tear the cloud down and put the loading state back up every 4
    // seconds — only the first fetch for a context is allowed to show 'loading'.
    if (!opts.silent) setStatus('loading');
    api.vectors.projection(contextId)
      .then((res) => {
        if (requestFor.current !== contextId) return;
        setProjection(res);
        setStatus('ready');
        // The server says whether a fit is actually queued or running. Polling on that
        // rather than on `staleness` is what keeps a permanently failed projection (which
        // also reads 'absent') from being polled forever — see ProjectionResponse.pending.
        if (res.pending) timer.current = setTimeout(() => load({ silent: true }), POLL_MS);
      })
      .catch((err: unknown) => {
        void err;
        if (requestFor.current !== contextId) return;
        setProjection(null);
        setStatus('unavailable');
      });
  }, [contextId, clearTimer]);

  /** The explicit Rebuild action. Enqueues a fit and immediately resumes polling, so the
   *  console reflects the new fit without the user reloading the page. */
  const rebuild = useCallback(async () => {
    if (!contextId || rebuilding) return;
    setRebuilding(true);
    try {
      await api.vectors.rebuild(contextId);
      load({ silent: true });
    } finally {
      setRebuilding(false);
    }
  }, [contextId, rebuilding, load]);

  useEffect(() => {
    load();
    return clearTimer;
  }, [load, clearTimer]);

  return { projection, status, refresh: load, rebuild, rebuilding };
}
