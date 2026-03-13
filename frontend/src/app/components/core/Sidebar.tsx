import React from 'react';
import { NavLink } from 'react-router';
import { Terminal, Database, ShieldCheck, Activity, Box } from 'lucide-react';

export function Sidebar() {
  return (
    <div className="w-16 flex flex-col items-center py-4 bg-[#020617] border-r border-[#333] shrink-0 z-50 justify-between h-full font-mono">
      
      <div className="flex flex-col items-center w-full gap-8">
        <div className="w-8 h-8 flex items-center justify-center border border-[#00FF41] text-[#00FF41]">
          <Activity size={18} />
        </div>

        <nav className="flex flex-col gap-4 w-full px-2">
          <NavItem to="/" icon={<Terminal size={20} />} label="Core" />
          <NavItem to="/ingestion" icon={<Database size={20} />} label="Ingestion" />
          <NavItem to="/reliability" icon={<ShieldCheck size={20} />} label="Reliability" />
          <NavItem to="/vector" icon={<Box size={20} />} label="Vector Map" />
        </nav>
      </div>

      <div className="relative mb-4 group cursor-pointer flex items-center justify-center" title="Systems Health">
        <div className="w-2.5 h-2.5 bg-[#00FF41]"></div>
        <div className="absolute top-0 left-0 w-2.5 h-2.5 bg-[#00FF41] animate-ping opacity-75"></div>
      </div>
    </div>
  );
}

function NavItem({ to, icon, label }: { to: string, icon: React.ReactNode, label: string }) {
  return (
    <NavLink
      to={to}
      title={label}
      className={({ isActive }) =>
        `p-3 flex items-center justify-center transition-none ${
          isActive 
            ? 'bg-[#00FF41]/10 text-[#00FF41] border border-[#00FF41]' 
            : 'text-gray-500 hover:text-gray-300 border border-transparent'
        }`
      }
    >
      {icon}
    </NavLink>
  );
}