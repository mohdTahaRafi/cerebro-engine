import React, { useEffect, useRef, useState } from 'react';
import { Square, RotateCcw } from 'lucide-react';
import { useEngine } from '../context/EngineContext';
import { AnswerBox } from '../components/core/AnswerBox';
import { ChatInput } from '../components/ui/ChatInput';
import { SourceChip } from '../components/ui/SourceChip';
import { GlobalDropzone } from '../components/ui/GlobalDropzone';
import { ThreadSidebar } from '../components/ui/ThreadSidebar';
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
    fileName: s.fileName, page: s.page, headingPath: s.headingPath, text: s.text,
  };
}

function fromThreadSource(s: ThreadSource, i: number): DisplaySource {
  return {
    key: s.pointId || String(i), kind: s.kind, score: s.score, documentId: s.documentId,
    fileName: s.available ? s.fileName : `${s.fileName ?? 'Document'} (deleted)`, page: s.page,
  };
}

export function ConsumerDashboard() {
  const {
    sources, answer, isGenerating, chatError, threadId,
    askCerebro, loadThread, startNewThread, stopGenerating, regenerate,
  } = useEngine();
  const { fetchThread } = useThreads();

  const [turns, setTurns] = useState<DisplayTurn[]>([]);
  const [refreshSignal, setRefreshSignal] = useState(0);
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
    // A turn that just finished streaming means the thread list's lastMessageAt/title
    // (a brand-new thread) may have changed — nudge the sidebar to refetch.
    if (wasGenerating.current && !isGenerating) {
      liveTurnId.current = null;
      setRefreshSignal((n) => n + 1);
    }
    wasGenerating.current = isGenerating;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [answer, sources, isGenerating, chatError]);

  const handleQuery = (query: string) => {
    const id = `live-${Date.now()}`;
    liveTurnId.current = id;
    setTurns((prev) => [...prev, { id, question: query, answer: '', sources: [], isStreaming: true }]);
    // Attachments no longer scope retrieval here: /api/ask scopes by Mongo document _id
    // (scopeDocumentIds), and attachedSources still holds the legacy /api/ingest upload
    // path — a different id space the new pipeline doesn't read. See EngineContext's
    // askCerebro doc comment.
    askCerebro(query);
  };

  const handleSelectThread = async (id: string) => {
    liveTurnId.current = null;
    loadThread(id);
    try {
      const { messages } = await fetchThread(id);
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
    } catch (err) {
      console.error('Failed to load thread:', err);
    }
  };

  const handleNewThread = () => {
    liveTurnId.current = null;
    startNewThread();
    setTurns([]);
  };

  const hasContent = turns.length > 0;
  const lastTurn = turns[turns.length - 1];

  return (
    <GlobalDropzone>
      <div className="flex-1 flex h-full overflow-hidden">
        <ThreadSidebar
          activeThreadId={threadId}
          onSelectThread={handleSelectThread}
          onNewThread={handleNewThread}
          refreshSignal={refreshSignal}
        />

        <div className="flex-1 flex flex-col bg-[#050505] relative overflow-hidden h-full">
          <div className={`flex-1 flex flex-col w-full max-w-3xl mx-auto px-6 transition-all duration-700 ease-in-out ${hasContent ? 'pt-8 pb-40' : 'justify-center pb-20'}`}>

            <AnimatePresence>
              {!hasContent && (
                <motion.div
                  initial={{ opacity: 0, y: -20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -20, height: 0, margin: 0 }}
                  className="flex flex-col items-center gap-4 mb-12"
                >
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-gray-800 to-black border border-[#333] shadow-[0_0_40px_rgba(255,255,255,0.05)] flex items-center justify-center">
                    <div className="w-4 h-4 bg-white rounded-sm animate-pulse"></div>
                  </div>
                  <h1 className="text-3xl font-semibold text-gray-200 tracking-tight">How can I help you?</h1>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {hasContent && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex-1 overflow-y-auto custom-scrollbar flex flex-col gap-8 w-full pr-4 pb-12"
                >
                  {turns.map((turn) => (
                    <div key={turn.id} className="flex flex-col gap-3">
                      <div className="self-end max-w-[80%] px-4 py-2.5 rounded-2xl bg-[#1a1a1a] border border-[#333] text-gray-200 text-sm">
                        {turn.question}
                      </div>

                      <AnswerBox answer={turn.answer} isGenerating={turn.isStreaming} error={turn.error ?? null} />

                      {turn.sources.length > 0 && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: 0.3 }}
                          className="flex flex-col gap-3 pl-4 border-l-2 border-[#333]"
                        >
                          <span className="text-[10px] uppercase tracking-widest text-gray-500 font-bold font-mono">Sources Analyzed</span>
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
                          className="self-start flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-gray-500 hover:text-gray-300 font-mono transition-colors"
                          title="Regenerate response"
                        >
                          <RotateCcw size={12} />
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
                <div className="flex justify-center mb-3">
                  <button
                    onClick={stopGenerating}
                    className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#1a1a1a] border border-[#444] text-gray-300 hover:border-[#666] hover:text-white text-xs font-mono transition-colors"
                  >
                    <Square size={12} fill="currentColor" />
                    Stop generating
                  </button>
                </div>
              )}
              <ChatInput onSearch={handleQuery} isSearching={isGenerating} />
              <div className="text-center mt-3 text-[10px] text-gray-500 font-mono tracking-wide">
                Cerebro Engine operates entirely offline. No data leaves your machine.
              </div>
            </div>

          </div>
        </div>
      </div>
    </GlobalDropzone>
  );
}
