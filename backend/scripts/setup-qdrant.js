// Idempotent Qdrant collection + payload-index creation, checked into the repo.
// This is the direct fix for the audit finding that the Atlas vector index existed
// only in a web UI with no versioned definition (architecture §4).
import { ensureCollections } from '../src/providers/vectorStore.js';

try {
  await ensureCollections();
  process.exit(0);
} catch (err) {
  console.error(`[setup-qdrant] ${err.message}`);
  process.exit(1);
}
