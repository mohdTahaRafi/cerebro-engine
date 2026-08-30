// phase_1 §6.3 — /forgot-password. Same split-screen shell, reset-specific feature rows,
// icon-in-circle card treatment shared with /reset-password. The response is always the
// same whether or not the account exists (architecture §7.10) — the masked address and
// countdown seeds travel in router state, never the query string, so a masked address
// never ends up in browser history or server logs.
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { Loader2, Lock, Mail } from 'lucide-react';
import { AuthShell } from '../../components/auth/AuthShell';
import { RESET_FEATURE_ROWS } from '../../components/auth/featureRows';
import { BackendUnreachable } from '../../components/design/BackendUnreachable';
import { RouteLoading } from '../../components/design/RouteLoading';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { useAuth } from '../../context/AuthContext';
import { api, CerebroApiError } from '../../../api';
import type { OtpChannel } from '../../../api/contracts';

export function ForgotPassword() {
  const { status, capabilities, refresh } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [channel, setChannel] = useState<OtpChannel>('email');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (status === 'loading') return <RouteLoading />;
  if (status === 'unreachable') return <BackendUnreachable onRetry={refresh} />;
  if (status === 'authenticated') return <Navigate to="/chat" replace />;

  const showChannelSelector = (capabilities?.otpChannels.length ?? 1) > 1;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setPending(true);
    try {
      const res = await api.auth.forgotPassword({ identifier, channel });
      navigate('/reset-password', {
        state: {
          identifier, channel: res.channel, maskedDestination: res.maskedDestination,
          expiresInSeconds: res.expiresInSeconds, resendAfterSeconds: res.resendAfterSeconds,
        },
      });
    } catch (err) {
      setFormError(err instanceof CerebroApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      headline={['Reset your password', "we've got you."]}
      supportingText="Enter your work email and we'll send you a link to reset your password."
      features={RESET_FEATURE_ROWS}
      headerLinkLabel="Back to sign in"
      headerLinkTo="/login"
    >
      <div className="w-[600px] max-w-full rounded-2xl border border-line bg-surface-raised px-9 py-10 shadow-1">
        <div className="mb-8 flex flex-col items-center gap-5 text-center">
          <div className="flex size-[88px] shrink-0 items-center justify-center rounded-full bg-signal-soft">
            <Lock className="size-10 text-signal" aria-hidden="true" strokeWidth={1.75} />
          </div>
          <div className="flex flex-col gap-2">
            <h2 className="text-[32px] font-bold leading-tight text-ink">Forgot your password?</h2>
            <p className="max-w-[420px] text-[17px] leading-[1.5] text-ink-secondary">
              No worries. Enter your work email and we'll send you a secure link to reset it.
            </p>
          </div>
        </div>

        {formError && (
          <div role="alert" className="mb-4 rounded-md border border-critical-soft-line bg-critical-soft px-3 py-2 text-sm text-critical-text">
            {formError}
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-6" noValidate>
          <div className="flex flex-col gap-2">
            <Label htmlFor="forgot-identifier" className="text-[15px] font-semibold text-ink">Work email</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-4 top-1/2 size-[18px] -translate-y-1/2 text-graphite" aria-hidden="true" />
              <Input
                id="forgot-identifier"
                type="email"
                inputMode="email"
                autoComplete="username"
                placeholder="Enter your email"
                required
                disabled={pending}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className="h-[54px] rounded-[10px] border-line-strong pl-11 text-[16px]"
              />
            </div>
          </div>

          {showChannelSelector && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-[15px] font-semibold text-ink">Send code via</legend>
              {capabilities!.otpChannels.map((c) => (
                <label key={c} className="flex items-center gap-2 text-[15px] text-ink-secondary">
                  <input type="radio" name="otp-channel" checked={channel === c} onChange={() => setChannel(c)} />
                  {c === 'email' ? 'Email' : 'Text message'}
                </label>
              ))}
            </fieldset>
          )}

          <Button type="submit" disabled={pending} className="h-[54px] w-full rounded-[10px] bg-signal text-[16px] font-semibold text-signal-on hover:bg-signal-hover">
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Sending…
              </>
            ) : 'Send reset link'}
          </Button>
        </form>

        <div className="my-8 flex items-center gap-3" aria-hidden="true">
          <div className="h-px flex-1 bg-line" />
          <span className="text-[13px] text-graphite">Remembered your password?</span>
          <div className="h-px flex-1 bg-line" />
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-[54px] w-full rounded-[10px] border-line bg-surface-raised text-[16px] font-medium text-ink hover:bg-surface-sunken"
          onClick={() => navigate('/login')}
        >
          Back to sign in
        </Button>
      </div>
    </AuthShell>
  );
}
