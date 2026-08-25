// phase_3_chat_ui.md §4 — the markdown pipeline. Both new plugins (remark-math,
// rehype-katex, rehype-highlight) are synchronous, which is the whole reason they were
// chosen (architecture.md §4): this component re-renders on every streamed token, and an
// async highlighter would either flash unstyled code or serialize highlighting behind
// token arrival.
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import 'katex/dist/katex.min.css';
import { StreamingCaret } from '../design/StreamingCaret';
import { CitationRef } from './CitationRef';
import { streamSafeMarkdown } from './streamSafeMarkdown';
import { MARKDOWN_COMPONENTS, HIGHLIGHT_LANGUAGES, HIGHLIGHT_ALIASES, HIGHLIGHT_SUBSET } from './markdownComponents';
import type { ProvenanceSource } from '../../../api/contracts';

// Rewrites bare "[N]" citation markers into a markdown link with a recognizable scheme
// (never matching a real URL), so react-markdown's ordinary link parsing does the token
// splitting for us instead of a hand-rolled text walker. `[N](` — an N already followed by
// a real link — is left untouched.
function withCitationLinks(markdown: string): string {
  return markdown.replace(/\[(\d+)\](?!\()/g, '[[$1]](#cite-$1)');
}

const REHYPE_PLUGINS: NonNullable<React.ComponentProps<typeof ReactMarkdown>['rehypePlugins']> = [
  // §4.1 amendment (2026-08-25) — rehype-katex's installed Options type omits
  // `throwOnError` entirely (it always catches a malformed expression internally and
  // renders it in `errorColor` rather than throwing); only `errorColor` and `strict` are
  // real knobs here. The effect the spec wants — a partial formula renders in --critical
  // for a few frames, then resolves once its closing delimiter arrives — is what
  // rehype-katex already does by default.
  [rehypeKatex, { errorColor: 'var(--critical)', strict: false }],
  // §4.1 amendment (2026-08-25) — `ignoreMissing` is not a real rehype-highlight v7
  // option (it predates the current lowlight-based API). Its effect is already the
  // default: a `code` block whose language isn't in `languages` just renders unhighlighted
  // rather than throwing. `languages` (not just `subset`) has to be restricted too —
  // `subset` alone only limits what `detect: true` guesses among; the languages a build
  // actually ships come from `languages`, which is what keeps the bundle at ~90 KB instead
  // of highlight.js's ~700 KB "common" default.
  [rehypeHighlight, { detect: true, subset: HIGHLIGHT_SUBSET, languages: HIGHLIGHT_LANGUAGES, aliases: HIGHLIGHT_ALIASES }],
];

interface AnswerBodyProps {
  answer: string;
  isStreaming: boolean;
  sources: ProvenanceSource[];
  interactiveCitations: boolean;
  activeCitation: number | null;
  onHoverCitation: (index: number | null) => void;
  onClickCitation: (index: number) => void;
}

export function AnswerBody({
  answer, isStreaming, sources, interactiveCitations, activeCitation, onHoverCitation, onClickCitation,
}: AnswerBodyProps) {
  const sourceCount = sources.length;
  // §4.2 — the fence/math/table guards apply ONLY while streaming; a completed answer
  // renders the raw buffer, since by then every construct has genuinely closed.
  const safeMarkdown = isStreaming ? streamSafeMarkdown(answer) : answer;
  const withLinks = withCitationLinks(safeMarkdown);

  const components = useMemo(() => ({
    ...MARKDOWN_COMPONENTS,
    a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
      const cite = /^#cite-(\d+)$/.exec(href ?? '');
      if (cite) {
        const index = Number(cite[1]);
        return (
          <CitationRef
            index={index}
            sourceCount={sourceCount}
            fileName={sources[index - 1]?.fileName}
            interactive={interactiveCitations}
            active={activeCitation === index}
            onHover={onHoverCitation}
            onClick={onClickCitation}
          />
        );
      }
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="text-signal underline underline-offset-2 hover:text-signal-hover">
          {children}
        </a>
      );
    },
  }), [sources, sourceCount, interactiveCitations, activeCitation, onHoverCitation, onClickCitation]);

  return (
    <div className="max-w-none text-[15px] leading-relaxed text-ink" aria-live="polite">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={REHYPE_PLUGINS}
        components={components}
      >
        {withLinks}
      </ReactMarkdown>
      {/* §4.4 — appended here, never concatenated into `answer` state, so it can never
          land in a persisted message or survive into a completed render. Placed after the
          whole tree rather than inside the last paragraph: markdown block structure
          (a table, a code fence, a list) makes "the last paragraph" an unreliable target,
          while "after the answer" is always correct regardless of what construct it ends on. */}
      {isStreaming && <StreamingCaret />}
    </div>
  );
}
