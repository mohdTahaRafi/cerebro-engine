// phase_1 §7.3 — full rewrite; extended in phase_3_chat_ui.md §7.2. The wide, always-labeled
// left rail: product mark, `+ New chat`, the nav rows, a divider, the admin-only rows,
// Recent Chats, and the account panel anchoring the bottom. This rail is the ONLY thread
// list in the product — ConsumerDashboard's old in-page ThreadSidebar is retired in favor
// of it, and v1's standalone ui/ThreadSidebar.tsx is deleted outright (§7.2), not restyled.
//
// §7.2's four additions over what Phase 1 shipped: recency group headers, inline rename,
// delete (confirming once and stating the message count), and filtering to the active
// context — server-side as of Phase 6 (GET /api/threads?contextId=).
//
// There is no standalone nav item for a document list — every document belongs to a
// context and is reached through the context detail view, which the data model doesn't
// support outside a context.
import type { ComponentType } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  Activity, ChartScatter, Check, ChevronDown, HeartPulse, Library, MessageSquare,
  MoreHorizontal, Pencil, Plus, Trash2, Waypoints, X,
} from 'lucide-react';
import { UserMenu, userInitials } from './UserMenu';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '../ui/alert-dialog';
import { buttonVariants } from '../ui/button';
import { useAuth } from '../../context/AuthContext';
import { useEngine } from '../../context/EngineContext';
import { useContextScope } from '../../context/ContextScopeContext';
import { useThreads, type ThreadSummary } from '../../hooks/useThreads';
import { cn } from '../ui/utils';

const RECENT_CHATS_LIMIT = 30; // grouped list — Phase 1's flat 7-row cap no longer applies

const NAV_ITEMS = [
  { to: '/chat', label: 'Chat', icon: MessageSquare },
  { to: '/contexts', label: 'Contexts', icon: Library },
];

const OPS_NAV_ITEMS = [
  { to: '/admin/traces', label: 'Traces', icon: Activity },
  { to: '/admin/vectors', label: 'Vector space', icon: ChartScatter },
];

function formatRelativeTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

type RecencyGroup = 'Today' | 'Yesterday' | 'Previous 7 days' | 'Older';
const GROUP_ORDER: RecencyGroup[] = ['Today', 'Yesterday', 'Previous 7 days', 'Older'];

function groupFor(iso: string, now: Date): RecencyGroup {
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const sevenDaysAgo = new Date(now);
  sevenDaysAgo.setDate(now.getDate() - 7);
  if (d.getTime() >= sevenDaysAgo.getTime()) return 'Previous 7 days';
  return 'Older';
}

function groupThreads(threads: ThreadSummary[]): Array<[RecencyGroup, ThreadSummary[]]> {
  const now = new Date();
  const buckets = new Map<RecencyGroup, ThreadSummary[]>();
  for (const t of threads) {
    const g = groupFor(t.lastMessageAt, now);
    if (!buckets.has(g)) buckets.set(g, []);
    buckets.get(g)!.push(t);
  }
  return GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => [g, buckets.get(g)!]);
}

function NavRow({ to, label, icon: Icon }: { to: string; label: string; icon: ComponentType<{ className?: string }> }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        'flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-signal-ring',
        isActive ? 'border-signal bg-signal-soft text-signal' : 'border-transparent text-ink-secondary hover:bg-surface-sunken',
      )}
    >
      <Icon className="size-[18px]" aria-hidden="true" />
      {label}
    </NavLink>
  );
}

interface ThreadRowProps {
  thread: ThreadSummary;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => void;
}

function ThreadRow({ thread, active, onOpen, onRename, onDelete }: ThreadRowProps) {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(thread.title);
  const inputRef = useRef<HTMLInputElement>(null);

  const startRename = () => { setDraft(thread.title); setRenaming(true); };

  const commitRename = async () => {
    const title = draft.trim();
    setRenaming(false);
    if (!title || title === thread.title) return;
    await onRename(title);
  };

  if (renaming) {
    return (
      <div className="flex items-center gap-1.5 rounded-md border-l-2 border-transparent px-2.5 py-1.5">
        <MessageSquare className="size-3.5 shrink-0 text-graphite" aria-hidden="true" />
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
            if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
          }}
          onBlur={() => void commitRename()}
          className="min-w-0 flex-1 rounded-sm border border-signal-soft-line bg-surface px-1.5 py-0.5 text-sm text-ink outline-none"
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => void commitRename()}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-graphite hover:bg-surface-sunken hover:text-ink"
          title="Save"
        >
          <Check className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setRenaming(false)}
          className="flex size-6 shrink-0 items-center justify-center rounded-sm text-graphite hover:bg-surface-sunken hover:text-ink"
          title="Cancel"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'group/thread flex items-center gap-1 rounded-md border-l-2 pr-1 transition-colors',
        active ? 'border-signal bg-signal-soft' : 'border-transparent hover:bg-surface-sunken',
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-signal-ring',
          active ? 'text-ink' : 'text-ink-secondary',
        )}
      >
        <MessageSquare className="size-3.5 shrink-0 text-graphite" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{thread.title || 'Untitled chat'}</span>
        <span className="shrink-0 text-[11px] text-graphite opacity-100 group-hover/thread:opacity-0" title={new Date(thread.lastMessageAt).toLocaleString()}>
          {formatRelativeTime(thread.lastMessageAt)}
        </span>
      </button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`More actions for ${thread.title || 'Untitled chat'}`}
            className="flex size-6 shrink-0 items-center justify-center rounded-sm text-graphite opacity-0 outline-none transition-opacity hover:bg-surface-sunken hover:text-ink focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-signal-ring group-hover/thread:opacity-100"
          >
            <MoreHorizontal className="size-3.5" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-40 border-line bg-surface-overlay p-1">
          <DropdownMenuItem onSelect={startRename} className="gap-2">
            <Pencil className="size-3.5" aria-hidden="true" />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onDelete} className="gap-2 text-critical-text focus:text-critical-text">
            <Trash2 className="size-3.5" aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function Sidebar() {
  const { user } = useAuth();
  const { isGenerating } = useEngine();
  const { activeContext } = useContextScope();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { threads, fetchThreads, renameThread, deleteThread } = useThreads();
  const [deleteTarget, setDeleteTarget] = useState<ThreadSummary | null>(null);
  const wasGenerating = useRef(false);

  const refetch = useCallback(() => { void fetchThreads(activeContext?.id); }, [fetchThreads, activeContext?.id]);

  useEffect(() => { refetch(); }, [refetch]);

  // A turn finishing streaming means a brand-new thread's title/lastMessageAt may have
  // just appeared — refetch on the isGenerating true→false edge, driven off the same
  // EngineContext the Chat page reads, so the two stay in sync without a direct callback.
  useEffect(() => {
    if (wasGenerating.current && !isGenerating) refetch();
    wasGenerating.current = isGenerating;
  }, [isGenerating, refetch]);

  const visible = [...threads]
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
    .slice(0, RECENT_CHATS_LIMIT);
  const grouped = groupThreads(visible);

  const activeThreadId = location.pathname === '/chat' ? searchParams.get('threadId') : null;

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteThread(deleteTarget._id);
    if (activeThreadId === deleteTarget._id) navigate('/chat');
    setDeleteTarget(null);
  };

  return (
    <aside className="flex h-full w-[268px] shrink-0 flex-col border-r border-line bg-surface-raised">
      <div className="flex flex-col gap-1 px-5 pt-6">
        <div className="flex items-center gap-2 text-base font-bold uppercase tracking-widest text-ink">
          <Waypoints className="size-5 text-signal" aria-hidden="true" />
          Cerebro
        </div>
        <p className="text-xs text-graphite">Grounded answers. Full context.</p>
      </div>

      <div className="px-4 pt-5">
        <button
          type="button"
          onClick={() => navigate('/chat')}
          className="flex w-full items-center gap-2.5 rounded-lg bg-signal-soft px-3.5 py-2.5 text-sm font-medium text-signal outline-none transition-colors hover:bg-signal-soft-line focus-visible:ring-[3px] focus-visible:ring-signal-ring"
        >
          <Plus className="size-[18px]" aria-hidden="true" />
          New chat
        </button>
      </div>

      <nav className="flex flex-col gap-1 px-4 pt-5" aria-label="Primary">
        {NAV_ITEMS.map((item) => <NavRow key={item.to} {...item} />)}
      </nav>

      <div className="mx-5 my-4 h-px bg-line" role="separator" />

      <nav className="flex flex-col gap-1 px-4" aria-label="Operations">
        {OPS_NAV_ITEMS.map((item) => <NavRow key={item.to} {...item} />)}
        {user?.role === 'admin' && <NavRow to="/admin/health" label="Health" icon={HeartPulse} />}
      </nav>

      <div className="mt-5 flex min-h-0 flex-1 flex-col px-4">
        <div className="flex items-center justify-between px-1 pb-1.5">
          <span className="text-[11px] font-medium uppercase tracking-wide text-graphite">Recent chats</span>
          {activeContext && (
            <span className="max-w-[120px] truncate text-[11px] text-graphite-faint" title={`Filtered to ${activeContext.title}`}>
              {activeContext.title}
            </span>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2.5 overflow-y-auto">
          {grouped.map(([group, items]) => (
            <div key={group} className="flex flex-col gap-0.5">
              <div className="px-2.5 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-graphite-faint">{group}</div>
              {items.map((t) => (
                <ThreadRow
                  key={t._id}
                  thread={t}
                  active={activeThreadId === t._id}
                  onOpen={() => navigate(`/chat?threadId=${t._id}`)}
                  onRename={(title) => renameThread(t._id, title)}
                  onDelete={() => setDeleteTarget(t)}
                />
              ))}
            </div>
          ))}
          {threads.length === 0 && (
            <p className="px-2.5 py-1.5 text-xs text-graphite">
              {activeContext ? `No chats yet in ${activeContext.title}.` : 'No chats yet.'}
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-line p-4">
        <UserMenu
          trigger={
            <button type="button" className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left outline-none hover:bg-surface-sunken focus-visible:ring-[3px] focus-visible:ring-signal-ring">
              <Avatar className="size-9">
                {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                <AvatarFallback className="bg-ink text-xs font-medium text-surface">
                  {user ? userInitials(user.name, user.email) : '?'}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{user?.name ?? user?.email}</div>
                <div className="truncate text-xs text-graphite">{user?.email}</div>
              </div>
              <ChevronDown className="size-4 shrink-0 text-graphite" aria-hidden="true" />
            </button>
          }
        />
      </div>

      <AlertDialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.title || 'Untitled chat'}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This conversation has {deleteTarget?.messageCount ?? 0} message{deleteTarget?.messageCount === 1 ? '' : 's'}. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteTarget(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDelete()} className={buttonVariants({ variant: 'destructive' })}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}
