// phase_2 §3, §8 task 2.1/2.2 — list + create/rename/delete, with the §3.5 2s "deleting"
// poll: only runs while at least one context is in that state, and stops the moment none
// are — a settled list generates zero traffic, the same rule §5.4 applies to documents.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import type { KnowledgeContext, CreateContextRequest } from '../../api/contracts';

const DELETE_POLL_INTERVAL_MS = 2000;

export type ContextsStatus = 'loading' | 'ready' | 'error';

export function useContexts() {
  const [contexts, setContexts] = useState<KnowledgeContext[]>([]);
  const [status, setStatus] = useState<ContextsStatus>('loading');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const { contexts: list } = await api.contexts.list();
      setContexts(list);
      setStatus('ready');
      return list;
    } catch {
      setStatus('error');
      return [];
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const hasDeleting = contexts.some((c) => c.status === 'deleting');
    if (!hasDeleting) return undefined;
    timerRef.current = setTimeout(load, DELETE_POLL_INTERVAL_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [contexts, load]);

  const create = useCallback(async (body: CreateContextRequest) => {
    const created = await api.contexts.create(body);
    setContexts((prev) => [created, ...prev]);
    return created;
  }, []);

  const update = useCallback(async (id: string, body: CreateContextRequest) => {
    const updated = await api.contexts.update(id, body);
    setContexts((prev) => prev.map((c) => (c.id === id ? updated : c)));
    return updated;
  }, []);

  // Optimistic: the card must grey and go unclickable the instant the dialog submits
  // (§3.5), not after the 150ms mock round-trip.
  const remove = useCallback(async (id: string) => {
    setContexts((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'deleting' } : c)));
    await api.contexts.delete(id);
  }, []);

  return { contexts, status, refresh: load, create, update, remove };
}
