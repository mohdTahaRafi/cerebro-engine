import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useCerebroChat, type ChatSource, type ChatTelemetry } from '../hooks/useCerebroChat';
import type { LangSmithLink } from '../components/core/TelemetryTypes';
import { api } from '../../api';
import type { DocumentStatusResponse, IngestionResponse } from '../../api/endpoints/documents';

export type { IngestionResponse, DocumentStatusResponse as DocumentStatus } from '../../api/endpoints/documents';

interface EngineState {
  // Chat state (the conversational RAG pipeline — phase 5/6)
  answer: string;
  sources: ChatSource[];
  isGenerating: boolean;
  chatError: string | null;
  threadId: string | null;
  chatTelemetry: ChatTelemetry | null;
  runId: string | null;
  langsmith: LangSmithLink | null;
  askCerebro: (q: string, scopeDocumentIds?: string[]) => Promise<void>;
  loadThread: (id: string) => void;
  startNewThread: () => void;
  stopGenerating: () => void;
  regenerate: () => void;

  // Upload state
  attachedFiles: File[];
  setAttachedFiles: React.Dispatch<React.SetStateAction<File[]>>;
  // Document ids (Mongo _id from POST /api/documents) for attachments that have finished
  // ingesting and are ready to be searched — populated once ingestFile's returned promise
  // resolves, not at attach time. Passed to askCerebro as scopeDocumentIds so a question
  // asked right after an attachment is actually scoped to it.
  attachedSources: string[];
  setAttachedSources: React.Dispatch<React.SetStateAction<string[]>>;
  // Enqueues the upload, then polls until the document reaches 'ready' (or throws on
  // 'failed'/timeout) — the returned promise settles once the document is actually
  // searchable, not merely accepted. Callers (ChatInput's attach flow) hold a loading
  // toast open for exactly that whole span, which is the honest UX for an async pipeline.
  ingestFile: (file: File, onProgress?: (s: DocumentStatusResponse) => void) => Promise<IngestionResponse & { chunkCount: number; pageCount: number }>;
}

const EngineContext = createContext<EngineState | undefined>(undefined);

export function EngineProvider({ children }: { children: ReactNode }) {
  const {
    answer, sources, isGenerating, error: chatError, threadId, telemetry: chatTelemetry, runId, langsmith,
    askCerebro, loadThread, startNewThread, stopGenerating, regenerate,
  } = useCerebroChat();
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachedSources, setAttachedSources] = useState<string[]>([]);

  // phase_1 §8 — routed through src/api/ (api.documents.upload + pollUntilSettled),
  // which is also what consolidates this poll loop with the one that used to live
  // separately in IngestionZone. No behavior change: same 1500ms interval, same
  // 5-minute timeout.
  const ingestFile: EngineState['ingestFile'] = async (file, onProgress) => {
    // Optimistically add to UI — removed again below if the enqueue call itself fails.
    setAttachedFiles((prev) => [...prev, file]);

    let data: IngestionResponse;
    try {
      data = await api.documents.upload(file);
    } catch (err) {
      setAttachedFiles((prev) => prev.filter((f) => f.name !== file.name));
      throw new Error(err instanceof Error ? err.message : 'Upload failed');
    }

    // A duplicate resolves immediately against the existing (already-ready) document —
    // nothing to poll, and it is already searchable under duplicateOf's id.
    if (data.status === 'duplicate') {
      const targetId = data.duplicateOf ?? data.documentId;
      setAttachedSources((prev) => [...prev, targetId]);
      return { ...data, chunkCount: 0, pageCount: 0 };
    }

    let final: DocumentStatusResponse;
    try {
      final = await api.documents.pollUntilSettled(data.documentId, onProgress);
    } catch (err) {
      setAttachedFiles((prev) => prev.filter((f) => f.name !== file.name));
      throw err;
    }
    if (final.status === 'failed') {
      setAttachedFiles((prev) => prev.filter((f) => f.name !== file.name));
      throw new Error(final.error || 'Ingestion failed');
    }

    setAttachedSources((prev) => [...prev, data.documentId]);
    return { ...data, status: 'ready' as any, chunkCount: final.chunkCount, pageCount: final.pageCount };
  };

  const value: EngineState = {
    answer,
    sources,
    isGenerating,
    chatError,
    threadId,
    chatTelemetry,
    runId,
    langsmith,
    askCerebro,
    loadThread,
    startNewThread,
    stopGenerating,
    regenerate,

    attachedFiles,
    setAttachedFiles,
    attachedSources,
    setAttachedSources,
    ingestFile,
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
