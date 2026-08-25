// phase_2 §6.1 — optimistic rows for files accepted into the upload queue but without a
// real documentId yet: rendered at the top of the table with an indeterminate bar.
// useDocuments' next poll picks up the real row and useUploadQueue removes this one at the
// same moment the upload response lands, so the swap never leaves a visible gap.
import { FileText } from 'lucide-react';
import { TableCell, TableRow } from '../ui/table';
import type { OptimisticRow } from '../../hooks/useUploadQueue';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value.toFixed(1)} ${units[unit]}`;
}

export function UploadQueueRow({ row }: { row: OptimisticRow }) {
  return (
    <TableRow>
      <TableCell />
      <TableCell>
        <div className="flex items-center gap-2">
          <FileText className="size-4 shrink-0 text-graphite" aria-hidden />
          <span className="truncate">{row.fileName}</span>
        </div>
      </TableCell>
      <TableCell className="tabular-nums">{formatBytes(row.sizeBytes)}</TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span className="inline-flex w-fit items-center gap-1.5 rounded-full border border-line bg-surface-sunken px-2 py-0.5 text-xs font-medium text-graphite">
            Queued
          </span>
          <div className="h-1 w-32 overflow-hidden rounded-full bg-line" role="progressbar" aria-label={`Uploading ${row.fileName}`}>
            <div className="h-full w-1/3 animate-pulse rounded-full bg-graphite-faint" />
          </div>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">—</TableCell>
      <TableCell className="text-right tabular-nums">—</TableCell>
      <TableCell>—</TableCell>
      <TableCell />
    </TableRow>
  );
}
