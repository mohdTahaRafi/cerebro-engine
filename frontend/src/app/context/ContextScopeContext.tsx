// DESIGN.md §2.2, §5.3; phase_3_chat_ui.md §2.1 — the active context is application state,
// not page state: it is provided at AppShell (mounted around every authenticated route),
// not inside Chat, so a future context-aware screen reads the same value rather than
// re-deriving it. Selection persists in localStorage; a stored id that no longer exists in
// the fetched list (deleted from another tab, or never existed) falls back silently to the
// most recently updated context — there is nothing useful to tell the user about a
// workspace that no longer exists.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api } from '../../api';
import type { KnowledgeContext, CreateContextRequest } from '../../api/contracts';

const STORAGE_KEY = 'cerebro.activeContext';

// Module-level, not component state: survives ContextScopeProvider unmounting and
// remounting, which happens on navigation to/from /admin/health — RequireAdmin's guard
// deliberately sits OUTSIDE AppShell (routes.tsx's comment on that route, and
// RequireAdmin.tsx), so the browser gets a genuinely separate <AppShell> element there,
// and React unmounts/remounts everything under it, ContextScopeProvider included.
// Without this cache, that remount re-ran `load()` from scratch every time, which is
// what made the context selector visibly flash back to its loading skeleton on
// navigation. Reusing the last resolved result here means a remount hydrates instantly
// instead — `refresh()` (below, and useContexts.ts's create/update/remove) is still the
// only thing that ever forces a real re-fetch, so an explicit mutation still updates
// every consumer immediately, same as before.
let scopeCache: { contexts: KnowledgeContext[]; activeId: string | null; status: ContextScopeStatus } | null = null;

/** Called on sign-out (AuthContext) — see useThreads.ts's resetThreadsCache. */
export function resetContextScopeCache() {
  scopeCache = null;
}

// 'none'        — the list call succeeded and returned zero contexts.
// 'unavailable' — the endpoint isn't there yet (no Context model on the backend outside
//                 mock mode — Phase 2). Distinct from 'none': there may well BE contexts,
//                 the app just cannot ask. Chat degrades to its context-less v1 behavior
//                 rather than pretending the workspace is empty.
export type ContextScopeStatus = 'loading' | 'ready' | 'none' | 'unavailable';

interface ContextScopeState {
  contexts: KnowledgeContext[];
  activeContext: KnowledgeContext | null;
  status: ContextScopeStatus;
  setActive: (id: string) => void;
  createAndActivate: (req: CreateContextRequest) => Promise<KnowledgeContext>;
  refresh: () => void;
}

const ContextScope = createContext<ContextScopeState | undefined>(undefined);

export function ContextScopeProvider({ children }: { children: ReactNode }) {
  const [contexts, setContexts] = useState<KnowledgeContext[]>(() => scopeCache?.contexts ?? []);
  const [activeId, setActiveId] = useState<string | null>(() => scopeCache?.activeId ?? null);
  const [status, setStatus] = useState<ContextScopeStatus>(() => scopeCache?.status ?? 'loading');

  const load = useCallback(() => {
    setStatus('loading');
    api.contexts.list()
      .then(({ contexts: list }) => {
        setContexts(list);
        if (list.length === 0) {
          setStatus('none');
          setActiveId(null);
          return;
        }
        const stored = localStorage.getItem(STORAGE_KEY);
        const storedIsValid = stored != null && list.some((c) => c.id === stored);
        if (storedIsValid) {
          setActiveId(stored);
        } else {
          const mostRecent = [...list].sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
          )[0];
          setActiveId(mostRecent.id);
          localStorage.setItem(STORAGE_KEY, mostRecent.id);
        }
        setStatus('ready');
      })
      .catch((err) => {
        // Not distinguishing further here: whether it's the endpoint genuinely not
        // existing yet (EndpointUnavailableError) or a real network error, the correct UI
        // response is the same honest degraded state, never a fabricated context list.
        void err;
        setContexts([]);
        setActiveId(null);
        setStatus('unavailable');
      });
  }, []);

  // Skip the fetch entirely when a previous mount already resolved one this session — a
  // remount (see the scopeCache comment above) should hydrate from that, not refetch.
  // The `status !== 'loading'` half guards the (very unlikely) case of remounting while
  // the FIRST fetch is still in flight: scopeCache exists but nothing has resolved into
  // it yet, so skipping here would leave this instance stuck on the loading skeleton
  // forever with nothing left to ever call `load()` again.
  useEffect(() => {
    if (scopeCache && scopeCache.status !== 'loading') return;
    load();
  }, [load]);

  // Mirrors this provider's state into the module cache on every change, so the NEXT
  // mount (a remount, not this one) starts from up-to-date data instead of refetching.
  useEffect(() => {
    scopeCache = { contexts, activeId, status };
  }, [contexts, activeId, status]);

  const setActive = useCallback((id: string) => {
    setActiveId(id);
    localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const createAndActivate = useCallback(async (req: CreateContextRequest) => {
    const created = await api.contexts.create(req);
    setContexts((prev) => [...prev, created]);
    setActive(created.id);
    setStatus('ready');
    return created;
  }, [setActive]);

  const activeContext = contexts.find((c) => c.id === activeId) ?? null;

  return (
    <ContextScope.Provider value={{ contexts, activeContext, status, setActive, createAndActivate, refresh: load }}>
      {children}
    </ContextScope.Provider>
  );
}

export function useContextScope(): ContextScopeState {
  const ctx = useContext(ContextScope);
  if (ctx === undefined) throw new Error('useContextScope must be used within a ContextScopeProvider');
  return ctx;
}
