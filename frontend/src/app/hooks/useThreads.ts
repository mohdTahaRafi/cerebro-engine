import { useCallback, useState } from 'react';
import { api } from '../../api';
import type { ThreadMessage, ThreadSummary } from '../../api/endpoints/threads';

export type { ThreadSummary, ThreadSource, ThreadMessage } from '../../api/endpoints/threads';

// Module-level, not component state: Sidebar.tsx's `useThreads()` instance is torn down
// and recreated whenever Sidebar remounts, which happens on navigation to/from
// /admin/health (RequireAdmin's guard deliberately sits outside AppShell — see
// routes.tsx and ContextScopeContext.tsx's matching cache for the full reasoning).
// Keyed by contextId (the same scope `fetchThreads` is called with) because the one
// piece of "recent chats" data that legitimately differs across that boundary is which
// context it's filtered to. `force` (below) is how a genuine data change — a turn just
// finished, a rename, a delete — always bypasses this and fetches for real; a passive
// remount into the same scope never does.
let threadsCache: { key: string | undefined; threads: ThreadSummary[] } | null = null;

/** Called on sign-out (AuthContext). The cache outlives AppShell by design, so without
 *  this the next sign-in in the same tab — possibly a different account — starts from the
 *  previous session's thread list instead of fetching its own. */
export function resetThreadsCache() {
  threadsCache = null;
}

// GET/PATCH/DELETE /api/threads, now routed through src/api/ (phase_1 §8 — no behavior
// change; this hook still owns no polling/caching layer beyond plain state).
export function useThreads() {
  const [threads, setThreads] = useState<ThreadSummary[]>(() => threadsCache?.threads ?? []);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchThreads = useCallback(async (contextId?: string, opts?: { force?: boolean }) => {
    if (!opts?.force && threadsCache && threadsCache.key === contextId) {
      setThreads(threadsCache.threads);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const { threads: list } = await api.threads.list(contextId);
      threadsCache = { key: contextId, threads: list };
      setThreads(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load threads');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchThread = useCallback(async (id: string): Promise<{ thread: ThreadSummary; messages: ThreadMessage[] }> => {
    const { messages, ...thread } = await api.threads.get(id);
    return { thread, messages };
  }, []);

  const renameThread = useCallback(async (id: string, title: string) => {
    const { title: newTitle } = await api.threads.rename(id, title);
    setThreads((prev) => {
      const next = prev.map((t) => (t._id === id ? { ...t, title: newTitle } : t));
      if (threadsCache) threadsCache = { ...threadsCache, threads: next };
      return next;
    });
  }, []);

  const deleteThread = useCallback(async (id: string) => {
    await api.threads.delete(id);
    setThreads((prev) => {
      const next = prev.filter((t) => t._id !== id);
      if (threadsCache) threadsCache = { ...threadsCache, threads: next };
      return next;
    });
  }, []);

  return { threads, isLoading, error, fetchThreads, fetchThread, renameThread, deleteThread };
}
