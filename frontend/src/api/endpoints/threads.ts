import { request } from '../client';

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
  /** `contextId`, when passed, narrows to that context's threads — server-side now
   *  (phase_6 §5.4): GET /api/threads accepts it as an optional query filter. Omitting it
   *  returns every thread the signed-in user owns. */
  async list(contextId?: string): Promise<{ threads: ThreadSummary[] }> {
    const qs = contextId ? `?contextId=${encodeURIComponent(contextId)}` : '';
    return request<{ threads: ThreadSummary[] }>(`/threads${qs}`);
  },

  get: (id: string) =>
    request<ThreadSummary & { messages: ThreadMessage[] }>(`/threads/${id}`),

  rename: (id: string, title: string) =>
    request<{ title: string }>(`/threads/${id}`, { method: 'PATCH', json: { title } }),

  async delete(id: string): Promise<void> {
    await request<void>(`/threads/${id}`, { method: 'DELETE' });
  },
};
