// phase_1 §5.3 — placeholder; the operations console lands in Phase 4. Reachable only by
// an admin (RequireAdmin) — this is the page it wraps in AppShell manually, see
// routes.tsx's comment on the 'admin/health' route for why.
import { EmptyState } from '../../components/design/EmptyState';

export function Health() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <EmptyState title="Health" description="The operations console arrives in Phase 4." />
    </div>
  );
}
