import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useCerebroSearch } from '../hooks/useCerebroSearch';
import { useCerebroChat, type ChatSource, type ChatTelemetry } from '../hooks/useCerebroChat';

// Matches the real backend response from POST /api/ingest (see IngestionService.js).
export interface IngestionResponse {
  success: boolean;
  chunksCount: number;
  processingTimeS: number;
  source: string;
  message?: string; // present on the "no content found" early-exit path
}

interface EngineState {
  // Search state
  results: any[];
  isSearching: boolean;
  telemetry: any;
  isCircuitOpen: boolean;
  searchTime?: number;
  totalChunks?: number;
  error: string | null;
  performSearch: (q: string, scopeSources?: string[]) => Promise<void>;
  
  // Chat state
  answer: string;
  sources: ChatSource[];
  isGenerating: boolean;
  chatError: string | null;
  threadId: string | null;
  chatTelemetry: ChatTelemetry | null;
  // scopeDocumentIds, not scopeSources (phase 5 §11 point 2): /api/ask scopes retrieval
  // by Mongo document _id, the id /api/documents assigns — not the legacy /api/ingest
  // upload path attachedSources still holds. Attaching a file therefore no longer scopes
  // a question to it until the ingestion UI itself is migrated onto /api/documents (a
  // Phase 2/3 frontend gap this phase does not touch); the param exists for whoever
  // provides real document ids.
  askCerebro: (q: string, scopeDocumentIds?: string[]) => Promise<void>;
  loadThread: (id: string) => void;
  startNewThread: () => void;
  stopGenerating: () => void;
  regenerate: () => void;

  // Upload state
  attachedFiles: File[];
  setAttachedFiles: React.Dispatch<React.SetStateAction<File[]>>;
  // metadata.source values (legacy /api/ingest upload paths) for the currently attached
  // file(s). No longer passed to askCerebro as of phase 5: /api/ask scopes by Mongo
  // document _id, an id space the legacy /api/ingest response never returns. Tracked
  // here for the attachment chips' display/clear lifecycle in ChatInput; not currently
  // consumed as a scope by any request.
  attachedSources: string[];
  setAttachedSources: React.Dispatch<React.SetStateAction<string[]>>;
  ingestFile: (file: File) => Promise<IngestionResponse>;
}

const EngineContext = createContext<EngineState | undefined>(undefined);

export function EngineProvider({ children }: { children: ReactNode }) {
  const { performSearch, isSearching, results, telemetry: searchTelemetry, isCircuitOpen, error: searchError } = useCerebroSearch();
  const {
    answer, sources, isGenerating, error: chatError, threadId, telemetry: chatTelemetry,
    askCerebro, loadThread, startNewThread, stopGenerating, regenerate,
  } = useCerebroChat();
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachedSources, setAttachedSources] = useState<string[]>([]);

  const ingestFile = async (file: File): Promise<IngestionResponse> => {
    // We import toast dynamically or assume it's handled by the components
    // Actually, we can just return a promise and let the component handle the toast
    // But since it's global, let's just do it here and import toast
    const formData = new FormData();
    formData.append('document', file);

    // Optimistically add to UI
    setAttachedFiles(prev => [...prev, file]);

    const res = await fetch('/api/ingest', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      setAttachedFiles(prev => prev.filter(f => f.name !== file.name));
      throw new Error('Ingestion failed');
    }
    const data: IngestionResponse = await res.json();
    // Tracked for the attachment chip's display/clear lifecycle only (see the
    // attachedSources field comment above) — not currently used to scope a question.
    if (data.source) {
      setAttachedSources(prev => [...prev, data.source]);
    }
    return data;
  };

  const value: EngineState = {
    results,
    isSearching,
    telemetry: searchTelemetry,
    isCircuitOpen,
    error: searchError,
    performSearch,

    answer,
    sources,
    isGenerating,
    chatError,
    threadId,
    chatTelemetry,
    askCerebro,
    loadThread,
    startNewThread,
    stopGenerating,
    regenerate,

    attachedFiles,
    setAttachedFiles,
    attachedSources,
    setAttachedSources,
    ingestFile
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
