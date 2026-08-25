// phase_1 §7.2, amended for the Phase 3 chat rebuild — the old fabricated
// hardware-metrics block (processor load, memory, throughput, a native-addon status
// badge) is deleted outright, not replaced with real equivalents: a browser cannot know
// the server's resource usage, and the two metrics that could be made real (queue depth,
// dependency status) belong on /admin/health, not permanent chrome. The static "No
// context" label is replaced with the real ContextSwitcher (DESIGN.md §5.3).
import { ChevronDown } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import { HealthIndicator } from './HealthIndicator';
import { UserMenu, userInitials } from './UserMenu';
import { ThemeToggle } from '../design/ThemeToggle';
import { ContextSwitcher } from '../chat/ContextSwitcher';
import { useAuth } from '../../context/AuthContext';

export function TopHeader() {
  const { user } = useAuth();

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-surface px-6">
      <ContextSwitcher />

      <div className="flex items-center gap-4">
        <HealthIndicator />
        <div className="h-5 w-px bg-line" role="separator" aria-hidden="true" />
        <ThemeToggle />
        <UserMenu
          trigger={
            <button type="button" className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 outline-none hover:bg-surface-sunken focus-visible:ring-[3px] focus-visible:ring-signal-ring">
              <Avatar className="size-8">
                {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                <AvatarFallback className="bg-ink text-xs font-medium text-surface">
                  {user ? userInitials(user.name, user.email) : '?'}
                </AvatarFallback>
              </Avatar>
              {user?.role === 'admin' && (
                <span className="rounded-full bg-signal-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-signal">
                  Admin
                </span>
              )}
              <ChevronDown className="size-3.5 text-graphite" aria-hidden="true" />
            </button>
          }
        />
      </div>
    </header>
  );
}
