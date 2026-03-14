import { useState } from 'react';
import { Hash, Code, Save, Play } from 'lucide-react';

interface QueryConsoleProps {
  onSearch?: (query: string) => void;
  isSearching?: boolean;
}

export function QueryConsole({ onSearch, isSearching }: QueryConsoleProps) {
  const [query, setQuery] = useState("SELECT * FROM vectors\nWHERE intent = 'payment_routing'\nAND threshold > 0.85\nLIMIT 10");
  
  // Fake hash calculation for visuals
  const mockHash = "a7b8f921e4c3d6a9b0...8f2a1c";

  const handleSearch = () => {
    if (onSearch && query.trim()) {
      onSearch(query);
    }
  };

  return (
    <div className="w-[340px] flex-shrink-0 border-r border-[#333] bg-[#0A0A0A] flex flex-col font-mono text-xs text-gray-300">
      <div className="h-10 border-b border-[#333] flex items-center justify-between px-4 uppercase font-bold text-gray-500 tracking-wider bg-[#0F0F0F] shrink-0">
        <span className="flex items-center gap-2"><Code size={14} className="text-[#00FF41]" /> Query Console</span>
        <div className="flex gap-2 text-gray-400">
           <button className="hover:text-white transition-colors"><Save size={14} /></button>
           <button 
             onClick={handleSearch}
             disabled={isSearching}
             className={`transition-colors ${isSearching ? 'text-gray-600 cursor-not-allowed' : 'hover:text-[#00FF41]'}`}
           >
             <Play size={14} className={isSearching ? 'animate-pulse' : ''} />
           </button>
        </div>
      </div>
      
      <div className="p-4 flex-1 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
        <div className="flex flex-col gap-3">
          <label className="text-gray-500 uppercase font-bold tracking-widest text-[10px]">Input Stream (SQL-v2)</label>
          <div className="border border-[#333] bg-black p-0 flex shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
            <div className="w-8 border-r border-[#333] bg-[#111] flex flex-col items-center py-3 text-gray-600 select-none font-bold">
              <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
            </div>
            <textarea 
              className="w-full bg-transparent p-3 outline-none text-[#00FF41] resize-none h-48 font-mono leading-relaxed selection:bg-[#00FF41]/30 custom-scrollbar"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              spellCheck={false}
            />
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <label className="text-gray-500 uppercase font-bold tracking-widest text-[10px] flex items-center gap-2">
            <Hash size={12} className="text-gray-400" /> Computed Hash (SHA-256)
          </label>
          <div className="border border-[#333] bg-black p-3 break-all text-[#00FF41] opacity-70 leading-relaxed shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
            {mockHash}
          </div>
        </div>

        <div className="mt-auto border border-[#333] bg-[#111] p-4 flex flex-col gap-2">
           <div className="text-gray-500 uppercase font-bold tracking-widest text-[10px] mb-1">Status</div>
           <div className="flex justify-between items-center text-xs">
              <span className="text-gray-400">Syntax</span>
              <span className="text-[#00FF41]">VALID</span>
           </div>
           <div className="flex justify-between items-center text-xs">
              <span className="text-gray-400">Mode</span>
              <span className="text-white">STRICT</span>
           </div>
            <button 
              onClick={handleSearch}
              disabled={isSearching}
              className={`mt-2 w-full py-2 border font-bold uppercase tracking-[0.2em] transition-all duration-300 ${isSearching ? 'bg-gray-800 border-gray-700 text-gray-500 cursor-not-allowed' : 'bg-[#00FF41]/10 border-[#00FF41]/30 text-[#00FF41] hover:bg-[#00FF41] hover:text-black shadow-[0_0_15px_rgba(0,255,65,0.1)]'}`}
            >
               {isSearching ? 'Tracing...' : 'Execute Architecture Trace'}
            </button>
         </div>
      </div>
    </div>
  );
}