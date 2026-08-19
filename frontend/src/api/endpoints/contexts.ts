// [stub] Phase 2 wires the UI and the backend routes this calls. Declared now so the
// contract exists; every function throws EndpointUnavailableError against the real
// backend until Phase 2/5 land, and returns fixtures once Phase 2 adds this module to
// MOCKED_ENDPOINTS.
import { request } from '../client';
import type { KnowledgeContext, CreateContextRequest } from '../contracts';

export const contexts = {
  list: () => request<{ contexts: KnowledgeContext[] }>('/contexts'),
  get: (id: string) => request<KnowledgeContext>(`/contexts/${id}`),
  create: (body: CreateContextRequest) => request<KnowledgeContext>('/contexts', { method: 'POST', json: body }),
  update: (id: string, body: CreateContextRequest) =>
    request<KnowledgeContext>(`/contexts/${id}`, { method: 'PATCH', json: body }),
  delete: (id: string) => request<void>(`/contexts/${id}`, { method: 'DELETE' }),
};
