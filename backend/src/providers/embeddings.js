import { CohereClient } from 'cohere-ai';
import { config } from '../config/index.js';
import { wrap } from './breaker.js';

let _client = null;

function client() {
  if (_client) return _client;
  _client = new CohereClient({ token: config.cohere.apiKey });
  return _client;
}

// architecture §6.1: a 96-text batch returns in ~800ms p95; 10s is >10x headroom
// without holding a worker.
export const embedBreaker = wrap('cohere.embed', (req) => client().embed(req), { timeout: 10_000 });

// Phase 1 only implements ping(). encodeDocuments() lands in Phase 2,
// encodeQuery() in Phase 3 — see architecture §6 adapter table.
export async function ping() {
  await embedBreaker.fire({
    model: config.cohere.embedModel,
    texts: ['ping'],
    inputType: 'search_document',
    embeddingTypes: ['float'],
  });
}
