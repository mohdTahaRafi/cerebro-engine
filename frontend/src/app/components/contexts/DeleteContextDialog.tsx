// phase_2 §3.5 — typed confirmation, not Yes/No: deleting a context destroys documents,
// vectors, page images, uploaded files, and every conversation held in it. Conversation
// count is always 0 in this phase — conversations aren't scoped to a context until Phase 3
// wires chat integration, so there are, honestly, zero of them tied to any context yet.
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { CerebroApiError } from '../../../api';
import type { KnowledgeContext } from '../../../api/contracts';

interface DeleteContextDialogProps {
  context: KnowledgeContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDelete: (id: string) => Promise<void>;
}

export function DeleteContextDialog({ context, open, onOpenChange, onDelete }: DeleteContextDialogProps) {
  const [typed, setTyped] = useState('');
  const [pending, setPending] = useState(false);
  const matches = typed.trim() === context.title;
  const isEmpty = context.documentCount === 0;

  async function confirm() {
    if (!matches) return;
    setPending(true);
    try {
      await onDelete(context.id);
      onOpenChange(false);
    } catch (err) {
      toast.error('Could not delete context', {
        description: err instanceof CerebroApiError ? err.message : 'Try again in a moment.',
        duration: Infinity,
      });
    } finally {
      setPending(false);
      setTyped('');
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setTyped(''); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete "{context.title}"</DialogTitle>
          <DialogDescription>
            {isEmpty
              ? 'This context is empty. Deleting it cannot be undone.'
              : `This permanently deletes ${context.documentCount} document${context.documentCount === 1 ? '' : 's'}, `
                + `${context.chunkCount.toLocaleString()} indexed chunk${context.chunkCount === 1 ? '' : 's'}, and 0 conversations. `
                + 'It cannot be undone.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="delete-confirm">Type the context name to confirm.</Label>
          <Input
            id="delete-confirm" value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={context.title}
            autoComplete="off"
          />
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button variant="destructive" onClick={confirm} disabled={!matches || pending}>
            {pending ? 'Deleting…' : 'Delete context'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
