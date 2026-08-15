import { CohereClient } from 'cohere-ai';
import { config } from '../config/index.js';
import { wrap } from './breaker.js';

let _client = null;

function client() {
  if (_client) return _client;
  _client = new CohereClient({ token: config.cohere.apiKey });
  return _client;
}

// architecture §6.1: 50 short documents return in ~250ms p95; this stage is
// inside the interactive query budget.
export const rerankBreaker = wrap('cohere.rerank', (req) => client().rerank(req), { timeout: 5_000 });

// Phase 1 only implements ping(). rerank() lands in Phase 3 — see architecture §6.
export async function ping() {
  await rerankBreaker.fire({
    model: config.cohere.rerankModel,
    query: 'ping',
    documents: ['pong', 'unrelated'],
    topN: 1,
  });
}
