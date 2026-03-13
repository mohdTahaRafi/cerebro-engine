import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { Activity } from 'lucide-react';

const hitRateData = [
  { time: 0, val: 96 }, { time: 1, val: 97 }, { time: 2, val: 96.5 },
  { time: 3, val: 98 }, { time: 4, val: 99 }, { time: 5, val: 98.2 },
  { time: 6, val: 98.5 }, { time: 7, val: 97 }, { time: 8, val: 98.8 },
  { time: 9, val: 99.1 }, { time: 10, val: 98 }, { time: 11, val: 98.2 },
  { time: 12, val: 97.5 }, { time: 13, val: 98.6 }, { time: 14, val: 99.3 },
  { time: 15, val: 98.9 }, { time: 16, val: 97.8 }, { time: 17, val: 98.1 },
  { time: 18, val: 99.4 }, { time: 19, val: 98.2 },
];

const execTimeData = [
  { time: 0, val: 180 }, { time: 1, val: 175 }, { time: 2, val: 182 },
  { time: 3, val: 160 }, { time: 4, val: 155 }, { time: 5, val: 162 },
  { time: 6, val: 168 }, { time: 7, val: 190 }, { time: 8, val: 172 },
  { time: 9, val: 158 }, { time: 10, val: 165 }, { time: 11, val: 162 },
  { time: 12, val: 178 }, { time: 13, val: 164 }, { time: 14, val: 159 },
  { time: 15, val: 161 }, { time: 16, val: 174 }, { time: 17, val: 168 },
  { time: 18, val: 154 }, { time: 19, val: 162 },
];

const CustomTooltip = ({ active, payload }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-black border border-[#333] p-2 text-xs font-mono">
        <span className="text-[#00FF41] font-bold">{payload[0].value}</span>
      </div>
    );
  }
  return null;
};

export function HardwareStats() {
  return (
    <div className="w-[340px] flex-shrink-0 border-l border-[#333] bg-[#0A0A0A] flex flex-col font-mono text-xs text-white">
      <div className="h-10 border-b border-[#333] flex items-center px-4 uppercase font-bold text-gray-500 tracking-wider bg-[#0F0F0F] shrink-0">
        <Activity size={14} className="mr-2 text-white" /> Hardware & Caching
      </div>
      
      <div className="flex-1 p-5 flex flex-col gap-8 overflow-y-auto custom-scrollbar">
        
        {/* Chart 1: Hit Rate */}
        <div className="flex flex-col gap-3 h-56">
           <div className="flex justify-between items-end border-b border-[#222] pb-2">
             <span className="text-gray-500 font-bold uppercase tracking-widest text-[10px]">Redis Cache Hit Rate</span>
             <span className="text-[#00FF41] font-bold text-lg leading-none">98.2%</span>
           </div>
           <div className="flex-1 border border-[#333] bg-black p-3 relative shadow-[inset_0_0_10px_rgba(0,0,0,0.5)] min-h-[100px]">
              <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                <LineChart data={hitRateData} id="chart-hit-rate">
                  <XAxis dataKey="time" tick={false} axisLine={false} type="number" domain={[0, 19]} height={0} />
                  <CartesianGrid strokeDasharray="2 2" stroke="#222" vertical={false} />
                  <YAxis domain={[90, 100]} tick={false} axisLine={false} type="number" width={0} />
                  <Tooltip content={<CustomTooltip />} cursor={{stroke: '#333', strokeWidth: 1, strokeDasharray: '3 3'}} />
                  <Line type="step" dataKey="val" stroke="#00FF41" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="absolute bottom-2 left-2 text-gray-600 text-[9px] uppercase tracking-widest">Live</div>
           </div>
        </div>

        {/* Chart 2: Exec Time */}
        <div className="flex flex-col gap-3 h-56">
           <div className="flex justify-between items-end border-b border-[#222] pb-2">
             <span className="text-gray-500 font-bold uppercase tracking-widest text-[10px]">C++ Core Exec Time (μs)</span>
             <span className="text-[#00FF41] font-bold text-lg leading-none">162μs</span>
           </div>
           <div className="flex-1 border border-[#333] bg-black p-3 relative shadow-[inset_0_0_10px_rgba(0,0,0,0.5)] min-h-[100px]">
              <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={100}>
                <LineChart data={execTimeData} id="chart-exec-time">
                  <XAxis dataKey="time" tick={false} axisLine={false} type="number" domain={[0, 19]} height={0} />
                  <CartesianGrid strokeDasharray="2 2" stroke="#222" vertical={false} />
                  <YAxis domain={[100, 250]} tick={false} axisLine={false} type="number" width={0} />
                  <Tooltip content={<CustomTooltip />} cursor={{stroke: '#333', strokeWidth: 1, strokeDasharray: '3 3'}} />
                  <Line type="monotone" dataKey="val" stroke="#00FF41" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
              <div className="absolute bottom-2 left-2 text-gray-600 text-[9px] uppercase tracking-widest">Live</div>
           </div>
        </div>

        {/* Memory Stats Bottom */}
        <div className="mt-auto pt-4 border-t border-[#333]">
           <div className="flex justify-between text-[10px] uppercase font-bold tracking-widest text-gray-500 mb-2">Memory Allocation</div>
           <div className="flex gap-1 h-3 w-full bg-[#111] border border-[#333]">
              <div className="w-[45%] bg-[#00FF41] border-r border-[#00FF41]/50"></div>
              <div className="w-[20%] bg-blue-500 border-r border-blue-500/50"></div>
              <div className="w-[15%] bg-yellow-500 border-r border-yellow-500/50"></div>
           </div>
           <div className="flex justify-between text-[9px] text-gray-600 uppercase tracking-widest mt-2">
              <span>HNSW</span>
              <span>Vectors</span>
              <span>Cache</span>
              <span>Free</span>
           </div>
        </div>

      </div>
    </div>
  );
}