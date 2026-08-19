// phase_1 §2.6 — the streaming caret is the one deliberate motion exception: implemented
// as a discrete opacity STEP driven by JS on an interval, not a CSS @keyframes
// animation, so theme.css's blanket `prefers-reduced-motion` suppression (which zeroes
// every animation/transition duration) cannot freeze it invisible. A user who suppresses
// motion still needs to know the answer is still arriving.
import { useEffect, useState } from 'react';

export function StreamingCaret() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const id = setInterval(() => setVisible((v) => !v), 500);
    return () => clearInterval(id);
  }, []);
  return <span aria-hidden="true" style={{ opacity: visible ? 1 : 0 }} className="text-signal">▍</span>;
}
