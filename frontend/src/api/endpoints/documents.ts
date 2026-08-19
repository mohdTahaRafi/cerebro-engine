// Consolidates the two independent poll loops that used to live in EngineContext
// (pollDocumentStatus) and IngestionZone (an inline `while (true)`) — phase_1 §8.
// The 1500ms interval and 5-minute timeout are unchanged from both originals.
import { request } from '../client';

export interface IngestionResponse {
  documentId: string;
  status: 'queued' | 'duplicate';
  fileName: string;
  duplicateOf?: string;
  message?: string;
}

export interface DocumentStatusResponse {
  status: 'queued' | 'processing' | 'ready' | 'failed' | 'duplicate';
  progress: number;
  error: string | null;
  chunkCount: number;
  pageCount: number;
}

const POLL_INTERVAL_MS = 1500;
// Bounds how long a caller waits for ingestion to finish before giving up on the promise
// (the job itself keeps running server-side either way). Generous relative to
// architecture's own budgets (30s text, ~6s/page visual) to comfortably cover a
// multi-page scanned document without declaring failure on something still in progress.
const POLL_TIMEOUT_MS = 5 * 60_000;

export const documents = {
  upload: (file: File) => {
    const formData = new FormData();
    formData.append('document', file);
    return request<IngestionResponse>('/documents', { method: 'POST', body: formData });
  },

  status: (documentId: string) =>
    request<DocumentStatusResponse>(`/documents/${documentId}/status`),

  async pollUntilSettled(
    documentId: string,
    onProgress?: (s: DocumentStatusResponse) => void,
  ): Promise<DocumentStatusResponse> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const status = await documents.status(documentId);
      onProgress?.(status);
      if (status.status === 'ready' || status.status === 'failed') return status;
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
    throw new Error('Ingestion is taking longer than expected; check the document list for its status.');
  },
};
