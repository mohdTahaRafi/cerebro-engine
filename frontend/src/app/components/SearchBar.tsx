import React from 'react';
import { Search, Command, Sparkles } from 'lucide-react';

export function SearchBar() {
  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col items-center z-10 relative">
      <div className="w-full p-[1px] rounded-lg bg-gradient-to-r from-indigo-500 via-indigo-400 to-teal-400 shadow-[0_0_30px_-5px_rgba(99,102,241,0.3)]">
        <div className="bg-slate-900 rounded-[7px] w-full flex items-center px-4 py-3 border-y border-x border-transparent hover:bg-slate-800/80 transition-colors focus-within:bg-slate-900">
          <Search className="text-slate-500 mr-3 shrink-0" size={24} strokeWidth={1.5} />
          
          <input 
            type="text" 
            placeholder="Search by intent or concept..." 
            className="w-full bg-transparent border-none outline-none text-slate-100 placeholder:text-slate-500 text-lg font-medium tracking-wide"
            autoFocus
          />

          <div className="flex items-center gap-2 ml-3 shrink-0">
            {/* AI Badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 rounded-md text-[11px] font-bold tracking-wider uppercase">
              <Sparkles size={12} strokeWidth={2.5} className="text-indigo-400" />
              AI
            </div>

            {/* Keyboard Shortcut */}
            <div className="flex items-center justify-center gap-0.5 px-2 py-1 bg-slate-800 border border-slate-700 text-slate-400 rounded-md text-[11px] font-mono shadow-inner">
              <Command size={12} strokeWidth={2} />
              <span>K</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}