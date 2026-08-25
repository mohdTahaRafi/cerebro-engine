import { request } from '../client';
import * as threadContexts from '../mock/fixtures/threadContexts'; // PHASE-6-REMOVE

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

export const threads = {
  /** `contextId`, when passed, narrows to that context's threads — PHASE-6-REMOVE, purely
   *  client-side against threadContexts.ts, since the backend has no contextId column on
   *  Thread to filter on yet (phase_3_chat_ui.md §7.2). Omitting it returns every thread. */
  async list(contextId?: string): Promise<{ threads: ThreadSummary[] }> {
    const { threads: all } = await request<{ threads: ThreadSummary[] }>('/threads');
    if (!contextId) return { threads: all };
    return { threads: all.filter((t) => threadContexts.contextIdFor(t._id) === contextId) };
  },

  get: (id: string) =>
    request<ThreadSummary & { messages: ThreadMessage[] }>(`/threads/${id}`),

  rename: (id: string, title: string) =>
    request<{ title: string }>(`/threads/${id}`, { method: 'PATCH', json: { title } }),

  async delete(id: string): Promise<void> {
    await request<void>(`/threads/${id}`, { method: 'DELETE' });
    threadContexts.unassign(id); // PHASE-6-REMOVE
  },
};
