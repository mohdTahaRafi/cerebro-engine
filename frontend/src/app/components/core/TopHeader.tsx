import React from 'react';
import { Cpu, Database, Zap, Terminal } from 'lucide-react';

export function TopHeader() {
  return (
    <div className="h-12 border-b border-[#333] bg-[#020617] flex items-center justify-between px-4 text-white font-mono text-xs select-none shrink-0 z-40">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2 font-bold text-[#00FF41] uppercase tracking-widest">
          <Terminal size={16} />
          <span>CEREBRO::CORE</span>
        </div>
        
        <div className="h-4 w-px bg-[#333]"></div>
        
        <div className="flex items-center gap-6 text-gray-400">
           <span className="flex items-center gap-2">
             <Cpu size={14}/> CPU: <span className="text-[#00FF41]">12%</span>
           </span>
           <span className="flex items-center gap-2">
             <Database size={14}/> RAM: <span className="text-white">4.2/16GB</span>
           </span>
           <span className="flex items-center gap-2">
             <Zap size={14}/> IOPS: <span className="text-white">1.2k/s</span>
           </span>
        </div>
      </div>
      
      <div className="flex items-center gap-2 border border-[#00FF41] bg-[#00FF41]/10 px-3 py-1.5">
        <div className="w-2 h-2 bg-[#00FF41]"></div>
        <span className="text-[#00FF41] uppercase font-bold tracking-wider text-[10px]">C++ Addon: Active</span>
      </div>
    </div>
  );
}