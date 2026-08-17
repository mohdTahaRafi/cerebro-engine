import { useState } from 'react';
import { Code, Play, Square } from 'lucide-react';

// Phase 6 §2.1: this panel previously shipped a hardcoded fake SQL query
// ("SELECT * FROM vectors WHERE intent = 'payment_routing'") as its default value and a
// `mockHash` constant labeled "Computed Hash (SHA-256)" — neither corresponded to anything
// the backend does. /api/ask takes a natural-language question; there is no SQL dialect and
// nothing hashes the query. Both are replaced with the real contract.

// Mirrors MAX_QUERY_CHARS in backend/src/retrieval/constants.js — the backend rejects
// anything longer with a 400, so the console enforces it client-side rather than letting a
// user compose a long query only to have it bounced.
const MAX_QUERY_CHARS = 4000;

interface QueryConsoleProps {
  onSearch?: (query: string) => void;
  onStop?: () => void;
  isSearching?: boolean;
}

export function QueryConsole({ onSearch, onStop, isSearching }: QueryConsoleProps) {
  const [query, setQuery] = useState('');

  const trimmed = query.trim();
  const tooLong = query.length > MAX_QUERY_CHARS;
  const canRun = trimmed.length > 0 && !tooLong && !isSearching;

  const handleSearch = () => {
    if (canRun) onSearch?.(trimmed);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl/Cmd+Enter runs, matching the "execute" affordance of a developer console;
    // plain Enter inserts a newline, since a multi-line question is legitimate here.
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSearch();
    }
  };

  return (
    <div className="w-[340px] flex-shrink-0 border-r border-[#333] bg-[#0A0A0A] flex flex-col font-mono text-xs text-gray-300">
      <div className="h-10 border-b border-[#333] flex items-center justify-between px-4 uppercase font-bold text-gray-500 tracking-wider bg-[#0F0F0F] shrink-0">
        <span className="flex items-center gap-2"><Code size={14} className="text-[#00FF41]" /> Query Console</span>
        <button
          onClick={isSearching ? onStop : handleSearch}
          disabled={!isSearching && !canRun}
          title={isSearching ? 'Stop generating' : 'Run query (Ctrl+Enter)'}
          className={`transition-colors ${
            isSearching ? 'text-[#FF003C] hover:text-white' : canRun ? 'hover:text-[#00FF41]' : 'text-gray-700 cursor-not-allowed'
          }`}
        >
          {isSearching ? <Square size={14} fill="currentColor" /> : <Play size={14} />}
        </button>
      </div>

      <div className="p-4 flex-1 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
        <div className="flex flex-col gap-3">
          <label className="text-gray-500 uppercase font-bold tracking-widest text-[10px]">
            Question (natural language)
          </label>
          <div className="border border-[#333] bg-black shadow-[inset_0_0_10px_rgba(0,0,0,0.5)]">
            <textarea
              className="w-full bg-transparent p-3 outline-none text-[#00FF41] resize-none h-48 font-mono leading-relaxed selection:bg-[#00FF41]/30 custom-scrollbar disabled:opacity-50"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. What was EMEA revenue in Q3?"
              spellCheck={false}
              disabled={isSearching}
            />
          </div>
          <div className="flex justify-between text-[10px]">
            <span className="text-gray-600 uppercase tracking-widest">Ctrl+Enter to run</span>
            <span className={tooLong ? 'text-[#FF003C] font-bold' : 'text-gray-600'}>
              {query.length} / {MAX_QUERY_CHARS}
            </span>
          </div>
          {tooLong && (
            <div className="text-[#FF003C] text-[10px] font-bold uppercase tracking-wide">
              Query exceeds {MAX_QUERY_CHARS} characters — the backend will reject this.
            </div>
          )}
        </div>

        <div className="mt-auto">
          <button
            onClick={isSearching ? onStop : handleSearch}
            disabled={!isSearching && !canRun}
            className={`w-full py-2 border font-bold uppercase tracking-[0.2em] transition-all duration-300 ${
              isSearching
                ? 'bg-[#FF003C]/10 border-[#FF003C]/40 text-[#FF003C] hover:bg-[#FF003C] hover:text-white'
                : canRun
                  ? 'bg-[#00FF41]/10 border-[#00FF41]/30 text-[#00FF41] hover:bg-[#00FF41] hover:text-black shadow-[0_0_15px_rgba(0,255,65,0.1)]'
                  : 'bg-gray-900 border-gray-800 text-gray-600 cursor-not-allowed'
            }`}
          >
            {isSearching ? 'Stop' : 'Run Query'}
          </button>
        </div>
      </div>
    </div>
  );
}
