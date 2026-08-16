// Standalone verification script (this repo's test/ convention — see AGENTS.md, no
// unified test framework). Ingests the phase 3 §9.1 fixture corpus into a dedicated
// Qdrant collection, isolated from the live `cerebro_chunks` collection any real user
// document lives in.
//
// REQUIRES a running Qdrant (docker compose up) and live Cohere credentials — it calls
// the real embed API, same as `npm run test:ingestion`.
//
// Isolation is env-driven, not code-driven: `npm run test:corpus:setup` sets
// QDRANT_CHUNKS_COLLECTION=cerebro_chunks_test before this process starts, so
// config/index.js (and every provider built on it) picks up the test collection with
// zero special-casing in vectorStore.js. Run directly rather than via npm, set the same
// var yourself: `QDRANT_CHUNKS_COLLECTION=cerebro_chunks_test node test/retrieval/setup-corpus.js`.
import path from 'path';
import { fileURLToPath } from 'url';
import * as vectorStore from '../../src/providers/vectorStore.js';
import * as embeddings from '../../src/providers/embeddings.js';
import * as parser from '../../src/providers/parser.js';
import { chunkPages } from '../../src/ingestion/chunker.js';
import { config } from '../../src/config/index.js';

const CORPUS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'corpus');

// Deterministic fixture ids — queries.json and the regression/floor/scoping suites
// reference these directly, so the eval is reproducible across re-runs. `contentHash`
// reuses the documentId: nothing here goes through the real dedup path, so a real sha256
// would only add noise.
export const FIXTURES = [
  { documentId: 'fixture-report', fileName: 'report.pdf', mimeType: 'application/pdf', ext: '.pdf' },
  { documentId: 'fixture-catalog', fileName: 'catalog.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx' },
  { documentId: 'fixture-spec', fileName: 'spec.md', mimeType: 'text/markdown', ext: '.md' },
  { documentId: 'fixture-invoices', fileName: 'invoices.txt', mimeType: 'text/plain', ext: '.txt' },
];

// Mirrors ingestDocument.js's own steps 1-3 (parse -> chunk -> embed -> upsert) called
// directly as pure functions rather than through the BullMQ job/Document registry — this
// script populates Qdrant only, with no Mongo row and no HTTP round trip, matching what a
// fixed evaluation corpus actually needs.
async function ingestFixture(fx) {
  const storagePath = path.join(CORPUS_DIR, fx.fileName);
  const pages = await parser.parseDocument(storagePath, fx.ext);
  const chunks = await chunkPages(pages, {
    documentId: fx.documentId, fileName: fx.fileName, mimeType: fx.mimeType, contentHash: fx.documentId,
  });
  const texts = chunks.map((c) => (c.headingPath ? `${c.headingPath}\n\n${c.text}` : c.text));
  const [{ vectors: dense }, sparse] = await Promise.all([
    embeddings.encodeDocuments(texts),
    embeddings.encodeSparse(texts),
  ]);
  await vectorStore.upsertChunks(chunks, dense, sparse);
  return chunks.length;
}

async function main() {
  if (config.qdrant.chunksCollection === 'cerebro_chunks') {
    throw new Error(
      'QDRANT_CHUNKS_COLLECTION resolves to the live "cerebro_chunks" collection. Refusing to ' +
      'write fixture data into it — run via `npm run test:corpus:setup` or set ' +
      'QDRANT_CHUNKS_COLLECTION=cerebro_chunks_test yourself.',
    );
  }

  await vectorStore.ensureCollections();

  let total = 0;
  for (const fx of FIXTURES) {
    await vectorStore.deleteByDocument(fx.documentId);   // idempotent re-run
    const count = await ingestFixture(fx);
    total += count;
    console.log(`[setup-corpus] ${fx.fileName} -> ${count} chunk(s)`);
  }
  console.log(`[setup-corpus] DONE — ${FIXTURES.length} fixtures, ${total} point(s) total in "${config.qdrant.chunksCollection}"`);
}

await main();
