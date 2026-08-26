// Phase 6 §5.4, §9: Context CRUD now hits the real backend
// (backend/src/models/Context.js, backend/src/api/routes/contexts.js) — the
// localStorage-backed mock adapter (mock/fixtures/contexts.ts, phase_2 §1.1) is gone.
// `documentCount`/`chunkCount` are real, server-maintained counters
// (backend/src/contexts/counters.js) now, not computed client-side from the document
// list — a context card no longer needs a second request just to render its numbers.
import { request } from '../client';
import type { KnowledgeContext, CreateContextRequest } from '../contracts';

interface RawContext {
  _id: string; title: string; description: string | null;
  documentCount: number; chunkCount: number;
  status: 'active' | 'deleting';
  createdAt: string; updatedAt: string;
}

function normalize(raw: RawContext): KnowledgeContext {
  return {
    id: raw._id, title: raw.title, description: raw.description,
    documentCount: raw.documentCount, chunkCount: raw.chunkCount,
    status: raw.status, createdAt: raw.createdAt, updatedAt: raw.updatedAt,
  };
}

export const contexts = {
  async list(): Promise<{ contexts: KnowledgeContext[] }> {
    const { contexts: raw } = await request<{ contexts: RawContext[] }>('/contexts');
    return { contexts: raw.map(normalize) };
  },

  async get(id: string): Promise<KnowledgeContext> {
    const raw = await request<RawContext>(`/contexts/${id}`);
    return normalize(raw);
  },

  async create(body: CreateContextRequest): Promise<KnowledgeContext> {
    const raw = await request<RawContext>('/contexts', { method: 'POST', json: body });
    return normalize(raw);
  },

  async update(id: string, body: CreateContextRequest): Promise<KnowledgeContext> {
    const raw = await request<RawContext>(`/contexts/${id}`, { method: 'PATCH', json: body });
    return normalize(raw);
  },

  /** Returns as soon as the context is marked `deleting` (backend returns 202) — the
   *  caller (DeleteContextDialog) needs nothing more than that to close and let the
   *  list's own 2s poll (phase_2 §3.5) take over. The cascade itself runs server-side,
   *  on its own BullMQ queue (backend/src/contexts/queue.js), not in this request. */
  async delete(id: string): Promise<void> {
    await request<{ contextId: string; status: 'deleting' }>(`/contexts/${id}`, { method: 'DELETE' });
  },
};
