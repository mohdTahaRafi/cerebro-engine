import { useCallback, useState } from 'react';
import { api } from '../../api';
import type { ThreadMessage, ThreadSummary } from '../../api/endpoints/threads';

export type { ThreadSummary, ThreadSource, ThreadMessage } from '../../api/endpoints/threads';

// GET/PATCH/DELETE /api/threads, now routed through src/api/ (phase_1 §8 — no behavior
// change; this hook still owns no polling/caching layer beyond plain state).
export function useThreads() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchThreads = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { threads: list } = await api.threads.list();
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
    setThreads((prev) => prev.map((t) => (t._id === id ? { ...t, title: newTitle } : t)));
  }, []);

  const deleteThread = useCallback(async (id: string) => {
    await api.threads.delete(id);
    setThreads((prev) => prev.filter((t) => t._id !== id));
  }, []);

  return { threads, isLoading, error, fetchThreads, fetchThread, renameThread, deleteThread };
}
