// phase_2 §3, §8 task 2.1/2.2 — list + create/rename/delete, with the §3.5 2s "deleting"
// poll: only runs while at least one context is in that state, and stops the moment none
// are — a settled list generates zero traffic, the same rule §5.4 applies to documents.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../api';
import { useContextScope } from '../context/ContextScopeContext';
import type { KnowledgeContext, CreateContextRequest } from '../../api/contracts';

const DELETE_POLL_INTERVAL_MS = 2000;

export type ContextsStatus = 'loading' | 'ready' | 'error';

export function useContexts() {
  const [contexts, setContexts] = useState<KnowledgeContext[]>([]);
  const [status, setStatus] = useState<ContextsStatus>('loading');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // This hook keeps its own list for the /contexts page (search/sort/grid layout), which
  // is a different copy of the same data from ContextScopeProvider's (mounted at AppShell,
  // backing the Chat switcher and every other context-aware screen). Bug #1: creating a
  // context here updated only this local copy, so the new context stayed invisible in Chat
  // until a full reload re-ran ContextScopeProvider's own initial fetch. Every mutation
  // below therefore also invalidates the shared scope so it re-fetches immediately.
  const { refresh: refreshScope } = useContextScope();

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
    refreshScope();
    return created;
  }, [refreshScope]);

  const update = useCallback(async (id: string, body: CreateContextRequest) => {
    const updated = await api.contexts.update(id, body);
    setContexts((prev) => prev.map((c) => (c.id === id ? updated : c)));
    refreshScope();
    return updated;
  }, [refreshScope]);

  // Optimistic: the card must grey and go unclickable the instant the dialog submits
  // (§3.5), not after the 150ms mock round-trip.
  const remove = useCallback(async (id: string) => {
    setContexts((prev) => prev.map((c) => (c.id === id ? { ...c, status: 'deleting' } : c)));
    await api.contexts.delete(id);
    refreshScope();
  }, [refreshScope]);

  return { contexts, status, refresh: load, create, update, remove };
}
