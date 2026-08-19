// phase_1 §5.2 — nested inside RequireAuth (its parent in the route tree already
// guarantees `status === 'authenticated'`), so this only checks role.
// user.role !== 'admin' → the 404 page, NOT a "forbidden" page: a forbidden page
// confirms the route exists and is worth attacking; a 404 says nothing
// (architecture §9). Deliberately placed as a SIBLING of the '/' AppShell branch in
// routes.tsx, not nested inside it — rendering bare <NotFound/> here, with no AppShell
// ancestor in the tree, is what makes task 1.14b's document.body.innerHTML diff against
// the top-level `*` route come out byte-identical. See routes.tsx's comment at the
// 'admin/health' route for the full explanation.
import { Outlet } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { NotFound } from '../pages/NotFound';

export function RequireAdmin() {
  const { user } = useAuth();
  if (user?.role !== 'admin') return <NotFound />;
  return <Outlet />;
}
