// DESIGN.md §5.14 — trigger: an avatar (image, or initials). Menu: name, email, an
// admin chip when the role applies, a divider, then Sign out. Anchored from two places
// (the top bar and the Sidebar's account panel, §7.3) — this is the one implementation
// both anchor to, not a second copy.
import type { ReactNode } from 'react';
import { LogOut } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Avatar, AvatarFallback, AvatarImage } from '../ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { useAuth } from '../../context/AuthContext';

function initials(name: string | null, email: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
  }
  return email[0]?.toUpperCase() ?? '?';
}

interface UserMenuProps {
  trigger: ReactNode;
}

export function UserMenu({ trigger }: UserMenuProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  const onSignOut = async () => {
    await signOut();
    navigate('/login', { replace: true });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 border-line bg-surface-overlay">
        <DropdownMenuLabel className="flex items-center gap-3 py-2 font-normal">
          <Avatar className="size-9">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
            <AvatarFallback className="bg-signal-soft text-sm font-medium text-signal">
              {initials(user.name, user.email)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-ink">{user.name ?? user.email}</span>
              {user.role === 'admin' && (
                <span className="rounded-full bg-signal-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-signal">
                  Admin
                </span>
              )}
            </div>
            <span className="truncate text-xs text-graphite">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSignOut} className="gap-2 text-critical focus:text-critical">
          <LogOut className="size-4" aria-hidden="true" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { initials as userInitials };
