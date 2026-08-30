// DESIGN.md §5.6 — "the most important component in the product." Lives in the evidence
// margin. Index badge matches the [N] marker in the answer text; score is labeled "rerank
// score" (never "confidence" — a cross-encoder score is not a probability); rank movement
// is fusionRank → finalRank, the single most informative fact about a retrieval.
import { useState } from 'react';
import { ChevronRight, Copy, Check, ImageOff } from 'lucide-react';
import type { ProvenanceSource } from '../../../api/contracts';
import { cn } from '../ui/utils';

const BRANCH_LABEL: Record<NonNullable<ProvenanceSource['branch']>, string> = {
  dense: 'Dense', sparse: 'Sparse', both: 'Dense+Sparse', colpali: 'ColPali',
};

function RankMovement({ fusionRank, finalRank }: { fusionRank: number | null; finalRank: number | null }) {
  if (fusionRank == null || finalRank == null) return <span className="text-graphite">—</span>;
  const delta = fusionRank - finalRank;
  const color = delta > 0 ? 'text-positive-text' : delta < 0 ? 'text-critical-text' : 'text-graphite';
  return (
    <span className="inline-flex items-center gap-1 text-graphite">
      rank {fusionRank}
      <ChevronRight className="size-3" aria-hidden="true" />
      {finalRank}
      {delta !== 0 && <span className={color}>{delta > 0 ? '↑' : '↓'}</span>}
    </span>
  );
}

interface CitationAccordionProps {
  source: ProvenanceSource;
  index: number;
  expanded: boolean;
  onToggle: () => void;
  active: boolean;
  /** Deleted-source annotation (DESIGN.md §5.6, body state 3) — absent on a live turn. */
  available?: boolean;
  /** §5.2 / DESIGN.md §7.6 — opens PageImageLightbox on this source. Present only for a
   *  `kind: 'page'` source that actually has an image to show. */
  onOpenImage?: () => void;
}

export function CitationAccordion({ source, index, expanded, onToggle, active, available = true, onOpenImage }: CitationAccordionProps) {
  const [copied, setCopied] = useState(false);
  // A live turn's source always has text; a resumed thread's persisted source never does
  // (Message.sources doesn't store chunk text) — body state 2 in §5.6.
  const resumed = source.text == null;

  const handleCopy = async () => {
    if (!source.text) return;
    await navigator.clipboard.writeText(source.text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const fileName = source.fileName ?? 'Unknown document';
  const locationLine = source.headingPath
    ? source.page != null ? `${source.headingPath} · page ${source.page}` : source.headingPath
    : source.page != null ? `page ${source.page}` : null;

  return (
    <div
      id={`citation-${index}`}
      className={cn(
        'rounded-lg border bg-surface-raised transition-colors',
        active ? 'border-signal-soft-line bg-signal-soft' : 'border-line',
        !available && 'opacity-60',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-lg"
      >
        <ChevronRight className={cn('mt-0.5 size-3.5 shrink-0 text-graphite transition-transform', expanded && 'rotate-90')} aria-hidden="true" />
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-signal text-[11px] font-semibold text-signal-on">
          {index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-medium text-ink">
              {fileName}{!available && <span className="text-graphite"> (deleted)</span>}
            </span>
            {source.score != null && (
              <span
                className="shrink-0 rounded-sm bg-surface-sunken px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-graphite"
                title={`rerank score: ${source.score.toFixed(4)}`}
              >
                {source.score.toFixed(2)}
              </span>
            )}
          </span>
          {locationLine && <span className="mt-0.5 block truncate text-xs text-graphite">{locationLine}</span>}
        </span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-2 px-3 pb-3 pl-[42px]">
          {source.kind === 'page' && (
            source.imageUri ? (
              <button
                type="button"
                onClick={onOpenImage}
                className="w-fit rounded-md outline-none focus-visible:ring-[3px] focus-visible:ring-signal-ring"
                title="View full page"
              >
                <img
                  src={source.imageUri}
                  alt={`Scanned page ${source.page ?? ''} of ${fileName}`}
                  className="h-24 w-[96px] rounded-md border border-line object-cover transition-opacity hover:opacity-90"
                  loading="lazy"
                />
              </button>
            ) : (
              <div className="flex h-24 w-[96px] items-center justify-center rounded-md border border-line bg-surface-sunken">
                <ImageOff className="size-4 text-graphite" aria-hidden="true" />
              </div>
            )
          )}

          {resumed ? (
            <p className="text-xs italic text-graphite">Text isn't stored for past conversations.</p>
          ) : (
            <blockquote className="rounded-md border border-line-subtle bg-surface-sunken px-3 py-2 text-xs leading-relaxed text-ink-secondary">
              “{source.text}”
            </blockquote>
          )}

          <div className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              {source.branch && (
                <span className="rounded-sm border border-line bg-surface-sunken px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-graphite">
                  {BRANCH_LABEL[source.branch]}
                </span>
              )}
              <RankMovement fusionRank={source.fusionRank} finalRank={source.finalRank} />
            </span>
            {!resumed && (
              <button
                type="button"
                onClick={handleCopy}
                className="flex items-center gap-1 text-xs text-graphite outline-none transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-signal-ring rounded-sm"
                title="Copy the retrieved chunk text"
              >
                {copied ? <Check className="size-3 text-positive" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
