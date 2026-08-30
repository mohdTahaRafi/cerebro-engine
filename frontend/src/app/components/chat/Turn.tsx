// DESIGN.md §6.7 "Turn structure": Question bubble (right-aligned) → answer body →
// ProvenanceRibbon → Regenerate (last completed turn only). phase_3_chat_ui.md §3.2 — a
// refused turn (backend's noContext node, §5.2 in refusals.ts) is a correct, successful
// answer, not a failure, and gets its own muted treatment: no citation margin, no
// regenerate, an inline suggestion instead.
import { AlertCircle, RotateCcw, Sparkles, Waypoints } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { userInitials } from '../core/UserMenu';
import { useAuth } from '../../context/AuthContext';
import { AnswerBody } from './AnswerBody';
import { ProvenanceRibbon, type TurnStatus } from './ProvenanceRibbon';
import type { PipelineTelemetry, ProvenanceSource } from '../../../api/contracts';

interface TurnProps {
  question: string;
  timestamp: string;
  answer: string;
  status: TurnStatus;
  error: string | null;
  sources: ProvenanceSource[];
  telemetry: PipelineTelemetry | null;
  traceId: string | null;
  isLast: boolean;
  interactiveCitations: boolean;
  activeCitation: number | null;
  onHoverCitation: (index: number | null) => void;
  onClickCitation: (index: number) => void;
  onRegenerate: () => void;
  onRetry: () => void;
}

export function Turn({
  question, timestamp, answer, status, error, sources, telemetry, traceId,
  isLast, interactiveCitations, activeCitation, onHoverCitation, onClickCitation, onRegenerate, onRetry,
}: TurnProps) {
  const { user } = useAuth();

  const isStreaming = status === 'streaming';
  const refused = status === 'refused';
  // §3.2 — a refused turn gets no regenerate: re-running produces the identical fixed
  // string and costs a retrieval for nothing.
  const canRegenerate = isLast && status === 'complete' && answer.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Question bubble — right-aligned per DESIGN.md §6.7 */}
      <div className="flex flex-col items-end gap-1 self-end">
        <div className="flex max-w-[80%] items-start gap-2.5 rounded-2xl border border-line bg-surface-raised px-4 py-2.5">
          <Avatar className="mt-0.5 size-6 shrink-0">
            {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
            <AvatarFallback className="bg-ink text-[10px] font-semibold text-surface">
              {user ? userInitials(user.name, user.email) : '?'}
            </AvatarFallback>
          </Avatar>
          <p className="text-sm leading-relaxed text-ink">{question}</p>
        </div>
        <span className="pr-1 text-[11px] text-graphite">{timestamp}</span>
      </div>

      {/* Answer body */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <Waypoints className="size-4 text-signal" aria-hidden="true" />
          <span className="text-xs font-semibold uppercase tracking-wide text-graphite">Cerebro</span>
        </div>

        {error ? (
          <div className="flex flex-col gap-2 pl-6">
            {answer && (
              // §7.3 — partial text is never discarded; it's what the model actually said.
              <div className="opacity-70">
                <AnswerBody
                  answer={answer}
                  isStreaming={false}
                  sources={sources}
                  interactiveCitations={false}
                  activeCitation={null}
                  onHoverCitation={() => {}}
                  onClickCitation={() => {}}
                />
              </div>
            )}
            <div className="flex items-start gap-2 rounded-lg border border-critical-soft-line bg-critical-soft px-3.5 py-2.5 text-sm text-critical-text">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <p>{error}</p>
            </div>
            {/* onRetry always retries the transcript's actual last turn (useTranscript has
                no per-turn retry, only "retry the one that just errored") — gated on
                isLast so an old errored turn, now stranded behind a newer successful one,
                never offers a Retry that would silently act on the wrong turn. */}
            {isLast && (
              <button
                type="button"
                onClick={onRetry}
                className="flex w-fit items-center gap-1.5 text-xs font-medium text-signal outline-none transition-colors hover:text-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm"
              >
                <RotateCcw className="size-3" aria-hidden="true" />
                Retry
              </button>
            )}
          </div>
        ) : refused ? (
          <div className="flex flex-col gap-2 pl-6">
            <p className="text-sm leading-relaxed text-graphite">{answer}</p>
            <p className="flex items-center gap-1.5 text-xs text-graphite">
              <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
              Try widening your question, or add a document that covers this topic.
            </p>
          </div>
        ) : answer ? (
          <div className="pl-6">
            <AnswerBody
              answer={answer}
              isStreaming={isStreaming}
              sources={sources}
              interactiveCitations={interactiveCitations}
              activeCitation={activeCitation}
              onHoverCitation={onHoverCitation}
              onClickCitation={onClickCitation}
            />
          </div>
        ) : (
          <p className="animate-pulse pl-6 text-sm text-graphite">Analyzing knowledge base and synthesizing answer…</p>
        )}

        {!error && (answer || isStreaming) && (
          <div className="pl-6">
            <ProvenanceRibbon status={status} telemetry={telemetry} sources={sources} traceId={traceId} />
          </div>
        )}

        {canRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            className="ml-6 mt-1 flex w-fit items-center gap-1.5 text-xs text-graphite outline-none transition-colors hover:text-ink-secondary focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm"
            title="Regenerate response"
          >
            <RotateCcw className="size-3" aria-hidden="true" />
            Regenerate
          </button>
        )}
      </div>
    </div>
  );
}
