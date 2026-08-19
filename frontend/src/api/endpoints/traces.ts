// [stub] Phase 4 wires the UI and the backend routes this calls.
import { request } from '../client';
import type { TraceSummary, TraceDetail } from '../contracts';

export const traces = {
  list: () => request<{ traces: TraceSummary[] }>('/traces'),
  get: (id: string) => request<TraceDetail>(`/traces/${id}`),
};
