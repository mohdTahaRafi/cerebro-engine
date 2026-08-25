// DESIGN.md §3.2, §5.1 — "the center holds the answer, the right margin holds the
// evidence for it." Renders the sources for the transcript's current turn (the one the
// user is actively reading or just asked); scoped that way rather than stacking every past
// turn's citations, matching both reference screenshots, which each show one turn's
// evidence at a time. Also owns the PageImageLightbox (§5.2 / DESIGN.md §7.6) — the natural
// place, since it's the component that already knows every page source in citation order.
import { useState } from 'react';
import { FileText } from 'lucide-react';
import type { ProvenanceSource } from '../../../api/contracts';
import { CitationAccordion } from './CitationAccordion';
import { PageImageLightbox, type LightboxPage } from './PageImageLightbox';

interface EvidenceMarginProps {
  sources: ProvenanceSource[];
  expandedIndex: number | null;
  onToggle: (index: number) => void;
  activeIndex: number | null;
  /** Indices (1-based) known to reference a deleted document — DESIGN.md §5.6 body state 3. */
  unavailableIndices?: Set<number>;
}

export function EvidenceMargin({ sources, expandedIndex, onToggle, activeIndex, unavailableIndices }: EvidenceMarginProps) {
  const [lightboxOpenIndex, setLightboxOpenIndex] = useState<number | null>(null);

  // Page sources in citation order — the order PageImageLightbox's Left/Right arrows move
  // through (§5.2: "with a single page source the arrows are absent rather than disabled").
  const pages: LightboxPage[] = sources
    .map((source, i) => ({ source, index: i + 1 }))
    .filter((p) => p.source.kind === 'page' && p.source.imageUri);

  return (
    <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-[400px]" aria-label="Sources">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-graphite">Sources</h2>
        <span className="rounded-full bg-surface-sunken px-1.5 py-0.5 text-[11px] font-medium text-graphite">
          {sources.length}
        </span>
      </div>

      {sources.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-line px-4 py-10 text-center">
          <FileText className="size-5 text-graphite-faint" aria-hidden="true" />
          <p className="text-sm text-graphite">No sources yet</p>
          <p className="text-xs text-graphite-faint">Sources will appear here once you ask a question.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2" id="citation-list">
          {sources.map((source, i) => {
            const index = i + 1;
            const pagePos = pages.findIndex((p) => p.index === index);
            return (
              <CitationAccordion
                key={source.pointId || index}
                source={source}
                index={index}
                expanded={expandedIndex === index}
                onToggle={() => onToggle(index)}
                active={activeIndex === index}
                available={!unavailableIndices?.has(index)}
                onOpenImage={pagePos !== -1 ? () => setLightboxOpenIndex(pagePos) : undefined}
              />
            );
          })}
        </div>
      )}

      <PageImageLightbox pages={pages} openIndex={lightboxOpenIndex} onOpenIndexChange={setLightboxOpenIndex} />
    </aside>
  );
}
