// phase_3_chat_ui.md — replaces ConsumerDashboard.tsx (task 3.5). This page now owns only
// layout, the context-scope guard, and the three-column frame; turn assembly and live-
// stream mirroring live in useTranscript, list rendering and scroll anchoring live in
// Transcript, and the markdown pipeline lives in AnswerBody/Turn.
import { useEffect, useState } from 'react';
import { api } from '../../api';
import { useEngine } from '../context/EngineContext';
import { useContextScope } from '../context/ContextScopeContext';
import { useTranscript } from '../hooks/useTranscript';
import { useCitationHover, useAutoExpandFirstSource } from '../hooks/useCitationHover';
import { useDocuments } from '../hooks/useDocuments';
import { useUploadQueue } from '../hooks/useUploadQueue';
import { Transcript } from '../components/chat/Transcript';
import { EvidenceMargin } from '../components/chat/EvidenceMargin';
import { Composer } from '../components/chat/Composer';
import { GlobalDropzone } from '../components/ui/GlobalDropzone';
import { EmptyState } from '../components/design/EmptyState';

export function Chat() {
  const { stopGenerating } = useEngine();
  const { activeContext, status: contextStatus, refresh: refreshContexts } = useContextScope();
  const { turns, lastTurn, ask, retryLast, regenerate, isGenerating, isThreadLoading } = useTranscript();
  const citationHover = useCitationHover();
  const [exampleFileNames, setExampleFileNames] = useState<string[]>([]);

  useAutoExpandFirstSource(citationHover.autoExpandFirst, lastTurn?.id, lastTurn?.sources.length ?? 0);

  // §7.1 attachments — a single queue instance for the whole page, shared by the
  // Composer's attach button and the page-wide GlobalDropzone, so a file dropped anywhere
  // and a file picked from the paperclip button produce the exact same chip.
  const { documents, refresh: refreshDocuments } = useDocuments(activeContext?.id ?? '');
  const onUploaded = () => { refreshDocuments(); refreshContexts(); };
  const { optimisticRows, enqueue, pendingDocIds, isSettling } = useUploadQueue(activeContext?.id ?? '', documents, onUploaded);

  const hasContent = turns.length > 0;

  // Three real filenames from the active context, for the empty-state's example
  // questions (§7.3 — "never invented sample questions"). Degrades to no examples (not
  // fabricated ones) when the endpoint isn't available.
  useEffect(() => {
    if (!activeContext || hasContent || activeContext.documentCount === 0) { setExampleFileNames([]); return; }
    let cancelled = false;
    api.documents.list(activeContext.id)
      .then(({ documents: list }) => { if (!cancelled) setExampleFileNames(list.slice(0, 3).map((d) => d.fileName)); })
      .catch(() => { if (!cancelled) setExampleFileNames([]); });
    return () => { cancelled = true; };
  }, [activeContext, hasContent]);

  const handleQuery = (query: string, contextId: string | null, scopeDocumentIds?: string[]) => {
    ask(query, contextId, scopeDocumentIds);
  };

  // §7.3 boundary state — no contexts at all: full-page empty state, no composer at all
  // (an input that cannot be submitted is worse than no input).
  if (contextStatus === 'none') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-surface">
        <EmptyState title="Create a context to get started" description="A context holds a set of documents you want to ask questions about." />
      </div>
    );
  }

  const contextIsEmpty = contextStatus === 'ready' && activeContext != null && activeContext.documentCount === 0
    && optimisticRows.length === 0 && pendingDocIds.length === 0;

  return (
    <GlobalDropzone onDrop={enqueue} disabled={!activeContext}>
      <div className="flex h-full overflow-hidden bg-surface">
        <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <Transcript
            turns={turns}
            isThreadLoading={isThreadLoading}
            activeContext={activeContext}
            contextIsEmpty={contextIsEmpty}
            exampleFileNames={exampleFileNames}
            onExampleClick={(question) => handleQuery(question, activeContext?.id ?? null)}
            activeCitation={citationHover.activeIndex}
            onHoverCitation={citationHover.onHover}
            onClickCitation={citationHover.onClickCitation}
            onRegenerate={regenerate}
            onRetry={retryLast}
          />

          <div className="shrink-0 border-t border-line px-8 py-5">
            <div className="mx-auto flex w-full max-w-[720px] flex-col gap-2">
              <Composer
                onSend={handleQuery}
                isGenerating={isGenerating}
                stopGenerating={stopGenerating}
                documents={documents}
                optimisticRows={optimisticRows}
                pendingDocIds={pendingDocIds}
                isSettling={isSettling}
                enqueue={enqueue}
              />
              <p className="text-center text-xs text-graphite">Cerebro can make mistakes. Verify important information.</p>
            </div>
          </div>
        </div>

        <div className="hidden shrink-0 overflow-y-auto border-l border-line bg-surface px-5 py-6 custom-scrollbar lg:block lg:w-[400px] xl:w-[440px]">
          <EvidenceMargin
            sources={lastTurn?.sources ?? []}
            expandedIndex={citationHover.expandedIndex}
            onToggle={citationHover.onToggleAccordion}
            activeIndex={citationHover.activeIndex}
            unavailableIndices={lastTurn?.unavailableIndices}
          />
        </div>
      </div>
    </GlobalDropzone>
  );
}
