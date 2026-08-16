import { useCallback, useState } from 'react';

export interface ThreadSummary {
  _id: string;
  title: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface ThreadSource {
  kind: 'chunk' | 'page';
  pointId: string;
  documentId: string;
  page: number | null;
  score: number;
  available: boolean;        // false when the cited document was later deleted (phase 5 §10.2)
  fileName: string | null;   // resolved from today's Document, not stored on the message itself
  imageUri: string | null;   // reconstructed for a page citation whose document is still live
}

export interface ThreadMessage {
  _id: string;
  role: 'user' | 'assistant';
  content: string;
  condensedQuery: string | null;
  sources: ThreadSource[];
  createdAt: string;
}

// GET/PATCH/DELETE /api/threads (phase 5 §10.1, §11 point "A useThreads.ts hook and a
// thread sidebar are added for FR-CONV-04"). Deliberately owns no polling/caching layer
// beyond plain state — the sidebar's list is small and refetched on the actions that
// change it (send, rename, delete), matching how useCerebroSearch/useCerebroChat already
// treat their own state in this codebase.
export function useThreads() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchThreads = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/threads');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load threads');
      setThreads(data.threads);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchThread = useCallback(async (id: string): Promise<{ thread: ThreadSummary; messages: ThreadMessage[] }> => {
    const res = await fetch(`/api/threads/${id}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load thread');
    const { messages, ...thread } = data;
    return { thread, messages };
  }, []);

  const renameThread = useCallback(async (id: string, title: string) => {
    const res = await fetch(`/api/threads/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to rename thread');
    setThreads((prev) => prev.map((t) => (t._id === id ? { ...t, title: data.title } : t)));
  }, []);

  const deleteThread = useCallback(async (id: string) => {
    const res = await fetch(`/api/threads/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete thread');
    setThreads((prev) => prev.filter((t) => t._id !== id));
  }, []);

  return { threads, isLoading, error, fetchThreads, fetchThread, renameThread, deleteThread };
}
