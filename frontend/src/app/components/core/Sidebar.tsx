// phase_1 §7.3 — full rewrite. The wide, always-labeled left rail: product mark, `+ New
// chat`, the nav rows, a divider, the admin-only rows, Recent Chats (flat, read-only this
// phase — `// Phase 3: recency grouping, rename, delete, context filter`), and the
// account panel anchoring the bottom. This rail is the ONLY thread list in the product —
// ConsumerDashboard's old in-page ThreadSidebar is retired in favor of it (§7.3).
//
// There is no standalone nav item for a document list — every document belongs to a
// context and is reached through the context detail view, which the data model doesn't
// support outside a context.
import type { ComponentType } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate, useSearchParams } from 'react-router';
import { Activity, ChartScatter, ChevronDown, HeartPulse, Library, MessageSquare, Plus, Waypoints } from 'lucide-react';
import { UserMenu, userInitials } from './UserMenu';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { useAuth } from '../../context/AuthContext';
import { useEngine } from '../../context/EngineContext';
import { api } from '../../../api';
import type { ThreadSummary } from '../../../api/endpoints/threads';
import { cn } from '../ui/utils';

const RECENT_CHATS_LIMIT = 7;

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

function NavRow({ to, label, icon: Icon }: { to: string; label: string; icon: ComponentType<{ className?: string }> }) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) => cn(
        'flex items-center gap-2.5 rounded-md border-l-2 px-2.5 py-2 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-signal-ring',
        isActive ? 'border-signal bg-signal-soft text-ink' : 'border-transparent text-ink-secondary hover:bg-surface-sunken',
      )}
    >
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </NavLink>
  );
}

export function Sidebar() {
  const { user } = useAuth();
  const { isGenerating } = useEngine();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const wasGenerating = useRef(false);

  const fetchThreads = useCallback(() => {
    api.threads.list().then((res) => setThreads(res.threads)).catch(() => { /* the panel just stays empty */ });
  }, []);

  useEffect(() => { fetchThreads(); }, [fetchThreads]);

  // A turn finishing streaming means a brand-new thread's title/lastMessageAt may have
  // just appeared — refetch on the isGenerating true→false edge, driven off the same
  // EngineContext ConsumerDashboard already reads, so the two stay in sync without a
  // direct callback between them.
  useEffect(() => {
    if (wasGenerating.current && !isGenerating) fetchThreads();
    wasGenerating.current = isGenerating;
  }, [isGenerating, fetchThreads]);

  const visible = [...threads]
    .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime())
    .slice(0, RECENT_CHATS_LIMIT);

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col border-r border-line bg-surface-raised">
      <div className="flex flex-col gap-0.5 px-4 pt-5">
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-ink">
          <Waypoints className="size-4 text-signal" aria-hidden="true" />
          Cerebro
        </div>
        <p className="text-xs text-graphite">Grounded answers. Full context.</p>
      </div>

      <div className="px-3 pt-4">
        <button
          type="button"
          onClick={() => navigate('/chat')}
          className="flex w-full items-center gap-2 rounded-lg bg-signal-soft px-3 py-2 text-sm font-medium text-signal outline-none transition-colors hover:bg-signal-soft-line focus-visible:ring-[3px] focus-visible:ring-signal-ring"
        >
          <Plus className="size-4" aria-hidden="true" />
          New chat
        </button>
      </div>

      <nav className="flex flex-col gap-0.5 px-3 pt-4" aria-label="Primary">
        {NAV_ITEMS.map((item) => <NavRow key={item.to} {...item} />)}
      </nav>

      <div className="mx-4 my-3 h-px bg-line" role="separator" />

      <nav className="flex flex-col gap-0.5 px-3" aria-label="Operations">
        {OPS_NAV_ITEMS.map((item) => <NavRow key={item.to} {...item} />)}
        {user?.role === 'admin' && <NavRow to="/admin/health" label="Health" icon={HeartPulse} />}
      </nav>

      <div className="mt-4 flex min-h-0 flex-1 flex-col px-3">
        <div className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-graphite">Recent chats</div>
        <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
          {visible.map((t) => {
            const active = location.pathname === '/chat' && searchParams.get('threadId') === t._id;
            return (
              <button
                key={t._id}
                type="button"
                onClick={() => navigate(`/chat?threadId=${t._id}`)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 text-left text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-signal-ring',
                  active ? 'border-signal bg-signal-soft text-ink' : 'border-transparent text-ink-secondary hover:bg-surface-sunken',
                )}
              >
                <MessageSquare className="size-3.5 shrink-0 text-graphite" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{t.title || 'Untitled chat'}</span>
                {/* A visible relative-time label, not a decorative mark — §2.2's
                    restriction reserves graphite-faint for the title attribute only. */}
                <span className="shrink-0 text-[11px] text-graphite" title={new Date(t.lastMessageAt).toLocaleString()}>
                  {formatRelativeTime(t.lastMessageAt)}
                </span>
              </button>
            );
          })}
          {threads.length === 0 && <p className="px-2 py-1.5 text-xs text-graphite">No chats yet.</p>}
        </div>
        {threads.length > RECENT_CHATS_LIMIT && (
          // Phase 3: a real full-history view. Until then this opens a fresh chat rather
          // than link to a route that doesn't exist yet.
          <button type="button" onClick={() => navigate('/chat')} className="px-2 pt-1 text-left text-xs font-medium text-signal outline-none hover:text-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring">
            View all chats ›
          </button>
        )}
      </div>

      <div className="border-t border-line p-3">
        <UserMenu
          trigger={
            <button type="button" className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left outline-none hover:bg-surface-sunken focus-visible:ring-[3px] focus-visible:ring-signal-ring">
              <Avatar className="size-8">
                {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                <AvatarFallback className="bg-signal-soft text-xs font-medium text-signal">
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
    </aside>
  );
}
