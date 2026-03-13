import React from 'react';
import { Zap, Cpu, ArrowRight } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';

const simdData = Array.from({ length: 40 }).map((_, i) => ({
  time: i,
  val: 50 + Math.random() * 50 + Math.sin(i / 3) * 20
}));

export function PerformanceRace() {
  return (
    <div className="flex-1 flex flex-col min-w-[400px] font-mono">
      <div className="flex items-center justify-between mb-6 px-2">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-[#00FF41]" />
          <h2 className="text-sm font-bold text-gray-300 tracking-wider">ENGINE BENCHMARK (C++ VS JS)</h2>
        </div>
      </div>

      <div className="bg-[#050505] border border-[#333] p-8 flex-1 flex flex-col relative overflow-hidden">
        {/* Decorative Grid Background */}
        <div 
          className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{ backgroundImage: `url("data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI0MCIgaGVpZ2h0PSI0MCI+PGNpcmNsZSBjeD0iMSIgY3k9IjEiIHI9IjEiIGZpbGw9IiNmZmYiLz48L3N2Zz4=")` }}
        ></div>

        <div className="flex-1 flex items-end justify-center gap-16 relative z-10 pb-12">
          
          {/* JavaScript Bar */}
          <div className="flex flex-col items-center gap-4 w-32">
            <div className="text-gray-500 font-mono text-sm tracking-wide">~420ms</div>
            <div className="w-full h-[380px] bg-[#020617] border border-[#333] relative flex items-end overflow-hidden">
              <div className="w-full h-full bg-[#111] absolute bottom-0 border-t border-[#333]"></div>
              {/* Fake processing steps */}
              <div className="absolute inset-0 flex flex-col justify-between py-4 opacity-30">
                {[...Array(10)].map((_, i) => (
                  <div key={i} className="w-full h-px bg-[#333]"></div>
                ))}
              </div>
            </div>
            <div className="text-center mt-2">
              <div className="font-bold text-gray-400 text-xs">V8 ENGINE</div>
              <div className="text-[10px] text-gray-600 mt-1 uppercase">Native JS</div>
            </div>
          </div>

          {/* VS Arrow */}
          <div className="flex items-center justify-center h-full pb-32">
            <span className="text-[#333] text-2xl font-bold">VS</span>
          </div>

          {/* C++ N-API Bar */}
          <div className="flex flex-col items-center gap-4 w-32 relative">
            
            {/* Speedup Badge */}
            <div className="absolute -top-14 z-20 whitespace-nowrap bg-[#00FF41]/10 text-[#00FF41] border border-[#00FF41] font-bold px-3 py-1 text-xs">
              30x SPEEDUP
            </div>

            <div className="text-[#00FF41] font-bold text-2xl tracking-tight">~18ms</div>
            <div className="w-full h-[40px] bg-[#00FF41]/20 border border-[#00FF41] relative flex items-end overflow-hidden group">
              <div className="w-full h-full bg-[#00FF41] relative opacity-80"></div>
            </div>
            <div className="text-center mt-2">
              <div className="font-bold text-[#00FF41] flex items-center justify-center gap-1.5 text-xs">
                <Cpu size={14} /> C++ CORE
              </div>
              <div className="text-[10px] text-gray-500 mt-1 uppercase">N-API Bindings</div>
            </div>
          </div>
        </div>

        {/* Bottom Micro-Graph: SIMD lane utilization */}
        <div className="h-32 border-t border-[#333] pt-5 mt-auto relative">
          <div className="flex justify-between items-center mb-3 px-2">
            <span className="text-[10px] font-bold text-gray-500 uppercase tracking-widest">SIMD LANE UTILIZATION (AVX-512)</span>
            <span className="text-xs font-bold text-[#00FF41]">94.2%</span>
          </div>
          <div className="h-16 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={simdData}>
                <Line type="step" dataKey="val" stroke="#00FF41" strokeWidth={1.5} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="absolute bottom-2 left-2 text-[#00FF41]/30 text-[10px] tracking-widest pointer-events-none">LIVE...</div>
        </div>
      </div>
    </div>
  );
}