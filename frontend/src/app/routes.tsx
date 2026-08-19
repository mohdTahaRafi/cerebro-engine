// phase_1 §5.3 — the v2 route table.
import { createBrowserRouter, Navigate } from 'react-router';
import { AppShell } from './pages/AppShell';
import { RequireAuth } from './guards/RequireAuth';
import { RequireAdmin } from './guards/RequireAdmin';
import { Login } from './pages/auth/Login';
import { Signup } from './pages/auth/Signup';
import { ForgotPassword } from './pages/auth/ForgotPassword';
import { ResetPassword } from './pages/auth/ResetPassword';
import { NotFound } from './pages/NotFound';
import { ConsumerDashboard } from './pages/ConsumerDashboard';
import { ContextList } from './pages/contexts/ContextList';
import { ContextDetail } from './pages/contexts/ContextDetail';
import { TraceList } from './pages/admin/TraceList';
import { TraceDetail } from './pages/admin/TraceDetail';
import { VectorSpace } from './pages/admin/VectorSpace';
import { Health } from './pages/admin/Health';

export const router = createBrowserRouter([
  { path: '/login', Component: Login },              // public
  { path: '/signup', Component: Signup },             // public
  { path: '/forgot-password', Component: ForgotPassword }, // public
  { path: '/reset-password', Component: ResetPassword },   // public
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/', Component: AppShell,               // Sidebar + TopHeader + Outlet
        children: [
          { index: true, element: <Navigate to="/chat" replace /> },
          { path: 'chat', Component: ConsumerDashboard },
          { path: 'contexts', Component: ContextList },       // Phase 2
          { path: 'contexts/:id', Component: ContextDetail }, // Phase 2
          { path: 'admin/traces', Component: TraceList },     // Phase 4
          { path: 'admin/traces/:id', Component: TraceDetail }, // Phase 4
          { path: 'admin/vectors', Component: VectorSpace },  // Phase 4
        ],
      },
      {
        // Deliberately a SIBLING of the '/' AppShell branch above, not nested inside it
        // (amending phase_1 §5.3's literal sketch, which nested RequireAdmin inside
        // AppShell's children — that structure cannot satisfy task 1.14b). Task 1.14b
        // requires a non-admin's /admin/health response to be byte-identical
        // (document.body.innerHTML) to the top-level `*` route's NotFound, which is only
        // possible if RequireAdmin's denial has zero AppShell ancestors in the tree —
        // otherwise the Sidebar/TopHeader markup stays present in the DOM around it.
        // When authorized, the leaf route below composes AppShell itself (its `children`
        // prop) instead of relying on the shared layout route.
        element: <RequireAdmin />,
        children: [
          { path: 'admin/health', element: <AppShell><Health /></AppShell> }, // admin only
        ],
      },
    ],
  },
  // v1 → v2 redirects. Kept permanently: these URLs are in the README and in
  // screenshots, and a 404 on a documented URL is a worse outcome than a redirect.
  { path: '/advanced', element: <Navigate to="/admin/traces" replace /> },
  { path: '/vector', element: <Navigate to="/admin/vectors" replace /> },
  { path: '*', Component: NotFound },
]);
