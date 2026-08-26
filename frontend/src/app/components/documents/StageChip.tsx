// phase_2 §5.3, DESIGN.md §5.4 — a pill carrying BOTH a glyph and a word (never color
// alone), a determinate progress bar while in flight, and the §5.2 stageDetail sub-label.
// Reduced motion swaps the spinning glyph for the percentage as text — the user still
// needs to know work is in flight, just without the animation.
//
// Phase 7 §5.3: `doc.stage`/`doc.stageDetail` are now real backend fields
// (backend/src/models/Document.js) — the client-side status+progress derivation this
// component used to import from './stage' is deleted; the table reads the backend's own
// truth directly.
import { Circle, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { Progress } from '../ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import type { DocumentRecord, IngestStage } from '../../../api/contracts';
import { useReducedMotion } from '../../hooks/useReducedMotion';

const STAGE_META: Record<IngestStage, { label: string; pill: string; icon: 'hollow' | 'spin' | 'check' | 'x' }> = {
  queued:    { label: 'Queued',    pill: 'bg-surface-sunken text-graphite border-line', icon: 'hollow' },
  parsing:   { label: 'Parsing',   pill: 'bg-signal-soft text-signal border-signal-soft-line', icon: 'spin' },
  chunking:  { label: 'Chunking',  pill: 'bg-signal-soft text-signal border-signal-soft-line', icon: 'spin' },
  embedding: { label: 'Embedding', pill: 'bg-signal-soft text-signal border-signal-soft-line', icon: 'spin' },
  ready:     { label: 'Ready',     pill: 'bg-positive-soft text-positive-text border-positive-soft-line', icon: 'check' },
  failed:    { label: 'Failed',    pill: 'bg-critical-soft text-critical-text border-critical-soft-line', icon: 'x' },
};

type StageChipDoc = Pick<DocumentRecord, 'status' | 'stage' | 'stageDetail' | 'progress' | 'duplicateOfFileName'>;

export function StageChip({ doc }: { doc: StageChipDoc }) {
  const stage = doc.stage;
  const meta = STAGE_META[stage];
  const detail = doc.stageDetail;
  const reducedMotion = useReducedMotion();
  const inProgress = stage === 'parsing' || stage === 'chunking' || stage === 'embedding';
  const isDuplicate = doc.status === 'duplicate';

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5">
        <span className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${meta.pill}`}>
          {meta.icon === 'hollow' && <Circle className="size-3" aria-hidden />}
          {meta.icon === 'spin' && (
            reducedMotion
              ? <span className="text-[10px] tabular-nums" aria-hidden>{doc.progress}%</span>
              : <Loader2 className="size-3 animate-spin" aria-hidden />
          )}
          {meta.icon === 'check' && <CheckCircle2 className="size-3" aria-hidden />}
          {meta.icon === 'x' && <XCircle className="size-3" aria-hidden />}
          {meta.label}
        </span>
        {/* DESIGN.md §5.4 — a static label, not a button: it carries no hover/focus state,
            it's a statement about what the index already found, not an interaction. */}
        {isDuplicate && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex w-fit items-center rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-xs font-medium text-graphite">
                Duplicate
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {doc.duplicateOfFileName
                ? `Identical content was already ingested as ${doc.duplicateOfFileName}.`
                : 'Identical content was already ingested.'}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      {inProgress && (
        <div className="w-32">
          <Progress value={doc.progress} className="h-1" aria-label={`${meta.label} — ${doc.progress}%`} />
        </div>
      )}
      {detail && <span className="text-[11px] text-graphite">{detail}</span>}
    </div>
  );
}
