// DESIGN.md §5.11 — Display-role headline + one action. No illustration: the empty state
// is an invitation to act, and the action is the only thing in it.
import { Link } from 'react-router';
import { Button } from '../ui/button';

interface EmptyStateAction {
  label: string;
  to?: string;
  onClick?: () => void;
}

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: EmptyStateAction;
  className?: string;
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={`flex h-full w-full flex-col items-center justify-center gap-3 px-6 py-16 text-center ${className ?? ''}`}>
      <h2 className="text-2xl font-bold text-ink">{title}</h2>
      {description && <p className="max-w-sm text-sm text-ink-secondary">{description}</p>}
      {action && (
        action.to
          ? <Button asChild className="mt-2"><Link to={action.to}>{action.label}</Link></Button>
          : <Button onClick={action.onClick} className="mt-2">{action.label}</Button>
      )}
    </div>
  );
}
