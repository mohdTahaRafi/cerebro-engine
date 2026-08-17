// GET /metrics — Prometheus text exposition (phase 6 §7.2, task 6.18). Internal-only: this
// router is mounted in api/index.js like any other, but the production Caddyfile (§8.2)
// only proxies `/api/*` and the SPA — `/metrics` is never in Caddy's route table, so it is
// reachable on the backend container's own port inside the Docker network but not through
// the public reverse proxy. It carries operational detail (per-provider call/token
// volumes, breaker state) that does not belong on the public interface.
import express from 'express';
import { registry, breakerState, queueDepth, BREAKER_STATE_VALUE } from '../../telemetry/metrics.js';
import { breakerStates } from '../../providers/breaker.js';
import { ingestQueue } from '../../ingestion/queue.js';

const router = express.Router();

router.get('/metrics', async (req, res, next) => {
  try {
    // Gauges are set here, on scrape, rather than push-updated on every state change
    // (metrics.js's own comment) — always current, no separate "did an event get missed"
    // bookkeeping to maintain.
    for (const [name, state] of Object.entries(breakerStates())) {
      breakerState.set({ name }, BREAKER_STATE_VALUE[state] ?? -1);
    }
    const counts = await ingestQueue.getJobCounts('waiting', 'active', 'failed', 'completed');
    for (const [state, count] of Object.entries(counts)) {
      queueDepth.set({ state }, count);
    }

    res.set('Content-Type', registry.contentType);
    res.end(await registry.metrics());
  } catch (err) {
    next(err);
  }
});

export default router;
