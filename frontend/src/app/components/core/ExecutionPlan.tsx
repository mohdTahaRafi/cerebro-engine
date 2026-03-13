import React from 'react';
import { ArrowDown, Cpu, Network, Layers, Zap } from 'lucide-react';

export function ExecutionPlan() {
  return (
    <div className="flex-1 border-b border-[#333] bg-[#0A0A0A] flex flex-col font-mono text-xs text-white relative overflow-hidden">
      <div className="h-10 border-b border-[#333] flex items-center px-4 uppercase font-bold text-gray-500 tracking-wider bg-[#0F0F0F] shrink-0">
        Execution Plan
      </div>
      
      {/* Background Grid */}
      <div 
        className="flex-1 p-8 flex flex-col items-center justify-center relative bg-repeat opacity-90 overflow-y-auto custom-scrollbar"
        style={{ backgroundImage: `url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=")` }}
      >
        <div className="absolute top-4 left-4 border border-[#333] bg-black px-3 py-1.5 text-gray-500 uppercase font-bold tracking-widest text-[10px] flex items-center gap-2 shadow-sm">
           <Zap size={12} className="text-yellow-500"/> Plan Trace Active
        </div>

        {/* Node 1 */}
        <div className="w-[420px] border border-[#333] bg-[#0A0A0A] p-4 relative z-10 shadow-[0_4px_20px_rgba(0,0,0,0.8)]">
           <div className="flex justify-between items-center mb-3 border-b border-[#333] pb-3">
              <span className="font-bold flex items-center gap-3 text-sm tracking-wide text-white uppercase"><Layers size={16} className="text-[#00FF41]"/> Stage 1: Embedding Gen</span>
              <span className="text-[#00FF41] font-bold text-sm bg-[#00FF41]/10 px-2 py-0.5 border border-[#00FF41]/30">12ms</span>
           </div>
           <div className="grid grid-cols-2 gap-4 text-gray-400 mt-2 text-xs">
              <div className="flex flex-col gap-1">
                 <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">Model</span>
                 <span className="text-white">all-MiniLM-L6-v2</span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                 <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">Dims</span>
                 <span className="text-white">384</span>
              </div>
           </div>
        </div>

        {/* Connecting Line & Arrow */}
        <div className="flex flex-col items-center justify-center z-10">
          <div className="w-px h-10 bg-[#333]"></div>
          <ArrowDown size={14} className="text-[#333] -mt-2.5" strokeWidth={3} />
        </div>

        {/* Node 2 */}
        <div className="w-[420px] border border-[#333] bg-[#0A0A0A] p-4 relative z-10 shadow-[0_4px_20px_rgba(0,0,0,0.8)]">
           <div className="flex justify-between items-center mb-3 border-b border-[#333] pb-3">
              <span className="font-bold flex items-center gap-3 text-sm tracking-wide text-white uppercase"><Network size={16} className="text-[#00FF41]"/> Stage 2: HNSW Lookup</span>
              <span className="text-[#00FF41] font-bold text-sm bg-[#00FF41]/10 px-2 py-0.5 border border-[#00FF41]/30">4ms</span>
           </div>
           <div className="grid grid-cols-2 gap-4 text-gray-400 mt-2 text-xs">
              <div className="flex flex-col gap-1">
                 <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">Index</span>
                 <span className="text-white">vectors_idx_01</span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                 <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">Candidate Count</span>
                 <span className="text-[#00FF41] font-bold">1000</span>
              </div>
           </div>
        </div>

        {/* Connecting Line & Arrow */}
        <div className="flex flex-col items-center justify-center z-10">
          <div className="w-px h-10 bg-[#333]"></div>
          <ArrowDown size={14} className="text-[#333] -mt-2.5" strokeWidth={3} />
        </div>

        {/* Node 3 (Highlighted) */}
        <div className="w-[420px] border border-[#00FF41] bg-[#00FF41]/5 p-4 relative z-10 shadow-[0_0_25px_rgba(0,255,65,0.1)]">
           <div className="absolute -left-[1px] top-0 bottom-0 w-[2px] bg-[#00FF41]"></div>
           <div className="flex justify-between items-center mb-3 border-b border-[#00FF41]/30 pb-3">
              <span className="font-bold flex items-center gap-3 text-sm tracking-wide text-[#00FF41] uppercase"><Cpu size={16} className="text-[#00FF41]"/> Stage 3: C++ Re-ranking</span>
              <span className="text-[#00FF41] font-bold text-sm bg-[#00FF41]/20 px-2 py-0.5 border border-[#00FF41]/50">1ms</span>
           </div>
           <div className="grid grid-cols-2 gap-4 text-gray-400 mt-2 text-xs">
              <div className="flex flex-col gap-1">
                 <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">Algorithm</span>
                 <span className="text-white">Cosine Similarity</span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                 <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">Acceleration</span>
                 <span className="text-[#00FF41] font-bold">SIMD</span>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}