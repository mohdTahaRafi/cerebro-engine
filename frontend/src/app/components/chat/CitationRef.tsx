// DESIGN.md §5.6 "Linkage with the answer" — hovering [1] in the answer highlights
// accordion 1 and vice versa; clicking [1] scrolls the accordion into view and expands it.
// A [N] whose number exceeds the source count renders as plain text: the model occasionally
// cites a number it wasn't given, and a button that scrolls to nothing is worse than an
// unstyled bracket.
import { cn } from '../ui/utils';

interface CitationRefProps {
  index: number;
  sourceCount: number;
  fileName?: string | null;
  /** false for any turn other than the one the evidence margin is currently showing —
   *  its [N] markers still render with the citation styling, just without hover/click. */
  interactive: boolean;
  active: boolean;
  onHover: (index: number | null) => void;
  onClick: (index: number) => void;
}

export function CitationRef({ index, sourceCount, fileName, interactive, active, onHover, onClick }: CitationRefProps) {
  if (index > sourceCount) return <>[{index}]</>;

  // task 3.25 — "Source 1, q3-earnings.pdf": the number alone isn't enough context for a
  // screen reader user, who can't see the accordion it points at.
  const label = fileName ? `Source ${index}, ${fileName}` : `Source ${index}`;

  if (!interactive) {
    return <sup className="mx-0.5 text-[0.7em] font-semibold text-signal">[{index}]</sup>;
  }

  return (
    <button
      type="button"
      onMouseEnter={() => onHover(index)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onHover(index)}
      onBlur={() => onHover(null)}
      onClick={() => onClick(index)}
      aria-label={label}
      className={cn(
        'mx-0.5 -translate-y-[0.4em] inline-flex h-[1.3em] items-center rounded px-1 align-baseline text-[0.7em] font-semibold text-signal outline-none transition-colors hover:bg-signal-soft focus-visible:ring-2 focus-visible:ring-signal-ring',
        active && 'bg-signal-soft',
      )}
    >
      [{index}]
    </button>
  );
}
