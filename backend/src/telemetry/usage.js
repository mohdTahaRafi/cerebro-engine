import { UsageEvent } from '../models/UsageEvent.js';

// One row per provider call made on behalf of a document or query. ingestDocument.js calls
// this after a successful embed batch so the ingest cost is auditable per document.
export async function recordUsage({ provider, operation, inputTokens = 0, outputTokens = 0, callCount = 1, documentId = null, requestId = null }) {
  await UsageEvent.create({ provider, operation, inputTokens, outputTokens, callCount, documentId, requestId });
}
