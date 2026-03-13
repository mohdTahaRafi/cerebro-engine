import React from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';

const rateData = [
  { time: 0, val: 420 }, { time: 1, val: 410 }, { time: 2, val: 450 },
  { time: 3, val: 480 }, { time: 4, val: 430 }, { time: 5, val: 450 },
  { time: 6, val: 470 }, { time: 7, val: 490 }, { time: 8, val: 485 },
  { time: 9, val: 460 }, { time: 10, val: 450 }
];

export function ThroughputTelemetry() {
  return (
    <div className="h-64 bg-[#020617] flex font-mono text-gray-300 shrink-0 border-t border-[#333]">
      
      {/* VECTORS / SEC */}
      <div className="flex-1 border-r border-[#333] p-5 flex flex-col relative">
         <div className="flex justify-between items-start mb-4">
           <span className="text-gray-500 uppercase text-[11px] font-bold tracking-widest">
             VECTORS / SEC
           </span>
           <span className="text-[#00FF41] text-xl font-bold">450</span>
         </div>
         <div className="flex-1 min-h-[80px]">
           <ResponsiveContainer width="100%" height="100%">
             <LineChart data={rateData}>
               <XAxis dataKey="time" hide />
               <YAxis domain={['dataMin - 50', 'dataMax + 50']} hide />
               <Line type="step" dataKey="val" stroke="#00FF41" strokeWidth={1.5} dot={false} isAnimationActive={false} />
             </LineChart>
           </ResponsiveContainer>
         </div>
         <div className="absolute bottom-5 left-5 text-[#00FF41] text-[10px] tracking-widest">LIVE....................</div>
      </div>

      {/* QUEUE DEPTH */}
      <div className="flex-1 border-r border-[#333] p-5 flex flex-col relative">
         <div className="flex justify-between items-start mb-4">
           <span className="text-gray-500 uppercase text-[11px] font-bold tracking-widest">
             QUEUE DEPTH
           </span>
           <span className="text-[#00FF41] text-xl font-bold">707</span>
         </div>
         <div className="flex-1 min-h-[80px]">
           <ResponsiveContainer width="100%" height="100%">
             <LineChart data={rateData.map(d => ({...d, val: d.val * 1.5}))}>
               <XAxis dataKey="time" hide />
               <YAxis domain={['dataMin - 50', 'dataMax + 50']} hide />
               <Line type="step" dataKey="val" stroke="#00FF41" strokeWidth={1.5} dot={false} isAnimationActive={false} />
             </LineChart>
           </ResponsiveContainer>
         </div>
         <div className="absolute bottom-5 left-5 text-[#00FF41] text-[10px] tracking-widest">LIVE....................</div>
      </div>

      {/* API QUOTA */}
      <div className="w-[300px] p-5 flex flex-col relative">
         <div className="flex justify-between items-start mb-4">
           <span className="text-gray-500 uppercase text-[11px] font-bold tracking-widest">
             API QUOTA
           </span>
           <span className="text-[#00FF41] text-xl font-bold">76%</span>
         </div>
         <div className="flex-1 flex flex-col justify-end gap-2 pb-6">
            <div className="flex justify-between text-[10px] text-gray-500">
              <span>HuggingFace Limit</span>
              <span>1.2M / 1.5M</span>
            </div>
            <div className="h-2 w-full bg-[#111] border border-[#333]">
              <div className="h-full bg-[#00FF41]" style={{ width: '76%' }}></div>
            </div>
         </div>
      </div>

    </div>
  );
}