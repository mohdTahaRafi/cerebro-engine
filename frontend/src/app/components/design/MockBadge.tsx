// phase_1 §4.4 — reads MOCKED_ENDPOINTS and renders a small "MOCK" chip in the corner of
// any panel whose data came from the mock adapter. `IS_MOCKED` is `false` (a folded
// compile-time constant) in a production build, so this compiles to `null` there.
//
// phase_2 §1.1, §7.4 — `force` bypasses that check for the one case that isn't a dev-only
// convenience: contexts have no backend model until Phase 6, so /contexts and
// /contexts/:id carry this badge in EVERY build, honestly telling a real user that this
// particular panel's data is local to their browser, not the workaround-y "you're in dev
// mode" signal `IS_MOCKED` means everywhere else.
import { IS_MOCKED } from '../../../api';

export function MockBadge({ className, force, title }: { className?: string; force?: boolean; title?: string }) {
  if (!IS_MOCKED && !force) return null;
  return (
    <span
      className={`rounded-full bg-warn-soft px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warn-text ${className ?? ''}`}
      title={title ?? "This panel's data comes from the dev-only mock adapter"}
    >
      Mock
    </span>
  );
}
