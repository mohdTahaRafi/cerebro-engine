import { ArrowDown, Cpu, Network, Layers, Zap } from 'lucide-react';

interface Telemetry {
  cacheWaitMs: number;
  embeddingMs: number;
  retrievalMs: number;
  rerankingMs: number;
  totalMs: number;
}

interface ExecutionPlanProps {
  telemetry?: Telemetry | null;
}

export function ExecutionPlan({ telemetry }: ExecutionPlanProps) {
  // Fallbacks to 0 if not available yet
  const embMs = telemetry?.embeddingMs || 0;
  const retMs = telemetry?.retrievalMs || 0;
  const rerankMs = telemetry?.rerankingMs || 0;
  
  const hasData = telemetry != null;

  return (
    <div className="flex-1 border-b border-[#333] bg-[#0A0A0A] flex flex-col font-mono text-xs text-white relative overflow-hidden">
      <div className="h-10 border-b border-[#333] flex items-center justify-between px-4 uppercase font-bold text-gray-500 tracking-wider bg-[#0F0F0F] shrink-0">
        <span>Execution Plan</span>
        {hasData && (
          <span className="text-[#00FF41] text-[10px] bg-[#00FF41]/10 px-2 py-0.5 border border-[#00FF41]/30">
            TOTAL TRACE: {telemetry.totalMs}ms
          </span>
        )}
      </div>
      
      {/* Background Grid */}
      <div 
        className="flex-1 p-8 flex flex-col items-center justify-center relative bg-repeat opacity-90 overflow-y-auto custom-scrollbar"
        style={{ backgroundImage: `url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9IiMzMzMiLz48L3N2Zz4=")` }}
      >
        <div className="absolute top-4 left-4 border border-[#333] bg-black px-3 py-1.5 text-gray-500 uppercase font-bold tracking-widest text-[10px] flex items-center gap-2 shadow-sm">
           <Zap size={12} className={hasData ? "text-[#00FF41]" : "text-gray-600"}/> 
           {hasData ? "Plan Trace Active" : "Awaiting Query"}
        </div>

        {/* Node 1 */}
        <div className={`w-[420px] border ${hasData ? 'border-[#333]' : 'border-[#222]'} bg-[#0A0A0A] p-4 relative z-10 shadow-[0_4px_20px_rgba(0,0,0,0.8)] transition-all duration-500`}>
           <div className={`flex justify-between items-center mb-3 border-b ${hasData ? 'border-[#333]' : 'border-[#222]'} pb-3`}>
              <span className={`font-bold flex items-center gap-3 text-sm tracking-wide uppercase ${hasData ? 'text-white' : 'text-gray-600'}`}>
                <Layers size={16} className={hasData ? 'text-[#00FF41]' : 'text-gray-700'}/> Stage 1: Embedding Gen
              </span>
              <span className={`font-bold text-sm px-2 py-0.5 border transition-all ${hasData ? 'text-[#00FF41] bg-[#00FF41]/10 border-[#00FF41]/30' : 'text-gray-600 border-gray-800'}`}>
                {embMs}ms
              </span>
           </div>
           <div className="grid grid-cols-2 gap-4 text-gray-400 mt-2 text-xs">
              <div className="flex flex-col gap-1">
                 <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">Model</span>
                 <span className={hasData ? "text-white" : "text-gray-700"}>all-MiniLM-L6-v2</span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                 <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">Dims</span>
                 <span className={hasData ? "text-white" : "text-gray-700"}>384</span>
              </div>
           </div>
        </div>

        {/* Connecting Line & Arrow */}
        <div className="flex flex-col items-center justify-center z-10 transition-opacity duration-500" style={{ opacity: hasData ? 1 : 0.3 }}>
          <div className="w-px h-10 bg-[#333]"></div>
          <ArrowDown size={14} className="text-[#333] -mt-2.5" strokeWidth={3} />
        </div>

        {/* Node 2 */}
        <div className={`w-[420px] border ${hasData ? 'border-[#333]' : 'border-[#222]'} bg-[#0A0A0A] p-4 relative z-10 shadow-[0_4px_20px_rgba(0,0,0,0.8)] transition-all duration-500`}>
           <div className={`flex justify-between items-center mb-3 border-b ${hasData ? 'border-[#333]' : 'border-[#222]'} pb-3`}>
              <span className={`font-bold flex items-center gap-3 text-sm tracking-wide uppercase ${hasData ? 'text-white' : 'text-gray-600'}`}>
                <Network size={16} className={hasData ? 'text-[#00FF41]' : 'text-gray-700'}/> Stage 2: HNSW Lookup
              </span>
              <span className={`font-bold text-sm px-2 py-0.5 border transition-all ${hasData ? 'text-[#00FF41] bg-[#00FF41]/10 border-[#00FF41]/30' : 'text-gray-600 border-gray-800'}`}>
                {retMs}ms
              </span>
           </div>
           <div className="grid grid-cols-2 gap-4 text-gray-400 mt-2 text-xs">
              <div className="flex flex-col gap-1">
                 <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">Index</span>
                 <span className={hasData ? "text-white" : "text-gray-700"}>vector_index</span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                 <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">Candidate Count</span>
                 <span className={hasData ? "text-[#00FF41] font-bold" : "text-gray-700 font-bold"}>50</span>
              </div>
           </div>
        </div>

        {/* Connecting Line & Arrow */}
        <div className="flex flex-col items-center justify-center z-10 transition-opacity duration-500" style={{ opacity: hasData ? 1 : 0.3 }}>
          <div className="w-px h-10 bg-[#333]"></div>
          <ArrowDown size={14} className="text-[#333] -mt-2.5" strokeWidth={3} />
        </div>

        {/* Node 3 (Highlighted typically, dimmed if no data) */}
        <div className={`w-[420px] border ${hasData ? 'border-[#00FF41] bg-[#00FF41]/5 shadow-[0_0_25px_rgba(0,255,65,0.1)]' : 'border-[#222] bg-[#0A0A0A]'} p-4 relative z-10 transition-all duration-500`}>
           {hasData && <div className="absolute -left-[1px] top-0 bottom-0 w-[2px] bg-[#00FF41]"></div>}
           <div className={`flex justify-between items-center mb-3 border-b ${hasData ? 'border-[#00FF41]/30' : 'border-[#222]'} pb-3`}>
              <span className={`font-bold flex items-center gap-3 text-sm tracking-wide uppercase ${hasData ? 'text-[#00FF41]' : 'text-gray-600'}`}>
                <Cpu size={16} className={hasData ? 'text-[#00FF41]' : 'text-gray-700'}/> Stage 3: C++ Re-ranking
              </span>
              <span className={`font-bold text-sm px-2 py-0.5 border transition-all ${hasData ? 'text-[#00FF41] bg-[#00FF41]/20 border-[#00FF41]/50' : 'text-gray-600 border-gray-800'}`}>
                {rerankMs}ms
              </span>
           </div>
           <div className="grid grid-cols-2 gap-4 text-gray-400 mt-2 text-xs">
              <div className="flex flex-col gap-1">
                 <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">Algorithm</span>
                 <span className={hasData ? "text-white" : "text-gray-700"}>Cosine Similarity</span>
              </div>
              <div className="flex flex-col gap-1 text-right">
                 <span className="text-gray-500 uppercase text-[10px] tracking-widest font-bold">Acceleration</span>
                 <span className={hasData ? "text-[#00FF41] font-bold" : "text-gray-700 font-bold"}>Native SIMD</span>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}