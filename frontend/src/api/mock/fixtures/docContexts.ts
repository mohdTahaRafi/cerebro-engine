// PHASE-6-REMOVE — phase_2 §7.4. Documents have no `contextId` on the real backend until
// Phase 6 (backend/src/models/Document.js has no such field). This is the client-side
// doc→context assignment the mock makes at upload time, persisted in localStorage so it
// survives a reload — a development affordance, not a shipping behavior. Task 6.x in the
// Phase 6 doc deletes this whole file and every site that imports it; the acceptance
// criterion `grep -rn "PHASE-6-REMOVE" frontend/src/ | wc -l` returning 0 is what proves
// it actually happened.
const STORAGE_KEY = 'cerebro.mock.docContexts';

function readMap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Record<string, string>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage full or unavailable (private browsing): the assignment is lost on reload
    // rather than the app crashing — the same "degrade, don't throw" rule as everywhere
    // else this mock touches localStorage.
  }
}

export function assign(documentId: string, contextId: string): void {
  const map = readMap();
  map[documentId] = contextId;
  writeMap(map);
}

export function contextIdFor(documentId: string): string | null {
  return readMap()[documentId] ?? null;
}

export function unassign(documentId: string): void {
  const map = readMap();
  delete map[documentId];
  writeMap(map);
}

export function documentIdsForContext(contextId: string): Set<string> {
  const map = readMap();
  return new Set(Object.entries(map).filter(([, c]) => c === contextId).map(([docId]) => docId));
}
