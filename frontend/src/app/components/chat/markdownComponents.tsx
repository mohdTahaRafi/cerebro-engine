// phase_3_chat_ui.md §4.3 — generic markdown element overrides shared by every answer.
// Citation-marker interception ([N] → <CitationRef>) lives in AnswerBody.tsx, which owns
// the `a` override specifically because it needs per-turn hover/click state; everything
// else here is a pure, stateless mapping from element to styled output.
import { useState, type ReactNode } from 'react';
import { Children, isValidElement } from 'react';
import { Check, Copy } from 'lucide-react';
import type { Components } from 'react-markdown';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import bash from 'highlight.js/lib/languages/bash';
import go from 'highlight.js/lib/languages/go';
import rust from 'highlight.js/lib/languages/rust';
import java from 'highlight.js/lib/languages/java';

// §4.1 — the twelve-language subset (js ts jsx tsx python sql json yaml bash go rust java)
// instead of highlight.js's 190-language default. `languages` controls what actually ships
// in the bundle (~90 KB vs ~700 KB); `subset`, passed separately to rehype-highlight, is
// what `detect: true` is allowed to guess among. jsx/tsx are not separate grammars — the
// javascript/typescript grammars already parse JSX syntax — so they're registered as
// aliases rather than pulling in two more highlight.js language files.
export const HIGHLIGHT_LANGUAGES = { javascript, typescript, python, sql, json, yaml, bash, go, rust, java };
export const HIGHLIGHT_ALIASES = { javascript: ['js', 'jsx'], typescript: ['ts', 'tsx'] };
export const HIGHLIGHT_SUBSET = [
  'javascript', 'typescript', 'jsx', 'tsx', 'python', 'sql', 'json', 'yaml', 'bash', 'go', 'rust', 'java',
];

function extractText(node: ReactNode): string {
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(extractText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return extractText(node.props.children);
  return '';
}

function CodeBlock({ className, children }: { className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const lang = /language-(\S+)/.exec(className ?? '')?.[1] ?? null;
  const text = extractText(children);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(text.replace(/\n$/, ''));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="group/code relative mb-3 overflow-hidden rounded-lg border border-line bg-surface-sunken last:mb-0">
      {lang && (
        <span className="pointer-events-none absolute right-2 top-1.5 text-[10px] font-medium uppercase tracking-wide text-graphite-faint">
          {lang}
        </span>
      )}
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Copied' : 'Copy code'}
        // Visible on hover AND on focus — a hover-only reveal is unreachable by keyboard.
        className="absolute right-2 top-7 flex items-center gap-1 rounded-sm border border-line bg-surface-raised px-1.5 py-1 text-[11px] text-graphite opacity-0 outline-none transition-opacity hover:text-ink focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-signal-ring group-hover/code:opacity-100"
      >
        {copied ? <Check className="size-3 text-positive" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre className="overflow-x-auto px-3.5 pb-3 pt-7 text-[13px] leading-relaxed">
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

export const MARKDOWN_COMPONENTS: Components = {
  p: (props) => <p className="mb-3 last:mb-0" {...props} />,
  strong: (props) => <strong className="font-semibold text-ink" {...props} />,
  ul: (props) => <ul className="mb-3 list-disc space-y-1 pl-5 last:mb-0" {...props} />,
  ol: (props) => <ol className="mb-3 list-decimal space-y-1 pl-5 last:mb-0" {...props} />,
  // A `pre` always wraps a single `code` child in the markdown → hast pipeline (a fenced
  // block); everything CodeBlock needs (language class, raw text) comes off that child.
  pre: ({ children }) => {
    const child = Children.only(children);
    const codeProps = isValidElement<{ className?: string; children?: ReactNode }>(child) ? child.props : {};
    return <CodeBlock className={codeProps.className}>{codeProps.children}</CodeBlock>;
  },
  // Inline code spans never reach here with a `pre` ancestor — rehype-highlight only
  // touches `pre > code`, so an inline span's className is always undefined.
  code: (props) => (
    <code className="rounded-sm border border-line bg-surface-sunken px-1.5 py-0.5 text-[0.85em] text-ink-secondary" {...props} />
  ),
  table: (props) => (
    <div className="mb-3 overflow-x-auto rounded-md border border-line last:mb-0">
      <table className="w-full border-collapse text-sm" {...props} />
    </div>
  ),
  thead: (props) => <thead className="bg-surface-sunken" {...props} />,
  th: (props) => <th className="border-b border-line px-2 py-1.5 text-left font-medium text-ink-secondary" {...props} />,
  td: (props) => <td className="border-b border-line-subtle px-2 py-1.5" {...props} />,
  blockquote: (props) => <blockquote className="mb-3 border-l-[3px] border-line-strong pl-3 text-ink-secondary last:mb-0" {...props} />,
  // §4.3 — retrieved document text is untrusted; an `img` URL is an outbound request from
  // an authenticated session, so images are never fetched. Alt text stands in for it.
  img: ({ alt }) => <span className="text-graphite-faint">{alt}</span>,
};
