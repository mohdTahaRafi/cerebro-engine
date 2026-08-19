// phase_1 §7.1 — replaces RootLayout. The wide labeled rail + 56px top bar + content
// outlet. EngineProvider mounts here, wrapping the whole shell (not just the outlet) —
// the Sidebar's "+ New chat" and Recent Chats both need EngineContext (§7.3), which the
// old RootLayout's Sidebar never did. AuthProvider mounts higher, in App.tsx, because
// /login needs it too.
// Phase 3: ContextScopeProvider also mounts here.
import type { ReactNode } from 'react';
import { Outlet } from 'react-router';
import { Toaster } from 'sonner';
import { useTheme } from 'next-themes';
import { Sidebar } from '../components/core/Sidebar';
import { TopHeader } from '../components/core/TopHeader';
import { EngineProvider } from '../context/EngineContext';

export function AppShell({ children }: { children?: ReactNode }) {
  const { resolvedTheme } = useTheme();

  return (
    <EngineProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-surface text-ink">
        <Sidebar />
        <div className="flex flex-1 flex-col overflow-hidden">
          <TopHeader />
          <div className="flex-1 overflow-hidden">
            {children ?? <Outlet />}
          </div>
        </div>
      </div>
      <Toaster theme={resolvedTheme === 'dark' ? 'dark' : 'light'} position="bottom-right" />
    </EngineProvider>
  );
}
