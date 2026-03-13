import React, { useState, useEffect, useRef } from 'react';
import { Database, TerminalSquare } from 'lucide-react';

const HEATMAP_SIZE = 100;
const generateHeatmap = () => {
  return Array.from({ length: HEATMAP_SIZE }).map((_, i) => {
    const isHot = Math.random() > 0.85;
    const queryTypes = ['SHA256:internship', 'REQ:user_404', 'EMB:vector_doc', 'IDX:hnsw_build', 'CACHE:miss_91'];
    return {
      id: i,
      intensity: isHot ? Math.random() * 0.5 + 0.5 : Math.random() * 0.3,
      isHot,
      query: queryTypes[Math.floor(Math.random() * queryTypes.length)]
    };
  });
};

export function CacheAndLogs() {
  const [heatmap, setHeatmap] = useState(generateHeatmap());
  const [logs, setLogs] = useState<{id: number, msg: string}[]>([]);
  const logEndRef = useRef<HTMLDivElement>(null);
  const logIdRef = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setHeatmap(generateHeatmap());
      
      const newLog = {
        id: logIdRef.current++,
        msg: `[INFO] Idempotency Key: batch_${Math.floor(Math.random() * 9000) + 1000} committed`
      };
      setLogs(prev => [...prev.slice(-30), newLog]);
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="flex flex-col gap-6 w-[420px] shrink-0 font-mono">
      
      {/* Top Panel: Cache Inspector */}
      <div className="bg-[#050505] border border-[#333] p-6 flex flex-col h-[320px]">
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-2">
            <Database size={16} className="text-[#00FF41]" />
            <h3 className="font-bold text-gray-300 text-sm tracking-wider">CACHE INSPECTOR</h3>
          </div>
          <div className="bg-[#020617] border border-[#00FF41]/30 px-2.5 py-1 text-[10px] text-[#00FF41] flex items-center gap-1.5 font-bold">
            <span className="w-1.5 h-1.5 bg-[#00FF41]"></span>
            HIT RATE: 92%
          </div>
        </div>

        <div className="flex-1 grid grid-cols-10 gap-1 p-2 bg-[#020617] border border-[#333]">
          {heatmap.map((cell) => (
            <div 
              key={cell.id} 
              title={cell.query}
              className="transition-colors duration-500 relative cursor-crosshair border border-[#111]"
              style={{ 
                backgroundColor: cell.isHot ? `rgba(0, 255, 65, ${cell.intensity})` : `rgba(51, 51, 51, ${cell.intensity * 0.3})`
              }}
            >
            </div>
          ))}
        </div>
        <div className="flex justify-between items-center mt-4 px-1 text-[10px] text-gray-500 uppercase tracking-widest font-bold">
          <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 bg-[#333] border border-[#555]"></div> COLD</span>
          <span className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 bg-[#00FF41]"></div> HOT</span>
        </div>
      </div>

      {/* Bottom Panel: Idempotency Logs */}
      <div className="bg-[#050505] border border-[#333] p-6 flex flex-col flex-1 min-h-[250px]">
        <div className="flex items-center gap-2 mb-4 pb-4 border-b border-[#333]">
          <TerminalSquare size={16} className="text-[#00FF41]" />
          <h3 className="font-bold text-gray-300 text-sm tracking-wider">IDEMPOTENCY LOGS</h3>
        </div>
        
        <div className="flex-1 bg-[#020617] border border-[#333] p-3 overflow-y-auto text-[10px] leading-relaxed custom-scrollbar">
          {logs.length === 0 && (
             <div className="text-gray-600 italic px-2">Waiting for operations...</div>
          )}
          {logs.map(log => (
            <div key={log.id} className="text-gray-400 mb-1 flex items-start gap-2 hover:bg-[#111] px-1 py-0.5 transition-colors">
              <span className="text-[#00FF41]/70 shrink-0 select-none">{'>'}</span>
              <span className="break-all tracking-wide">
                <span className="text-[#00FF41] mr-1.5 font-bold">[INFO]</span>
                {log.msg.replace('[INFO] ', '')}
              </span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>
      
    </div>
  );
}