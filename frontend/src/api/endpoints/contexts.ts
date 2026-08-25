// phase_2 §1.1 — "Context CRUD is served by the mock adapter." Unlike every other endpoint
// module, this one deliberately never calls the real backend: there is no Context model
// server-side until Phase 6. It always talks to the localStorage-backed store in
// mock/fixtures/contexts.ts, regardless of VITE_API_MOCK — see that file's header for why
// this is NOT the same thing as phase_1's dev-only auth mock. `documentCount`/`chunkCount`
// are never stored; they're computed live off the real document list every call, so they
// can never drift from what actually got uploaded (§2's KnowledgeContext comment).
import { CerebroApiError } from '../client';
import * as store from '../mock/fixtures/contexts';
import { documents as documentsApi } from './documents';
import type { KnowledgeContext, CreateContextRequest } from '../contracts';

// A tiny artificial delay so a loading state is actually observable, the same way a real
// network round-trip would be — mirrors mock/index.ts's own LATENCY_MS for the same reason.
const LATENCY_MS = 150;
const delay = () => new Promise((r) => setTimeout(r, LATENCY_MS));

async function withCounts(records: KnowledgeContext[]): Promise<KnowledgeContext[]> {
  const { documents: all } = await documentsApi.list();
  return records.map((c) => {
    const inContext = all.filter((d) => d.contextId === c.id);
    // "sum of chunkCount over ready documents" (§2) — a duplicate's chunkCount is always 0
    // (it has no vectors of its own), so restricting to 'ready' is the literal contract,
    // not just an optimization.
    const chunkCount = inContext
      .filter((d) => d.status === 'ready')
      .reduce((sum, d) => sum + d.chunkCount, 0);
    return { ...c, documentCount: inContext.length, chunkCount };
  });
}

// Cascade-delete concurrency. Matches §7.3's re-index concurrency: both are paid,
// provider-touching per-document operations (each document delete calls Qdrant + storage),
// and 2 keeps a 50-document cascade from opening 50 simultaneous deletes against the vector
// store while still finishing well inside architecture §8's ~20s budget.
const CASCADE_CONCURRENCY = 2;

async function cascadeDelete(contextId: string): Promise<void> {
  const { documents: inContext } = await documentsApi.list(contextId);
  const queue = inContext.map((d) => d.id);
  const workers = Array.from({ length: CASCADE_CONCURRENCY }, async () => {
    for (let next = queue.shift(); next; next = queue.shift()) {
      // A document that fails to delete stays real and orphaned under a context record
      // that has already vanished from the UI — an accepted rough edge of a client-only
      // mock with no server-side transaction to roll the whole cascade back on. Swallowed
      // here rather than aborting the rest of the cascade over one bad document.
      await documentsApi.remove(next).catch(() => {});
    }
  });
  await Promise.all(workers);
  store.remove(contextId);
}

export const contexts = {
  async list(): Promise<{ contexts: KnowledgeContext[] }> {
    await delay();
    return { contexts: await withCounts(store.list()) };
  },

  async get(id: string): Promise<KnowledgeContext> {
    await delay();
    const found = store.get(id);
    if (!found) {
      throw new CerebroApiError({
        status: 404, code: 'context_not_found', message: 'That context no longer exists.',
      });
    }
    const [withCount] = await withCounts([found]);
    return withCount;
  },

  async create(body: CreateContextRequest): Promise<KnowledgeContext> {
    await delay();
    return store.create(body);
  },

  async update(id: string, body: CreateContextRequest): Promise<KnowledgeContext> {
    await delay();
    const updated = store.update(id, body);
    if (!updated) {
      throw new CerebroApiError({
        status: 404, code: 'context_not_found', message: 'That context no longer exists.',
      });
    }
    return updated;
  },

  /** Returns as soon as the context is marked `deleting` — the caller (DeleteContextDialog)
   *  needs nothing more than that to close and let the list's own 2s poll (§3.5) take over.
   *  The actual cascade (deleting every real document, then the context record itself) runs
   *  in the background and is intentionally not awaited here. */
  async delete(id: string): Promise<void> {
    await delay();
    if (!store.get(id)) return;
    store.setStatus(id, 'deleting');
    void cascadeDelete(id);
  },
};
