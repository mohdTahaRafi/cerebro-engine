// phase_3_chat_ui.md §7.1 — textarea, attachments, send/stop. Attachments upload into the
// active context through Phase 2's useUploadQueue (owned one level up, in Chat.tsx, since
// GlobalDropzone wraps the whole page and needs the same `enqueue`). A question asked while
// an attachment is still ingesting is QUEUED, not blocked: sending immediately would run
// retrieval against a corpus that provably doesn't contain the file the user just attached.
import { useEffect, useRef, useState } from 'react';
import TextareaAutosize from 'react-textarea-autosize';
import { ArrowUp, FileText, Loader2, Paperclip, Square } from 'lucide-react';
import { StageChip } from '../documents/StageChip';
import { useContextScope } from '../../context/ContextScopeContext';
import type { DocumentRecord } from '../../../api/contracts';
import type { OptimisticRow } from '../../hooks/useUploadQueue';

interface QueuedSend {
  query: string;
  scopeDocumentIds: string[];
}

interface ComposerProps {
  onSend: (query: string, contextId: string | null, scopeDocumentIds?: string[]) => void;
  isGenerating: boolean;
  stopGenerating: () => void;
  documents: DocumentRecord[];
  optimisticRows: OptimisticRow[];
  pendingDocIds: string[];
  isSettling: boolean;
  enqueue: (files: File[]) => void;
}

export function Composer({
  onSend, isGenerating, stopGenerating, documents, optimisticRows, pendingDocIds, isSettling, enqueue,
}: ComposerProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { activeContext, status: contextStatus } = useContextScope();
  const [queryText, setQueryText] = useState('');
  const [queuedSend, setQueuedSend] = useState<QueuedSend | null>(null);

  // Fires the deferred send the instant every in-flight attachment settles — §7.1.
  useEffect(() => {
    if (queuedSend && !isSettling) {
      onSend(queuedSend.query, activeContext?.id ?? null, queuedSend.scopeDocumentIds);
      setQueuedSend(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSettling]);

  const inFlightCount = optimisticRows.length + pendingDocIds.length;
  // A freshly-attached document isn't reflected in activeContext.documentCount until the
  // context list itself is refetched — treating any attachment activity this session as
  // "no longer empty" keeps the composer usable the instant a file is dropped, rather than
  // making the user wait for that refetch.
  const contextEmpty = contextStatus === 'ready' && activeContext != null
    && activeContext.documentCount === 0 && inFlightCount === 0;

  // task 3.21 — each disabled reason carries its own tooltip. "In-flight stream" isn't a
  // third branch here: while a stream is running the control itself becomes Stop (below),
  // so there is never a disabled Send button to explain at the same time.
  const disabledReason = !activeContext
    ? 'Select a context to ask questions.'
    : contextEmpty
      ? 'Add a document to this context first.'
      : queryText.trim().length === 0
        ? 'Enter a question first.'
        : null;

  const placeholder = activeContext ? `Ask about ${activeContext.title}…` : 'Ask a question…';

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length > 0) enqueue(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (e.currentTarget.value.trim() && !isGenerating && !disabledReason) formRef.current?.requestSubmit();
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (queuedSend) return; // a send is already deferred; don't double-queue
    const query = queryText.trim();
    if (!query || isGenerating || disabledReason) return;

    if (isSettling) {
      // §7.1 — queued, not blocked. Snapshots the currently-pending ids now: by the time
      // isSettling flips false, useUploadQueue has already cleared pendingDocIds to [].
      setQueuedSend({ query, scopeDocumentIds: [...pendingDocIds] });
    } else {
      onSend(query, activeContext?.id ?? null, pendingDocIds.length ? pendingDocIds : undefined);
    }
    e.currentTarget.reset();
    setQueryText('');
  };

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className="relative flex w-full flex-col rounded-2xl border border-line bg-surface-raised p-3.5 pb-2.5 shadow-2 transition-colors focus-within:border-line-strong"
    >
      <input
        type="file" ref={fileInputRef} onChange={handleFileUpload} className="hidden" multiple
        accept=".pdf,.docx,.txt,.md,.csv,.xlsx,.xls,.json"
      />

      {(optimisticRows.length > 0 || pendingDocIds.length > 0) && (
        <div className="mb-2 flex flex-wrap gap-2 px-1">
          {optimisticRows.map((row) => (
            <div key={row.key} className="flex items-center gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-1.5">
              <Loader2 className="size-3.5 shrink-0 animate-spin text-graphite" aria-hidden="true" />
              <span className="max-w-[150px] truncate text-xs text-ink-secondary">{row.fileName}</span>
            </div>
          ))}
          {pendingDocIds.map((id) => {
            const doc = documents.find((d) => d.id === id);
            if (!doc) return null;
            return (
              <div key={id} className="flex items-center gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-1.5">
                <FileText className="size-3.5 shrink-0 text-graphite" aria-hidden="true" />
                <span className="max-w-[150px] truncate text-xs text-ink-secondary">{doc.fileName}</span>
                <StageChip doc={doc} />
              </div>
            );
          })}
        </div>
      )}

      {queuedSend && (
        <p className="mb-2 px-1 text-xs text-graphite">
          Waiting for {inFlightCount} document{inFlightCount === 1 ? '' : 's'} to finish indexing…
        </p>
      )}

      <div className="relative flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!activeContext}
          aria-label={activeContext ? 'Attach a document' : 'Select a context first'}
          title={activeContext ? 'Attach a document' : 'Select a context first'}
          className="mb-1 flex size-10 shrink-0 items-center justify-center rounded-xl text-graphite outline-none transition-colors hover:bg-surface-sunken hover:text-ink focus-visible:ring-[3px] focus-visible:ring-signal-ring disabled:opacity-40"
        >
          <Paperclip size={20} />
        </button>

        <TextareaAutosize
          name="query"
          value={queryText}
          onChange={(e) => setQueryText(e.target.value)}
          placeholder={placeholder}
          className="flex-1 resize-none bg-transparent py-2.5 text-[15px] leading-relaxed text-ink placeholder-graphite focus:outline-none disabled:cursor-not-allowed disabled:text-graphite-faint"
          minRows={1}
          maxRows={8}
          onKeyDown={handleKeyDown}
          disabled={!activeContext || contextEmpty}
          title={!activeContext || contextEmpty ? disabledReason ?? undefined : undefined}
        />

        {isGenerating ? (
          <button
            type="button"
            onClick={stopGenerating}
            aria-label="Stop generating"
            title="Stop generating"
            className="mb-1 flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary outline-none transition-colors hover:bg-line focus-visible:ring-[3px] focus-visible:ring-signal-ring"
          >
            <Square size={16} fill="currentColor" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={!!disabledReason}
            aria-label={disabledReason ?? 'Send'}
            title={disabledReason ?? 'Send'}
            className="mb-1 flex size-10 shrink-0 items-center justify-center rounded-xl bg-signal text-signal-on outline-none transition-colors hover:bg-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring disabled:opacity-40"
          >
            <ArrowUp size={20} strokeWidth={3} />
          </button>
        )}
      </div>
    </form>
  );
}
