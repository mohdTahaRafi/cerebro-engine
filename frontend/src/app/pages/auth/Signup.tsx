// phase_1 §6.2 — /signup. Same split-screen shell as /login. On success: redirect to
// returnTo or /chat. When the address already exists, the mock (matching the real
// backend's future behavior — DESIGN.md §6.2) responds with no session at all, so this
// routes to /login with a banner instead of trying to distinguish the failure itself.
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { AuthShell } from '../../components/auth/AuthShell';
import { PRODUCT_FEATURE_ROWS } from '../../components/auth/featureRows';
import { ProviderButton } from '../../components/auth/ProviderButton';
import { BackendUnreachable } from '../../components/design/BackendUnreachable';
import { RouteLoading } from '../../components/design/RouteLoading';
import { PasswordField } from '../../components/design/PasswordField';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useAuth } from '../../context/AuthContext';
import { CerebroApiError } from '../../../api';
import { sanitizeReturnTo } from '../../lib/returnTo';

export function Signup() {
  const { status, capabilities, signUp, refresh } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (status === 'loading') return <RouteLoading />;
  if (status === 'unreachable') return <BackendUnreachable onRetry={refresh} />;
  if (status === 'authenticated') {
    return <Navigate to={sanitizeReturnTo(searchParams.get('returnTo'))} replace />;
  }

  const minLength = capabilities?.passwordMinLength ?? 12;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});
    if (password.length < minLength) {
      setFieldErrors({ password: `Use at least ${minLength} characters.` });
      return;
    }
    setPending(true);
    try {
      const user = await signUp({ email, password, name: name.trim() || undefined });
      if (!user) {
        navigate('/login', {
          replace: true,
          state: { banner: 'An account already exists for that address. Sign in, or reset your password.' },
        });
        return;
      }
      navigate(sanitizeReturnTo(searchParams.get('returnTo')), { replace: true });
    } catch (err) {
      if (err instanceof CerebroApiError) {
        setFieldErrors(err.fields ?? {});
        setFormError(err.message);
      } else {
        setFormError('Something went wrong. Try again.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      headline={['Private workspaces,', 'built for your documents.']}
      supportingText="Join Cerebro and start asking questions about your documents."
      features={PRODUCT_FEATURE_ROWS}
      headerLinkLabel="Already have an account? Sign in"
      headerLinkTo="/login"
    >
      <div className="w-full rounded-lg border border-line bg-surface-raised p-8 shadow-1">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="text-3xl font-bold text-ink">Create your account</h2>
          <p className="text-sm text-ink-secondary">Join Cerebro and start asking questions about your documents.</p>
        </div>

        {formError && (
          <div role="alert" className="mb-4 rounded-md border border-critical-soft-line bg-critical-soft px-3 py-2 text-sm text-critical-text">
            {formError}
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-name">Name</Label>
            <Input id="signup-name" autoComplete="name" disabled={pending} value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="signup-email">Email</Label>
            <Input
              id="signup-email"
              type="email"
              inputMode="email"
              autoComplete="username"
              required
              disabled={pending}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? 'signup-email-error' : undefined}
            />
            {fieldErrors.email && <p id="signup-email-error" role="alert" className="text-xs text-critical">{fieldErrors.email}</p>}
          </div>

          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            showStrength
            minLength={minLength}
            disabled={pending}
            error={fieldErrors.password}
            helpText={`At least ${minLength} characters. Longer is better than more complicated.`}
          />

          <Button type="submit" disabled={pending} className="w-full bg-signal text-signal-on hover:bg-signal-hover">
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Creating account…
              </>
            ) : 'Create account'}
          </Button>
        </form>

        {capabilities && capabilities.providers.length > 0 && (
          <>
            <div className="my-5 flex items-center gap-3" aria-hidden="true">
              <div className="h-px flex-1 bg-line" />
              <span className="text-[11px] font-medium uppercase tracking-wide text-graphite">or continue with</span>
              <div className="h-px flex-1 bg-line" />
            </div>
            <div className="flex flex-col gap-2">
              {capabilities.providers.map((p) => <ProviderButton key={p} provider={p} />)}
            </div>
          </>
        )}

        <p className="mt-6 text-center text-sm text-ink-secondary">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-signal outline-none hover:text-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
