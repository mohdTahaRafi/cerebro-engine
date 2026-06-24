import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useCerebroSearch } from '../hooks/useCerebroSearch';
import { useCerebroChat } from '../hooks/useCerebroChat';

interface EngineState {
  // Search state
  results: any[];
  isSearching: boolean;
  telemetry: any;
  isCircuitOpen: boolean;
  searchTime?: number;
  totalChunks?: number;
  error: string | null;
  performSearch: (q: string) => Promise<void>;
  
  // Chat state
  answer: string;
  isGenerating: boolean;
  chatError: string | null;
  askCerebro: (q: string) => Promise<void>;

  // Upload state
  attachedFiles: File[];
  setAttachedFiles: React.Dispatch<React.SetStateAction<File[]>>;
  ingestFile: (file: File) => Promise<void>;
}

const EngineContext = createContext<EngineState | undefined>(undefined);

export function EngineProvider({ children }: { children: ReactNode }) {
  const { performSearch, isSearching, results, telemetry, isCircuitOpen, error: searchError } = useCerebroSearch();
  const { answer, isGenerating, error: chatError, askCerebro } = useCerebroChat();
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);

  const ingestFile = async (file: File) => {
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
    return await res.json();
  };

  const value: EngineState = {
    results,
    isSearching,
    telemetry,
    isCircuitOpen,
    error: searchError,
    performSearch,
    
    answer,
    isGenerating,
    chatError,
    askCerebro,

    attachedFiles,
    setAttachedFiles,
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
