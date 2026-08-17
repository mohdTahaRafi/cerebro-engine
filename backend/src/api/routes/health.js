import express from 'express';
import mongoose from 'mongoose';
import * as vectorStore from '../../providers/vectorStore.js';
import * as embeddings from '../../providers/embeddings.js';
import * as reranker from '../../providers/reranker.js';
import * as llm from '../../providers/llm.js';
import * as parser from '../../providers/parser.js';
import * as visionService from '../../providers/visionService.js';
import * as redis from '../../redis.js';
import { breakerStates } from '../../providers/breaker.js';
import { config } from '../../config/index.js';
import { ingestQueue } from '../../ingestion/queue.js';
import pkg from '../../../package.json' with { type: 'json' };

const router = express.Router();

// GET /health probes every dependency CONCURRENTLY and reports each independently.
// A single aggregate boolean would be useless for the failure modes in architecture
// §6.2, where the correct behavior is partial degradation.
const PROBES = {
  mongo:      () => mongoose.connection.db.admin().ping(),
  qdrant:     () => vectorStore.ping(),
  redis:      () => redis.ping(),
  vision:     () => visionService.health(),
  cohere:     () => embeddings.ping(),
  llamaparse: () => parser.ping(),
  llm:        () => llm.ping(),
};

async function probe(name, fn) {
  const start = performance.now();
  try {
    await fn();
    return { name, status: 'up', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return { name, status: 'down', latencyMs: Math.round(performance.now() - start), error: err.message };
  }
}

// Phase 6 §7.1: queue depth and collection counts, so a single request answers "is
// anything backing up" — a human (or an alert rule) doesn't have to separately query
// BullMQ and Qdrant to notice the ingest queue is draining slower than it's filling.
// Best-effort: a failure here degrades this one field to `null` rather than failing the
// whole health check — an operator who can already see mongo/qdrant/redis are up does not
// need /health itself to 503 because the queue-depth side query timed out.
async function safeQueueDepth() {
  try {
    const counts = await ingestQueue.getJobCounts('waiting', 'active', 'failed', 'completed');
    return counts;
  } catch {
    return null;
  }
}

async function safeCollectionCounts() {
  try {
    const [chunks, pages] = await Promise.all([vectorStore.countPoints(), vectorStore.countPagePoints()]);
    return { [config.qdrant.chunksCollection]: chunks, [config.qdrant.pagesCollection]: pages };
  } catch {
    return null;
  }
}

async function healthHandler(req, res) {
  const [results, queue, collections] = await Promise.all([
    Promise.all(Object.entries(PROBES).map(([n, f]) => probe(n, f))),
    safeQueueDepth(),
    safeCollectionCounts(),
  ]);
  const dependencies = Object.fromEntries(results.map((r) => [r.name, r]));

  // Mongo and Qdrant are non-degradable; anything else down is 'degraded', not 'down'.
  const critical = ['mongo', 'qdrant'];
  const criticalDown = critical.some((n) => dependencies[n].status === 'down');
  const anyDown = results.some((r) => r.status === 'down');
  const status = criticalDown ? 'down' : anyDown ? 'degraded' : 'up';

  res.status(status === 'down' ? 503 : 200).json({
    status,
    version: pkg.version,
    breakers: breakerStates(),
    dependencies,
    queue,
    collections,
    timestamp: new Date().toISOString(),
  });
}

// Registered on two paths, deliberately (phase 6, amended during implementation):
//
//   /health      — infrastructure. backend/Dockerfile's HEALTHCHECK and
//                  docker-compose.prod.yml's dependency conditions probe this, and it must
//                  stay off the public interface, exactly like /metrics.
//   /api/health  — the browser. The advanced console's SystemHealth panel polls this.
//
// Both are needed because the frontend can only reach paths that are proxied to the
// backend, and BOTH proxies in this project route on the /api prefix alone — Vite's dev
// server (vite.config.ts) and Caddy (Caddyfile). Verified live: a browser fetch of bare
// /health is not proxied in dev, and in production falls through to the SPA's catch-all and
// returns index.html, so the panel would parse HTML as JSON. Widening either proxy to carry
// /health would also expose it publicly through Caddy, which is the opposite of what §7.2
// wants; adding the /api alias keeps the infra path private and gives the browser a route
// on the surface it is already allowed to use.
router.get('/health', healthHandler);
router.get('/api/health', healthHandler);

export default router;
