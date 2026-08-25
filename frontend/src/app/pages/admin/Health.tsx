// phase_4 §5 — the full operations console. Promotes the old 300px SystemHealth rail to a
// full page; admin-gated by routes.tsx's RequireAdmin (a non-admin never reaches this
// component — see routes.tsx's comment on why RequireAdmin sits outside AppShell).
import { AlertCircle } from 'lucide-react';
import { useHealthHistory } from '../../hooks/useHealthHistory';
import { useQueueStats } from '../../hooks/useQueueStats';
import { usePipelineErrors } from '../../hooks/usePipelineErrors';
import { DependencyCard } from '../../components/health/DependencyCard';
import { BreakerList } from '../../components/health/BreakerList';
import { QueuePanel } from '../../components/health/QueuePanel';
import { CollectionPanel } from '../../components/health/CollectionPanel';
import { ErrorStream } from '../../components/health/ErrorStream';

const STATUS_LABEL: Record<'up' | 'degraded' | 'down', string> = { up: 'HEALTHY', degraded: 'DEGRADED', down: 'DOWN' };
const STATUS_CLASS: Record<'up' | 'degraded' | 'down', string> = {
  up: 'border-positive-soft-line bg-positive-soft text-positive-text',
  degraded: 'border-warn-soft-line bg-warn-soft text-warn-text',
  down: 'border-critical-soft-line bg-critical-soft text-critical-text',
};

export function Health() {
  const { health, error, dependencyHistory, breakerSince } = useHealthHistory();
  const { stats } = useQueueStats();
  const { errors } = usePipelineErrors();

  const degradedName = health
    ? Object.values(health.dependencies).find((d) => d.status === 'down')?.name
    : null;

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto px-8 py-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">System health</h1>
        <p className="text-sm text-graphite">Live dependency, queue, and breaker state.</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-critical-soft-line bg-critical-soft px-4 py-2.5 text-sm text-critical-text">
          <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
          /health unreachable: {error}
        </div>
      )}

      {health && (
        <div className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium ${STATUS_CLASS[health.status]}`}>
          <span className="size-2 shrink-0 rounded-full bg-current" aria-hidden="true" />
          {STATUS_LABEL[health.status]}
          {health.status !== 'up' && degradedName && <span className="font-normal">— {degradedName} is not responding</span>}
        </div>
      )}

      {!health && !error && <p className="text-sm text-graphite">Polling /health…</p>}

      {health && (
        <>
          <section className="flex flex-col gap-2">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-graphite">Dependencies</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
              {Object.values(health.dependencies).map((d) => (
                <DependencyCard key={d.name} dependency={d} history={dependencyHistory[d.name] ?? []} />
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <BreakerList breakers={health.breakers} since={breakerSince} />
            <QueuePanel queue={health.queue} stats={stats} />
            <CollectionPanel collections={health.collections} />
          </div>

          <section>
            <ErrorStream errors={errors} />
          </section>
        </>
      )}
    </div>
  );
}
