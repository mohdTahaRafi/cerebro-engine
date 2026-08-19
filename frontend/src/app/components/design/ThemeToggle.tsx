// phase_1 §7.2 / DESIGN.md §5.2 — a 3-state segmented control (Light / Dark / System),
// not a 2-state switch, because next-themes has three states and a switch cannot
// represent "follow the system."
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { cn } from '../ui/utils';

const OPTIONS = [
  { value: 'light', icon: Sun, label: 'Light' },
  { value: 'dark', icon: Moon, label: 'Dark' },
  { value: 'system', icon: Monitor, label: 'System' },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const active = theme ?? 'system';

  return (
    <div role="radiogroup" aria-label="Theme" className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface-sunken p-0.5">
      {OPTIONS.map(({ value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={active === value}
          aria-label={label}
          title={label}
          onClick={() => setTheme(value)}
          className={cn(
            'flex size-7 items-center justify-center rounded-md outline-none transition-colors',
            'focus-visible:ring-[3px] focus-visible:ring-signal-ring',
            active === value ? 'bg-surface-raised text-signal shadow-1' : 'text-graphite hover:text-ink-secondary',
          )}
        >
          <Icon className="size-3.5" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}
