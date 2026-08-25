// phase_1 §2.6 / phase_3_chat_ui.md §4.4 — the streaming caret is the one deliberate motion
// exception: implemented as a discrete opacity STEP driven by JS on an interval, not a CSS
// @keyframes animation, so theme.css's blanket prefers-reduced-motion suppression (which
// zeroes every animation/transition duration) cannot freeze it invisible mid-blink. Under
// prefers-reduced-motion itself, though, it deliberately stops blinking and stays solid
// (opacity 1, no interval at all) — a user who suppresses motion still needs to see that the
// answer is still arriving, just without the flicker.
import { useEffect, useState } from 'react';
import { useReducedMotion } from '../../hooks/useReducedMotion';

export function StreamingCaret() {
  const reducedMotion = useReducedMotion();
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (reducedMotion) return;
    const id = setInterval(() => setVisible((v) => !v), 500);
    return () => clearInterval(id);
  }, [reducedMotion]);

  const opacity = reducedMotion ? 1 : visible ? 1 : 0;
  return <span aria-hidden="true" style={{ opacity }} className="text-signal">▍</span>;
}
