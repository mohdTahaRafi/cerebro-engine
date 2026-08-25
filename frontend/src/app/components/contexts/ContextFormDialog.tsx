// phase_2 §3.3, §3.4 — one dialog component for create, rename, and edit-description.
// Create: both fields start empty, Name autofocused. Edit: pre-filled, submit stays
// disabled until a value actually differs from the current one (task 2.5) — a no-op save
// that still shows a success toast trains users to distrust the toast.
//
// Radix keeps DialogContent's React subtree mounted between opens (it only toggles
// presence/animation, not the component instance), so this does NOT get a fresh
// useState() for free on every open the way a truly-remounted dialog would — confirmed
// live: reopening after Cancel showed the previous open's stale, over-length text. The
// effect below resets the fields explicitly; the `key` on the two inputs (tied to `open`)
// forces THEM to remount so `autoFocus` fires again each time, without needing a ref
// (Input/Textarea aren't wrapped in forwardRef, so a ref silently no-ops under React 18).
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Label } from '../ui/label';
import { CerebroApiError } from '../../../api';
import type { KnowledgeContext, CreateContextRequest } from '../../../api/contracts';

const NAME_MAX = 80;
const DESCRIPTION_MAX = 280;
const DESCRIPTION_COUNTER_THRESHOLD = 240;

interface ContextFormDialogProps {
  mode: 'create' | 'edit';
  context?: KnowledgeContext | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (body: CreateContextRequest) => Promise<KnowledgeContext>;
  onSuccess?: (ctx: KnowledgeContext) => void;
  focusField?: 'name' | 'description';
}

export function ContextFormDialog({
  mode, context, open, onOpenChange, onSubmit, onSuccess, focusField,
}: ContextFormDialogProps) {
  const initialTitle = context?.title ?? '';
  const initialDescription = context?.description ?? '';
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) { setTitle(initialTitle); setDescription(initialDescription); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const trimmedTitle = title.trim();
  const titleValid = trimmedTitle.length >= 1 && trimmedTitle.length <= NAME_MAX;
  const descriptionValid = description.length <= DESCRIPTION_MAX;
  const changed = mode === 'create' || title !== initialTitle || description !== initialDescription;
  const canSubmit = titleValid && descriptionValid && changed && !pending;

  async function handleSubmit() {
    if (!canSubmit) return;
    setPending(true);
    try {
      const result = await onSubmit({ title: trimmedTitle, description: description.trim() || undefined });
      onOpenChange(false);
      onSuccess?.(result);
    } catch (err) {
      toast.error(mode === 'create' ? 'Could not create context' : 'Could not save changes', {
        description: err instanceof CerebroApiError ? err.message : 'Try again in a moment.',
        duration: Infinity,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'New context' : 'Edit context'}</DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? "A context holds a set of documents you want to ask questions about."
              : `Update "${initialTitle}"'s name or description.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="context-name">Name</Label>
            <Input
              key={`name-${open}`}
              id="context-name" value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={NAME_MAX + 20}
              aria-invalid={!titleValid && title.length > 0}
              placeholder="Q3 Reports"
              autoFocus={focusField !== 'description'}
            />
            {title.length > NAME_MAX && (
              <p role="alert" className="text-xs text-critical-text">
                Names are limited to {NAME_MAX} characters ({title.length} entered).
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="context-description">Description</Label>
              {description.length > DESCRIPTION_COUNTER_THRESHOLD && (
                <span className={`text-xs tabular-nums ${description.length > DESCRIPTION_MAX ? 'text-critical-text' : 'text-graphite'}`}>
                  {description.length}/{DESCRIPTION_MAX}
                </span>
              )}
            </div>
            <Textarea
              key={`description-${open}`}
              id="context-description" value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={DESCRIPTION_MAX + 40}
              rows={3}
              aria-invalid={!descriptionValid}
              placeholder="What's in this context?"
              autoFocus={focusField === 'description'}
            />
            {!descriptionValid && (
              <p role="alert" className="text-xs text-critical-text">
                Descriptions are limited to {DESCRIPTION_MAX} characters.
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {pending ? (mode === 'create' ? 'Creating…' : 'Saving…') : (mode === 'create' ? 'Create context' : 'Save changes')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
