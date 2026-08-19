import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Square, RotateCcw } from 'lucide-react';
import { useEngine } from '../context/EngineContext';
import { AnswerBox } from '../components/core/AnswerBox';
import { ChatInput } from '../components/ui/ChatInput';
import { SourceChip } from '../components/ui/SourceChip';
import { GlobalDropzone } from '../components/ui/GlobalDropzone';
import { useThreads, type ThreadSource } from '../hooks/useThreads';
import type { ChatSource } from '../hooks/useCerebroChat';
import { motion, AnimatePresence } from 'motion/react';

// A turn pairs one question with its (possibly still-streaming) answer. Sources carry
// only the fields both the live SSE shape (ChatSource) and the persisted-thread shape
// (ThreadSource) can supply — a resumed thread's chips render with less detail (no text
// snippet; Message.sources never stores chunk text, see api/routes/threads.js) than a
// live turn's, by design rather than by omission.
interface DisplaySource {
  key: string;
  kind: string;
  score: number | null;
  documentId: string;
  fileName: string | null;
  page: number | null;
  headingPath?: string | null;
  text?: string;
}

interface DisplayTurn {
  id: string;
  question: string;
  answer: string;
  sources: DisplaySource[];
  isStreaming: boolean;
  error?: string | null;
}

function fromChatSource(s: ChatSource, i: number): DisplaySource {
  return {
    key: s.pointId || String(i), kind: s.kind, score: s.score, documentId: s.documentId,
    fileName: s.fileName, page: s.page, headingPath: s.headingPath, text: s.text ?? undefined,
  };
}

function fromThreadSource(s: ThreadSource, i: number): DisplaySource {
  return {
    key: s.pointId || String(i), kind: s.kind, score: s.score, documentId: s.documentId,
    fileName: s.available ? s.fileName : `${s.fileName ?? 'Document'} (deleted)`, page: s.page,
  };
}

// phase_1 §7.3 — the left rail's Recent Chats is now the only thread list in the
// product; the in-page ThreadSidebar this component used to render is retired. Thread
// selection is URL-driven instead: the rail navigates to `/chat?threadId=<id>` (or bare
// `/chat` for a fresh thread) and this component reconciles against that param, so the
// rail and this page can coordinate without a direct callback between them.
export function ConsumerDashboard() {
  const {
    sources, answer, isGenerating, chatError, threadId, attachedSources,
    askCerebro, loadThread, startNewThread, stopGenerating, regenerate,
  } = useEngine();
  const { fetchThread } = useThreads();
  const [searchParams] = useSearchParams();

  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const liveTurnId = useRef<string | null>(null);
  const wasGenerating = useRef(false);

  // Mirrors the live SSE state (answer/sources/isGenerating/chatError, all owned by
  // useCerebroChat via EngineContext) into whichever turn is currently streaming.
  useEffect(() => {
    if (!liveTurnId.current) return;
    setTurns((prev) => prev.map((t) => (
      t.id === liveTurnId.current
        ? { ...t, answer, sources: sources.map(fromChatSource), isStreaming: isGenerating, error: chatError }
        : t
    )));
    if (wasGenerating.current && !isGenerating) {
      liveTurnId.current = null;
    }
    wasGenerating.current = isGenerating;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, sources, isGenerating, chatError]);

  // Reconciles the URL's `threadId` against the engine's current thread — a click on a
  // Sidebar row, a "+ New chat", or a direct link all funnel through here.
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
        const loaded: DisplayTurn[] = [];
        for (let i = 0; i < messages.length; i += 1) {
          const m = messages[i];
          if (m.role !== 'user') continue;
          const reply = messages[i + 1];
          loaded.push({
            id: m._id,
            question: m.content,
            answer: reply?.role === 'assistant' ? reply.content : '',
            sources: reply ? reply.sources.map(fromThreadSource) : [],
            isStreaming: false,
          });
        }
        setTurns(loaded);
      })
      .catch((err) => console.error('Failed to load thread:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const handleQuery = (query: string) => {
    // Hard guard at the state source, not just ChatInput's disabled prop: without this,
    // a turn started while a previous one is still in flight orphans the previous turn's
    // isStreaming at true forever.
    if (isGenerating) return;

    const id = `live-${Date.now()}`;
    liveTurnId.current = id;
    setTurns((prev) => [
      ...prev.map((t) => (t.isStreaming ? { ...t, isStreaming: false } : t)),
      { id, question: query, answer: '', sources: [], isStreaming: true },
    ]);
    askCerebro(query, attachedSources.length ? attachedSources : undefined);
  };

  const hasContent = turns.length > 0;
  const lastTurn = turns[turns.length - 1];

  return (
    <GlobalDropzone>
      <div className="flex h-full flex-1 flex-col overflow-hidden bg-surface">
        <div className={`flex-1 min-h-0 flex flex-col w-full max-w-3xl mx-auto px-6 transition-all duration-700 ease-in-out ${hasContent ? 'pt-8 pb-40' : 'justify-center pb-20'}`}>

          <AnimatePresence>
            {!hasContent && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20, height: 0, margin: 0 }}
                className="mb-12 flex flex-col items-center gap-4"
              >
                <div className="flex size-14 items-center justify-center rounded-2xl bg-signal-soft">
                  <div className="size-3 animate-pulse rounded-sm bg-signal" />
                </div>
                <h1 className="text-3xl font-bold tracking-tight text-ink">How can I help you?</h1>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {hasContent && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex w-full flex-1 flex-col gap-8 overflow-y-auto pb-12 pr-4 custom-scrollbar"
              >
                {turns.map((turn) => (
                  <div key={turn.id} className="flex flex-col gap-3">
                    <div className="self-end max-w-[80%] rounded-2xl border border-line bg-surface-raised px-4 py-2.5 text-sm text-ink">
                      {turn.question}
                    </div>

                    <AnswerBox answer={turn.answer} isGenerating={turn.isStreaming} error={turn.error ?? null} />

                    {turn.sources.length > 0 && (
                      <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.3 }}
                        className="flex flex-col gap-3 border-l-2 border-line pl-4"
                      >
                        <span className="text-[11px] font-medium uppercase tracking-wide text-graphite">Sources analyzed</span>
                        <div className="flex flex-wrap gap-2">
                          {turn.sources.slice(0, 8).map((s, i) => (
                            <SourceChip
                              key={s.key}
                              index={i}
                              documentId={s.documentId}
                              fileName={s.fileName ?? 'Knowledge Node'}
                              position={s.headingPath ?? (s.page ? `p.${s.page}` : undefined)}
                              textSnippet={s.text}
                              score={s.score ?? undefined}
                            />
                          ))}
                        </div>
                      </motion.div>
                    )}

                    {!turn.isStreaming && turn.id === lastTurn?.id && turn.answer && (
                      <button
                        onClick={regenerate}
                        className="self-start flex items-center gap-1.5 text-xs text-graphite outline-none transition-colors hover:text-ink-secondary focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm"
                        title="Regenerate response"
                      >
                        <RotateCcw size={12} aria-hidden="true" />
                        Regenerate
                      </button>
                    )}
                  </div>
                ))}
              </motion.div>
            )}
          </AnimatePresence>

          <div className={`w-full ${hasContent ? 'absolute bottom-8 left-0 right-0 px-6 max-w-3xl mx-auto' : ''}`}>
            {isGenerating && (
              <div className="mb-3 flex justify-center">
                <button
                  onClick={stopGenerating}
                  className="flex items-center gap-2 rounded-full border border-line bg-surface-raised px-4 py-1.5 text-xs text-ink-secondary outline-none transition-colors hover:border-line-strong hover:text-ink focus-visible:ring-[3px] focus-visible:ring-signal-ring"
                >
                  <Square size={12} fill="currentColor" aria-hidden="true" />
                  Stop generating
                </button>
              </div>
            )}
            <ChatInput onSearch={handleQuery} isSearching={isGenerating} />
          </div>

        </div>
      </div>
    </GlobalDropzone>
  );
}
