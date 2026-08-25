// phase_2 §7.1, §7.3 — one row: the seven columns, plus the failed-row inline error
// (DESIGN.md §6.6) and the ⋯ menu (Re-index/Retry, Delete, Copy document ID).
import { useState } from 'react';
import { toast } from 'sonner';
import {
  FileText, FileSpreadsheet, FileJson2, FileCode, File as FileIcon, MoreHorizontal,
} from 'lucide-react';
import { TableCell, TableRow } from '../ui/table';
import { Checkbox } from '../ui/checkbox';
import { Button } from '../ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { StageChip } from './StageChip';
import { ReindexDialog } from './ReindexDialog';
import { DeleteDocumentDialog } from './DeleteDocumentDialog';
import { api, CerebroApiError } from '../../../api';
import type { DocumentRecord } from '../../../api/contracts';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(1)} ${units[unit]}`;
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/** Truncates from the middle so the extension stays visible (§7.1) — "a-very-long-filen…
 *  ame-report.pdf" would hide the one part of the name that tells you what kind of file it
 *  is; "a-very-long-fil…report.pdf" keeps it. */
function truncateMiddle(name: string, max = 32): string {
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot) : '';
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const keep = Math.max(4, max - ext.length - 1);
  return `${stem.slice(0, keep)}…${ext}`;
}

const FILE_ICON: Record<string, { Icon: typeof FileText; className: string }> = {
  pdf:  { Icon: FileText, className: 'text-critical' },
  docx: { Icon: FileText, className: 'text-signal' },
  txt:  { Icon: FileText, className: 'text-graphite' },
  md:   { Icon: FileCode, className: 'text-graphite' },
  csv:  { Icon: FileSpreadsheet, className: 'text-positive' },
  xlsx: { Icon: FileSpreadsheet, className: 'text-positive' },
  xls:  { Icon: FileSpreadsheet, className: 'text-positive' },
  json: { Icon: FileJson2, className: 'text-warn' },
};

function fileIconFor(fileName: string) {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  return FILE_ICON[ext] ?? { Icon: FileIcon, className: 'text-graphite' };
}

interface DocumentRowProps {
  doc: DocumentRecord;
  selected: boolean;
  onToggleSelect: (id: string) => void;
  onChanged: () => void;   // re-fetch the list after an action that changes it
}

export function DocumentRow({ doc, selected, onToggleSelect, onChanged }: DocumentRowProps) {
  const [reindexOpen, setReindexOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { Icon, className: iconClassName } = fileIconFor(doc.fileName);
  const isFailed = doc.status === 'failed';

  async function retryNow() {
    try {
      await api.documents.reingest(doc.id);
      onChanged();
    } catch (err) {
      toast.error('Retry failed to start', {
        description: err instanceof CerebroApiError ? err.message : 'Try again in a moment.',
        duration: Infinity,
      });
    }
  }

  async function copyId() {
    await navigator.clipboard.writeText(doc.id);
    toast.success('Document ID copied.');
  }

  return (
    <>
      <TableRow data-state={selected ? 'selected' : undefined}>
        <TableCell>
          <Checkbox
            checked={selected}
            onCheckedChange={() => onToggleSelect(doc.id)}
            aria-label={`Select ${doc.fileName}`}
          />
        </TableCell>
        <TableCell className="max-w-0">
          <div className="flex items-center gap-2">
            <Icon className={`size-4 shrink-0 ${iconClassName}`} aria-hidden />
            <span className="truncate" title={doc.fileName}>{truncateMiddle(doc.fileName)}</span>
          </div>
          {isFailed && doc.error && (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-md bg-critical-soft px-2 py-1 text-xs text-critical-text">
              <span>{doc.error}</span>
              <button type="button" onClick={retryNow} className="font-medium underline underline-offset-2 hover:no-underline">
                Retry
              </button>
            </div>
          )}
        </TableCell>
        <TableCell className="tabular-nums">{formatBytes(doc.sizeBytes)}</TableCell>
        <TableCell><StageChip doc={doc} /></TableCell>
        <TableCell className="text-right tabular-nums">{doc.status === 'ready' ? doc.chunkCount : '—'}</TableCell>
        <TableCell className="text-right tabular-nums">
          <Tooltip>
            <TooltipTrigger asChild>
              <span>{doc.pageCount > 0 ? doc.pageCount : '—'}</span>
            </TooltipTrigger>
            <TooltipContent>{doc.textPageCount} text · {doc.visualPageCount} visual</TooltipContent>
          </Tooltip>
        </TableCell>
        <TableCell title={new Date(doc.createdAt).toLocaleString()}>{formatRelativeTime(doc.createdAt)}</TableCell>
        <TableCell>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Actions for ${doc.fileName}`}>
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => (isFailed ? retryNow() : setReindexOpen(true))}>
                {isFailed ? 'Retry' : 'Re-index'}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={copyId}>Copy document ID</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDeleteOpen(true)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </TableCell>
      </TableRow>
      <ReindexDialog doc={doc} open={reindexOpen} onOpenChange={setReindexOpen} onReindexed={onChanged} />
      <DeleteDocumentDialog docs={[doc]} open={deleteOpen} onOpenChange={setDeleteOpen} onDeleted={onChanged} />
    </>
  );
}
