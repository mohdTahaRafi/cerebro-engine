// phase_1 §4.4 — reads MOCKED_ENDPOINTS and renders a small "MOCK" chip in the corner of
// any panel whose data came from the mock adapter. `IS_MOCKED` is `false` (a folded
// compile-time constant) in a production build, so this compiles to `null` there.
import { IS_MOCKED } from '../../../api';

export function MockBadge({ className }: { className?: string }) {
  if (!IS_MOCKED) return null;
  return (
    <span
      className={`rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn-text ${className ?? ''}`}
      title="This panel's data comes from the dev-only mock adapter"
    >
      Mock
    </span>
  );
}
