import React from 'react';
import { Activity, DatabaseZap, Cpu } from 'lucide-react';

export function PerformanceHUD() {
  return (
    <div className="flex items-center justify-center mt-4 text-xs font-mono font-medium tracking-tight z-10 relative">
      <div className="flex items-center divide-x divide-slate-800 bg-slate-900/40 border border-slate-800 rounded-lg px-2 py-1.5 backdrop-blur-md shadow-sm">
        
        <div className="px-4 flex items-center gap-2 text-slate-400">
          <Activity size={12} className="text-teal-400" />
          <span>Latency: <span className="text-slate-200">24ms</span></span>
        </div>

        <div className="px-4 flex items-center gap-2 text-slate-400">
          <DatabaseZap size={12} className="text-indigo-400" />
          <span>Cache: <span className="text-emerald-400 bg-emerald-400/10 px-1 rounded-sm border border-emerald-400/20">HIT</span> <span className="text-slate-500">(Redis)</span></span>
        </div>

        <div className="px-4 flex items-center gap-2 text-slate-400">
          <Cpu size={12} className="text-amber-400" />
          <span>Engine: <span className="text-slate-200">C++ Core</span></span>
        </div>

      </div>
    </div>
  );
}