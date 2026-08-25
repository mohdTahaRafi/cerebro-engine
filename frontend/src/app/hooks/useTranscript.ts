// phase_3_chat_ui.md §3 — owns the turn array, live-stream mirroring, and thread
// load/reset. Extracted out of Chat.tsx (task 3.5): the page component is left with only
// layout and the scope guard, and this hook is the single place that can be wrong about
// "which turn is currently streaming."
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useEngine } from '../context/EngineContext';
import { useContextScope } from '../context/ContextScopeContext';
import { isRefusal } from '../components/chat/refusals';
import type { TurnStatus } from '../components/chat/ProvenanceRibbon';
import { useThreads, type ThreadSource } from './useThreads';
import type { PipelineTelemetry, ProvenanceSource } from '../../api/contracts';

export interface Turn {
  id: string;             // 'live-<ts>' while streaming, the Message _id once persisted
  question: string;
  answer: string;
  sources: ProvenanceSource[];
  telemetry: PipelineTelemetry | null;
  traceId: string | null;
  status: TurnStatus;
  error: string | null;
  createdAt: string;
  /** Indices (1-based) known to reference a since-deleted document — only ever set on a
   *  resumed thread (§5.3); a live turn's sources are always available. */
  unavailableIndices: Set<number>;
}

function fromThreadSource(s: ThreadSource): ProvenanceSource {
  return {
    pointId: s.pointId, kind: s.kind === 'chunk' ? 'text' : 'page', text: null, score: s.score,
    documentId: s.documentId, fileName: s.fileName, page: s.page,
    headingPath: null, position: null, imageUri: s.imageUri, ocrQuality: null, absorbedChunks: null,
    branch: null, fusionRank: null, finalRank: null,
  };
}

function deriveStatus(isStreaming: boolean, error: string | null, answer: string): TurnStatus {
  if (error) return 'error';
  if (isStreaming) return 'streaming';
  if (isRefusal(answer)) return 'refused';
  return 'complete';
}

export function useTranscript() {
  const {
    sources, answer, isGenerating, chatError, threadId, chatTelemetry, traceId,
    askCerebro, loadThread, startNewThread, regenerate,
  } = useEngine();
  const { activeContext } = useContextScope();
  const { fetchThread } = useThreads();
  const [searchParams, setSearchParams] = useSearchParams();

  const [turns, setTurns] = useState<Turn[]>([]);
  const liveTurnId = useRef<string | null>(null);
  const wasGenerating = useRef(false);

  // Mirrors the live SSE state into whichever turn is currently streaming. The id is
  // captured into a local BEFORE the setTurns call, and that local — not the ref — is
  // what the updater closes over: setTurns's updater function runs when React flushes the
  // update, not synchronously here, so if the updater read `liveTurnId.current` directly
  // it would see whatever the ref holds AT FLUSH TIME — already `null`, since the very next
  // line in this same effect nulls it the instant a turn finishes. That silently turned
  // every "stream just completed" update into a no-op.
  useEffect(() => {
    const currentTurnId = liveTurnId.current;
    if (!currentTurnId) return;
    setTurns((prev) => prev.map((t) => (
      t.id === currentTurnId
        ? { ...t, answer, sources, telemetry: chatTelemetry, traceId, error: chatError,
            status: deriveStatus(isGenerating, chatError, answer) }
        : t
    )));
    // invariant 1 (§3.3) — a new question is refused while one is in flight (see
    // handleQuery's guard below); this is the other half: the id is cleared only on the
    // generating true→false edge, never mid-stream, so a turn is never orphaned at
    // 'streaming' forever.
    if (wasGenerating.current && !isGenerating) liveTurnId.current = null;
    wasGenerating.current = isGenerating;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, sources, isGenerating, chatError, chatTelemetry, traceId]);

  // Reconciles the URL's `threadId` against the engine's current thread.
  useEffect(() => {
    const urlThreadId = searchParams.get('threadId');
    if (!urlThreadId) {
      if (threadId !== null) {
        liveTurnId.current = null;
        startNewThread();
        setTurns([]);
      }
      return;
    }
    if (urlThreadId === threadId) return;

    liveTurnId.current = null;
    loadThread(urlThreadId);
    fetchThread(urlThreadId)
      .then(({ messages }) => {
        const loaded: Turn[] = [];
        for (let i = 0; i < messages.length; i += 1) {
          const m = messages[i];
          if (m.role !== 'user') continue;
          const reply = messages[i + 1];
          const replySources = reply ? reply.sources.map(fromThreadSource) : [];
          const unavailableIndices = new Set<number>();
          reply?.sources.forEach((s, idx) => { if (!s.available) unavailableIndices.add(idx + 1); });
          const replyAnswer = reply?.role === 'assistant' ? reply.content : '';
          loaded.push({
            id: m._id, question: m.content, createdAt: m.createdAt,
            answer: replyAnswer, sources: replySources,
            status: isRefusal(replyAnswer) ? 'refused' : 'complete',
            error: null, telemetry: null, traceId: null, unavailableIndices,
          });
        }
        setTurns(loaded);
      })
      .catch((err) => console.error('Failed to load thread:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Switching the active context mid-conversation starts a new thread (§2.3). The
  // ContextSwitcher's confirm step calls startNewThread() itself for an ordinary switch,
  // but it is NOT the only way activeContext.id changes — quick-create (§2.2, "New
  // context" from the switcher) goes through createAndActivate instead, which never
  // touches the engine at all. Without startNewThread() here too, the frontend's turn
  // array and URL both correctly reset to "empty conversation", but useCerebroChat's own
  // threadId state is untouched — the very next question then silently continues the
  // OLD context's thread on the backend (condense runs against its history, and the
  // reply gets appended to that thread's message count) rather than starting a fresh
  // one. This effect is the single place that reacts to the id actually changing, so
  // calling startNewThread() here — redundantly with ContextSwitcher's own call, which
  // is harmless, since startNewThread() is idempotent — makes the reset happen exactly
  // once regardless of what triggered the change, including quick-create.
  const prevContextIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const id = activeContext?.id ?? null;
    if (prevContextIdRef.current === undefined) { prevContextIdRef.current = id; return; }
    if (prevContextIdRef.current !== id) {
      prevContextIdRef.current = id;
      liveTurnId.current = null;
      setTurns([]);
      startNewThread();
      if (searchParams.get('threadId')) setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeContext?.id]);

  const lastTurn = turns[turns.length - 1];

  // task 3.6 — the in-flight guard. Without it, a second submit while streaming would
  // reassign liveTurnId and orphan the first turn at 'streaming' forever.
  const ask = (query: string, contextId: string | null, scopeDocumentIds?: string[]) => {
    if (isGenerating) return;
    const id = `live-${Date.now()}`;
    liveTurnId.current = id;
    setTurns((prev) => [
      ...prev,
      { id, question: query, createdAt: new Date().toISOString(), answer: '', sources: [],
        status: 'streaming', error: null, telemetry: null, traceId: null, unavailableIndices: new Set() },
    ]);
    askCerebro(query, contextId, scopeDocumentIds?.length ? scopeDocumentIds : undefined);
  };

  // §7.3 — "Backend unreachable mid-stream": Retry re-sends the exact question of the
  // last (errored) turn on the same thread, replacing that turn's contents in place rather
  // than appending a duplicate question bubble.
  const retryLast = () => {
    if (!lastTurn || lastTurn.status !== 'error') return;
    const id = lastTurn.id;
    liveTurnId.current = id;
    setTurns((prev) => prev.map((t) => (
      t.id === id ? { ...t, answer: '', sources: [], status: 'streaming', error: null, telemetry: null, traceId: null } : t
    )));
    askCerebro(lastTurn.question, activeContext?.id ?? null);
  };

  // useEngine's regenerate() re-posts the last query on the same threadId, but it doesn't
  // know about the turn array at all — nothing else sets liveTurnId for it, so without
  // this wrapper the mirroring effect's `if (!currentTurnId) return` guard would silently
  // drop every token a regenerate produces: engine state updates, but no turn ever shows
  // it. Mirrored the same way retryLast resets the last turn in place before re-asking.
  const handleRegenerate = () => {
    if (!lastTurn) return;
    const id = lastTurn.id;
    liveTurnId.current = id;
    setTurns((prev) => prev.map((t) => (
      t.id === id ? { ...t, answer: '', sources: [], status: 'streaming', error: null, telemetry: null, traceId: null } : t
    )));
    regenerate();
  };

  return { turns, lastTurn, ask, retryLast, regenerate: handleRegenerate, isGenerating };
}
