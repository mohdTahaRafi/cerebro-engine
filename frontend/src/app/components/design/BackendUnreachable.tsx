// phase_1 §6.5 / DESIGN.md §6.12 — rendered by RequireAuth when status === 'unreachable',
// and by the public auth screens when the session probe fails. Replaces the entire route
// content, including the login card — showing a sign-in form to someone whose backend is
// down is a dead end. `onRetry` calls AuthContext.refresh(), never location.reload(),
// which would discard any unsaved form state for what is usually a two-second outage.
import { WifiOff } from 'lucide-react';
import { Button } from '../ui/button';

export function BackendUnreachable({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex h-full min-h-screen w-full flex-col items-center justify-center gap-4 bg-surface px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-critical-soft">
        <WifiOff className="size-6 text-critical" aria-hidden="true" />
      </div>
      <div className="flex max-w-sm flex-col gap-2">
        <h1 className="text-2xl font-bold text-ink">Cerebro is not reachable.</h1>
        <p className="text-sm text-ink-secondary">
          The app can't reach the server. This is usually a local backend that isn't running.
        </p>
      </div>
      <Button onClick={onRetry}>Try again</Button>
    </div>
  );
}
