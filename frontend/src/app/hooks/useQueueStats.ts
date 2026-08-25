// phase_4 §5.1, §5.2 — /api/admin/queue, mocked this phase, polled every 5s (cheap, Redis
// only per the real implementation) and paused while the tab is hidden.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { QueueStats } from '../../api/contracts';

const POLL_INTERVAL_MS = 5_000;

export function useQueueStats() {
  const [stats, setStats] = useState<QueueStats | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await api.admin.queueStats();
      setStats(data);
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

  return { stats, status };
}
