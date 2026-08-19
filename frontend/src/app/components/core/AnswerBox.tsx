import { motion } from 'motion/react';
import { Bot, AlertCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StreamingCaret } from '../design/StreamingCaret';

interface AnswerBoxProps {
  answer: string;
  isGenerating: boolean;
  error: string | null;
}

export function AnswerBox({ answer, isGenerating, error }: AnswerBoxProps) {
  if (!answer && !isGenerating && !error) {
    return null; // Don't show if nothing to display
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="relative m-4 overflow-hidden rounded-lg border border-line bg-surface-raised p-5 shadow-1"
    >
      <div className="mb-3 flex items-center gap-2 border-b border-line pb-2">
        <Bot className="size-5 text-signal" aria-hidden="true" />
        <h3 className="text-xs font-medium uppercase tracking-wide text-graphite">Cerebro</h3>
      </div>

      {error ? (
        <div className="flex items-center gap-2 text-sm text-critical">
          <AlertCircle className="size-4" aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : (
        <div
          className="prose prose-sm max-w-none text-base leading-relaxed text-ink"
          aria-live="polite"
        >
          {answer ? (
            <>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  strong: ({ ...props }) => <strong className="font-semibold text-ink" {...props} />,
                  code: ({ ...props }) => <code className="rounded-sm border border-line bg-surface-sunken px-1.5 py-0.5 text-sm text-signal" {...props} />,
                }}
              >
                {answer}
              </ReactMarkdown>
              {isGenerating && <StreamingCaret />}
            </>
          ) : (
            <span className="animate-pulse text-sm text-graphite">Analyzing knowledge base and synthesizing answer…</span>
          )}
        </div>
      )}
    </motion.div>
  );
}
