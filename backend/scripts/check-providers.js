// CLI: ping every provider adapter (architecture §6's 7-adapter table) and print an
// up/down table. Exercises the exact same ping() functions /health calls, so this is
// useful standalone when the server isn't running yet (e.g. right after filling in
// .env, before `npm run dev`).
import fs from 'fs/promises';
import * as vectorStore from '../src/providers/vectorStore.js';
import * as embeddings from '../src/providers/embeddings.js';
import * as reranker from '../src/providers/reranker.js';
import * as llm from '../src/providers/llm.js';
import * as parser from '../src/providers/parser.js';
import * as visionService from '../src/providers/visionService.js';
import { config } from '../src/config/index.js';

const PROVIDERS = {
  vectorStore:   () => vectorStore.ping(),
  embeddings:    () => embeddings.ping(),
  reranker:      () => reranker.ping(),
  llm:           () => llm.ping(),
  parser:        () => parser.ping(),
  visionService: () => visionService.health(),
  // storage.js has no network ping (filesystem driver) — a directory-access check
  // is the equivalent readiness signal.
  storage:       () => fs.mkdir(config.storage.pagesDir, { recursive: true }),
};

async function check(name, fn) {
  const start = performance.now();
  try {
    await fn();
    return { name, status: 'up', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { name, status: 'down', latencyMs: Math.round(performance.now() - start), error: err.message };
  }
}

const results = await Promise.all(Object.entries(PROVIDERS).map(([n, f]) => check(n, f)));

let anyDown = false;
for (const r of results) {
  const label = r.status === 'up' ? 'UP  ' : 'DOWN';
  const detail = r.status === 'up' ? `${r.latencyMs}ms` : r.error;
  console.log(`  ${label}  ${r.name.padEnd(14)} ${detail}`);
  if (r.status === 'down') anyDown = true;
}

process.exit(anyDown ? 1 : 0);
