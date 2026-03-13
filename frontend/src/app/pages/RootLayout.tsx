import React from 'react';
import { Outlet } from 'react-router';
import { TopHeader } from '../components/core/TopHeader';
import { Sidebar } from '../components/core/Sidebar';

export function RootLayout() {
  return (
    <div className="flex h-screen w-screen bg-[#020617] text-gray-300 overflow-hidden font-mono selection:bg-[#00FF41]/30 selection:text-white">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top Header */}
        <TopHeader />

        {/* Main Multi-Pane Content */}
        <Outlet />
      </div>
    </div>
  );
}