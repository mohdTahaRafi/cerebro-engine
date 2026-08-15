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

router.get('/health', async (req, res) => {
  const results = await Promise.all(Object.entries(PROBES).map(([n, f]) => probe(n, f)));
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
    timestamp: new Date().toISOString(),
  });
});

export default router;
