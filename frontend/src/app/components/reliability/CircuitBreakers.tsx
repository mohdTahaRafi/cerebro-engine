import React, { useState, useEffect } from 'react';
import { LineChart, Line, ResponsiveContainer, YAxis } from 'recharts';
import { ShieldCheck, Zap } from 'lucide-react';

const generateUptimeData = (base: number, volatility: number) => {
  return Array.from({ length: 24 }).map((_, i) => ({
    time: i,
    value: Math.min(100, Math.max(0, base + (Math.random() - 0.5) * volatility)),
  }));
};

const breakers = [
  {
    id: 1,
    name: 'HuggingFace Embedding API',
    status: 'closed',
    uptime: 99.98,
    data: generateUptimeData(99.9, 0.2),
    color: '#00FF41', // green
  },
  {
    id: 2,
    name: 'MongoDB Atlas Retrieval',
    status: 'closed',
    uptime: 99.95,
    data: generateUptimeData(99.8, 0.3),
    color: '#00FF41',
  },
  {
    id: 3,
    name: 'Redis Hot-Vector Cache',
    status: 'half-open',
    uptime: 98.45,
    data: generateUptimeData(95, 8),
    color: '#EAB308', // yellow
  },
];

export function CircuitBreakers() {
  const [activeBreakers, setActiveBreakers] = useState(breakers);

  useEffect(() => {
    const interval = setInterval(() => {
      setActiveBreakers(prev => prev.map(breaker => ({
        ...breaker,
        data: [...breaker.data.slice(1), { time: 24, value: Math.min(100, Math.max(0, breaker.uptime + (Math.random() - 0.5) * (breaker.status === 'half-open' ? 10 : 0.5))) }]
      })));
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex flex-col gap-4 w-[400px] shrink-0 font-mono">
      <div className="flex items-center gap-2 mb-2 px-1">
        <ShieldCheck size={18} className="text-[#00FF41]" />
        <h2 className="text-sm font-bold text-gray-300 tracking-wider">CIRCUIT BREAKERS</h2>
      </div>

      {activeBreakers.map((breaker) => (
        <div key={breaker.id} className="bg-[#050505] border border-[#333] p-5 flex flex-col relative overflow-hidden group">
          <div className="flex justify-between items-start mb-5 relative z-10">
            <h3 className="font-bold text-sm text-gray-200 w-2/3 uppercase">{breaker.name}</h3>
            
            {/* Status Text Indicator */}
            <div className={`px-2 py-1 text-[10px] font-bold border ${
              breaker.status === 'closed' ? 'text-[#00FF41] border-[#00FF41]/30 bg-[#00FF41]/10' :
              breaker.status === 'half-open' ? 'text-yellow-500 border-yellow-500/30 bg-yellow-500/10' :
              'text-red-500 border-red-500/30 bg-red-500/10'
            }`}>
              {breaker.status.toUpperCase()}
            </div>
          </div>

          <div className="flex items-center justify-between mb-4 relative z-10">
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">HEALTH STATE</span>
              <span className={`text-sm font-bold uppercase tracking-wide ${
                breaker.status === 'closed' ? 'text-[#00FF41]' :
                breaker.status === 'half-open' ? 'text-yellow-500' :
                'text-red-500'
              }`}>
                {breaker.status === 'closed' ? 'OPERATIONAL' : 'DEGRADED'}
              </span>
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-gray-500 uppercase tracking-widest mb-1">24H UPTIME</span>
              <span className="text-sm font-bold text-[#00FF41]">{breaker.uptime.toFixed(2)}%</span>
            </div>
          </div>

          {/* Sparkline Graph */}
          <div className="h-16 w-full mt-2 -mx-2 relative z-0">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={breaker.data}>
                <YAxis domain={['dataMin - 5', 100]} hide />
                <Line 
                  type="step" 
                  dataKey="value" 
                  stroke={breaker.color} 
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
            <div className="absolute bottom-2 left-2 text-[#00FF41]/30 text-[10px] tracking-widest pointer-events-none">LIVE...</div>
          </div>
        </div>
      ))}
    </div>
  );
}