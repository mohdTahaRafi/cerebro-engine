// DESIGN.md §5.3 — lives in the top bar. Search field only above 7 contexts. Switching
// while a thread is open (threadId set) confirms first — a conversation's history was
// condensed against one corpus, and carrying it into another produces follow-ups that
// reference documents the new context doesn't contain.
import { useMemo, useState } from 'react';
import { ChevronDown, FileText, Plus, Search } from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog';
import { useContextScope } from '../../context/ContextScopeContext';
import { useEngine } from '../../context/EngineContext';
import { ContextFormDialog } from '../contexts/ContextFormDialog';
import { cn } from '../ui/utils';

const SEARCH_THRESHOLD = 7;

export function ContextSwitcher() {
  const { contexts, activeContext, status, setActive, createAndActivate } = useContextScope();
  const { threadId, startNewThread } = useEngine();
  const [query, setQuery] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [pendingContextId, setPendingContextId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!query.trim()) return contexts;
    const q = query.toLowerCase();
    return contexts.filter((c) => c.title.toLowerCase().includes(q));
  }, [contexts, query]);

  const requestSwitch = (id: string) => {
    if (id === activeContext?.id) return;
    if (threadId) {
      setPendingContextId(id); // confirm first — DESIGN.md §6.7
    } else {
      setActive(id);
    }
  };

  const confirmSwitch = () => {
    if (!pendingContextId) return;
    startNewThread();
    setActive(pendingContextId);
    setPendingContextId(null);
  };

  const pendingTitle = contexts.find((c) => c.id === pendingContextId)?.title;

  if (status === 'loading') {
    return <div className="h-9 w-48 animate-pulse rounded-lg border border-line bg-surface-sunken" />;
  }

  if (status === 'unavailable') {
    return (
      <span
        className="flex items-center gap-2 rounded-lg border border-line-subtle px-3 py-1.5 text-sm text-graphite-faint"
        title="Couldn't reach the contexts endpoint. Try reloading — your contexts and their documents are unaffected."
      >
        <FileText className="size-4" aria-hidden="true" />
        Contexts unavailable
      </span>
    );
  }

  if (status === 'none') {
    return (
      <>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-dashed border-line px-3 py-1.5 text-sm font-medium text-signal outline-none transition-colors hover:bg-signal-soft focus-visible:ring-[3px] focus-visible:ring-signal-ring"
        >
          <Plus className="size-4" aria-hidden="true" />
          New context
        </button>
        <ContextFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} onSubmit={createAndActivate} />
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex items-center gap-2 rounded-lg border border-line bg-surface-raised px-3 py-1.5 text-sm font-medium text-ink outline-none transition-colors hover:border-line-strong focus-visible:ring-[3px] focus-visible:ring-signal-ring"
          >
            <FileText className="size-4 text-graphite" aria-hidden="true" />
            <span className="max-w-[220px] truncate">{activeContext?.title ?? 'Select a context'}</span>
            {activeContext && (
              <>
                <span className="text-graphite-faint">·</span>
                <span className="text-graphite">{activeContext.documentCount} document{activeContext.documentCount === 1 ? '' : 's'}</span>
              </>
            )}
            <ChevronDown className="size-3.5 shrink-0 text-graphite" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72 border-line bg-surface-overlay p-1.5">
          {contexts.length > SEARCH_THRESHOLD && (
            <div className="mb-1 flex items-center gap-2 rounded-md border border-line px-2 py-1.5">
              <Search className="size-3.5 shrink-0 text-graphite" aria-hidden="true" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search contexts…"
                className="w-full bg-transparent text-sm text-ink placeholder-graphite outline-none"
              />
            </div>
          )}
          <div className="flex max-h-72 flex-col gap-0.5 overflow-y-auto">
            {filtered.map((c) => (
              <DropdownMenuItem
                key={c.id}
                onSelect={() => requestSwitch(c.id)}
                className={cn('flex items-center justify-between gap-2', c.id === activeContext?.id && 'bg-signal-soft text-signal')}
              >
                <span className="truncate">{c.title}</span>
                <span className="shrink-0 text-xs text-graphite">{c.documentCount} docs</span>
              </DropdownMenuItem>
            ))}
            {filtered.length === 0 && (
              <p className="px-2 py-2 text-xs text-graphite">No contexts match “{query}”.</p>
            )}
          </div>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setCreateOpen(true)} className="gap-2 text-signal focus:text-signal">
            <Plus className="size-4" aria-hidden="true" />
            New context
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ContextFormDialog mode="create" open={createOpen} onOpenChange={setCreateOpen} onSubmit={createAndActivate} />

      <AlertDialog open={pendingContextId != null} onOpenChange={(open) => !open && setPendingContextId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to {pendingTitle}?</AlertDialogTitle>
            <AlertDialogDescription>
              This starts a new conversation. {activeContext?.title} and its conversations stay where they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setPendingContextId(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSwitch}>Switch</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
