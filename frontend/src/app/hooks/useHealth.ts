// DESIGN.md §5.13 / §8.7 — the top bar's HealthIndicator polls GET /api/health every
// 30 seconds. Cross-cutting polling pattern: one loop, pauses when the tab is hidden,
// fires once immediately on return.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { HealthResponse } from '../../api/contracts';

const POLL_INTERVAL_MS = 30_000;

export function useHealth() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await api.health.get();
      setHealth(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unreachable');
    }
  }, []);

  useEffect(() => {
    const start = () => {
      if (timerRef.current) return;
      timerRef.current = setInterval(poll, POLL_INTERVAL_MS);
    };
    const stop = () => {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else { poll(); start(); }
    };

    poll();
    start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => { stop(); document.removeEventListener('visibilitychange', onVisibility); };
  }, [poll]);

  return { health, error };
}
