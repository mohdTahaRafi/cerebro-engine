import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useCerebroChat, type ChatSource, type ChatTelemetry } from '../hooks/useCerebroChat';
import type { LangSmithLink } from '../components/core/TelemetryTypes';

// Matches POST /api/documents' response (backend/src/api/routes/documents.js) — replaces
// the legacy /api/ingest contract (chunksCount/processingTimeS/source) that route no
// longer exists to serve (phase 6 §5.1, §5.3: /api/ingest and IngestionService.js were
// deleted this phase). Ingestion here is async: this is the *enqueue* response, not a
// finished result — see DocumentStatus / pollDocumentStatus below for what happens after.
export interface IngestionResponse {
  documentId: string;
  status: 'queued' | 'duplicate';
  fileName: string;
  duplicateOf?: string;
  message?: string;
}

// Matches GET /api/documents/:id/status.
export interface DocumentStatus {
  status: 'queued' | 'processing' | 'ready' | 'failed' | 'duplicate';
  progress: number;
  error: string | null;
  chunkCount: number;
  pageCount: number;
}

const POLL_INTERVAL_MS = 1500;
// Bounds how long a caller waits for ingestion to finish before giving up on the promise
// (the job itself keeps running server-side either way — BullMQ owns that lifecycle, not
// this poll loop). Generous relative to architecture's own budgets (30s text, ~6s/page
// visual) to comfortably cover a multi-page scanned document without the UI declaring
// failure on something that is still legitimately in progress.
const POLL_TIMEOUT_MS = 5 * 60_000;

async function pollDocumentStatus(
  documentId: string,
  onProgress?: (s: DocumentStatus) => void,
): Promise<DocumentStatus> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`/api/documents/${documentId}/status`);
    const data: DocumentStatus = await res.json();
    onProgress?.(data);
    if (data.status === 'ready' || data.status === 'failed') return data;
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error('Ingestion is taking longer than expected; check the document list for its status.');
}

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
  // asked right after an attachment is actually scoped to it (phase 6 closes the gap phase
  // 5 left open: "attachments no longer scope retrieval... a Phase 2/3 frontend gap this
  // phase does not touch").
  attachedSources: string[];
  setAttachedSources: React.Dispatch<React.SetStateAction<string[]>>;
  // Enqueues the upload, then polls until the document reaches 'ready' (or throws on
  // 'failed'/timeout) — the returned promise settles once the document is actually
  // searchable, not merely accepted. Callers (ChatInput's attach flow) hold a loading
  // toast open for exactly that whole span, which is the honest UX for an async pipeline.
  ingestFile: (file: File, onProgress?: (s: DocumentStatus) => void) => Promise<IngestionResponse & { chunkCount: number; pageCount: number }>;
}

const EngineContext = createContext<EngineState | undefined>(undefined);

export function EngineProvider({ children }: { children: ReactNode }) {
  const {
    answer, sources, isGenerating, error: chatError, threadId, telemetry: chatTelemetry, runId, langsmith,
    askCerebro, loadThread, startNewThread, stopGenerating, regenerate,
  } = useCerebroChat();
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [attachedSources, setAttachedSources] = useState<string[]>([]);

  const ingestFile: EngineState['ingestFile'] = async (file, onProgress) => {
    const formData = new FormData();
    formData.append('document', file);

    // Optimistically add to UI — removed again below if the enqueue call itself fails.
    setAttachedFiles((prev) => [...prev, file]);

    const res = await fetch('/api/documents', { method: 'POST', body: formData });
    const data: IngestionResponse = await res.json();

    if (!res.ok) {
      setAttachedFiles((prev) => prev.filter((f) => f.name !== file.name));
      throw new Error((data as any)?.error || 'Upload failed');
    }

    // A duplicate resolves immediately against the existing (already-ready) document —
    // nothing to poll, and it is already searchable under duplicateOf's id.
    if (data.status === 'duplicate') {
      const targetId = data.duplicateOf ?? data.documentId;
      setAttachedSources((prev) => [...prev, targetId]);
      return { ...data, chunkCount: 0, pageCount: 0 };
    }

    const final = await pollDocumentStatus(data.documentId, onProgress);
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
