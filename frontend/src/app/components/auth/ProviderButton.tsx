// phase_1 §6.1 — "One button per capabilities.providers, below the divider... An
// unconfigured provider is absent, never a button that fails." Shared between /login and
// /signup so capabilities.providers drives the same set on both.
//
// Phase 5: wired to the real redirect. This is a plain `<a>` (rendered with the Button's
// styling via `asChild`), NOT a click handler that calls `fetch` — the OAuth handshake is
// a full top-level navigation away to Google/GitHub and back (backend/src/api/routes/
// auth.js's GET /api/auth/:provider), and a fetch call cannot follow that kind of
// cross-origin redirect chain the way a real browser navigation does.
import { useSearchParams } from 'react-router';
import { Github } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../ui/utils';
import { sanitizeReturnTo, encodeReturnTo } from '../../lib/returnTo';

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 18 18" className="size-4" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.85.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.03z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.97L3.95 7.3C4.66 5.17 6.65 3.58 9 3.58z" />
    </svg>
  );
}

const PROVIDER_META = {
  google: { label: 'Google', Icon: GoogleGlyph },
  github: { label: 'GitHub', Icon: Github },
} as const;

export function ProviderButton({
  provider,
  action = 'Sign in',
  className,
}: {
  provider: 'google' | 'github';
  /** "Sign in" on /login, "Sign up" on /signup — same button, page-appropriate verb. */
  action?: 'Sign in' | 'Sign up';
  className?: string;
}) {
  const { label, Icon } = PROVIDER_META[provider];
  const [searchParams] = useSearchParams();
  // Same validation both ends share (frontend/src/app/lib/returnTo.ts) — sanitized here
  // before it ever leaves the browser, and re-validated server-side
  // (backend/src/auth/mask.js's safeReturnTo) since neither end trusts the other alone.
  const returnTo = sanitizeReturnTo(searchParams.get('returnTo'));
  const href = `/api/auth/${provider}?returnTo=${encodeReturnTo(returnTo)}`;

  return (
    <Button
      asChild
      variant="outline"
      className={cn('w-full gap-2 border-line bg-surface-raised', className)}
    >
      <a href={href}>
        <Icon className="size-4" aria-hidden="true" />
        {action} with {label}
      </a>
    </Button>
  );
}
