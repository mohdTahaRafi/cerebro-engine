// phase_1 §6.1 — "One button per capabilities.providers, below the divider... An
// unconfigured provider is absent, never a button that fails." Shared between /login and
// /signup so capabilities.providers drives the same set on both.
import { Github } from 'lucide-react';
import { Button } from '../ui/button';

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

export function ProviderButton({ provider }: { provider: 'google' | 'github' }) {
  const { label, Icon } = PROVIDER_META[provider];
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full gap-2 border-line bg-surface-raised"
      // Phase 5 wires the real redirect; the mock has no server-side OAuth to hand off
      // to, so this is inert (not a button that lies about success) until then.
      disabled
      title="Available once the backend auth service lands (Phase 5)"
    >
      <Icon className="size-4" aria-hidden="true" />
      Sign in with {label}
    </Button>
  );
}
