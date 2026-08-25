// phase_2 §5.4 — list-level polling: one request for the whole page, not one per row,
// running at 1.5s only while at least one row is non-terminal, stopped entirely once every
// row settles, and paused while the tab is hidden (firing one immediate poll on return).
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { DocumentRecord } from '../../api/contracts';

const POLL_INTERVAL_MS = 1500;

export function isTerminal(doc: Pick<DocumentRecord, 'status'>): boolean {
  return doc.status === 'ready' || doc.status === 'failed' || doc.status === 'duplicate';
}

export type DocumentsStatus = 'loading' | 'ready' | 'error';

export function useDocuments(contextId: string) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [status, setStatus] = useState<DocumentsStatus>('loading');
  const documentsRef = useRef<DocumentRecord[]>([]);
  documentsRef.current = documents;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const pollingRef = useRef(false); // true while the recurring tick() chain is alive

  const load = useCallback(async () => {
    // phase_3_chat_ui.md §7.1 — Composer/Chat call this hook before an active context is
    // necessarily known yet (or with none at all, §7.3's "no contexts" state). Unlike
    // ContextDetail's route-supplied id, this caller can legitimately have an empty one;
    // fetching the whole unfiltered document pool for it would be both wrong and wasteful.
    if (!contextId) {
      setDocuments([]);
      setStatus('ready');
      return [];
    }
    try {
      const { documents: list } = await api.documents.list(contextId);
      setDocuments(list);
      setStatus('ready');
      return list;
    } catch {
      setStatus('error');
      return [];
    }
  }, [contextId]);

  // Starts the recurring poll chain if it isn't already running. Called on mount and again
  // from refresh() below — a caller outside this hook (useUploadQueue's onUploaded, right
  // after a fresh upload lands) can hand this hook a newly non-terminal row after the chain
  // already stopped itself. That happens on every context that had zero documents (an empty
  // list is vacuously "every row terminal") when this hook first mounted: tick() fires once,
  // sees nothing to poll, and never schedules a second tick — so the first real upload into
  // a brand-new context landed in `documents` via refresh()'s one-off fetch and then just sat
  // there at 'queued' forever, since nothing was left running to notice it turn 'ready'.
  const ensurePolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = true;

    async function tick() {
      const list = await load();
      if (cancelledRef.current) { pollingRef.current = false; return; }
      if (list.every(isTerminal)) { pollingRef.current = false; return; } // settled — stop entirely
      if (document.visibilityState === 'hidden') { pollingRef.current = false; return; } // resumes on visibilitychange
      timerRef.current = setTimeout(tick, POLL_INTERVAL_MS);
    }
    tick();
  }, [load]);

  useEffect(() => {
    cancelledRef.current = false;
    ensurePolling();

    function onVisibility() {
      if (document.visibilityState !== 'visible') return;
      if (documentsRef.current.length > 0 && documentsRef.current.every(isTerminal)) return;
      if (pollingRef.current) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      ensurePolling();
    }
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelledRef.current = true;
      pollingRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [contextId, ensurePolling]);

  const refresh = useCallback(async () => {
    const list = await load();
    if (list.some((d) => !isTerminal(d))) ensurePolling();
    return list;
  }, [load, ensurePolling]);

  return { documents, status, refresh };
}
