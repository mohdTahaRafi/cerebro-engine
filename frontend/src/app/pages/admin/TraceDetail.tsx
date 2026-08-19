// phase_1 §5.3 — placeholder; the trace detail (waterfall + rerank matrix) lands in Phase 4.
import { EmptyState } from '../../components/design/EmptyState';

export function TraceDetail() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <EmptyState title="Trace detail" description="The waterfall and rerank matrix arrive in Phase 4." />
    </div>
  );
}
