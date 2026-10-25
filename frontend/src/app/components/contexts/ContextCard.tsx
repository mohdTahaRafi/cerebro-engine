// phase_2 §3.1, §3.1b — the whole card/row is a link to /contexts/:id. The ⋯ menu
// (Rename / Edit description / Delete) was removed: all three live on the context's own
// page, in ContextMetaPanel, one click away. `deleting` renders greyed and unclickable with a chip, never silently
// absent (would look like data loss) and never still clickable (would 404 mid-delete).
import { Link } from 'react-router';
import { Folder } from 'lucide-react';
import type { KnowledgeContext } from '../../../api/contracts';

// §3.1b — six pale, low-saturation hues so a row of cards reads as a quiet set (DESIGN.md's
// restraint rule), each with a dark-mode pair that composites the same way theme.css's own
// `-soft` tokens do. Purely decorative: never the only way to tell two contexts apart (the
// title always is), never a status.
const CONTEXT_TINTS = [
  { bg: 'bg-blue-50 dark:bg-blue-400/15', text: 'text-blue-600 dark:text-blue-300' },
  { bg: 'bg-emerald-50 dark:bg-emerald-400/15', text: 'text-emerald-600 dark:text-emerald-300' },
  { bg: 'bg-violet-50 dark:bg-violet-400/15', text: 'text-violet-600 dark:text-violet-300' },
  { bg: 'bg-amber-50 dark:bg-amber-400/15', text: 'text-amber-600 dark:text-amber-300' },
  { bg: 'bg-teal-50 dark:bg-teal-400/15', text: 'text-teal-600 dark:text-teal-300' },
  { bg: 'bg-slate-100 dark:bg-slate-400/15', text: 'text-slate-600 dark:text-slate-300' },
];

export function tintFor(contextId: string): { bg: string; text: string } {
  let hash = 0;
  for (let i = 0; i < contextId.length; i++) hash = (hash * 31 + contextId.charCodeAt(i)) >>> 0;
  return CONTEXT_TINTS[hash % CONTEXT_TINTS.length];
}

function formatRelativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

interface ContextCardProps {
  context: KnowledgeContext;
  view: 'grid' | 'list';
}

export function ContextCard({ context, view }: ContextCardProps) {
  const isDeleting = context.status === 'deleting';
  const tint = tintFor(context.id);
  const updated = context.documentCount === 0 ? 'Never used' : `Updated ${formatRelativeTime(context.updatedAt)}`;

  const icon = (
    <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tint.bg} ${tint.text}`}>
      <Folder className="size-4.5" aria-hidden />
    </span>
  );

  const content = view === 'grid' ? (
    <div className={`flex h-full flex-col gap-3 rounded-lg border border-line bg-surface-raised p-5 shadow-1 transition-colors ${isDeleting ? 'opacity-50' : 'hover:border-line-strong'}`}>
      <div className="flex items-center gap-3">
        {icon}
        <h3 className="font-semibold text-ink">{context.title}</h3>
      </div>
      {isDeleting && (
        <span className="inline-flex w-fit items-center gap-1 rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-graphite">
          ● Deleting…
        </span>
      )}
      <p className="min-h-[2.5rem] text-sm text-graphite">{context.description || '—'}</p>
      <div className="mt-auto flex items-center justify-between border-t border-line-subtle pt-3 text-sm">
        <span className="tabular-nums text-ink-secondary">{context.documentCount} document{context.documentCount === 1 ? '' : 's'}</span>
        <span className="text-graphite">{updated}</span>
      </div>
    </div>
  ) : (
    <div className={`flex items-center gap-4 border-b border-line-subtle px-4 py-3 transition-colors ${isDeleting ? 'opacity-50' : 'hover:bg-surface-sunken'}`}>
      {icon}
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-semibold text-ink">
          {context.title}
          {isDeleting && <span className="ml-2 text-[11px] font-medium text-graphite">● Deleting…</span>}
        </h3>
        <p className="truncate text-sm text-graphite">{context.description || '—'}</p>
      </div>
      <span className="w-28 shrink-0 text-sm tabular-nums text-ink-secondary">{context.documentCount} documents</span>
      <span className="w-32 shrink-0 text-sm text-graphite">{updated}</span>
    </div>
  );

  return isDeleting ? (
    <div aria-disabled="true">{content}</div>
  ) : (
    <Link to={`/contexts/${context.id}`} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-signal">
      {content}
    </Link>
  );
}
