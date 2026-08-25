// phase_3_chat_ui.md §5.2, DESIGN.md §7.6 — a full-screen overlay of a page image at its
// natural size. Built on the same Radix Dialog primitive as every other dialog in the
// product (ui/dialog.tsx), which is what supplies the focus trap, Escape-to-close, and
// focus-return-to-trigger for free — this is the one overlay in the product that isn't a
// decision (no confirm, no destructive action), so it takes no Cancel of its own; Radix's
// built-in close (Escape, backdrop click) is the whole interaction.
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/dialog';
import type { ProvenanceSource } from '../../../api/contracts';

export interface LightboxPage {
  source: ProvenanceSource;
  index: number; // 1-based citation index, for the caption
}

interface PageImageLightboxProps {
  pages: LightboxPage[];
  openIndex: number | null; // position within `pages`, not the citation index
  onOpenIndexChange: (index: number | null) => void;
}

export function PageImageLightbox({ pages, openIndex, onOpenIndexChange }: PageImageLightboxProps) {
  const open = openIndex != null;
  const current = openIndex != null ? pages[openIndex] : null;
  const hasMultiple = pages.length > 1;

  const goTo = (delta: number) => {
    if (openIndex == null) return;
    const next = (openIndex + delta + pages.length) % pages.length;
    onOpenIndexChange(next);
  };

  if (!current) return null;

  const fileName = current.source.fileName ?? 'Unknown document';
  const caption = current.source.page != null ? `${fileName} · page ${current.source.page}` : fileName;

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onOpenIndexChange(null); }}>
      <DialogContent
        className="flex h-screen max-h-none w-screen max-w-none translate-x-0 translate-y-0 flex-col items-center justify-center gap-0 rounded-none border-none bg-black/90 p-0 top-0 left-0"
        onKeyDown={(e) => {
          if (!hasMultiple) return;
          if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(-1); }
          if (e.key === 'ArrowRight') { e.preventDefault(); goTo(1); }
        }}
      >
        {/* Radix requires an accessible name + description; visually hidden since the
            visible caption below already carries the same information for sighted users. */}
        <DialogTitle className="sr-only">{caption}</DialogTitle>
        <DialogDescription className="sr-only">Full-size scanned page image.</DialogDescription>

        {hasMultiple && (
          <button
            type="button"
            onClick={() => goTo(-1)}
            aria-label="Previous page"
            className="absolute left-4 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
          >
            <ChevronLeft className="size-6" aria-hidden="true" />
          </button>
        )}

        <img
          src={current.source.imageUri ?? undefined}
          alt={caption}
          className="max-h-[85vh] max-w-[90vw] rounded-md object-contain shadow-2xl"
        />

        <p className="mt-4 text-sm text-white/80">{caption}</p>

        {hasMultiple && (
          <button
            type="button"
            onClick={() => goTo(1)}
            aria-label="Next page"
            className="absolute right-4 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white outline-none transition-colors hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white"
          >
            <ChevronRight className="size-6" aria-hidden="true" />
          </button>
        )}
      </DialogContent>
    </Dialog>
  );
}
