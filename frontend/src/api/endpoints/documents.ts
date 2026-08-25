// Consolidates the two independent poll loops that used to live in EngineContext
// (pollDocumentStatus) and IngestionZone (an inline `while (true)`) — phase_1 §8.
// The 1500ms interval and 5-minute timeout are unchanged from both originals.
//
// phase_2 §7.4 — every real backend call here still hits the real `/api/documents` routes
// (upload, status, reingest, delete all genuinely exist and genuinely do the work). What's
// interim is the shape: the backend's `Document` model has no `contextId` or `stage` field
// yet (that's Phase 6/7), so `normalize()` attaches both client-side before anything else
// in the app sees a `DocumentRecord` — `contextId` from the PHASE-6-REMOVE map in
// mock/fixtures/docContexts.ts, `stage` from stage.ts's derivation (deleted in Phase 7).
import { request } from '../client';
import type { DocumentRecord, DocumentStatus } from '../contracts';
import { deriveStage } from '../../app/components/documents/stage';
import * as docContexts from '../mock/fixtures/docContexts';

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
 *  neither `contextId` nor `stage` (phase_2 §7.4, §5.2). `duplicateOf` is the raw ObjectId
 *  ref (or null); the list route doesn't populate it to a filename, so `normalize` below
 *  resolves it against the rest of the same batch instead. */
interface RawDocument {
  _id: string; fileName: string; mimeType: string; sizeBytes: number;
  status: DocumentStatus; progress: number; error: string | null;
  chunkCount: number; pageCount: number; textPageCount: number; visualPageCount: number;
  warnings: string[]; createdAt: string; duplicateOf: string | null;
}

function normalize(raw: RawDocument, fileNameById: Map<string, string>): DocumentRecord {
  const contextId = docContexts.contextIdFor(raw._id) ?? '';   // PHASE-6-REMOVE
  const withoutStage = {
    id: raw._id, contextId,
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
  /** Fetches the full document list from the real backend and normalizes every row.
   *  `contextId`, when passed, narrows to that context's rows — PHASE-6-REMOVE, purely
   *  client-side, since the backend has no contextId column to filter on (§7.4). Omitting
   *  it (used by /contexts' aggregate counts) returns every document in the pool. */
  async list(contextId?: string): Promise<{ documents: DocumentRecord[] }> {
    const { documents: raw } = await request<{ documents: RawDocument[] }>(`/documents?limit=${LIST_LIMIT}`);
    const fileNameById = new Map(raw.map((d) => [d._id, d.fileName] as const));
    const normalized = raw.map((d) => normalize(d, fileNameById));
    return { documents: contextId ? normalized.filter((d) => d.contextId === contextId) : normalized };
  },

  upload(file: File, contextId?: string): Promise<IngestionResponse> {
    const formData = new FormData();
    formData.append('document', file);
    return request<IngestionResponse>('/documents', { method: 'POST', body: formData })
      .then((res) => {
        // PHASE-6-REMOVE — records which context this upload belongs to, client-side only.
        // As of Phase 3, every real caller (Composer's attach button and /chat's page-wide
        // GlobalDropzone alike, both routed through useUploadQueue) passes the active
        // context's id; `contextId` is optional only so a hypothetical unscoped caller
        // doesn't crash — such an upload would carry no context assignment.
        if (contextId) docContexts.assign(res.documentId, contextId);
        return res;
      });
  },

  status: (documentId: string) =>
    request<DocumentStatusResponse>(`/documents/${documentId}/status`),

  reingest: (documentId: string) =>
    request<ReindexResponse>(`/documents/${documentId}/reingest`, { method: 'POST' }),

  async remove(documentId: string): Promise<DeleteDocumentResponse> {
    const res = await request<DeleteDocumentResponse>(`/documents/${documentId}`, { method: 'DELETE' });
    docContexts.unassign(documentId);   // PHASE-6-REMOVE
    return res;
  },

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
