// phase_4 §3.4 — the raw payload drawer, in the evidence margin. Three tabs: Prompt (labeled
// regions, never one JSON blob), Sources (the full pre-floor candidate set, the escape
// hatch), Usage (provider-reported token counts, "not reported" — never 0 — when absent).
import { useState } from 'react';
import { Copy, Check, AlertTriangle } from 'lucide-react';
import type { TraceDetail } from '../../../api/contracts';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs';

function approxTokenLabel(n: number | null): string | null {
  return n != null ? `~${n.toLocaleString()} tokens` : null;
}

const BLOCK_TITLE: Record<string, string> = {
  'system-text': 'SYSTEM', 'user-text': 'USER · text', 'user-image': 'USER · image',
};

function PromptTab({ trace }: { trace: TraceDetail }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[11px] text-graphite">
        Estimated with <code className="text-[10px]">js-tiktoken</code> (cl100k). The
        provider's own count is shown under Usage when reported.
      </p>
      {trace.prompt.map((block, i) => (
        <div key={i} className="rounded-md border border-line">
          <div className="flex items-center justify-between border-b border-line-subtle bg-surface-sunken px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-graphite">
            <span>{BLOCK_TITLE[`${block.role}-${block.kind}`] ?? `${block.role} · ${block.kind}`}</span>
            {approxTokenLabel(block.approxTokens) && <span>{approxTokenLabel(block.approxTokens)}</span>}
          </div>
          {block.kind === 'image' ? (
            <div className="flex items-center gap-3 p-3">
              <img src={block.content} alt="Source page thumbnail" className="h-16 w-12 shrink-0 rounded-sm border border-line object-cover" loading="lazy" />
              <span className="min-w-0 truncate text-xs text-graphite" title={block.content}>{block.content}</span>
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words p-3 text-xs leading-relaxed text-ink-secondary">{block.content}</pre>
          )}
        </div>
      ))}
      {trace.prompt.length === 0 && <p className="text-xs text-graphite">No prompt captured for this trace.</p>}
    </div>
  );
}

function SourcesTab({ trace }: { trace: TraceDetail }) {
  const [copied, setCopied] = useState(false);
  const copyAll = async () => {
    await navigator.clipboard.writeText(JSON.stringify(trace.candidates, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void copyAll()}
        className="flex w-fit items-center gap-1.5 self-end rounded-sm text-xs text-graphite outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-signal-ring"
      >
        {copied ? <Check className="size-3 text-positive" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
        {copied ? 'Copied' : 'Copy all'}
      </button>
      {trace.candidates.map((c) => (
        <details key={c.pointId} className="rounded-md border border-line">
          <summary className="cursor-pointer select-none px-3 py-1.5 text-xs text-ink">
            #{c.fusionRank ?? '—'} · {c.fileName ?? 'unknown'} {c.page != null ? `p${c.page}` : ''}
          </summary>
          <pre className="whitespace-pre-wrap break-words border-t border-line-subtle bg-surface-sunken p-3 text-[11px] leading-relaxed text-ink-secondary">
            {JSON.stringify(c, null, 2)}
          </pre>
        </details>
      ))}
    </div>
  );
}

function UsageTab({ trace }: { trace: TraceDetail }) {
  if (!trace.tokens) {
    return <p className="text-xs text-graphite">Usage not reported for this trace.</p>;
  }
  const { provider, model, input, output } = trace.tokens;
  const rows: Array<[string, string]> = [
    ['Provider', provider],
    ['Model', model],
    ['Input tokens', input != null ? input.toLocaleString() : 'not reported'],
    ['Output tokens', output != null ? output.toLocaleString() : 'not reported'],
  ];
  return (
    <dl className="flex flex-col gap-2 text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-baseline justify-between border-b border-line-subtle pb-1.5">
          <dt className="text-graphite">{label}</dt>
          <dd className="font-medium tabular-nums text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PayloadDrawer({ trace }: { trace: TraceDetail }) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-ink">Raw payload</h2>
      {trace.truncated && (
        <div className="flex items-start gap-2 rounded-md border border-warn-soft-line bg-warn-soft px-3 py-2 text-xs text-warn-text">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          This prompt exceeded the 256 KB capture limit and was truncated.
        </div>
      )}
      <Tabs defaultValue="prompt">
        <TabsList>
          <TabsTrigger value="prompt">Prompt</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="usage">Usage</TabsTrigger>
        </TabsList>
        <TabsContent value="prompt"><PromptTab trace={trace} /></TabsContent>
        <TabsContent value="sources"><SourcesTab trace={trace} /></TabsContent>
        <TabsContent value="usage"><UsageTab trace={trace} /></TabsContent>
      </Tabs>
    </div>
  );
}
