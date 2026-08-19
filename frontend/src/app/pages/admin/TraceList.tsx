// phase_1 §5.3 — placeholder; the trace list lands in Phase 4.
import { EmptyState } from '../../components/design/EmptyState';

export function TraceList() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <EmptyState title="Traces" description="The trace list arrives in Phase 4." />
    </div>
  );
}
