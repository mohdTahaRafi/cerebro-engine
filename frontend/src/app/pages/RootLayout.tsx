import React from 'react';
import { Outlet } from 'react-router';
import { Toaster } from 'sonner';
import { TopHeader } from '../components/core/TopHeader';
import { Sidebar } from '../components/core/Sidebar';
import { EngineProvider } from '../context/EngineContext';

export function RootLayout() {
  return (
    <div className="flex h-screen w-screen bg-[#020617] text-gray-300 overflow-hidden font-mono selection:bg-[#00FF41]/30 selection:text-white">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top Header */}
        <TopHeader />

        {/* Main Multi-Pane Content */}
        {/* Main Multi-Pane Content */}
        <EngineProvider>
          <Outlet />
        </EngineProvider>
      </div>
      <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { background: '#0F0F0F', border: '1px solid #333', color: '#fff', fontFamily: 'monospace' } }} />
    </div>
  );
}