import { QueryConsole } from '../components/core/QueryConsole';
import { ExecutionPlan } from '../components/core/ExecutionPlan';
import { SystemHealth } from '../components/core/SystemHealth';
import { ProvenancePanel } from '../components/core/ProvenancePanel';
import { IngestionZone } from '../components/core/IngestionZone';
import { AnswerBox } from '../components/core/AnswerBox';
import { useEngine } from '../context/EngineContext';

// The advanced console (phase 6 §1, §2): a live per-query trace of the same conversational
// RAG pipeline the main dashboard ("/") uses — condense, embed/sparse/colpali, retrieve,
// merge, rerank, generate — not a separate legacy search path. EngineProvider is mounted
// once above both routes (RootLayout.tsx), so a question asked here and a question asked
// on "/" share the same underlying askCerebro/telemetry state; this page is a different
// *view* onto it, not a different pipeline.
export function CoreEngine() {
  const {
    askCerebro, stopGenerating, isGenerating, answer, sources, chatTelemetry, chatError, runId, langsmith,
  } = useEngine();

  // No threadId is passed explicitly — askCerebro (useCerebroChat's run()) already
  // continues whatever thread is currently active in EngineContext's shared state, the
  // same continuation behavior the main dashboard gets.
  const handleQuery = (query: string) => {
    askCerebro(query);
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Far-Left Sidebar: Ingestion Zone */}
      <div className="w-[260px] flex-shrink-0 border-r border-line bg-surface-sunken p-4 flex flex-col overflow-y-auto custom-scrollbar">
        <IngestionZone />
      </div>

      {/* Left Sidebar: Query Console */}
      <QueryConsole onSearch={handleQuery} onStop={stopGenerating} isSearching={isGenerating} />

      {/* Center Pane: Execution Plan (Top) & Provenance Panel (Bottom) */}
      <div className="flex-1 flex flex-col overflow-hidden bg-surface relative">
        {/* Error Alert */}
        {chatError && (
           <div className="absolute top-0 left-0 right-0 bg-critical text-white font-bold p-3 text-center uppercase tracking-[0.2em] font-mono z-50 animate-pulse shadow-2">
              ⚠️ NETWORK ERROR: {chatError} ⚠️
           </div>
        )}
        <ExecutionPlan telemetry={chatTelemetry} isGenerating={isGenerating} runId={runId} langsmith={langsmith} />

        {/* Generative Answer Box — same live stream the main dashboard renders, since
            both views share one EngineContext-held conversation. */}
        <AnswerBox answer={answer} isGenerating={isGenerating} error={chatError} />

        <ProvenancePanel sources={sources} />
      </div>

      {/* Right Sidebar: live /health — real dependency, breaker, queue and collection state */}
      <SystemHealth />
    </div>
  );
}
