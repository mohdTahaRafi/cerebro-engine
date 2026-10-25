// phase_4 §4.9 — replaces DimensionAnalysis (deleted this phase). Per-dimension
// "variance and contribution" over a 1024-dim Cohere embedding is not a quantity this system
// computes, and individual dimensions of a learned embedding aren't interpretable the way
// that panel implied. This is real data instead: one row per document, its cloud color, its
// chunk count, and a visibility toggle that dims that document's points in place — it
// directly serves "is my clustering clean."
import { useMemo } from 'react';
import { Eye, EyeOff } from 'lucide-react';

interface LegendDoc { id: string; fileName: string; color: number }

interface DocumentLegendProps {
  documents: LegendDoc[];
  docIndex: Uint16Array;
  hidden: Set<number>;
  onToggle: (docIdx: number) => void;
}

function hexCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function DocumentLegend({ documents, docIndex, hidden, onToggle }: DocumentLegendProps) {
  const counts = useMemo(() => {
    const c = new Array(documents.length).fill(0);
    for (let i = 0; i < docIndex.length; i++) c[docIndex[i]] = (c[docIndex[i]] ?? 0) + 1;
    return c;
  }, [documents.length, docIndex]);

  return (
    <div className="flex flex-col gap-1" aria-label="Document legend">
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-graphite">Documents</h2>
      {documents.map((doc, i) => {
        const isHidden = hidden.has(i);
        return (
          <button
            key={doc.id}
            type="button"
            onClick={() => onToggle(i)}
            aria-pressed={!isHidden}
            title={isHidden ? `${doc.fileName} — hidden, click to show` : `${doc.fileName} — click to dim`}
            // `group` is load-bearing, not decoration: the Eye icon below is styled
            // `group-hover:opacity-100`, and with no group ancestor that variant never
            // matches — the icon sat permanently at opacity-0, so a visible document
            // showed no affordance at all while a hidden one showed EyeOff.
            className="group flex items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none transition-colors hover:bg-surface-sunken focus-visible:ring-[3px] focus-visible:ring-signal-ring"
          >
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: hexCss(doc.color), opacity: isHidden ? 0.25 : 1 }}
              aria-hidden="true"
            />
            <span className={`min-w-0 flex-1 truncate text-xs ${isHidden ? 'text-graphite' : 'text-ink'}`}>
              {doc.fileName}
            </span>
            <span className="shrink-0 text-[11px] tabular-nums text-graphite">{counts[i] ?? 0}</span>
            {isHidden
              ? <EyeOff className="size-3 shrink-0 text-graphite" aria-hidden="true" />
              : <Eye className="size-3 shrink-0 text-graphite opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />}
          </button>
        );
      })}
    </div>
  );
}
