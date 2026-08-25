// PHASE-6-REMOVE — phase_3_chat_ui.md §7.2. Threads have no `contextId` on the real
// backend until Phase 6 (backend/src/models/Message.js's Thread has no such field). This
// is the client-side thread→context assignment, recorded the moment a thread id is first
// learned (useCerebroChat's 'threadId' SSE frame, which already knows the contextId the
// question was asked against), persisted in localStorage so it survives a reload — a
// development affordance, not a shipping behavior, mirroring docContexts.ts's identical
// PHASE-6-REMOVE pattern from Phase 2 exactly. The Phase 6 doc deletes this whole file and
// every site that imports it; `grep -rn "PHASE-6-REMOVE" frontend/src/ | wc -l` returning 0
// is what proves it actually happened.
const STORAGE_KEY = 'cerebro.mock.threadContexts';

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
    // rather than the app crashing.
  }
}

export function assign(threadId: string, contextId: string): void {
  const map = readMap();
  map[threadId] = contextId;
  writeMap(map);
}

export function contextIdFor(threadId: string): string | null {
  return readMap()[threadId] ?? null;
}

export function unassign(threadId: string): void {
  const map = readMap();
  delete map[threadId];
  writeMap(map);
}
