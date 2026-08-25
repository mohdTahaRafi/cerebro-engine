// phase_2 §6 — pre-flight validation, an optimistic-row queue at concurrency 3, and one
// summary toast per batch fired once every document in it reaches a terminal state (not
// merely once the upload requests finish — §6.1 step 5 and the milestone's own ordering:
// the toast appears only after the scanned PDF and the corrupt file have both settled).
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api, CerebroApiError } from '../../api';
import type { DocumentRecord } from '../../api/contracts';
import { isTerminal } from './useDocuments';

// Mirrors backend/src/api/middleware/upload.js's real ACCEPTED map and 50 MB cap —
// client pre-flight has to match what the server will actually accept.
const ACCEPTED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.xlsx', '.xls', '.json']);
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

// §6.1 — three concurrent uploads: headroom under the browser's 6-connection-per-origin
// budget alongside the status poll, and under the backend's own 10/hour upload rate limit
// and single 50MB multipart body at a time.
const CONCURRENCY = 3;

export interface OptimisticRow {
  key: string;
  fileName: string;
  sizeBytes: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/** Returns the toast copy for a rejected file, or null if it passes. Client-authored text
 *  — there is no server response to render verbatim for a request that never left the
 *  browser (§6.2's two client-side rows). */
function preflightReject(file: File): string | null {
  const dot = file.name.lastIndexOf('.');
  const ext = dot === -1 ? '' : file.name.slice(dot).toLowerCase();
  if (!ACCEPTED_EXTENSIONS.has(ext)) {
    return `${file.name} isn't a supported type. Cerebro reads PDF, DOCX, TXT, MD, CSV, XLSX, and JSON.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is ${formatBytes(file.size)}. The limit is 50 MB.`;
  }
  return null;
}

interface PendingBatch {
  pendingDocIds: Set<string>;
  uploadFailures: number;
  total: number;
}

export function useUploadQueue(
  contextId: string,
  documents: DocumentRecord[],
  onUploaded: () => void,
) {
  const [optimisticRows, setOptimisticRows] = useState<OptimisticRow[]>([]);
  const batchRef = useRef<PendingBatch | null>(null);
  // phase_3_chat_ui.md §7.1 — a reactive mirror of batchRef.current.pendingDocIds, so a
  // caller outside this hook (the Composer, gating "send" on ingestion finishing) can react
  // to a document actually settling. batchRef alone doesn't trigger a re-render on its own
  // mutation; every place that adds to or clears batchRef.pendingDocIds updates this too.
  const [pendingDocIds, setPendingDocIds] = useState<string[]>([]);

  // Watches the live (polled) document list for the current batch's outstanding ids
  // reaching a terminal state, then fires exactly one summary toast.
  useEffect(() => {
    const batch = batchRef.current;
    if (!batch || batch.pendingDocIds.size === 0) return;
    const byId = new Map(documents.map((d) => [d.id, d] as const));
    let stillPending = false;
    let readyCount = 0;
    let failedCount = 0;
    for (const id of batch.pendingDocIds) {
      const doc = byId.get(id);
      if (!doc || !isTerminal(doc)) { stillPending = true; continue; }
      if (doc.status === 'failed') failedCount += 1; else readyCount += 1;
    }
    if (stillPending) return;
    setPendingDocIds([]);
    const totalFailed = failedCount + batch.uploadFailures;
    const totalReady = batch.total - totalFailed;
    if (totalFailed === 0) {
      toast.success(`${totalReady} document${totalReady === 1 ? '' : 's'} ready.`);
    } else {
      // DESIGN.md §5.15 — a batch with any failure in it never auto-dismisses; the user
      // shouldn't have to catch a failed upload in a 4-second window.
      toast.error(`${totalReady} document${totalReady === 1 ? '' : 's'} ready. ${totalFailed} failed.`, { duration: Infinity });
    }
    batchRef.current = null;
  }, [documents]);

  const enqueue = useCallback((files: File[]) => {
    const accepted: File[] = [];
    for (const file of files) {
      const reason = preflightReject(file);
      if (reason) { toast.error(reason, { duration: Infinity }); continue; }
      accepted.push(file);
    }
    if (accepted.length === 0) return;

    const batchRows: OptimisticRow[] = accepted.map((f) => ({
      key: `${f.name}-${f.size}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      fileName: f.name, sizeBytes: f.size,
    }));
    setOptimisticRows((prev) => [...batchRows, ...prev]);

    // A second drop while an earlier batch is still indexing extends the same pending
    // batch rather than starting a fresh one, so the first batch's toast is never lost.
    if (!batchRef.current) batchRef.current = { pendingDocIds: new Set(), uploadFailures: 0, total: 0 };
    batchRef.current.total += accepted.length;

    const queue = accepted.map((file, i) => ({ file, row: batchRows[i] }));
    const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item; item = queue.shift()) {
        try {
          // A 'duplicate' response is still its own real Document row (documents.js
          // creates one with status:'duplicate') — it goes in the poll-tracked set too.
          const res = await api.documents.upload(item.file, contextId);
          batchRef.current?.pendingDocIds.add(res.documentId);
          setPendingDocIds((prev) => [...prev, res.documentId]);
          onUploaded();
        } catch (err) {
          if (batchRef.current) batchRef.current.uploadFailures += 1;
          const message = err instanceof CerebroApiError ? err.message : 'Upload failed.';
          toast.error(`${item.file.name} failed to upload`, { description: message, duration: Infinity });
        } finally {
          setOptimisticRows((prev) => prev.filter((r) => r.key !== item!.row.key));
        }
      }
    });
    void Promise.all(workers);
  }, [contextId, onUploaded]);

  // isSettling: true while anything from this queue is still uploading OR still ingesting
  // — the composer's attachment-queueing gate (§7.1) waits on this, not just on the upload
  // request settling, since retrieval against a still-embedding document finds nothing.
  const isSettling = optimisticRows.length > 0 || pendingDocIds.length > 0;

  return { optimisticRows, enqueue, pendingDocIds, isSettling };
}
