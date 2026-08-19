import { request } from '../client';
import type { HealthResponse } from '../contracts';

export const health = {
  get: () => request<HealthResponse>('/health'),
};
