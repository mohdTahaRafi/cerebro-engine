// phase_1 §6.5 "Route loading" — while AuthContext's status is 'loading', a full-page
// centered spinner. Never a flash of the app shell followed by a redirect, which reads
// as a broken navigation — the shell (and the public auth screens) do not mount their
// real content until the session probe resolves.
import { Loader2 } from 'lucide-react';

export function RouteLoading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-surface" role="status" aria-live="polite">
      <Loader2 className="size-6 animate-spin text-graphite" aria-hidden="true" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
