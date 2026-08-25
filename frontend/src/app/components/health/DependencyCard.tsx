// phase_4 §5.1 — one card per probe (mongo, qdrant, redis, vision, cohere, llamaparse, llm):
// current latency, a 20-sample sparkline, the error string on failure.
import { LatencySparkline } from './LatencySparkline';

interface Dependency { name: string; status: 'up' | 'down'; latencyMs: number; error?: string }

export function DependencyCard({ dependency, history }: { dependency: Dependency; history: number[] }) {
  return (
    <div className="rounded-lg border border-line bg-surface-raised p-3" title={dependency.error}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium capitalize text-ink">{dependency.name}</span>
        <span className={`text-xs font-medium tabular-nums ${dependency.status === 'up' ? 'text-positive-text' : 'text-critical-text'}`}>
          {dependency.status === 'up' ? `${dependency.latencyMs}ms` : 'down'}
        </span>
      </div>
      <LatencySparkline samples={history} />
      <p className="text-[10px] text-graphite" title="This sparkline starts empty on page load and never back-fills.">
        last 20 polls (5 min)
      </p>
      {dependency.status === 'down' && dependency.error && (
        <p className="mt-1 truncate text-[10px] text-critical-text" title={dependency.error}>{dependency.error}</p>
      )}
    </div>
  );
}
