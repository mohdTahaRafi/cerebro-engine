// phase_1 §5.2 — status 'loading' → full-page spinner (no layout shift into the app
// shell); 'anonymous' → redirect to /login with a captured, encoded returnTo;
// 'unreachable' → <BackendUnreachable>; 'authenticated' → <Outlet />.
import { Navigate, Outlet, useLocation } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { BackendUnreachable } from '../components/design/BackendUnreachable';
import { RouteLoading } from '../components/design/RouteLoading';
import { encodeReturnTo } from '../lib/returnTo';

export function RequireAuth() {
  const { status, refresh } = useAuth();
  const location = useLocation();

  if (status === 'loading') return <RouteLoading />;
  if (status === 'unreachable') return <BackendUnreachable onRetry={refresh} />;
  if (status === 'anonymous') {
    const returnTo = encodeReturnTo(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?returnTo=${returnTo}`} replace />;
  }
  return <Outlet />;
}
