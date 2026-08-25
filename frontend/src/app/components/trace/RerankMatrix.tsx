// phase_4 §3.3 — the PRD's explicit side-by-side framing (US-4.2) of ProvenancePanel.tsx's
// preserved logic: fusionRank → finalRank with the delta, branch attribution, absorbed-OCR
// counts. A single table sorted by final rank hides the movement; two columns joined by
// connectors make it legible.
import { useState } from 'react';
import type { ProvenanceSource } from '../../../api/contracts';
import { RelevanceFloorRule } from './RelevanceFloorRule';
import { cn } from '../ui/utils';

const ROW_H = 32; // px — uniform row height lets connector geometry be computed from array
                   // index alone, with no DOM measurement / ResizeObserver on every render.

const BRANCH_ABBR: Record<NonNullable<ProvenanceSource['branch']>, string> = {
  dense: 'DNSE', sparse: 'SPRS', both: 'BOTH', colpali: 'COLP',
};

function candidateLabel(c: ProvenanceSource): string {
  const loc = c.page != null ? `p${c.page}` : c.headingPath ?? '';
  return `${c.fileName ?? 'unknown'}${loc ? ` ${loc}` : ''}`;
}

/** ProvenancePanel.tsx's absorbed-OCR-chunk count, preserved (§3.3) — a scanned page whose
 *  neighboring OCR chunks were merged into it during retrieval, surfaced as a small badge
 *  rather than silently dropped in the v2 port. */
function AbsorbedBadge({ count }: { count: number }) {
  return (
    <span
      className="shrink-0 text-[9px] font-medium text-graphite"
      title={`${count} OCR chunk(s) absorbed into this page`}
    >
      OCR×{count}
    </span>
  );
}

interface Row {
  candidate: ProvenanceSource;
  index: number; // position within its own column, drives connector Y
}

function LeftRow({ row, hovered, onHover }: { row: Row; hovered: boolean; onHover: (id: string | null) => void }) {
  const { candidate: c } = row;
  return (
    <div
      className={cn('flex items-center gap-2 rounded-sm px-1.5 text-xs transition-colors', hovered && 'bg-surface-sunken')}
      style={{ height: ROW_H }}
      onMouseEnter={() => onHover(c.pointId)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="w-5 shrink-0 text-right tabular-nums text-graphite">{c.fusionRank}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{candidateLabel(c)}</span>
      {c.absorbedChunks && c.absorbedChunks.length > 0 && <AbsorbedBadge count={c.absorbedChunks.length} />}
      {c.branch && (
        <span className="shrink-0 rounded-sm border border-line bg-surface-sunken px-1 py-0.5 text-[9px] font-medium tracking-wide text-graphite">
          {BRANCH_ABBR[c.branch]}
        </span>
      )}
    </div>
  );
}

function SurvivorRow({ row, hovered, onHover }: { row: Row; hovered: boolean; onHover: (id: string | null) => void }) {
  const { candidate: c } = row;
  const delta = c.fusionRank != null && c.finalRank != null ? c.fusionRank - c.finalRank : null;
  return (
    <div
      className={cn('flex items-center gap-2 rounded-sm px-1.5 text-xs transition-colors', hovered && 'bg-surface-sunken')}
      style={{ height: ROW_H }}
      onMouseEnter={() => onHover(c.pointId)}
      onMouseLeave={() => onHover(null)}
    >
      <span className="w-5 shrink-0 text-right tabular-nums text-graphite">{c.finalRank}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{candidateLabel(c)}</span>
      <span className="shrink-0 xl:hidden text-[10px] text-graphite">
        {c.fusionRank}→{c.finalRank}
      </span>
      <span
        className="w-14 shrink-0 text-right font-medium tabular-nums text-ink"
        title={c.score != null ? `rerank score: ${c.score.toFixed(4)}` : undefined}
      >
        {c.score != null ? c.score.toFixed(2) : '—'}
      </span>
      {delta != null && delta !== 0 && (
        <span className={cn('w-8 shrink-0 text-right text-[10px] font-medium', delta > 0 ? 'text-signal' : 'text-graphite')}>
          {delta > 0 ? '▲' : '▼'}{Math.abs(delta)}
        </span>
      )}
    </div>
  );
}

function CutRow({ row, hovered, onHover }: { row: Row; hovered: boolean; onHover: (id: string | null) => void }) {
  const { candidate: c } = row;
  return (
    <div
      className={cn('flex items-center gap-2 rounded-sm px-1.5 text-xs text-graphite transition-colors', hovered && 'bg-surface-sunken')}
      style={{ height: ROW_H }}
      onMouseEnter={() => onHover(c.pointId)}
      onMouseLeave={() => onHover(null)}
      title="Below the relevance floor — never assigned a final rank"
    >
      <span className="w-5 shrink-0 text-right">✕</span>
      <span className="min-w-0 flex-1 truncate line-through">{candidateLabel(c)}</span>
      <span className="w-14 shrink-0 text-right tabular-nums line-through">
        {c.score != null ? c.score.toFixed(2) : '—'}
      </span>
    </div>
  );
}

interface RerankMatrixProps {
  candidates: ProvenanceSource[]; // full pre-floor set, fusionRank + finalRank + belowFloor
  relevanceFloor: number;
  rerankSkipped: boolean;
}

export function RerankMatrix({ candidates, relevanceFloor, rerankSkipped }: RerankMatrixProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const left: Row[] = [...candidates]
    .sort((a, b) => (a.fusionRank ?? Infinity) - (b.fusionRank ?? Infinity))
    .map((candidate, index) => ({ candidate, index }));

  if (rerankSkipped) {
    return (
      <section className="flex flex-col gap-2" aria-label="Reranking delta matrix">
        <div className="flex flex-col xl:flex-row xl:gap-6">
          <div className="w-full xl:w-1/2">
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-graphite">
              Retrieved (fusion order)
            </h3>
            <div className="flex flex-col">
              {left.map((row) => <LeftRow key={row.candidate.pointId} row={row} hovered={false} onHover={() => {}} />)}
            </div>
            <p className="mt-1 text-[11px] text-graphite">{left.length} candidates</p>
          </div>
          <div className="mt-4 w-full xl:mt-0 xl:w-1/2">
            <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-graphite">
              Reranked (final order)
            </h3>
            <p className="rounded-md border border-warn-soft-line bg-warn-soft px-3 py-2 text-xs text-warn-text">
              Reranking was unavailable; results are in fusion order.
            </p>
          </div>
        </div>
      </section>
    );
  }

  const survivors: Row[] = [...candidates]
    .filter((c) => !c.belowFloor)
    .sort((a, b) => (a.finalRank ?? Infinity) - (b.finalRank ?? Infinity))
    .map((candidate, i) => ({ candidate, index: i }));
  const cut: Row[] = [...candidates]
    .filter((c) => c.belowFloor)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((candidate, i) => ({ candidate, index: survivors.length + 1 + i })); // +1 for the rule row

  const rightRowCount = survivors.length + (cut.length > 0 ? 1 : 0) + cut.length;
  const svgRows = Math.max(left.length, rightRowCount);
  const svgHeight = svgRows * ROW_H;

  // Right-column index for a given candidate — survivors keep their computed index;
  // a cut candidate's index already accounts for the rule row above it.
  const rightIndexOf = new Map<string, number>();
  survivors.forEach((r) => rightIndexOf.set(r.candidate.pointId, r.index));
  cut.forEach((r) => rightIndexOf.set(r.candidate.pointId, r.index));

  return (
    <section className="flex flex-col gap-2" aria-label="Reranking delta matrix">
      <div className="flex flex-col xl:flex-row xl:items-start xl:gap-0">
        <div className="w-full xl:w-1/2">
          <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-graphite">
            Retrieved (fusion order)
          </h3>
          <div className="flex flex-col">
            {left.map((row) => (
              <LeftRow key={row.candidate.pointId} row={row} hovered={hoveredId === row.candidate.pointId} onHover={setHoveredId} />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-graphite">{left.length} candidates</p>
        </div>

        {/* Connector gutter — wide viewports only; below xl each SurvivorRow shows an inline
            "fusionRank→finalRank" glyph instead (§3.3's stacked-viewport fallback). */}
        <div className="relative hidden shrink-0 xl:block" style={{ width: 56, height: svgHeight }}>
          <svg width="100%" height={svgHeight} viewBox={`0 0 56 ${svgHeight}`} preserveAspectRatio="none" className="absolute inset-0">
            {left.map((row) => {
              const rightIndex = rightIndexOf.get(row.candidate.pointId);
              if (rightIndex == null) return null;
              const y1 = row.index * ROW_H + ROW_H / 2;
              const y2 = rightIndex * ROW_H + ROW_H / 2;
              const promoted = row.candidate.fusionRank != null && row.candidate.finalRank != null
                && row.candidate.finalRank < row.candidate.fusionRank;
              const isHovered = hoveredId === row.candidate.pointId;
              return (
                <path
                  key={row.candidate.pointId}
                  d={`M 0 ${y1} C 28 ${y1} 28 ${y2} 56 ${y2}`}
                  fill="none"
                  stroke={promoted ? 'var(--signal)' : 'var(--graphite-faint)'}
                  strokeWidth={isHovered ? 2 : 1.5}
                  opacity={hoveredId == null ? 0.4 : isHovered ? 1 : 0.15}
                  style={{ transition: 'opacity 120ms, stroke-width 120ms' }}
                />
              );
            })}
          </svg>
        </div>

        <div className="mt-4 w-full xl:mt-0 xl:w-1/2">
          <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wide text-graphite">
            Reranked (final order)
          </h3>
          <div className="flex flex-col">
            {survivors.map((row) => (
              <SurvivorRow key={row.candidate.pointId} row={row} hovered={hoveredId === row.candidate.pointId} onHover={setHoveredId} />
            ))}
            {cut.length > 0 && <RelevanceFloorRule floor={relevanceFloor} />}
            {cut.map((row) => (
              <CutRow key={row.candidate.pointId} row={row} hovered={hoveredId === row.candidate.pointId} onHover={setHoveredId} />
            ))}
          </div>
          <p className="mt-1 text-[11px] text-graphite">
            {survivors.length} survived{cut.length > 0 && ` · ${cut.length} below floor`}
          </p>
        </div>
      </div>
    </section>
  );
}
