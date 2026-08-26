// Consolidates the two independent poll loops that used to live in EngineContext
// (pollDocumentStatus) and IngestionZone (an inline `while (true)`) — phase_1 §8.
// The 1500ms interval and 5-minute timeout are unchanged from both originals.
//
// Phase 6 §5.4, §9: the backend's `Document` model now carries a real `contextId`
// (backend/src/models/Document.js) and every route is nested under
// `/api/contexts/:contextId/...` (backend/src/api/routes/contexts.js) — the interim
// client-side `contextId` mapping (mock/fixtures/docContexts.ts) is gone; `stage` is
// still derived on the client from status + progress until Phase 7 adds a real field.
import { request } from '../client';
import type { DocumentRecord, DocumentStatus } from '../contracts';
import { deriveStage } from '../../app/components/documents/stage';

export interface IngestionResponse {
  documentId: string;
  status: 'queued' | 'duplicate';
  fileName: string;
  duplicateOf?: string;
  message?: string;
}

export interface DocumentStatusResponse {
  status: DocumentStatus;
  progress: number;
  error: string | null;
  chunkCount: number;
  pageCount: number;
}

export interface ReindexResponse { documentId: string; status: 'queued'; }
export interface DeleteDocumentResponse {
  deleted: true; documentId: string; deletedPoints: number; deletedPagePoints: number;
}

const POLL_INTERVAL_MS = 1500;
// Bounds how long a caller waits for ingestion to finish before giving up on the promise
// (the job itself keeps running server-side either way). Generous relative to
// architecture's own budgets (30s text, ~6s/page visual) to comfortably cover a
// multi-page scanned document without declaring failure on something still in progress.
const POLL_TIMEOUT_MS = 5 * 60_000;

// phase_2 §11 performance budget: "200 is enforced by the page limit" — the document
// table renders without virtualization up to 200 rows, so the list is fetched whole
// (one request, per §5.4's list-level polling) rather than paginated against the server.
const LIST_LIMIT = 200;

/** The shape a Mongoose `Document` actually serializes to over `res.json()` — `_id`, and
 *  a REAL `contextId` as of Phase 6 (backend/src/models/Document.js), unlike Phase 2's
 *  interim client-side mapping. Still no `stage` (phase_2 §5.2). */
interface RawDocument {
  _id: string; contextId: string; fileName: string; mimeType: string; sizeBytes: number;
  status: DocumentStatus; progress: number; error: string | null;
  chunkCount: number; pageCount: number; textPageCount: number; visualPageCount: number;
  warnings: string[]; createdAt: string; duplicateOf: string | null;
}

function normalize(raw: RawDocument, fileNameById: Map<string, string>): DocumentRecord {
  const withoutStage = {
    id: raw._id, contextId: raw.contextId,
    fileName: raw.fileName, mimeType: raw.mimeType, sizeBytes: raw.sizeBytes,
    status: raw.status, progress: raw.progress,
    chunkCount: raw.chunkCount, pageCount: raw.pageCount,
    textPageCount: raw.textPageCount, visualPageCount: raw.visualPageCount,
    error: raw.error, warnings: raw.warnings ?? [], createdAt: raw.createdAt,
    duplicateOfFileName: raw.duplicateOf ? fileNameById.get(raw.duplicateOf) ?? null : null,
  };
  return { ...withoutStage, stage: deriveStage(withoutStage) };
}

export const documents = {
  /** Fetches a context's document list from the real, tenant-scoped backend route and
   *  normalizes every row. `contextId` is now REQUIRED (Phase 6 §5.4) — every document
   *  belongs to exactly one context, and the backend has no unscoped list route anymore. */
  async list(contextId: string): Promise<{ documents: DocumentRecord[] }> {
    const { documents: raw } = await request<{ documents: RawDocument[] }>(
      `/contexts/${contextId}/documents?limit=${LIST_LIMIT}`,
    );
    const fileNameById = new Map(raw.map((d) => [d._id, d.fileName] as const));
    const normalized = raw.map((d) => normalize(d, fileNameById));
    return { documents: normalized };
  },

  upload(file: File, contextId: string): Promise<IngestionResponse> {
    const formData = new FormData();
    formData.append('document', file);
    return request<IngestionResponse>(`/contexts/${contextId}/documents`, { method: 'POST', body: formData });
  },

  status: (documentId: string) =>
    request<DocumentStatusResponse>(`/documents/${documentId}/status`),

  reingest: (documentId: string) =>
    request<ReindexResponse>(`/documents/${documentId}/reingest`, { method: 'POST' }),

  remove: (documentId: string) =>
    request<DeleteDocumentResponse>(`/documents/${documentId}`, { method: 'DELETE' }),

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
