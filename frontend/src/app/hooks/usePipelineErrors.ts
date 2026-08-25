// phase_4 §5.1, §5.2 — /api/admin/errors, mocked this phase, polled every 15s and paused
// while the tab is hidden. The user-facing "pause" (freeze the displayed list while it keeps
// polling underneath) is a display concern, owned by ErrorStream.tsx, not this hook — this
// hook only ever reflects the latest poll.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { PipelineErrorRecord } from '../../api/contracts';

const POLL_INTERVAL_MS = 15_000;

export function usePipelineErrors() {
  const [errors, setErrors] = useState<PipelineErrorRecord[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const { errors: list } = await api.admin.pipelineErrors();
      setErrors(list);
      setStatus('ready');
    } catch (err: unknown) {
      void err;
      setStatus('unavailable');
    }
  }, []);

  useEffect(() => {
    const start = () => { if (!timerRef.current) timerRef.current = setInterval(poll, POLL_INTERVAL_MS); };
    const stop = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };
    const onVisibility = () => { if (document.hidden) stop(); else { poll(); start(); } };

    poll();
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [poll]);

  return { errors, status };
}
