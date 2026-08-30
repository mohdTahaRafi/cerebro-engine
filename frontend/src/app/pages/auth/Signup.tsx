// phase_1 §6.2 — /signup. Same split-screen shell as /login. On success: redirect to
// returnTo or /chat. When the address already exists, the mock (matching the real
// backend's future behavior — DESIGN.md §6.2) responds with no session at all, so this
// routes to /login with a banner instead of trying to distinguish the failure itself.
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { Loader2, Mail, User } from 'lucide-react';
import { AuthShell } from '../../components/auth/AuthShell';
import { PRODUCT_FEATURE_ROWS } from '../../components/auth/featureRows';
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

export function Signup() {
  const { status, capabilities, signUp, refresh } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  if (status === 'loading') return <RouteLoading />;
  if (status === 'unreachable') return <BackendUnreachable onRetry={refresh} />;
  if (status === 'authenticated') {
    return <Navigate to={sanitizeReturnTo(searchParams.get('returnTo'))} replace />;
  }

  const minLength = capabilities?.passwordMinLength ?? 12;
  const inputClass = 'h-[50px] rounded-[10px] border-line-strong pl-11 text-[16px]';
  const labelClass = 'text-[15px] font-semibold text-ink';

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const errors: Record<string, string> = {};
    if (password.length < minLength) errors.password = `Use at least ${minLength} characters.`;
    if (confirmPassword !== password) errors.confirmPassword = "Passwords don't match.";
    if (!agreed) errors.terms = 'Agree to the Terms of Service and Privacy Policy to continue.';
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
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
      headline={['Create your Cerebro', 'account']}
      supportingText="Upload your documents, ask questions, and get answers backed by the exact passages that matter. Built for clarity. Designed for trust."
      features={PRODUCT_FEATURE_ROWS}
      headerLinkLabel="Already have an account? Sign in"
      headerLinkTo="/login"
    >
      <div className="w-[600px] max-w-full rounded-2xl border border-line bg-surface-raised px-9 py-5 shadow-1">
        {/* Elastic (clamp) spacing below, not fixed breakpoint values: it scales with
            viewport HEIGHT so the card genuinely fits at any desktop window size between
            a short 13" laptop and a tall external monitor, not just the two heights we
            happened to test (§1/§3/§11 of the no-scroll pass — "the layout remains
            robust"). Input height and type stay fixed per that same pass: only the
            whitespace between elements (and, modestly, card padding) is negotiable. */}
        <div className="mb-[clamp(0.625rem,1.6vh,1.25rem)] flex flex-col gap-1.5">
          <h2 className="text-[32px] font-bold leading-tight text-ink">Create your account</h2>
          <p className="text-[17px] text-ink-secondary">Join Cerebro and start asking questions about your documents.</p>
        </div>

        {formError && (
          <div role="alert" className="mb-4 rounded-md border border-critical-soft-line bg-critical-soft px-3 py-2 text-sm text-critical-text">
            {formError}
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-[clamp(0.5rem,1.5vh,1.25rem)]" noValidate>
          <div className="flex flex-col gap-1">
            <Label htmlFor="signup-name" className={labelClass}>Full name</Label>
            <div className="relative">
              <User className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-graphite" aria-hidden="true" />
              <Input
                id="signup-name"
                autoComplete="name"
                placeholder="Enter your full name"
                disabled={pending}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="signup-email" className={labelClass}>Work email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-graphite" aria-hidden="true" />
              <Input
                id="signup-email"
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder="Enter your email"
                required
                disabled={pending}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={!!fieldErrors.email}
                aria-describedby={fieldErrors.email ? 'signup-email-error' : undefined}
                className={inputClass}
              />
            </div>
            {fieldErrors.email && <p id="signup-email-error" role="alert" className="text-xs text-critical">{fieldErrors.email}</p>}
          </div>

          <PasswordField
            label="Password"
            placeholder="Create a password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            showStrength
            minLength={minLength}
            disabled={pending}
            error={fieldErrors.password}
            helpText={`At least ${minLength} characters. Longer is better than more complicated.`}
            showLeftIcon
            labelClassName={labelClass}
            inputClassName="h-[50px] rounded-[10px] border-line-strong text-[16px]"
          />

          <PasswordField
            label="Confirm password"
            placeholder="Confirm your password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            disabled={pending}
            error={fieldErrors.confirmPassword}
            showLeftIcon
            labelClassName={labelClass}
            inputClassName="h-[50px] rounded-[10px] border-line-strong text-[16px]"
          />

          <div className="flex flex-col gap-1.5">
            <label className="flex items-start gap-3 text-sm text-ink-secondary">
              <Checkbox
                checked={agreed}
                onCheckedChange={(v) => setAgreed(v === true)}
                disabled={pending}
                aria-invalid={!!fieldErrors.terms}
                className="mt-0.5 size-5"
              />
              <span>
                I agree to the <span className="font-medium text-signal">Terms of Service</span> and{' '}
                <span className="font-medium text-signal">Privacy Policy</span>
              </span>
            </label>
            {fieldErrors.terms && <p role="alert" className="pl-8 text-xs text-critical">{fieldErrors.terms}</p>}
          </div>

          <Button
            type="submit"
            disabled={pending}
            className="h-[50px] w-full rounded-[10px] bg-signal text-[16px] font-semibold text-signal-on hover:bg-signal-hover"
          >
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Creating account…
              </>
            ) : 'Create account'}
          </Button>
        </form>

        <p className="mt-[clamp(0.625rem,1.5vh,1.25rem)] text-center text-[15px] text-ink-secondary">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-signal outline-none hover:text-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm">
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}
