// phase_1 §6.3 — /forgot-password. Same split-screen shell, reset-specific feature rows,
// icon-in-circle card treatment shared with /reset-password. The response is always the
// same whether or not the account exists (architecture §7.10) — the masked address and
// countdown seeds travel in router state, never the query string, so a masked address
// never ends up in browser history or server logs.
import type { FormEvent } from 'react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { KeyRound, Loader2 } from 'lucide-react';
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
      <div className="w-full rounded-lg border border-line bg-surface-raised p-8 shadow-1">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-signal-soft">
            <KeyRound className="size-5 text-signal" aria-hidden="true" />
          </div>
          <div className="flex flex-col gap-1">
            <h2 className="text-2xl font-bold text-ink">Forgot your password?</h2>
            <p className="text-sm text-ink-secondary">
              No worries. Enter your work email and we'll send you a secure link to reset it.
            </p>
          </div>
        </div>

        {formError && (
          <div role="alert" className="mb-4 rounded-md border border-critical-soft-line bg-critical-soft px-3 py-2 text-sm text-critical-text">
            {formError}
          </div>
        )}

        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="forgot-identifier">Work email</Label>
            <Input
              id="forgot-identifier"
              type="email"
              inputMode="email"
              autoComplete="username"
              required
              disabled={pending}
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
            />
          </div>

          {showChannelSelector && (
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-ink">Send code via</legend>
              {capabilities!.otpChannels.map((c) => (
                <label key={c} className="flex items-center gap-2 text-sm text-ink-secondary">
                  <input type="radio" name="otp-channel" checked={channel === c} onChange={() => setChannel(c)} />
                  {c === 'email' ? 'Email' : 'Text message'}
                </label>
              ))}
            </fieldset>
          )}

          <Button type="submit" disabled={pending} className="w-full bg-signal text-signal-on hover:bg-signal-hover">
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Sending…
              </>
            ) : 'Send reset link'}
          </Button>
        </form>

        <div className="my-5 flex items-center gap-3" aria-hidden="true">
          <div className="h-px flex-1 bg-line" />
          <span className="text-[11px] font-medium uppercase tracking-wide text-graphite">Remembered your password?</span>
          <div className="h-px flex-1 bg-line" />
        </div>
        <Button type="button" variant="secondary" className="w-full" onClick={() => navigate('/login')}>
          Back to sign in
        </Button>
      </div>
    </AuthShell>
  );
}
