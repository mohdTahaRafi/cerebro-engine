// phase_4 §5.1, §5.2 — the admin Health page's own 15s poll (distinct from the top bar's
// useHealth.ts, which polls at 30s for the HealthIndicator — matching the old SystemHealth
// console's interval, not the header's). Accumulates two things the endpoint itself does not
// provide: a 20-sample latency sparkline per dependency, and how long each breaker has held
// its current state. Both start EMPTY on page load and are never back-filled — there is no
// latency-history source, so drawing a line for a period this page did not observe would be
// an invention (DESIGN.md §6.11).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { HealthResponse } from '../../api/contracts';

const POLL_INTERVAL_MS = 15_000;
const MAX_SAMPLES = 20;

export interface BreakerSince { state: string; since: number }

export function useHealthHistory() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, forceRender] = useState(0);
  const historyRef = useRef<Record<string, number[]>>({});
  const breakerSinceRef = useRef<Record<string, BreakerSince>>({});
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    try {
      const data = await api.health.get();
      setHealth(data);
      setError(null);

      for (const dep of Object.values(data.dependencies)) {
        const arr = historyRef.current[dep.name] ?? (historyRef.current[dep.name] = []);
        arr.push(dep.status === 'up' ? dep.latencyMs : NaN);
        if (arr.length > MAX_SAMPLES) arr.shift();
      }
      for (const [name, state] of Object.entries(data.breakers)) {
        const prev = breakerSinceRef.current[name];
        if (!prev || prev.state !== state) breakerSinceRef.current[name] = { state, since: Date.now() };
      }
      forceRender((v) => v + 1); // the refs above are mutated in place; this is what re-renders
    } catch (err) {
      setError(err instanceof Error ? err.message : 'unreachable');
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

  return { health, error, dependencyHistory: historyRef.current, breakerSince: breakerSinceRef.current };
}
