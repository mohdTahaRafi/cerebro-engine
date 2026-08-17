import { useEffect, useState } from 'react';
import { Activity, AlertTriangle } from 'lucide-react';

// Replaces HardwareStats.tsx (phase 6 §2.1, deleted this phase). That component rendered a
// hardcoded "Redis Cache Hit Rate 98.2%" and a mock "C++ Core Exec Time" series against a
// static array — describing a Redis cache that does not exist and a C++ engine that has not
// been on the query path since Phase 3. It was the same class of fabrication as the legacy
// telemetry panel's `cacheWaitMs`, which §2.1 exists to eliminate; documenting it as a
// placeholder was not good enough. Everything below is read from GET /health — measured, or
// absent.

interface Dependency { name: string; status: 'up' | 'down'; latencyMs: number; error?: string }
interface Health {
  status: 'up' | 'degraded' | 'down';
  version: string;
  breakers: Record<string, 'closed' | 'half-open' | 'open'>;
  dependencies: Record<string, Dependency>;
  queue: { waiting: number; active: number; failed: number; completed: number } | null;
  collections: Record<string, number> | null;
}

// /health fans out to every provider concurrently and a cold LLM ping alone can take
// several seconds, so polling faster than this would stack overlapping requests and
// generate provider load purely to draw a sidebar.
const POLL_INTERVAL_MS = 15_000;

const STATUS_COLOR = {
  up: 'text-[#00FF41]', degraded: 'text-yellow-500', down: 'text-[#FF003C]',
} as const;

const BREAKER_COLOR = {
  closed: 'text-[#00FF41]', 'half-open': 'text-yellow-500', open: 'text-[#FF003C]',
} as const;

export function SystemHealth() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        // /api/health, not bare /health — both Vite's dev proxy and Caddy route to the
        // backend on the /api prefix only, so bare /health is unreachable from the browser
        // in dev and returns the SPA's index.html in production. The backend registers the
        // same handler on both paths; see api/routes/health.js.
        const res = await fetch('/api/health');
        const data: Health = await res.json();
        if (!cancelled) { setHealth(data); setError(null); }
      } catch (err) {
        // A failed /health poll is itself a signal worth showing, not a silent no-op —
        // the backend being unreachable is exactly when this panel matters most.
        if (!cancelled) setError((err as Error).message);
      }
    };
    poll();
    const id = setInterval(poll, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return (
    <div className="w-[300px] flex-shrink-0 border-l border-[#333] bg-[#0A0A0A] flex flex-col font-mono text-xs text-white">
      <div className="h-10 border-b border-[#333] flex items-center justify-between px-4 uppercase font-bold text-gray-500 tracking-wider bg-[#0F0F0F] shrink-0">
        <span className="flex items-center gap-2"><Activity size={14} className="text-white" /> System Health</span>
        {health && (
          <span className={`text-[10px] font-bold ${STATUS_COLOR[health.status]}`}>{health.status.toUpperCase()}</span>
        )}
      </div>

      <div className="flex-1 p-4 flex flex-col gap-5 overflow-y-auto custom-scrollbar">
        {error && (
          <div className="flex items-start gap-2 text-[#FF003C] text-[10px] font-bold uppercase tracking-wide">
            <AlertTriangle size={12} className="shrink-0 mt-0.5" /> /health unreachable: {error}
          </div>
        )}

        {!health && !error && (
          <div className="text-gray-600 uppercase font-bold tracking-widest text-[10px]">Polling /health…</div>
        )}

        {health && (
          <>
            <section className="flex flex-col gap-2">
              <div className="text-gray-500 uppercase font-bold tracking-widest text-[10px] border-b border-[#222] pb-1">
                Dependencies
              </div>
              {Object.values(health.dependencies).map((d) => (
                <div key={d.name} className="flex justify-between items-baseline" title={d.error ?? ''}>
                  <span className="text-gray-400">{d.name}</span>
                  <span className={`font-bold ${d.status === 'up' ? 'text-[#00FF41]' : 'text-[#FF003C]'}`}>
                    {d.status === 'up' ? `${d.latencyMs}ms` : 'down'}
                  </span>
                </div>
              ))}
            </section>

            <section className="flex flex-col gap-2">
              <div className="text-gray-500 uppercase font-bold tracking-widest text-[10px] border-b border-[#222] pb-1">
                Circuit Breakers
              </div>
              {Object.entries(health.breakers).map(([name, state]) => (
                <div key={name} className="flex justify-between items-baseline">
                  <span className="text-gray-400 truncate max-w-[150px]">{name}</span>
                  <span className={`font-bold ${BREAKER_COLOR[state]}`}>{state}</span>
                </div>
              ))}
            </section>

            <section className="flex flex-col gap-2">
              <div className="text-gray-500 uppercase font-bold tracking-widest text-[10px] border-b border-[#222] pb-1">
                Ingest Queue
              </div>
              {health.queue ? (
                Object.entries(health.queue).map(([state, count]) => (
                  <div key={state} className="flex justify-between items-baseline">
                    <span className="text-gray-400">{state}</span>
                    <span className={`font-bold ${state === 'failed' && count > 0 ? 'text-[#FF003C]' : 'text-white'}`}>{count}</span>
                  </div>
                ))
              ) : (
                <span className="text-gray-600 italic">unavailable</span>
              )}
            </section>

            <section className="flex flex-col gap-2">
              <div className="text-gray-500 uppercase font-bold tracking-widest text-[10px] border-b border-[#222] pb-1">
                Collections
              </div>
              {health.collections ? (
                Object.entries(health.collections).map(([name, count]) => (
                  <div key={name} className="flex justify-between items-baseline">
                    <span className="text-gray-400 truncate max-w-[150px]">{name}</span>
                    <span className="text-white font-bold">{count.toLocaleString()}</span>
                  </div>
                ))
              ) : (
                <span className="text-gray-600 italic">unavailable</span>
              )}
            </section>

            <div className="mt-auto pt-3 border-t border-[#333] text-[9px] text-gray-600 uppercase tracking-widest">
              v{health.version} · polled every {POLL_INTERVAL_MS / 1000}s
            </div>
          </>
        )}
      </div>
    </div>
  );
}
