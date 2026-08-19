// [stub] Phase 4 wires the UI and the backend routes this calls.
import { request } from '../client';
import type { QueueStats, PipelineErrorRecord } from '../contracts';

export const admin = {
  queueStats: () => request<QueueStats>('/admin/queue'),
  pipelineErrors: () => request<{ errors: PipelineErrorRecord[] }>('/admin/errors'),
};
