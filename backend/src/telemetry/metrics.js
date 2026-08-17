// Prometheus metrics registry (phase 6 §7.2, task 6.18) — the 7 metric families the
// budgets in every earlier phase were written against, so `/metrics` validates them in
// production rather than only in tests run against a dev machine.
import client from 'prom-client';

export const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry });   // process CPU/memory/event-loop-lag, free with prom-client

// Validates NFR-PERF-01/03 in production. Recorded by the request-timing middleware
// (api/index.js) around every route.
export const requestDuration = new client.Histogram({
  name: 'cerebro_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 90],
  registers: [registry],
});

// Per-stage p95 — the console's own PipelineTelemetry numbers (telemetry/pipelineTelemetry.js),
// aggregated across every request rather than shown one query at a time. Recorded by
// recordPipelineTelemetry() below, called from both /api/search and /api/ask once a
// PipelineTelemetry object exists.
export const pipelineStageDuration = new client.Histogram({
  name: 'cerebro_pipeline_stage_seconds',
  help: 'Per-stage RAG pipeline duration in seconds.',
  labelNames: ['stage'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

const STAGE_FIELDS = [
  'condenseMs', 'embedMs', 'sparseMs', 'colpaliMs', 'chunkRetrieveMs',
  'pageRetrieveMs', 'mergeMs', 'rerankMs', 'firstTokenMs', 'generateMs',
];

// Called once per request with the final PipelineTelemetry object — null/skipped stages
// are not observed at all (a histogram sample for a stage that didn't run would pull its
// p95 toward zero and misrepresent how long the stage actually takes when it does run).
export function recordPipelineTelemetry(telemetry) {
  for (const field of STAGE_FIELDS) {
    const ms = telemetry[field];
    if (ms != null) pipelineStageDuration.observe({ stage: field.replace(/Ms$/, '') }, ms / 1000);
  }
}

// Validates the 30s text / 6s-per-page visual ingestion budgets (architecture §6).
// Recorded by ingestion/ingestDocument.js on both the success and failure paths.
export const ingestJobDuration = new client.Histogram({
  name: 'cerebro_ingest_job_duration_seconds',
  help: 'Ingestion job duration in seconds, labeled by outcome.',
  labelNames: ['outcome'],
  buckets: [1, 2, 5, 10, 15, 30, 45, 60, 90, 120, 180, 300],
  registers: [registry],
});

// Cost tracking and failure-rate alerting. Recorded generically inside providers/breaker.js's
// wrap() — every provider call in the app already goes through a named breaker, so
// instrumenting there covers Cohere, Qdrant, the LLM, LlamaParse, and the vision service
// from one place rather than one call site per provider module.
export const providerCalls = new client.Counter({
  name: 'cerebro_provider_calls_total',
  help: 'Total provider calls, labeled by provider, operation, and outcome.',
  labelNames: ['provider', 'operation', 'outcome'],
  registers: [registry],
});

// NFR-COST-01. Recorded inside telemetry/usage.js's recordUsage() — the same call that
// already writes the UsageEvent audit row, so token counts land in both places from one
// source of truth instead of two independently-maintained tallies.
export const providerTokens = new client.Counter({
  name: 'cerebro_provider_tokens_total',
  help: 'Total tokens exchanged with a provider, labeled by provider and direction.',
  labelNames: ['provider', 'direction'],
  registers: [registry],
});

// 0 closed / 1 half-open / 2 open, per named circuit breaker (providers/breaker.js). Set
// on scrape (api/routes/metrics.js), not pushed on every state-change event — a gauge read
// at scrape time is always current and needs no separate "did I miss an event" bookkeeping.
export const breakerState = new client.Gauge({
  name: 'cerebro_breaker_state',
  help: '0 = closed, 1 = half-open, 2 = open.',
  labelNames: ['name'],
  registers: [registry],
});

// Ingestion backlog. Set on scrape from BullMQ's own getJobCounts(), same reasoning as
// breakerState above.
export const queueDepth = new client.Gauge({
  name: 'cerebro_queue_depth',
  help: 'BullMQ ingest queue depth, labeled by state.',
  labelNames: ['state'],
  registers: [registry],
});

export const BREAKER_STATE_VALUE = { closed: 0, 'half-open': 1, open: 2 };
