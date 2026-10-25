// phase_4 §5.1 — waiting/active/failed/completed are real (`/api/health`'s `queue`).
// Phase 7 §5.1 makes throughput/worker concurrency/oldest-waiting-age real too
// (`/api/admin/queue`, backed by the Redis sorted set backend/src/telemetry/throughput.js
// maintains) — no longer mocked.
import type { QueueStats } from '../../../api/contracts';

interface RealQueue { waiting: number; active: number; failed: number; completed: number }

export function QueuePanel({ queue, stats }: { queue: RealQueue | null; stats: QueueStats | null }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-graphite">Ingest queue</h2>
      {queue ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-graphite">waiting</span><span className="text-right font-medium tabular-nums text-ink">{queue.waiting}</span>
          <span className="text-graphite">active</span><span className="text-right font-medium tabular-nums text-ink">{queue.active}</span>
          <span className="text-graphite">failed</span><span className={`text-right font-medium tabular-nums ${queue.failed > 0 ? 'text-critical-text' : 'text-ink'}`}>{queue.failed}</span>
          <span className="text-graphite">completed</span><span className="text-right font-medium tabular-nums text-ink">{queue.completed}</span>
        </div>
      ) : (
        <p className="text-xs italic text-graphite">unavailable</p>
      )}

      <div className="mt-1 border-t border-line-subtle pt-1.5">
        <span className="text-[10px] font-medium uppercase tracking-wide text-graphite">Throughput</span>
      </div>
      {stats ? (
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <span className="text-graphite">throughput</span><span className="text-right font-medium tabular-nums text-ink">{stats.throughputPerMin}/min</span>
          <span className="text-graphite">workers</span><span className="text-right font-medium tabular-nums text-ink">{stats.activeWorkers}/{stats.workerConcurrency}</span>
          {stats.oldestWaitingAgeMs != null && (
            <>
              <span className="text-graphite">oldest waiting</span>
              <span className="text-right font-medium tabular-nums text-ink">{Math.round(stats.oldestWaitingAgeMs / 1000)}s</span>
            </>
          )}
        </div>
      ) : (
        <p className="text-xs italic text-graphite">unavailable</p>
      )}
    </div>
  );
}
