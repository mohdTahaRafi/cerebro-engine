// phase_1 §6.1 — /login. Public. On success: redirect to the captured return path, or
// /chat.
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { Loader2 } from 'lucide-react';
import { AuthShell } from '../../components/auth/AuthShell';
import { PRODUCT_FEATURE_ROWS } from '../../components/auth/featureRows';
import { ProviderButton } from '../../components/auth/ProviderButton';
import { BackendUnreachable } from '../../components/design/BackendUnreachable';
import { RouteLoading } from '../../components/design/RouteLoading';
import { PasswordField } from '../../components/design/PasswordField';
import { Button } from '../../components/ui/button';
import { Checkbox } from '../../components/ui/checkbox';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useAuth } from '../../context/AuthContext';
import { CerebroApiError } from '../../../api';
import { sanitizeReturnTo } from '../../lib/returnTo';

export function Login() {
  const { status, capabilities, signIn, refresh } = useAuth();
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const banner = (location.state as { banner?: string } | null)?.banner ?? null;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (status === 'loading') return <RouteLoading />;
  if (status === 'unreachable') return <BackendUnreachable onRetry={refresh} />;
  if (status === 'authenticated') {
    return <Navigate to={sanitizeReturnTo(searchParams.get('returnTo'))} replace />;
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});
    setPending(true);
    try {
      await signIn({ email, password });
      // AuthContext.signIn resolved without throwing → status flips to 'authenticated'
      // on the next render, and the guard above performs the redirect.
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
      headline={['Answers you can trust,', 'grounded in your data.']}
      supportingText="Upload your documents, ask questions, and get answers backed by the exact passages that matter."
      features={PRODUCT_FEATURE_ROWS}
      headerLinkLabel="Don't have an account? Sign up"
      headerLinkTo="/signup"
    >
      <div className="w-full rounded-lg border border-line bg-surface-raised p-8 shadow-1">
        <div className="mb-6 flex flex-col gap-1">
          <h2 className="text-3xl font-bold text-ink">Welcome back</h2>
          <p className="text-sm text-ink-secondary">Sign in to your Cerebro account</p>
        </div>

        {banner && !formError && (
          <div role="status" className="mb-4 rounded-md border border-signal-soft-line bg-signal-soft px-3 py-2 text-sm text-signal">
            {banner}
          </div>
        )}

        {formError && (
          <div role="alert" className="mb-4 rounded-md border border-critical-soft-line bg-critical-soft px-3 py-2 text-sm text-critical-text">
            {formError}
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="login-email">Email</Label>
            <Input
              id="login-email"
              type="email"
              inputMode="email"
              autoComplete="username"
              required
              disabled={pending}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={!!fieldErrors.email}
              aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
            />
            {fieldErrors.email && <p id="login-email-error" role="alert" className="text-xs text-critical">{fieldErrors.email}</p>}
          </div>

          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={pending}
            error={fieldErrors.password}
            labelExtra={
              <Link to="/forgot-password" className="text-xs font-medium text-signal outline-none hover:text-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm">
                Forgot password?
              </Link>
            }
          />

          <label className="flex items-center gap-2 text-sm text-ink-secondary">
            <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} disabled={pending} />
            Remember me
          </label>

          <Button type="submit" disabled={pending} className="w-full bg-signal text-signal-on hover:bg-signal-hover">
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Signing in…
              </>
            ) : 'Sign in'}
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
          Don't have an account?{' '}
          <Link to="/signup" className="font-medium text-signal outline-none hover:text-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm">
            Sign up
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
