// phase_4 §3.2 — row building and the `unaccounted` figure for the Waterfall. Ported
// verbatim in spirit from the old ExecutionPlan.tsx's `buildRows` (phase 6 §2.2's three
// honesty rules — see Waterfall.tsx's header comment for the full statement): every bar's
// position comes from the backend's MEASURED start offset, never a stacked reconstruction,
// and a stage with no duration gets no bar at all.
//
// Named `waterfallLayout.ts` rather than the spec's literal `waterfall.ts` (phase_4 §8's
// Files to Create) — that name collides with `Waterfall.tsx` on any case-insensitive
// filesystem (macOS default, Windows, and this dev environment), where `./waterfall`
// resolves to whichever of the two a case-insensitive directory lookup finds first. Deviation
// noted here per CLAUDE.md's spec-drift rule; phase_4's Files to Create section is amended
// to match.
import { STAGES } from '../core/TelemetryTypes.ts';
import type { PipelineTelemetry, StageSpec } from '../core/TelemetryTypes.ts';

export interface WaterfallRow {
  spec: StageSpec;
  startMs: number | null;
  durationMs: number | null;
  skipped: boolean;
  bracket: 'none' | 'top' | 'middle' | 'bottom';
}

export function buildWaterfallRows(t: PipelineTelemetry): WaterfallRow[] {
  return STAGES.map((spec, i) => {
    const group = spec.parallelGroup;
    const prev = STAGES[i - 1]?.parallelGroup;
    const next = STAGES[i + 1]?.parallelGroup;
    let bracket: WaterfallRow['bracket'] = 'none';
    if (group) {
      if (group !== prev && group === next) bracket = 'top';
      else if (group === prev && group === next) bracket = 'middle';
      else if (group === prev && group !== next) bracket = 'bottom';
    }
    const startMs = t[spec.startKey] as number | null;
    const durationMs = t[spec.durationKey] as number | null;
    return { spec, startMs, durationMs, skipped: durationMs == null || startMs == null, bracket };
  });
}

/** Every stage's measured span, keyed by its `parallelGroup` (or its own label when it has
 *  none) — the unit `computeUnaccountedMs` sums over. Grouping first is what keeps a
 *  concurrently-dispatched fan-out (embed+sparse+colpali) from being double-counted as the
 *  SUM of its members instead of the SPAN they actually occupied on the wall clock. */
function measuredSpans(t: PipelineTelemetry): number[] {
  const groups = new Map<string, { start: number; end: number }>();
  const ungrouped: number[] = [];

  for (const spec of STAGES) {
    const durationMs = t[spec.durationKey] as number | null;
    const startMs = t[spec.startKey] as number | null;
    if (durationMs == null || startMs == null) continue; // skipped — contributes nothing

    if (spec.parallelGroup) {
      const end = startMs + durationMs;
      const existing = groups.get(spec.parallelGroup);
      if (existing) {
        existing.start = Math.min(existing.start, startMs);
        existing.end = Math.max(existing.end, end);
      } else {
        groups.set(spec.parallelGroup, { start: startMs, end });
      }
    } else {
      ungrouped.push(durationMs);
    }
  }

  return [...ungrouped, ...[...groups.values()].map((g) => g.end - g.start)];
}

/** `totalMs − Σ(measured, non-overlapping stages)`, accounting for a parallel group by its
 *  SPAN rather than the sum of its members (phase_4 §3.2). Never negative — a telemetry
 *  object whose measured spans exceed `totalMs` (clock skew between node timers) reports
 *  zero rather than a nonsensical negative "unaccounted" figure. */
export function computeUnaccountedMs(t: PipelineTelemetry): number {
  const measured = measuredSpans(t).reduce((sum, span) => sum + span, 0);
  return Math.max(0, t.totalMs - measured);
}
