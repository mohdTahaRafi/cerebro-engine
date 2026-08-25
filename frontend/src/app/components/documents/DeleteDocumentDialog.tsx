// phase_2 §7.3, §7.2 task 2.20 — single-step confirm naming the file(s); the toast reads
// the real `deletedPoints` count the endpoint returns (never invented), summed across a
// bulk selection. Doubles as the bulk-delete confirm (§7.2's header-checkbox selection).
import { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Button } from '../ui/button';
import { api } from '../../../api';
import type { DocumentRecord } from '../../../api/contracts';

interface DeleteDocumentDialogProps {
  docs: DocumentRecord[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}

export function DeleteDocumentDialog({ docs, open, onOpenChange, onDeleted }: DeleteDocumentDialogProps) {
  const [pending, setPending] = useState(false);
  const isBulk = docs.length > 1;

  async function confirm() {
    setPending(true);
    let deletedPoints = 0;
    let failures = 0;
    for (const doc of docs) {
      try {
        const res = await api.documents.remove(doc.id);
        deletedPoints += res.deletedPoints;
      } catch {
        failures += 1;
      }
    }
    setPending(false);
    onOpenChange(false);
    onDeleted();
    if (!isBulk) {
      if (failures > 0) {
        toast.error(`Could not delete ${docs[0].fileName}`, { description: 'Try again in a moment.', duration: Infinity });
      } else {
        toast.success(`${docs[0].fileName} deleted. ${deletedPoints} indexed chunk${deletedPoints === 1 ? '' : 's'} removed.`);
      }
      return;
    }
    const succeeded = docs.length - failures;
    if (failures === 0) {
      toast.success(`${succeeded} document${succeeded === 1 ? '' : 's'} deleted. ${deletedPoints} indexed chunks removed.`);
    } else {
      toast.error(
        `${succeeded} document${succeeded === 1 ? '' : 's'} deleted, ${failures} failed. ${deletedPoints} indexed chunks removed.`,
        { duration: Infinity },
      );
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isBulk ? `Delete ${docs.length} documents?` : `Delete "${docs[0]?.fileName}"?`}</DialogTitle>
          <DialogDescription>
            {isBulk
              ? 'This permanently removes the selected files and their indexed chunks. It cannot be undone.'
              : 'This permanently removes the file and its indexed chunks. It cannot be undone.'}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button variant="destructive" onClick={confirm} disabled={pending || docs.length === 0}>
            {pending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
