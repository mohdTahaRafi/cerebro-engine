import axios from 'axios';
import { config } from '../config/index.js';
import { wrap } from './breaker.js';

// The LlamaParse SDK (@llamaindex/cloud) is not installed until Phase 2 — Phase 1's
// ping needs only a raw authenticated GET, so it goes straight through axios (already
// a dependency) rather than pulling in the SDK a phase early.
const BASE_URL = 'https://api.cloud.llamaindex.ai';

async function requestRaw(reqPath, options = {}) {
  const res = await axios.request({
    baseURL: BASE_URL,
    url: reqPath,
    headers: { Authorization: `Bearer ${config.llamaParse.apiKey}` },
    ...options,
  });
  return res.data;
}

// architecture §6.1: a 100-page PDF takes 60-120s and this runs inside a BullMQ
// worker, not a request — the long timeout matches the Phase 2 parse call, not
// Phase 1's lightweight ping.
const llamaParseBreaker = wrap('llamaparse', (reqPath, options) => requestRaw(reqPath, options), { timeout: 180_000 });

// Phase 1 only implements ping() (account reachability via GET /api/v1/projects,
// the lightest authenticated endpoint LlamaCloud exposes). parseDocument() lands
// in Phase 2 — see architecture §6.
export async function ping() {
  await llamaParseBreaker.fire('/api/v1/projects', { method: 'GET' });
}
