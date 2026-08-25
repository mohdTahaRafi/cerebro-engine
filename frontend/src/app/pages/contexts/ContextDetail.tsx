// phase_2 §4 — header (title + inline rename, Upload documents, New context, ⋯ → Delete),
// the whole-page dropzone (§4.2), the document table (§7), and the 380px evidence margin
// (§4.1) holding context identity + the upload target. Below 1024px the margin renders as
// a stacked panel above the table instead of a fixed-width column (task 2.8).
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { Folder, MoreHorizontal, Pencil, Plus, Upload } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { MockBadge } from '../../components/design/MockBadge';
import { ContextFormDialog } from '../../components/contexts/ContextFormDialog';
import { DeleteContextDialog } from '../../components/contexts/DeleteContextDialog';
import { ContextMetaPanel } from '../../components/contexts/ContextMetaPanel';
import { tintFor } from '../../components/contexts/ContextCard';
import { UploadDropzone } from '../../components/documents/UploadDropzone';
import { DocumentTable } from '../../components/documents/DocumentTable';
import { useDocuments } from '../../hooks/useDocuments';
import { useUploadQueue } from '../../hooks/useUploadQueue';
import { api, CerebroApiError } from '../../../api';
import type { KnowledgeContext, CreateContextRequest } from '../../../api/contracts';

export function ContextDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const contextId = id ?? '';

  const [context, setContext] = useState<KnowledgeContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { documents, refresh } = useDocuments(contextId);

  const loadContext = useCallback(async () => {
    if (!contextId) return;
    try {
      const c = await api.contexts.get(contextId);
      setContext(c);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof CerebroApiError ? err.message : 'Could not load this context.');
    }
  }, [contextId]);

  useEffect(() => { loadContext(); }, [loadContext]);
  // The header's document/chunk counts are computed off the same document list
  // useDocuments already polls — re-pull the context record whenever that list's length
  // changes so the two never visibly disagree.
  useEffect(() => { loadContext(); }, [documents.length, loadContext]);

  const { optimisticRows, enqueue } = useUploadQueue(contextId, documents, refresh);

  const handleUpdate = useCallback(async (cid: string, body: CreateContextRequest) => {
    const updated = await api.contexts.update(cid, body);
    setContext(updated);
    return updated;
  }, []);

  async function handleDelete(cid: string) {
    await api.contexts.delete(cid);
    navigate('/contexts');
  }

  function onPick(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) enqueue(Array.from(e.target.files));
    e.target.value = '';
  }

  if (!id) return <Navigate to="/contexts" replace />;

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-graphite">{loadError}</p>
        <Button onClick={() => navigate('/contexts')}>Back to contexts</Button>
      </div>
    );
  }

  if (!context) {
    return <div className="flex h-full items-center justify-center text-sm text-graphite">Loading…</div>;
  }

  const tint = tintFor(context.id);

  return (
    <>
      <UploadDropzone onFiles={enqueue}>
        {(target) => (
          <div className="flex h-full flex-col gap-6 overflow-y-auto p-8 lg:flex-row lg:overflow-hidden">
            <aside className="order-1 flex w-full shrink-0 flex-col gap-4 lg:order-2 lg:w-[380px] lg:overflow-y-auto">
              <ContextMetaPanel context={context} onUpdate={handleUpdate} />
              <div className="rounded-lg border border-line bg-surface-raised p-4 shadow-1">
                <h2 className="mb-3 font-semibold text-ink">Upload documents</h2>
                {target}
              </div>
            </aside>

            <div className="order-2 flex min-w-0 flex-1 flex-col gap-4 lg:order-1 lg:overflow-y-auto lg:pr-1">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${tint.bg} ${tint.text}`}>
                    <Folder className="size-5" aria-hidden />
                  </span>
                  <div>
                    <div className="flex items-center gap-1.5">
                      <h1 className="text-2xl font-bold text-ink">{context.title}</h1>
                      <Button variant="ghost" size="icon" className="size-7" aria-label="Rename context" onClick={() => setRenameOpen(true)}>
                        <Pencil className="size-3.5" />
                      </Button>
                      <MockBadge force title="Context assignment is local to this browser." />
                    </div>
                    <p className="text-sm text-graphite">{context.description || '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="size-4" /> Upload documents
                  </Button>
                  <input ref={fileInputRef} type="file" multiple className="hidden" onChange={onPick} />
                  <Button onClick={() => setCreateOpen(true)}>
                    <Plus className="size-4" /> New context
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon" aria-label="More context actions">
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <DocumentTable
                contextTitle={context.title}
                documents={documents}
                optimisticRows={optimisticRows}
                onChanged={() => { refresh(); loadContext(); }}
              />
            </div>
          </div>
        )}
      </UploadDropzone>

      <ContextFormDialog
        mode="edit" context={context} open={renameOpen} onOpenChange={setRenameOpen}
        onSubmit={(body) => handleUpdate(context.id, body)} focusField="name"
      />
      <ContextFormDialog
        mode="create" open={createOpen} onOpenChange={setCreateOpen}
        onSubmit={(body) => api.contexts.create(body)}
        onSuccess={(created) => { toast.success('Context created.'); navigate(`/contexts/${created.id}`); }}
      />
      <DeleteContextDialog context={context} open={deleteOpen} onOpenChange={setDeleteOpen} onDelete={handleDelete} />
    </>
  );
}
