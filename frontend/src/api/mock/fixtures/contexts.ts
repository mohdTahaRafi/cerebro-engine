// phase_2 §1.1 — Contexts do not exist server-side until Phase 6 (no Context model on the
// backend), so this is the mock adapter §1.1 refers to: every context CRUD operation the
// app makes is served from here, persisted to localStorage under the current browser so it
// survives a reload. This is NOT gated behind the VITE_API_MOCK dev flag the way phase_1's
// auth mock is (src/api/mock/index.ts) — a real user's /contexts workspace has to actually
// work, in production, today. `<MockBadge force>` is what tells them honestly that it is
// local to this browser (phase_2 §7.4, §1.1).
//
// Deliberately no seed data: a fresh store is empty, so a real first-time user sees the
// real empty state (phase_2 task 2.3), not fabricated example contexts.
import type { KnowledgeContext, CreateContextRequest } from '../../contracts';

const STORAGE_KEY = 'cerebro.contexts';

/** Every record actually stored, minus `documentCount`/`chunkCount` — those are always
 *  computed live from the real document list (endpoints/contexts.ts's `withCounts`), never
 *  stored, so they can never drift from what actually got uploaded. */
type StoredContext = Omit<KnowledgeContext, 'documentCount' | 'chunkCount'>;

function read(): StoredContext[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredContext[]) : [];
  } catch {
    return [];
  }
}

function write(records: StoredContext[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Storage full/unavailable: mutations stop persisting across reload, but the running
    // tab's in-memory behavior for this call still completes correctly.
  }
}

let idSeq = 0;
function nextId(): string {
  idSeq += 1;
  return `ctx-${Date.now().toString(36)}-${idSeq}`;
}

function toKnowledgeContext(c: StoredContext): KnowledgeContext {
  return { ...c, documentCount: 0, chunkCount: 0 };
}

export function list(): KnowledgeContext[] {
  return read().map(toKnowledgeContext);
}

export function get(id: string): KnowledgeContext | undefined {
  const found = read().find((c) => c.id === id);
  return found ? toKnowledgeContext(found) : undefined;
}

export function create(body: CreateContextRequest): KnowledgeContext {
  const now = new Date().toISOString();
  const created: StoredContext = {
    id: nextId(), title: body.title, description: body.description ?? null,
    status: 'active', createdAt: now, updatedAt: now,
  };
  write([...read(), created]);
  return toKnowledgeContext(created);
}

export function update(id: string, body: CreateContextRequest): KnowledgeContext | undefined {
  const records = read();
  const idx = records.findIndex((c) => c.id === id);
  if (idx === -1) return undefined;
  const updated: StoredContext = {
    ...records[idx], title: body.title, description: body.description ?? null,
    updatedAt: new Date().toISOString(),
  };
  records[idx] = updated;
  write(records);
  return toKnowledgeContext(updated);
}

export function setStatus(id: string, status: KnowledgeContext['status']): void {
  const records = read();
  const idx = records.findIndex((c) => c.id === id);
  if (idx === -1) return;
  records[idx] = { ...records[idx], status };
  write(records);
}

/** Hard-removes the record. Called once a delete's cascade (endpoints/contexts.ts) has
 *  actually finished deleting every document in it — never before, or the card would
 *  vanish from the list ahead of the data it represented actually being gone. */
export function remove(id: string): void {
  write(read().filter((c) => c.id !== id));
}
