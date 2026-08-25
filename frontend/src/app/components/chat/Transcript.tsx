// phase_3_chat_ui.md §3.1, §3.4 — list rendering, scroll anchoring, and the empty states.
// Anchored to the bottom ONLY while the user is already within 100px of it; a user who has
// scrolled up to read a citation must not be yanked down by an arriving token. Implemented
// with a scroll listener + a ref and a direct scrollTop assignment, never scrollIntoView on
// every token — scrollIntoView at 30 tokens/second is a layout thrash and fights the user's
// own scrolling.
import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowDown, Waypoints } from 'lucide-react';
import { Turn } from './Turn';
import type { Turn as TurnModel } from '../../hooks/useTranscript';
import type { KnowledgeContext } from '../../../api/contracts';

const PIN_THRESHOLD_PX = 100;

const EXAMPLE_TEMPLATES: Array<(fileName: string) => string> = [
  (f) => `What does ${f} cover?`,
  (f) => `Summarize the key points in ${f}.`,
  (f) => `What can I ask about ${f}?`,
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

interface TranscriptProps {
  turns: TurnModel[];
  activeContext: KnowledgeContext | null;
  contextIsEmpty: boolean;
  exampleFileNames: string[];
  onExampleClick: (question: string) => void;
  activeCitation: number | null;
  onHoverCitation: (index: number | null) => void;
  onClickCitation: (index: number) => void;
  onRegenerate: () => void;
  onRetry: () => void;
}

export function Transcript({
  turns, activeContext, contextIsEmpty, exampleFileNames, onExampleClick,
  activeCitation, onHoverCitation, onClickCitation, onRegenerate, onRetry,
}: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const [showJumpPill, setShowJumpPill] = useState(false);
  const hasContent = turns.length > 0;
  const lastTurn = turns[turns.length - 1];

  const scrollToBottom = () => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distanceFromBottom < PIN_THRESHOLD_PX;
    pinnedRef.current = atBottom;
    if (atBottom) setShowJumpPill(false);
  };

  // Sticks to the bottom as new tokens/turns arrive, but ONLY while already pinned — this
  // is the one place scroll position is mutated by the app; while pinnedRef is false this
  // effect makes zero scroll-position mutations (§11's perf validation row).
  useEffect(() => {
    if (pinnedRef.current) {
      scrollToBottom();
    } else if (hasContent) {
      setShowJumpPill(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns.length, lastTurn?.answer, lastTurn?.status]);

  const handleJumpToLatest = () => {
    pinnedRef.current = true;
    setShowJumpPill(false);
    scrollToBottom();
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-8 py-8 custom-scrollbar"
      >
        <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col">
          {!hasContent ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-1 flex-col items-center justify-center gap-6 text-center"
            >
              <div className="flex size-14 items-center justify-center rounded-2xl bg-signal-soft">
                <Waypoints className="size-6 text-signal" aria-hidden="true" />
              </div>

              {contextIsEmpty ? (
                <div className="flex flex-col items-center gap-2">
                  <h1 className="text-2xl font-bold tracking-tight text-ink">{activeContext!.title} is empty</h1>
                  <p className="max-w-sm text-sm text-graphite">
                    Add a document to this context before asking a question.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  <h1 className="text-3xl font-bold tracking-tight text-ink">
                    How can I help you <span className="text-signal">today</span>?
                  </h1>
                  <p className="text-sm text-graphite">Ask anything about your documents.</p>
                </div>
              )}

              {exampleFileNames.length > 0 && (
                <div className="flex w-full max-w-lg flex-col gap-2">
                  {exampleFileNames.map((fileName, i) => {
                    const question = EXAMPLE_TEMPLATES[i % EXAMPLE_TEMPLATES.length](fileName);
                    return (
                      <button
                        key={fileName + i}
                        type="button"
                        onClick={() => onExampleClick(question)}
                        className="rounded-xl border border-line bg-surface-raised px-4 py-3 text-left text-sm text-ink-secondary outline-none transition-colors hover:border-line-strong hover:bg-surface-sunken focus-visible:ring-[3px] focus-visible:ring-signal-ring"
                      >
                        {question}
                      </button>
                    );
                  })}
                </div>
              )}
            </motion.div>
          ) : (
            // task 3.25 — a labelled log region: an assistive-tech user gets each turn
            // announced as it's added, without the whole transcript re-announcing itself.
            <motion.div
              key="transcript"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-1 flex-col gap-10 pb-4"
              role="log"
              aria-label="Conversation"
              aria-live="polite"
            >
              {turns.map((turn) => (
                <Turn
                  key={turn.id}
                  question={turn.question}
                  timestamp={formatTime(turn.createdAt)}
                  answer={turn.answer}
                  status={turn.status}
                  error={turn.error}
                  sources={turn.sources}
                  telemetry={turn.telemetry}
                  traceId={turn.traceId}
                  isLast={turn.id === lastTurn?.id}
                  interactiveCitations={turn.id === lastTurn?.id}
                  activeCitation={activeCitation}
                  onHoverCitation={onHoverCitation}
                  onClickCitation={onClickCitation}
                  onRegenerate={onRegenerate}
                  onRetry={onRetry}
                />
              ))}
            </motion.div>
          )}
        </div>
      </div>

      {showJumpPill && (
        <button
          type="button"
          onClick={handleJumpToLatest}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-line bg-surface-overlay px-3.5 py-1.5 text-xs font-medium text-ink shadow-2 outline-none transition-colors hover:bg-surface-sunken focus-visible:ring-[3px] focus-visible:ring-signal-ring"
        >
          <ArrowDown className="size-3.5" aria-hidden="true" />
          Jump to latest
        </button>
      )}
    </div>
  );
}
