// Shared `prefers-reduced-motion` check — was duplicated inline in StageChip.tsx (phase_2
// §5.3); extracted here so StreamingCaret (phase_3_chat_ui.md §4.4, task 3.12) doesn't grow
// a third copy.
import { useEffect, useState } from 'react';

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}
