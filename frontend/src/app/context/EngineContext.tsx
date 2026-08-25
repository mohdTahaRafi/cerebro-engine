// phase_1 §7.1 / phase_3_chat_ui.md — the conversational RAG pipeline's live state
// (streaming answer, sources, telemetry). The upload/attachment surface this used to carry
// (attachedFiles, ingestFile) was v1's context-less single-file flow, superseded in Phase 3
// by Composer.tsx's own useUploadQueue instance, which uploads into the active context and
// supports multiple concurrent files — see Chat.tsx and Composer.tsx.
import { createContext, useContext, type ReactNode } from 'react';
import { useCerebroChat, type ChatSource, type ChatTelemetry } from '../hooks/useCerebroChat';
import type { LangSmithLink } from '../components/core/TelemetryTypes';

interface EngineState {
  answer: string;
  sources: ChatSource[];
  isGenerating: boolean;
  chatError: string | null;
  threadId: string | null;
  chatTelemetry: ChatTelemetry | null;
  runId: string | null;
  traceId: string | null;
  langsmith: LangSmithLink | null;
  askCerebro: (q: string, contextId?: string | null, scopeDocumentIds?: string[]) => Promise<void>;
  loadThread: (id: string) => void;
  startNewThread: () => void;
  stopGenerating: () => void;
  regenerate: () => void;
}

const EngineContext = createContext<EngineState | undefined>(undefined);

export function EngineProvider({ children }: { children: ReactNode }) {
  const {
    answer, sources, isGenerating, error: chatError, threadId, telemetry: chatTelemetry, runId, traceId, langsmith,
    askCerebro, loadThread, startNewThread, stopGenerating, regenerate,
  } = useCerebroChat();

  const value: EngineState = {
    answer,
    sources,
    isGenerating,
    chatError,
    threadId,
    chatTelemetry,
    runId,
    traceId,
    langsmith,
    askCerebro,
    loadThread,
    startNewThread,
    stopGenerating,
    regenerate,
  };

  return (
    <EngineContext.Provider value={value}>
      {children}
    </EngineContext.Provider>
  );
}

export function useEngine() {
  const context = useContext(EngineContext);
  if (context === undefined) {
    throw new Error('useEngine must be used within an EngineProvider');
  }
  return context;
}
