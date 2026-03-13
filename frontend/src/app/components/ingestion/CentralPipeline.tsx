import React, { useState, useEffect } from 'react';
import { Layers, Cog, Server, Database, Zap } from 'lucide-react';

export function CentralPipeline() {
  const [docCount, setDocCount] = useState(14820);

  useEffect(() => {
    const docInterval = setInterval(() => {
      setDocCount((prev) => prev + Math.floor(Math.random() * 5) + 1);
    }, 800);
    return () => clearInterval(docInterval);
  }, []);

  return (
    <div className="flex-1 flex flex-col font-mono relative overflow-hidden bg-[#020617] border-b border-[#333]">
      <div className="h-12 border-b border-[#333] flex items-center px-4 uppercase font-bold text-gray-500 tracking-wider text-[11px] shrink-0">
        <Zap size={14} className="mr-2 text-yellow-500" /> PLAN TRACE ACTIVE
      </div>

      <div 
        className="flex-1 p-8 flex flex-col items-center justify-start overflow-y-auto relative z-10 custom-scrollbar gap-0 opacity-90"
        style={{ backgroundImage: `url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=")` }}
      >
        
        {/* Node 1 */}
        <div className="w-[480px] shrink-0 border border-[#333] bg-[#020617] p-5 relative z-10 flex flex-col">
           <div className="flex justify-between items-center mb-4 border-b border-[#333] pb-4">
              <span className="font-bold flex items-center gap-2 text-sm text-gray-300 uppercase tracking-wide">
                <Layers size={16} className="text-[#00FF41]"/> STAGE 1: SOURCE INGRESS
              </span>
              <span className="text-[#00FF41] text-xs">LIVE</span>
           </div>
           <div className="flex justify-between items-end">
              <div className="flex flex-col gap-1">
                <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">DOCUMENT TYPE</span>
                <span className="text-gray-300 text-xs">JSON / PDF Stream</span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">COUNT</span>
                <span className="text-[#00FF41] text-sm">{docCount.toLocaleString()}</span>
              </div>
           </div>
        </div>

        {/* Connecting Line */}
        <div className="h-8 w-px bg-[#333] flex items-center justify-center relative">
           <div className="absolute bottom-0 w-2 h-2 border-r border-b border-[#333] transform rotate-45 translate-y-1"></div>
        </div>

        {/* Node 2 */}
        <div className="w-[480px] shrink-0 border border-[#333] bg-[#020617] p-5 relative z-10 flex flex-col mt-1">
           <div className="flex justify-between items-center mb-4 border-b border-[#333] pb-4">
              <span className="font-bold flex items-center gap-2 text-sm text-gray-300 uppercase tracking-wide">
                <Cog size={16} className="text-[#00FF41]"/> STAGE 2: TRANSFORMER
              </span>
              <span className="text-[#00FF41] text-xs">4ms</span>
           </div>
           <div className="flex justify-between items-end">
              <div className="flex flex-col gap-1">
                <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">CHUNKING STRATEGY</span>
                <span className="text-gray-300 text-xs">Sliding Window (512 tks)</span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">BATCH SIZE</span>
                <span className="text-[#00FF41] text-sm">128</span>
              </div>
           </div>
        </div>

        {/* Connecting Line */}
        <div className="h-8 w-px bg-[#333] flex items-center justify-center relative">
           <div className="absolute bottom-0 w-2 h-2 border-r border-b border-[#333] transform rotate-45 translate-y-1"></div>
        </div>

        {/* Node 3 - Active Focus */}
        <div className="w-[480px] shrink-0 border border-[#00FF41] bg-[#020617] p-5 relative z-10 flex flex-col mt-1 shadow-[0_0_15px_rgba(0,255,65,0.05)]">
           <div className="flex justify-between items-center mb-4 border-b border-[#00FF41]/30 pb-4">
              <span className="font-bold flex items-center gap-2 text-sm text-[#00FF41] uppercase tracking-wide">
                <Server size={16} className="text-[#00FF41]"/> STAGE 3: VECTORIZATION
              </span>
              <span className="text-[#00FF41] text-xs">18ms</span>
           </div>
           <div className="flex justify-between items-end">
              <div className="flex flex-col gap-1">
                <span className="text-[#00FF41]/70 uppercase text-[10px] tracking-widest font-bold">MODEL</span>
                <span className="text-[#00FF41] text-xs">all-MiniLM-L6-v2</span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                <span className="text-[#00FF41]/70 uppercase text-[10px] tracking-widest font-bold">ACCELERATION</span>
                <span className="text-[#00FF41] text-xs">C++ SIMD N-API</span>
              </div>
           </div>
        </div>

        {/* Connecting Line */}
        <div className="h-8 w-px bg-[#333] flex items-center justify-center relative">
           <div className="absolute bottom-0 w-2 h-2 border-r border-b border-[#333] transform rotate-45 translate-y-1"></div>
        </div>

        {/* Node 4 */}
        <div className="w-[480px] shrink-0 border border-[#333] bg-[#020617] p-5 relative z-10 flex flex-col mt-1">
           <div className="flex justify-between items-center mb-4 border-b border-[#333] pb-4">
              <span className="font-bold flex items-center gap-2 text-sm text-gray-300 uppercase tracking-wide">
                <Database size={16} className="text-[#00FF41]"/> STAGE 4: COMMIT SINK
              </span>
              <span className="text-[#00FF41] text-xs">2ms</span>
           </div>
           <div className="flex justify-between items-end">
              <div className="flex flex-col gap-1">
                <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">PRIMARY STORE</span>
                <span className="text-gray-300 text-xs">MongoDB (HNSW)</span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">CACHE</span>
                <span className="text-[#00FF41] text-xs">Redis Hot-Path</span>
              </div>
           </div>
        </div>

      </div>
    </div>
  );
}