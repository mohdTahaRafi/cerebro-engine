// phase_1 §6.5 / DESIGN.md §6.12 — the `*` route, and ALSO what a non-admin gets at
// /admin/health (RequireAdmin renders this exact component). The rendering must be
// byte-identical in both cases — no "you don't have access" variant, no different
// heading — because a cosmetic difference here would confirm the admin route exists and
// is worth attacking. This component therefore takes no props and reads nothing
// route-dependent.
import { EmptyState } from '../components/design/EmptyState';

export function NotFound() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-surface">
      <EmptyState title="That page doesn't exist." action={{ label: 'Go to chat', to: '/chat' }} />
    </div>
  );
}
