// phase_2 §7 — columns, sort, search + status filter (client-side, §7.2), multi-select
// (bulk delete only — no bulk re-index, §7.2), and the reference screenshot's client-side
// pagination of the already-loaded rows (see the DESIGN.md-vs-screenshot reconciliation:
// the full list is still fetched/polled once, per §5.4 — pagination here is display
// density over data already in memory, never a second network round trip).
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import {
  Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow,
} from '../ui/table';
import { Input } from '../ui/input';
import { Checkbox } from '../ui/checkbox';
import { Button } from '../ui/button';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../ui/select';
import { DocumentRow } from './DocumentRow';
import { UploadQueueRow } from './UploadQueue';
import { DeleteDocumentDialog } from './DeleteDocumentDialog';
import { MockBadge } from '../design/MockBadge';
import type { OptimisticRow } from '../../hooks/useUploadQueue';
import type { DocumentRecord } from '../../../api/contracts';

type StatusFilter = 'all' | 'ready' | 'in_progress' | 'failed';
type SortKey = 'name' | 'size' | 'chunks' | 'added';
type SortDirection = 'asc' | 'desc';

const PAGE_SIZE = 10;

function matchesStatusFilter(doc: DocumentRecord, filter: StatusFilter): boolean {
  switch (filter) {
    case 'all': return true;
    case 'ready': return doc.status === 'ready' || doc.status === 'duplicate';
    case 'in_progress': return doc.status === 'queued' || doc.status === 'processing';
    case 'failed': return doc.status === 'failed';
  }
}

interface DocumentTableProps {
  contextTitle: string;
  documents: DocumentRecord[];
  optimisticRows: OptimisticRow[];
  onChanged: () => void;
}

export function DocumentTable({ contextTitle, documents, optimisticRows, onChanged }: DocumentTableProps) {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'added', direction: 'desc' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const prevStatuses = useRef<Map<string, string>>(new Map());

  // §7.2 — debounced 200ms.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim().toLowerCase()), 200);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => { setPage(1); }, [search, statusFilter]);

  // task 2.22 — announce stage changes through an aria-live region.
  useEffect(() => {
    const prev = prevStatuses.current;
    const changed: string[] = [];
    for (const doc of documents) {
      const before = prev.get(doc.id);
      if (before !== undefined && before !== doc.status) {
        changed.push(`${doc.fileName} is now ${doc.status}`);
      }
      prev.set(doc.id, doc.status);
    }
    if (changed.length > 0) setAnnouncement(changed.join('. '));
  }, [documents]);

  const filtered = useMemo(() => {
    return documents
      .filter((d) => matchesStatusFilter(d, statusFilter))
      .filter((d) => (search ? d.fileName.toLowerCase().includes(search) : true));
  }, [documents, statusFilter, search]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    const dir = sort.direction === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      switch (sort.key) {
        case 'name': return a.fileName.localeCompare(b.fileName) * dir;
        case 'size': return (a.sizeBytes - b.sizeBytes) * dir;
        case 'chunks': return (a.chunkCount - b.chunkCount) * dir;
        case 'added': return (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir;
      }
    });
    return copy;
  }, [filtered, sort]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageSafe = Math.min(page, totalPages);
  const pageRows = sorted.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  function toggleSort(key: SortKey) {
    setSort((prev) => (prev.key === key
      ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
      : { key, direction: key === 'added' ? 'desc' : 'asc' }));
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const allOnPageSelected = pageRows.length > 0 && pageRows.every((d) => selected.has(d.id));
  function toggleSelectAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) pageRows.forEach((d) => next.delete(d.id));
      else pageRows.forEach((d) => next.add(d.id));
      return next;
    });
  }

  const selectedDocs = documents.filter((d) => selected.has(d.id));

  function SortHeader({ label, sortKey, align }: { label: string; sortKey: SortKey; align?: 'right' }) {
    const active = sort.key === sortKey;
    return (
      <TableHead scope="col" className={align === 'right' ? 'text-right' : undefined}>
        <button
          type="button"
          onClick={() => toggleSort(sortKey)}
          className={`inline-flex items-center gap-1 font-medium hover:text-ink ${active ? 'text-ink' : 'text-graphite'}`}
        >
          {label}
          {active && <span aria-hidden>{sort.direction === 'asc' ? '↑' : '↓'}</span>}
        </button>
      </TableHead>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full max-w-[360px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-graphite" aria-hidden />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search documents…"
            aria-label="Search documents"
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[160px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="ready">Ready</SelectItem>
            <SelectItem value="in_progress">In progress</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
        {selected.size > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setBulkDeleteOpen(true)}>
            Delete {selected.size} selected
          </Button>
        )}
        {/* §7.4 point 1 — labels the client-side doc→context assignment this table's rows
            are filtered by, so the limitation can't survive by accident. */}
        <MockBadge force className="ml-auto" title="Context assignment is local to this browser." />
      </div>

      <div aria-live="polite" className="sr-only">{announcement}</div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <Table>
          <TableCaption className="sr-only">Documents in {contextTitle}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="w-10">
                <Checkbox
                  checked={allOnPageSelected}
                  onCheckedChange={toggleSelectAllOnPage}
                  aria-label="Select all documents on this page"
                />
              </TableHead>
              <SortHeader label="Name" sortKey="name" />
              <SortHeader label="Size" sortKey="size" />
              <TableHead scope="col">Stage</TableHead>
              <SortHeader label="Chunks" sortKey="chunks" align="right" />
              <TableHead scope="col" className="text-right">Pages</TableHead>
              <SortHeader label="Added" sortKey="added" />
              <TableHead scope="col" className="w-11"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {optimisticRows.map((row) => <UploadQueueRow key={row.key} row={row} />)}
            {pageRows.map((doc) => (
              <DocumentRow
                key={doc.id}
                doc={doc}
                selected={selected.has(doc.id)}
                onToggleSelect={toggleSelect}
                onChanged={onChanged}
              />
            ))}
            {pageRows.length === 0 && optimisticRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-sm text-graphite">
                  {documents.length === 0 ? (
                    <>
                      <p className="font-medium text-ink">{contextTitle} is empty</p>
                      <p>Drop a document here to start asking questions about it.</p>
                    </>
                  ) : (
                    `No documents match "${searchInput}".`
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {sorted.length > 0 && (
        <div className="flex items-center justify-between text-sm text-graphite">
          <span>
            Showing {(pageSafe - 1) * PAGE_SIZE + 1} to {Math.min(pageSafe * PAGE_SIZE, sorted.length)} of {sorted.length} document{sorted.length === 1 ? '' : 's'}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" disabled={pageSafe <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Previous page">
              <ChevronLeft className="size-4" />
            </Button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <Button
                key={p}
                variant={p === pageSafe ? 'default' : 'outline'}
                size="icon"
                onClick={() => setPage(p)}
                aria-current={p === pageSafe ? 'page' : undefined}
              >
                {p}
              </Button>
            ))}
            <Button variant="outline" size="icon" disabled={pageSafe >= totalPages} onClick={() => setPage((p) => p + 1)} aria-label="Next page">
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      <DeleteDocumentDialog
        docs={selectedDocs}
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        onDeleted={() => { setSelected(new Set()); onChanged(); }}
      />
    </div>
  );
}
