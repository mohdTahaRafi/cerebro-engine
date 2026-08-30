// Shared tenant/corpus shape for every bench/v2 script (phase 8 §2.1) — one definition
// so seed.js and tenancy.bench.js can never seed and query against mismatched counts.
export const NUM_TENANTS = 20;
export const CONTEXTS_PER_TENANT = 5;
export const CHUNKS_PER_CONTEXT = 1_000;
export const TOTAL_CHUNKS = NUM_TENANTS * CONTEXTS_PER_TENANT * CHUNKS_PER_CONTEXT;   // 100,000

// `bench-` prefixed and index-derived, never a real Mongo ObjectId — this corpus lives
// only in Qdrant (search.js's retrieval pipeline has no Mongo dependency at all; see its
// own header comment) and is never joined against the `users`/`contexts` collections.
export function tenantUser(userIndex) {
  return `bench-user-${userIndex}`;
}
export function tenantContext(userIndex, contextIndex) {
  return `bench-context-${userIndex}-${contextIndex}`;
}
export function tenant(userIndex, contextIndex) {
  return { userId: tenantUser(userIndex), contextId: tenantContext(userIndex, contextIndex) };
}
export function documentId(userIndex, contextIndex) {
  return `bench-doc-${userIndex}-${contextIndex}`;
}

export function* allContexts() {
  for (let u = 0; u < NUM_TENANTS; u++) {
    for (let c = 0; c < CONTEXTS_PER_TENANT; c++) {
      yield { userIndex: u, contextIndex: c, tenant: tenant(u, c), documentId: documentId(u, c) };
    }
  }
}
