// DESIGN.md §5.12 — distinct from EmptyState: "empty" is the system answering with
// nothing, "unavailable" is the system not being able to answer yet. States what is
// missing in plain words and, where one exists, offers the path that does work. Never a
// placeholder chart, never a skeleton that never resolves, never invented numbers.
import { Info } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '../ui/button';

interface UnavailableAction {
  label: string;
  to: string;
}

interface UnavailableProps {
  reason: string;
  action?: UnavailableAction;
  className?: string;
}

export function Unavailable({ reason, action, className }: UnavailableProps) {
  return (
    <div className={`flex items-start gap-3 rounded-lg border border-line bg-surface-raised p-4 shadow-1 ${className ?? ''}`}>
      <Info className="mt-0.5 size-4 shrink-0 text-graphite" aria-hidden="true" />
      <p className="flex-1 text-sm text-ink-secondary">{reason}</p>
      {action && (
        <Button asChild size="sm" variant="secondary">
          <Link to={action.to}>{action.label}</Link>
        </Button>
      )}
    </div>
  );
}
