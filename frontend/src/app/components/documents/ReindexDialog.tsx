// DESIGN.md §7.4, phase_2 §7.3 task 2.19 — shown ONLY for a `ready` document; a `failed`
// one re-indexes directly (DocumentRow's ⋯ menu / inline Retry) without this confirm,
// because there is nothing to lose in that case.
import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { api, CerebroApiError } from '../../../api';
import type { DocumentRecord } from '../../../api/contracts';

interface ReindexDialogProps {
  doc: DocumentRecord;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReindexed: () => void;
}

export function ReindexDialog({ doc, open, onOpenChange, onReindexed }: ReindexDialogProps) {
  const [pending, setPending] = useState(false);

  async function confirm() {
    setPending(true);
    try {
      await api.documents.reingest(doc.id);
      onOpenChange(false);
      onReindexed();
    } catch (err) {
      toast.error('Could not start re-indexing', {
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
          <DialogTitle>Re-index "{doc.fileName}"?</DialogTitle>
          <DialogDescription>
            Re-indexing replaces this document's existing {doc.chunkCount} chunk{doc.chunkCount === 1 ? '' : 's'}.
            It re-runs parsing and embedding.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button onClick={confirm} disabled={pending}>{pending ? 'Starting…' : 'Re-index'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
