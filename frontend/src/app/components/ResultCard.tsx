import React from 'react';
import { Target, Search, FileText, Database, ShieldAlert, Cpu } from 'lucide-react';

export interface ResultCardProps {
  score: number;
  title: string;
  summary: string;
  source: string;
  format: string;
  matchType: 'Vector' | 'Keyword';
}

export function ResultCard({
  score,
  title,
  summary,
  source,
  format,
  matchType
}: ResultCardProps) {
  return (
    <div className="group relative bg-slate-900 border border-slate-800 rounded-lg p-5 hover:border-slate-700 hover:bg-slate-800/80 transition-all duration-300 flex flex-col h-full shadow-lg overflow-hidden">
      {/* Subtle top highlight on hover */}
      <div className="absolute top-0 inset-x-0 h-[2px] bg-gradient-to-r from-indigo-500/0 via-indigo-500/50 to-teal-400/0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

      {/* Header section: Score and Match Type */}
      <div className="flex items-center justify-between mb-4 z-10">
        
        {/* Similarity Score */}
        <div className="flex items-center gap-2">
          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-teal-500/10 border border-teal-500/30 text-teal-400 font-bold text-xs tracking-tight shadow-[0_0_10px_rgba(20,184,166,0.15)]">
            {score}%
          </div>
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Match</span>
        </div>

        {/* Match Type Badge */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider
          ${matchType === 'Vector' 
            ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' 
            : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
          }`}
        >
          {matchType === 'Vector' ? <Target size={12} strokeWidth={2.5} /> : <Search size={12} strokeWidth={2.5} />}
          {matchType}
        </div>
      </div>

      {/* Content Section */}
      <div className="flex-1 z-10">
        <h3 className="text-slate-100 font-semibold text-lg leading-tight mb-2 group-hover:text-indigo-300 transition-colors line-clamp-2">
          {title}
        </h3>
        <p className="text-slate-400 text-sm leading-relaxed line-clamp-2 mb-4">
          {summary}
        </p>
      </div>

      {/* Footer / Metadata */}
      <div className="flex items-center gap-3 pt-4 mt-auto border-t border-slate-800 z-10">
        
        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
          <Database size={12} className="text-slate-500" />
          <span><span className="text-slate-500">Source:</span> {source}</span>
        </div>

        <div className="w-[1px] h-3 bg-slate-800"></div>

        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium">
          <FileText size={12} className="text-slate-500" />
          <span><span className="text-slate-500">Format:</span> {format}</span>
        </div>

      </div>
    </div>
  );
}