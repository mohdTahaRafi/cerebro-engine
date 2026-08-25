// phase_2 §3 — the context workspace manager: search/sort/view toolbar (§3.1a), the grid/
// list card layout (§3.1), create (§3.3), and the true first-run empty state, matched to
// the reviewed reference screen's copy and folder-glyph icon.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { FolderPlus, List as ListIcon, LayoutGrid, Search } from 'lucide-react';
import { Button } from '../../components/ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../components/ui/select';
import { Input } from '../../components/ui/input';
import { MockBadge } from '../../components/design/MockBadge';
import { ContextCard } from '../../components/contexts/ContextCard';
import { ContextFormDialog } from '../../components/contexts/ContextFormDialog';
import { useContexts } from '../../hooks/useContexts';

type SortKey = 'updated' | 'name' | 'documents';
type ViewMode = 'grid' | 'list';

const VIEW_STORAGE_KEY = 'cerebro.contexts.view';

export function ContextList() {
  const navigate = useNavigate();
  const { contexts, status, create, update, remove } = useContexts();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('updated');
  const [view, setView] = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem(VIEW_STORAGE_KEY);
      return stored === 'list' || stored === 'grid' ? stored : 'grid';
    } catch { return 'grid'; }
  });
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 150);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* unavailable — view just won't persist */ }
  }, [view]);

  // §3.5 — a `deleting` context still renders (greyed, via ContextCard) rather than
  // vanishing from the list ahead of the poll that confirms it's actually gone.
  const filtered = useMemo(() => {
    if (!search) return contexts;
    return contexts.filter((c) =>
      c.title.toLowerCase().includes(search) || (c.description ?? '').toLowerCase().includes(search));
  }, [contexts, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    switch (sort) {
      case 'name': return copy.sort((a, b) => a.title.localeCompare(b.title));
      case 'documents': return copy.sort((a, b) => b.documentCount - a.documentCount);
      case 'updated':
      default:
        return copy.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    }
  }, [filtered, sort]);

  const hasAnyContext = contexts.length > 0;

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-ink">Contexts</h1>
              <MockBadge force title="Contexts are local to this browser until Phase 6 adds them to the backend." />
            </div>
            <p className="mt-1 text-sm text-graphite">Organize your documents into isolated contexts.</p>
          </div>
          {hasAnyContext && (
            <Button onClick={() => setCreateOpen(true)}>
              <FolderPlus className="size-4" /> New context
            </Button>
          )}
        </div>

        {hasAnyContext && (
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-[360px]">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-graphite" aria-hidden />
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search contexts…"
                aria-label="Search contexts"
                className="pl-8"
              />
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
                <SelectTrigger className="w-[180px]" aria-label="Sort contexts">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="updated">Sort by: Last updated</SelectItem>
                  <SelectItem value="name">Sort by: Name (A–Z)</SelectItem>
                  <SelectItem value="documents">Sort by: Document count</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex items-center rounded-md border border-line p-0.5">
                <Button
                  variant={view === 'list' ? 'secondary' : 'ghost'} size="icon" className="size-8"
                  aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}
                >
                  <ListIcon className="size-4" />
                </Button>
                <Button
                  variant={view === 'grid' ? 'secondary' : 'ghost'} size="icon" className="size-8"
                  aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}
                >
                  <LayoutGrid className="size-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {status === 'loading' && contexts.length === 0 ? (
          <p className="py-16 text-center text-sm text-graphite">Loading contexts…</p>
        ) : !hasAnyContext ? (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line bg-surface-raised px-6 py-16 text-center">
            <FolderPlus className="size-8 text-graphite" aria-hidden />
            <h2 className="text-xl font-bold text-ink">Create your first context</h2>
            <p className="max-w-sm text-sm text-graphite">Contexts help you organize documents and get more accurate answers.</p>
            <Button className="mt-2" onClick={() => setCreateOpen(true)}>
              <FolderPlus className="size-4" /> New context
            </Button>
          </div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <p className="text-sm text-graphite">No contexts match "{searchInput}".</p>
            <Button variant="ghost" onClick={() => setSearchInput('')}>Clear search</Button>
          </div>
        ) : view === 'grid' ? (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(288px, 1fr))' }}>
            {sorted.map((c) => (
              <ContextCard key={c.id} context={c} view="grid" onUpdate={update} onDelete={remove} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface-raised">
            {sorted.map((c) => (
              <ContextCard key={c.id} context={c} view="list" onUpdate={update} onDelete={remove} />
            ))}
          </div>
        )}
      </div>

      <ContextFormDialog
        mode="create" open={createOpen} onOpenChange={setCreateOpen} onSubmit={create}
        onSuccess={(created) => { toast.success('Context created.'); navigate(`/contexts/${created.id}`); }}
      />
    </div>
  );
}
