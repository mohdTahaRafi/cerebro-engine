// phase_2 §4 — header (title + inline rename), the whole-page dropzone (§4.2), the document table (§7), and the 380px evidence margin
// (§4.1) holding context identity + the upload target. Below 1024px the margin renders as
// a stacked panel above the table instead of a fixed-width column (task 2.8).
//
// The header's Upload documents / New context / ⋯ → Delete buttons were removed: upload
// duplicated the evidence margin's own dropzone (click-to-browse included), New context
// belongs on /contexts, and Delete moved into ContextMetaPanel's footer.
import { useCallback, useEffect, useState } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { Folder, Pencil } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { ContextFormDialog } from '../../components/contexts/ContextFormDialog';
import { ContextMetaPanel } from '../../components/contexts/ContextMetaPanel';
import { tintFor } from '../../components/contexts/ContextCard';
import { UploadDropzone } from '../../components/documents/UploadDropzone';
import { DocumentTable } from '../../components/documents/DocumentTable';
import { useDocuments } from '../../hooks/useDocuments';
import { useUploadQueue } from '../../hooks/useUploadQueue';
import { useContextScope } from '../../context/ContextScopeContext';
import { api, CerebroApiError } from '../../../api';
import type { KnowledgeContext, CreateContextRequest } from '../../../api/contracts';

export function ContextDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const contextId = id ?? '';

  const [context, setContext] = useState<KnowledgeContext | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);

  const { documents, refresh } = useDocuments(contextId);
  // Bug #1: this page manages its own `context` state and calls api.contexts.* directly,
  // bypassing both useContexts (the /contexts list's copy) and ContextScopeProvider (the
  // Chat switcher's copy). Renaming, deleting, or creating from here must invalidate the
  // shared scope too, or the new state stays invisible in Chat until a full reload.
  const { refresh: refreshScope } = useContextScope();

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
  // The header's document/chunk counts (denormalized onto Context — backend/src/contexts/
  // counters.js) are computed off the same document list useDocuments already polls.
  // Re-pull the context record whenever that list's length OR any row's status changes —
  // length alone missed the far more common case of a single upload: the list goes from
  // 0 to 1 document immediately (while it's still 'queued'), and length never changes
  // again as that same row moves through 'processing' to 'ready', so the real
  // documentCount bump on the backend was never picked up here. Also invalidates the
  // shared ContextScopeContext (the Chat switcher's copy — same staleness bug as #1, this
  // time triggered by ingestion completing rather than context creation): without it,
  // Composer stayed disabled with "Add a document to this context first." even after the
  // document the tooltip is about had genuinely finished and gone 'ready'.
  const documentsFingerprint = documents.map((d) => `${d.id}:${d.status}`).join(',');
  useEffect(() => { loadContext(); refreshScope(); }, [documentsFingerprint, loadContext, refreshScope]);

  const { optimisticRows, enqueue } = useUploadQueue(contextId, documents, refresh);

  const handleUpdate = useCallback(async (cid: string, body: CreateContextRequest) => {
    const updated = await api.contexts.update(cid, body);
    setContext(updated);
    refreshScope();
    return updated;
  }, [refreshScope]);

  async function handleDelete(cid: string) {
    await api.contexts.delete(cid);
    refreshScope();
    navigate('/contexts');
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
              <ContextMetaPanel context={context} onUpdate={handleUpdate} onDelete={handleDelete} />
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
                    </div>
                    <p className="text-sm text-graphite">{context.description || '—'}</p>
                  </div>
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
    </>
  );
}
