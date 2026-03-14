import { QueryConsole } from '../components/core/QueryConsole';
import { ExecutionPlan } from '../components/core/ExecutionPlan';
import { HardwareStats } from '../components/core/HardwareStats';
import { ResultsTable } from '../components/core/ResultsTable';
import { IngestionZone } from '../components/core/IngestionZone';
import { useCerebroSearch } from '../hooks/useCerebroSearch';

export function CoreEngine() {
  const { performSearch, telemetry, isSearching, error, isCircuitOpen, results } = useCerebroSearch();

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Far-Left Sidebar: Ingestion Zone */}
      <div className="w-[260px] flex-shrink-0 border-r border-[#333] bg-[#0A0A0A] p-4 flex flex-col overflow-y-auto custom-scrollbar">
        <IngestionZone />
      </div>

      {/* Left Sidebar: Query Console */}
      <QueryConsole onSearch={performSearch} isSearching={isSearching} />

      {/* Center Pane: Execution Plan (Top) & Results Table (Bottom) */}
      <div className="flex-1 flex flex-col overflow-hidden bg-[#050505] relative">
        {/* Error / Circuit Breaker Safeguard Mode Alert */}
        {(isCircuitOpen || error) && (
           <div className="absolute top-0 left-0 right-0 bg-[#FF003C] text-white font-bold p-3 text-center uppercase tracking-[0.2em] font-mono z-50 animate-pulse shadow-[0_0_20px_#FF003C]">
              ⚠️ {isCircuitOpen ? 'SYSTEM ALERT' : 'NETWORK ERROR'}: {error} ⚠️
           </div>
        )}
        <ExecutionPlan telemetry={telemetry} />
        <ResultsTable results={results} />
      </div>

      {/* Right Sidebar: Hardware & Caching Stats */}
      <HardwareStats />
    </div>
  );
}