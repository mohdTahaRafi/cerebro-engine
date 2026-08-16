import { CohereClient } from 'cohere-ai';
import { config } from '../config/index.js';
import { wrap } from './breaker.js';
import { encodeSparse as bm25EncodeSparse } from './bm25.js';

let _client = null;

function client() {
  if (_client) return _client;
  _client = new CohereClient({ token: config.cohere.apiKey });
  return _client;
}

// architecture §6.1: a 96-text batch returns in ~800ms p95; 10s is >10x headroom
// without holding a worker.
export const embedBreaker = wrap('cohere.embed', (req) => client().embed(req), { timeout: 10_000 });

export async function ping() {
  await embedBreaker.fire({
    model: config.cohere.embedModel,
    texts: ['ping'],
    inputType: 'search_document',
    embeddingTypes: ['float'],
  });
}

// ── Phase 2: real embedding ──────────────────────────────────────────────────

const BATCH_SIZE = 96;   // Cohere's per-request texts cap for embed v3

// inputType: 'search_document' here vs 'search_query' at query time (Phase 3) is the
// asymmetry the old MiniLM path had no mechanism for — Cohere v3 trains the two input
// types into different regions of the space (architecture §6).
export async function encodeDocuments(texts) {
  const vectors = [];
  let totalTokens = 0;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await embedBreaker.fire({
      model: config.cohere.embedModel,
      texts: batch,
      inputType: 'search_document',
      embeddingTypes: ['float'],
      truncate: 'END',   // belt-and-braces; the chunker already fits the token budget
    });
    vectors.push(...res.embeddings.float);
    totalTokens += res.meta?.billedUnits?.inputTokens ?? 0;
  }
  return { vectors, totalTokens };
}

// BM25 sparse encoding — architecture §5.12, phase 2 §6.2 (local tokenizer, not FastEmbed;
// the npm `fastembed` package has no BM25 model). Re-exported here so ingestDocument.js
// has one `embeddings` module for both dense and sparse, matching the spec's job-handler
// shape even though the sparse implementation lives in its own file.
export const encodeSparse = bm25EncodeSparse;

// ── Phase 3: query embedding ─────────────────────────────────────────────────

// inputType: 'search_query' here vs 'search_document' at ingest time (above) is the
// asymmetry the old MiniLM path had no mechanism for. Cohere v3 trains the two input
// types into different regions of the space, so a short question and the long passage
// answering it land near each other despite little lexical overlap — this is the largest
// single-line quality difference between the old pipeline and the new one (phase 3 §2.1).
export async function encodeQuery(text) {
  const res = await embedBreaker.fire({
    model: config.cohere.embedModel,
    texts: [text],
    inputType: 'search_query',
    embeddingTypes: ['float'],
  });
  return {
    vector: res.embeddings.float[0],
    tokens: res.meta?.billedUnits?.inputTokens ?? 0,
  };
}
