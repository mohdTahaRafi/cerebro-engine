// phase_4 §5.1 — dev-only demo data for /admin/health's queue-throughput and pipeline-error
// panels (`/api/admin/queue`, `/api/admin/errors`). Real from Phase 7. The dependency cards,
// breakers, and collection counts on the same page are NOT here — those come from the real
// `/api/health` (architecture §7.3's table), never mocked.
import type { QueueStats, PipelineErrorRecord } from '../../contracts';
import { DEMO_CONTEXTS } from './demoContexts';

export function queueStats(): QueueStats {
  // A little time-based jitter so a page left open doesn't show a perfectly static number —
  // close enough to "alive" without pretending to be a real poll of a real queue.
  const wobble = Math.sin(Date.now() / 30_000);
  return {
    depth: {
      waiting: Math.max(0, Math.round(3 + wobble * 2)),
      active: 2,
      failed: 1,
      completed: 1408,
    },
    throughputPerMin: Number((4.2 + wobble * 0.8).toFixed(1)),
    workerConcurrency: 4,
    activeWorkers: 2,
    oldestWaitingAgeMs: 42_000,
  };
}

const ERROR_TEMPLATES: Array<Omit<PipelineErrorRecord, 'id' | 'createdAt' | 'documentId' | 'fileName' | 'contextId'>> = [
  { kind: 'parse', message: 'bad.pdf — no extractable text found in any page', stack: 'ParseError: no text layer\n    at extractText (parse/pdf.js:88)\n    at processDocument (queue/worker.js:41)', retryable: false },
  { kind: 'notify', message: 'SMTP connection refused (ECONNREFUSED 127.0.0.1:587)', stack: 'Error: connect ECONNREFUSED 127.0.0.1:587\n    at TCPConnectWrap.afterConnect (net.js:1146)', retryable: true },
  { kind: 'vision', message: 'ColPali scoring timed out after 30000ms', stack: 'TimeoutError: vision request exceeded 30000ms\n    at visionService.classify (providers/visionService.js:52)', retryable: true },
  { kind: 'embed', message: 'Cohere embed API returned 429 (rate limited)', stack: 'CohereError: rate limit exceeded\n    at embedBatch (providers/llm.js:114)', retryable: true },
  { kind: 'rerank', message: 'Reranker model returned a malformed response body', stack: 'SyntaxError: Unexpected token in JSON at position 0\n    at rerank (retrieval/rerank.js:29)', retryable: true },
  { kind: 'queue', message: 'Job stalled — worker did not report progress within the lock TTL', stack: 'StalledJobError: lock expired\n    at Worker.checkStalledJobs (bullmq/worker.js:203)', retryable: true },
];
const AGE_MINUTES = [2, 18, 47, 96, 210, 480];

export function pipelineErrors(): PipelineErrorRecord[] {
  const ctx = DEMO_CONTEXTS[0] ?? null;
  const now = Date.now();
  return ERROR_TEMPLATES.map((t, i) => ({
    ...t,
    id: `err-${i}`,
    documentId: ctx ? `doc-demo-${i}` : null,
    fileName: ctx ? ['bad.pdf', 'quarterly.pdf', 'scan.pdf', 'earnings.pdf', 'notes.md', 'board-deck.pdf'][i] : null,
    contextId: ctx?.id ?? null,
    createdAt: new Date(now - AGE_MINUTES[i] * 60_000).toISOString(),
  }));
}
