// phase_4 wires the UI against this contract; Phase 7 implements the backend routes it
// calls. `contextId` omitted entirely (not a sentinel string) selects "All contexts" —
// phase_4 §2.3, task 4.3a.
import { request } from '../client';
import type { TraceSummary, TraceDetail } from '../contracts';

export type TraceTimeWindow = '1h' | '24h' | '7d' | 'all';

export interface ListTracesParams {
  contextId?: string;
  window?: TraceTimeWindow;
}

export const traces = {
  list: (params: ListTracesParams = {}) => {
    const qs = new URLSearchParams();
    if (params.contextId) qs.set('contextId', params.contextId);
    if (params.window) qs.set('window', params.window);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{ traces: TraceSummary[] }>(`/traces${suffix}`);
  },
  get: (id: string) => request<TraceDetail>(`/traces/${id}`),
};
