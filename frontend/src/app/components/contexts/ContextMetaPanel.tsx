// phase_2 §4.1 — the detail page's right-margin identity card: Name/Description (each with
// its own inline edit pencil, matching the reviewed reference screen — both open the same
// ContextFormDialog per §3.4, just pre-focused on the field its pencil sits next to),
// Created, Last updated, and the live document count. No "chunks" or "last query" line —
// dropped versus the phase doc's ASCII sketch: chunk count already sits in the header via
// the card grid, and "last query" has no real data source until Phase 3 wires chat
// integration to a context (DESIGN.md's "a number that wasn't measured is not displayed").
// Delete sits at the bottom, under a divider — the one home for it since the header's and
// the context cards' ⋯ menus were removed.
import { useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '../ui/button';
import { ContextFormDialog } from './ContextFormDialog';
import { DeleteContextDialog } from './DeleteContextDialog';
import type { KnowledgeContext, CreateContextRequest } from '../../../api/contracts';

function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

interface ContextMetaPanelProps {
  context: KnowledgeContext;
  onUpdate: (id: string, body: CreateContextRequest) => Promise<KnowledgeContext>;
  onDelete: (id: string) => Promise<void>;
}

export function ContextMetaPanel({ context, onUpdate, onDelete }: ContextMetaPanelProps) {
  const [renameOpen, setRenameOpen] = useState(false);
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div className="rounded-lg border border-line bg-surface-raised p-4 shadow-1">
      <h2 className="mb-3 font-semibold text-ink">Context details</h2>
      <dl className="flex flex-col gap-3 text-sm">
        <div>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium uppercase tracking-wide text-graphite">Name</dt>
            <Button variant="ghost" size="icon" className="size-6" aria-label="Rename context" onClick={() => setRenameOpen(true)}>
              <Pencil className="size-3.5" />
            </Button>
          </div>
          <dd className="text-ink">{context.title}</dd>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium uppercase tracking-wide text-graphite">Description</dt>
            <Button variant="ghost" size="icon" className="size-6" aria-label="Edit description" onClick={() => setDescriptionOpen(true)}>
              <Pencil className="size-3.5" />
            </Button>
          </div>
          <dd className="text-ink-secondary">{context.description || '—'}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-graphite">Created</dt>
          <dd className="text-ink-secondary">{formatAbsolute(context.createdAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-graphite">Last updated</dt>
          <dd className="text-ink-secondary">{formatAbsolute(context.updatedAt)}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-graphite">Documents</dt>
          <dd className="tabular-nums text-ink-secondary">{context.documentCount}</dd>
        </div>
      </dl>
      <div className="mt-4 border-t border-line-subtle pt-3">
        <Button
          variant="ghost" size="sm"
          className="-ml-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={() => setDeleteOpen(true)}
        >
          <Trash2 className="size-4" /> Delete context
        </Button>
      </div>
      <ContextFormDialog
        mode="edit" context={context} open={renameOpen} onOpenChange={setRenameOpen}
        onSubmit={(body) => onUpdate(context.id, body)} focusField="name"
      />
      <ContextFormDialog
        mode="edit" context={context} open={descriptionOpen} onOpenChange={setDescriptionOpen}
        onSubmit={(body) => onUpdate(context.id, body)} focusField="description"
      />
      <DeleteContextDialog context={context} open={deleteOpen} onOpenChange={setDeleteOpen} onDelete={onDelete} />
    </div>
  );
}
