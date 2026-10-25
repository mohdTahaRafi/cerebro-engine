import { request } from '../client';
import type { ProjectionResponse, ProjectQueryRequest, ProjectQueryResponse, VectorNodeDetail } from '../contracts';

export const vectors = {
  projection: (contextId: string) => request<ProjectionResponse>(`/vectors/${contextId}/projection`),
  /** The explicit rebuild action. 202 with `{ status: 'fitting' }` — the fit itself runs
   *  on the projection queue, so the caller polls the projection endpoint for the result. */
  rebuild: (contextId: string) =>
    request<{ contextId: string; status: string }>(`/vectors/${contextId}/rebuild`, { method: 'POST' }),
  query: (body: ProjectQueryRequest) => request<ProjectQueryResponse>('/vectors/query', { method: 'POST', json: body }),
  node: (pointId: string) => request<VectorNodeDetail>(`/vectors/node/${pointId}`),
};
