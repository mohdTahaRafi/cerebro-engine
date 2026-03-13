import React, { useEffect, useState, useRef } from 'react';
import { Filter, RefreshCcw } from 'lucide-react';

const initialLogs = [
  { id: 1, type: 'INFO', msg: 'Ingestion pipeline initialized. Awaiting doc ingress.', time: '10:45:01.012' },
  { id: 2, type: 'INFO', msg: 'Batch #400: 128 vectors committed to MongoDB.', time: '10:45:02.144' },
  { id: 3, type: 'INFO', msg: 'Batch #401: 128 vectors committed to MongoDB.', time: '10:45:03.522' },
  { id: 4, type: 'WARN', msg: 'Rate limit approaching on Embedding Service.', time: '10:45:04.901' },
  { id: 5, type: 'SUCCESS', msg: 'HNSW Index Optimization Triggered.', time: '10:45:05.112' },
];

export function SystemLogs() {
  const [logs, setLogs] = useState(initialLogs);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let count = 6;
    const interval = setInterval(() => {
      const typeRand = Math.random();
      let type = 'INFO';
      let msg = '';
      if (typeRand > 0.95) {
        type = 'ERROR';
        msg = 'Connection timeout to Redis Hot-Vector Cache.';
      } else if (typeRand > 0.85) {
        type = 'WARN';
        msg = 'Rate limit approaching on Embedding Service.';
      } else if (typeRand > 0.7) {
        type = 'SUCCESS';
        msg = 'HNSW Index Optimization Triggered.';
      } else {
        msg = `Batch #${400 + count}: 128 vectors committed to MongoDB.`;
      }
      
      const d = new Date();
      const timeStr = `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
      
      setLogs((prev) => [...prev, { id: count++, type, msg, time: timeStr }].slice(-50));
    }, 1200);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  return (
    <div className="flex-1 flex flex-col font-mono text-[11px] text-gray-300 relative z-10 h-full bg-[#020617]">
      <div className="h-12 border-b border-[#333] flex items-center justify-between px-4 uppercase font-bold text-gray-500 tracking-wider shrink-0">
        <span className="flex items-center gap-2 text-gray-400 text-xs">
          SYSTEM LOGS
        </span>
        <div className="flex gap-3 text-gray-500">
           <button className="hover:text-[#00FF41] transition-colors"><Filter size={14} /></button>
           <button className="hover:text-[#00FF41] transition-colors"><RefreshCcw size={14} /></button>
        </div>
      </div>
      
      <div className="flex-1 p-4 overflow-y-auto custom-scrollbar leading-relaxed tracking-wide">
         {logs.map((log) => (
           <div key={log.id} className="mb-2 flex gap-3 p-1">
             <span className="text-gray-600 shrink-0 select-none">{log.time}</span>
             <span className={`shrink-0 font-bold ${
               log.type === 'INFO' ? 'text-blue-500' :
               log.type === 'WARN' ? 'text-yellow-500' :
               log.type === 'SUCCESS' ? 'text-[#00FF41]' :
               'text-red-500'
             }`}>[{log.type}]</span>
             <span className={
               log.type === 'ERROR' ? 'text-red-400' : 
               log.type === 'WARN' ? 'text-yellow-300' : 
               'text-gray-300'
             }>
               {log.msg}
             </span>
           </div>
         ))}
         <div ref={bottomRef} />
      </div>
    </div>
  );
}