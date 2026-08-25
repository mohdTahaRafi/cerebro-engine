// phase_3_chat_ui.md §5.2 "Hover and click linkage" — the shared [N] ↔ accordion state.
// Scoped to the transcript's current turn (the evidence margin only ever shows one turn's
// sources at a time, §5.1), so this is a single hook instance at the page level, not
// per-turn: hovering [1] in the answer tints accordion 1 in the margin and vice versa;
// clicking [1] scrolls the accordion into view and expands it.
import { useCallback, useEffect, useRef, useState } from 'react';

export function useCitationHover() {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(1);
  const autoExpandedTurnIdRef = useRef<string | null>(null);

  const onHover = useCallback((index: number | null) => setActiveIndex(index), []);

  const onToggleAccordion = useCallback((index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  }, []);

  const onClickCitation = useCallback((index: number) => {
    setExpandedIndex(index);
    document.getElementById(`citation-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);

  // Auto-expands the first source once the current turn actually HAS sources — not when
  // the turn is first created (it starts with sources: [] and gets them a moment later via
  // the SSE 'sources' frame). Gating on id-change alone would fire once too early, set
  // expandedIndex back to null for an empty list, and never fire again once sources land.
  const autoExpandFirst = useCallback((turnId: string, sourceCount: number) => {
    if (sourceCount > 0 && autoExpandedTurnIdRef.current !== turnId) {
      autoExpandedTurnIdRef.current = turnId;
      setExpandedIndex(1);
    }
  }, []);

  const resetForNewTurn = useCallback(() => {
    autoExpandedTurnIdRef.current = null;
    setActiveIndex(null);
    setExpandedIndex(1);
  }, []);

  return { activeIndex, expandedIndex, onHover, onToggleAccordion, onClickCitation, autoExpandFirst, resetForNewTurn };
}

// Small convenience so callers don't need their own effect for the auto-expand rule.
export function useAutoExpandFirstSource(
  autoExpandFirst: (turnId: string, sourceCount: number) => void,
  turnId: string | undefined,
  sourceCount: number,
) {
  useEffect(() => {
    if (turnId) autoExpandFirst(turnId, sourceCount);
  }, [autoExpandFirst, turnId, sourceCount]);
}
