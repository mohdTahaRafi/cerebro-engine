// phase_1 §6.1 — /login. Public. On success: redirect to the captured return path, or
// /chat.
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link, Navigate, useLocation, useSearchParams } from 'react-router';
import { Loader2, Mail } from 'lucide-react';
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
      supportingText="Upload your documents, ask questions, and get answers backed by the exact passages that matter. Built for clarity. Designed for trust."
      features={PRODUCT_FEATURE_ROWS}
    >
      <div className="w-[600px] max-w-full rounded-2xl border border-line bg-surface-raised px-9 py-10 shadow-1">
        <div className="mb-8 flex flex-col gap-2">
          <h2 className="text-[34px] font-bold leading-tight text-ink">Welcome back</h2>
          <p className="text-[18px] text-ink-secondary">Sign in to your Cerebro account</p>
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

        <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="login-email" className="text-[15px] font-semibold text-ink">Email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-graphite" aria-hidden="true" />
              <Input
                id="login-email"
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder="you@company.com"
                required
                disabled={pending}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? 'login-email-error' : undefined}
                className="h-[54px] rounded-[10px] border-line-strong pl-11 text-[16px]"
              />
            </div>
            {fieldErrors.email && <p id="login-email-error" role="alert" className="text-xs text-critical">{fieldErrors.email}</p>}
          </div>

          <PasswordField
            label="Password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            disabled={pending}
            error={fieldErrors.password}
            showLeftIcon
            inputClassName="h-[54px] rounded-[10px] border-line-strong text-[16px]"
            labelExtra={
              <Link to="/forgot-password" className="text-sm font-medium text-signal outline-none hover:text-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm">
                Forgot password?
              </Link>
            }
          />

          <label className="flex items-center gap-2.5 text-sm text-ink-secondary">
            <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} disabled={pending} className="size-5" />
            Remember me
          </label>

          <Button type="submit" disabled={pending} className="h-[54px] w-full rounded-[10px] bg-signal text-[16px] font-semibold text-signal-on hover:bg-signal-hover">
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
            <div className="my-7 flex items-center gap-3" aria-hidden="true">
              <div className="h-px flex-1 bg-line" />
              <span className="text-[13px] text-graphite">or continue with</span>
              <div className="h-px flex-1 bg-line" />
            </div>
            <div className="flex flex-col gap-3">
              {capabilities.providers
                // The login card matches Cerebro's approved auth design, which offers
                // Google only — GitHub stays on /signup until product decides to add it here.
                .filter((p) => p !== 'github')
                .map((p) => <ProviderButton key={p} provider={p} className="h-[54px] rounded-[10px] text-[16px]" />)}
            </div>
          </>
        )}

        <p className="mt-8 text-center text-[15px] text-ink-secondary">
          Don't have an account?{' '}
          <Link to="/signup" className="font-medium text-signal outline-none hover:text-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm">
            Sign up
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
