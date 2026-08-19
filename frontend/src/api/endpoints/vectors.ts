// [stub] Phase 4 wires the UI and the backend routes this calls.
import { request } from '../client';
import type { ProjectionResponse, ProjectQueryRequest, ProjectQueryResponse, VectorNodeDetail } from '../contracts';

export const vectors = {
  projection: (contextId: string) => request<ProjectionResponse>(`/vectors/${contextId}/projection`),
  query: (body: ProjectQueryRequest) => request<ProjectQueryResponse>('/vectors/query', { method: 'POST', json: body }),
  node: (pointId: string) => request<VectorNodeDetail>(`/vectors/node/${pointId}`),
};
