// phase_3_chat_ui.md §3 — owns the turn array, live-stream mirroring, and thread
// load/reset. Extracted out of Chat.tsx (task 3.5): the page component is left with only
// layout and the scope guard, and this hook is the single place that can be wrong about
// "which turn is currently streaming."
import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
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
  const location = useLocation();
  const navigate = useNavigate();

  const [turns, setTurns] = useState<Turn[]>([]);
  // Bug #4 (this fix) — a persisted thread's turns arrive asynchronously (loadTranscript
  // below fetches them), but `turns` starts every mount at `[]` same as a genuine new
  // chat. Without a separate flag, Transcript.tsx's `turns.length === 0` empty-state
  // branch can't tell "nothing here yet" from "still fetching this thread" apart, and
  // renders the blank "How can I help you today?" New Chat screen for the whole fetch
  // window — a real, sustained flash, not a one-frame flicker, every time a thread is
  // opened from Recent Chats or restored on mount. Lazy-initialized so the very FIRST
  // render already knows: `turns` is unconditionally `[]` on mount, so if the URL names a
  // thread (and we're not explicitly starting a new chat) or the engine already has one
  // open, a fetch is guaranteed to be needed — the loading state is correct with zero
  // possibility of an extra render in between.
  const [isThreadLoading, setIsThreadLoading] = useState<boolean>(() => {
    const wantsNewChat = Boolean((location.state as { newChat?: boolean } | null)?.newChat);
    if (wantsNewChat) return false;
    return Boolean(searchParams.get('threadId') || threadId);
  });
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

  // Fetches a persisted thread's messages into `turns`. Shared by the URL-driven load
  // below and by the "resume in place" branch, which re-fetches the engine's own
  // already-open thread when Chat remounts without the URL naming it.
  const loadTranscript = (id: string) => {
    liveTurnId.current = null;
    setIsThreadLoading(true);
    fetchThread(id)
      .then(({ messages }) => {
        const loaded: Turn[] = [];
        for (let i = 0; i < messages.length; i += 1) {
          const m = messages[i];
          if (m.role !== 'user') continue;
          const reply = messages[i + 1];
          // Backend's persistFailedTurn (conversation/persistTurn.js) writes only the
          // user's half of a turn whose generation failed — no assistant message ever
          // follows it. That absence, not a stored error string, IS the persisted record
          // of a failed turn: reconstruct the same 'error' presentation Turn.tsx/
          // retryLast use for a turn that just failed live, so Retry still works after a
          // reload. Without this, an unpaired user message rendered as a silently
          // "complete" turn with an empty answer instead of surfacing the failure.
          const hasReply = reply?.role === 'assistant';
          const replySources = hasReply ? reply.sources.map(fromThreadSource) : [];
          const unavailableIndices = new Set<number>();
          if (hasReply) reply.sources.forEach((s, idx) => { if (!s.available) unavailableIndices.add(idx + 1); });
          const replyAnswer = hasReply ? reply.content : '';
          loaded.push({
            id: m._id, question: m.content, createdAt: m.createdAt,
            answer: replyAnswer, sources: replySources,
            status: hasReply ? (isRefusal(replyAnswer) ? 'refused' : 'complete') : 'error',
            // The original error text isn't persisted (persistFailedTurn only ever
            // writes the question, never a reason — see its own comment); this generic
            // message is all there is to show for a resumed thread.
            error: hasReply ? null : 'Something went wrong generating a response. Try again.',
            telemetry: null, traceId: null, unavailableIndices,
          });
        }
        setTurns(loaded);
      })
      .catch((err) => console.error('Failed to load thread:', err))
      .finally(() => setIsThreadLoading(false));
  };

  // Reconciles the URL's `threadId` against the engine's current thread, and against an
  // explicit "start a new chat" request.
  //
  // Bug history (#2 and #3): this used to treat "the URL has no threadId" as itself
  // meaning "reset to a blank chat". That's wrong on two counts. First, the rail's plain
  // "Chat" link and the browser's own back/forward both land on a bare `/chat` while a
  // real conversation is still open — EngineProvider (mounted once, at AppShell) keeps
  // `threadId` alive across ordinary navigation; only Chat's own local `turns` state gets
  // torn down and rebuilt on remount. Second, a hard refresh throws away EngineProvider's
  // state too, so the URL is the only thing that can possibly survive it — and nothing
  // was ever writing the thread id into the URL for a conversation started by just typing
  // a question (only opening a thread from Recent Chats did). Sidebar.tsx's "+ New chat"
  // and its "delete the active thread" both now navigate here with `state: { newChat:
  // true }`, which is the only thing that resets the thread; a bare `/chat` otherwise
  // resumes whatever conversation is already open.
  useEffect(() => {
    const urlThreadId = searchParams.get('threadId');
    const wantsNewChat = Boolean((location.state as { newChat?: boolean } | null)?.newChat);

    if (wantsNewChat) {
      liveTurnId.current = null;
      startNewThread();
      setTurns([]);
      setIsThreadLoading(false);
      // One-shot: strip the state so a later remount of this route (e.g. switching
      // tabs and back) doesn't wipe a conversation started since.
      navigate(location.pathname + location.search, { replace: true, state: null });
      return;
    }

    if (!urlThreadId) {
      // No thread named in the URL. If the engine already has one open — it survived
      // because AppShell never unmounted — resume it in place instead of treating the
      // absence as a reset (#2), and write it into the URL so a hard refresh from here
      // can restore it too (#3).
      if (threadId && turns.length === 0) {
        loadTranscript(threadId);
        setSearchParams({ threadId }, { replace: true });
      }
      return;
    }

    if (urlThreadId === threadId) {
      // The URL already names the engine's currently-open thread — normally a no-op,
      // EXCEPT right after a remount (e.g. opening this exact thread's Recent Chats
      // link from another page): the engine's threadId survived, but this hook's local
      // `turns` did not, so without this the transcript would sit empty forever with
      // nothing left to ever trigger a fetch for it.
      if (turns.length === 0) loadTranscript(urlThreadId);
      return;
    }

    loadThread(urlThreadId);
    loadTranscript(urlThreadId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, location.state]);

  // The moment a brand-new conversation gets its backend-assigned thread id, mirror it
  // into the URL (#3) — otherwise a conversation started by typing (never opened via a
  // Recent Chats link) has nothing durable to survive a hard refresh with.
  useEffect(() => {
    if (threadId && searchParams.get('threadId') !== threadId) {
      setSearchParams({ threadId }, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

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
  // Bug history (#2/#3, discovered while fixing them): `activeContext` is `null` for
  // every page's first render or two — ContextScopeProvider's own fetch hasn't resolved
  // yet — and only then becomes the real object. That loading→loaded transition used to
  // be indistinguishable from a genuine switch: the old guard recorded the ref as `null`
  // (via `?? null`) on the loading render, so the very next render — activeContext
  // finishing its fetch, on EVERY page load, reload included — read back `null !== <real
  // id>` and fired the reset, wiping the turn list and engine thread this hook had just
  // finished restoring, and stripping `?threadId=` back out of the URL a moment after the
  // sync effect above had written it in. The fix: don't touch the ref (or compare
  // anything) until `activeContext?.id` is a real value for the first time; only a value
  // that has already been real can meaningfully "change" afterward.
  const prevContextIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const id = activeContext?.id;
    if (id === undefined) return;   // still loading — nothing to compare against yet
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

  return {
    turns, lastTurn, ask, retryLast, regenerate: handleRegenerate, isGenerating,
    // True only while a PERSISTED thread's messages are being fetched (loadTranscript,
    // above) — never while a live turn is streaming. Chat.tsx/Transcript.tsx use this to
    // tell "nothing here yet, genuinely a new chat" apart from "there's a real
    // conversation, still loading it" so the blank New Chat screen never stands in for a
    // conversation that's just slow to arrive.
    isThreadLoading,
  };
}
