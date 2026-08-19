// phase_1 §5.3 — a real component rendering a single named placeholder, not a 404. The
// context list, creation, and management land in Phase 2.
import { EmptyState } from '../../components/design/EmptyState';

export function ContextList() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <EmptyState title="Contexts" description="The context list arrives in Phase 2." />
    </div>
  );
}
