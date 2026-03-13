import React from 'react';
import { Search, Network, Database, Settings, BrainCircuit } from 'lucide-react';

export function Sidebar() {
  return (
    <div className="w-16 h-screen bg-slate-900 border-r border-slate-800 flex flex-col items-center py-6 shrink-0 z-10">
      {/* Logo */}
      <div className="mb-8">
        <div className="w-10 h-10 bg-indigo-600/20 rounded-lg flex items-center justify-center border border-indigo-500/30 text-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.2)]">
          <BrainCircuit size={24} strokeWidth={1.5} />
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex flex-col gap-6 flex-1 w-full items-center">
        <NavItem icon={<Search size={22} />} active tooltip="Search" />
        <NavItem icon={<Network size={22} />} tooltip="Vector Map" />
        <NavItem icon={<Database size={22} />} tooltip="Ingestion" />
      </nav>

      {/* Settings */}
      <div className="mb-6 w-full flex justify-center">
         <NavItem icon={<Settings size={22} />} tooltip="Settings" />
      </div>

      {/* System Health */}
      <div className="group relative cursor-pointer flex flex-col items-center">
        <div className="w-8 h-8 rounded-lg bg-slate-800/50 flex items-center justify-center border border-slate-700 hover:bg-slate-800 transition-colors">
           <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.6)]"></div>
        </div>
        <div className="absolute left-12 px-2 py-1 bg-slate-800 text-slate-300 text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-slate-700 shadow-xl z-20">
          System Health: Optimal
        </div>
      </div>
    </div>
  );
}

function NavItem({ icon, active, tooltip }: { icon: React.ReactNode, active?: boolean, tooltip: string }) {
  return (
    <div className="group relative flex w-full justify-center">
      <button className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all duration-200 
        ${active 
          ? 'text-indigo-400 bg-indigo-500/10 border border-indigo-500/20' 
          : 'text-slate-500 hover:text-slate-300 hover:bg-slate-800'
        }`}
      >
        {icon}
      </button>
      
      {/* Tooltip */}
      <div className="absolute left-14 top-1/2 -translate-y-1/2 px-2 py-1 bg-slate-800 text-slate-200 text-xs rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none border border-slate-700 shadow-xl z-20">
        {tooltip}
      </div>
      
      {/* Active Indicator Line */}
      {active && (
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-6 bg-indigo-500 rounded-r-full"></div>
      )}
    </div>
  );
}