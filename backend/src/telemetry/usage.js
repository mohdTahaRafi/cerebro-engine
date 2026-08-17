import { UsageEvent } from '../models/UsageEvent.js';
import { providerTokens } from './metrics.js';

// One row per provider call made on behalf of a document or query. ingestDocument.js calls
// this after a successful embed batch so the ingest cost is auditable per document.
export async function recordUsage({ provider, operation, inputTokens = 0, outputTokens = 0, callCount = 1, documentId = null, requestId = null }) {
  await UsageEvent.create({ provider, operation, inputTokens, outputTokens, callCount, documentId, requestId });
  // NFR-COST-01 (phase 6 §7.2): same call, same source of truth as the UsageEvent row
  // above — a zero-count .inc() is a harmless no-op, so this stays unconditional rather
  // than adding an `if (inputTokens > 0)` branch that would just duplicate UsageEvent's
  // own "a call happened even if undercounted" reasoning in a second place.
  providerTokens.inc({ provider, direction: 'input' }, inputTokens);
  providerTokens.inc({ provider, direction: 'output' }, outputTokens);
}
