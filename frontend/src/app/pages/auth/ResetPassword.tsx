// phase_1 §6.4 — /reset-password. The most stateful screen in the phase, built as an
// explicit state machine: AWAITING_CODE → VERIFYING → (AWAITING_CODE | LOCKED | EXPIRED)
// → SETTING_PASSWORD → DONE. `resetToken` is held in component state ONLY — never
// localStorage, never the URL — so a page reload discards it and returns to
// /forgot-password, which is correct: a single-use credential must not survive a
// refresh (the same reload also loses router state, which is what actually triggers the
// redirect below).
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { KeyRound, Loader2 } from 'lucide-react';
import { AuthShell } from '../../components/auth/AuthShell';
import { RESET_FEATURE_ROWS } from '../../components/auth/featureRows';
import { BackendUnreachable } from '../../components/design/BackendUnreachable';
import { RouteLoading } from '../../components/design/RouteLoading';
import { OtpInput } from '../../components/design/OtpInput';
import { PasswordField } from '../../components/design/PasswordField';
import { Button } from '../../components/ui/button';
import { useAuth } from '../../context/AuthContext';
import { api, CerebroApiError, EndpointUnavailableError } from '../../../api';
import type { OtpChannel } from '../../../api/contracts';

type Phase = 'AWAITING_CODE' | 'VERIFYING' | 'LOCKED' | 'EXPIRED' | 'SETTING_PASSWORD' | 'DONE';

interface EntryState {
  identifier: string;
  channel: OtpChannel;
  maskedDestination: string;
  expiresInSeconds: number;
  resendAfterSeconds: number;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function networkDownMessage(err: unknown): string | null {
  if (err instanceof EndpointUnavailableError && err.code === 'network_unreachable') {
    return 'Cerebro is not reachable. Your code is still valid — try again in a moment.';
  }
  return null;
}

export function ResetPassword() {
  const { status, capabilities, refresh } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const entry = (location.state as EntryState | null) ?? null;

  const [phase, setPhase] = useState<Phase>('AWAITING_CODE');
  const [code, setCode] = useState('');
  const [otpKey, setOtpKey] = useState(0);          // remount → refocus box 1 on failure
  const [otpError, setOtpError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(entry?.expiresInSeconds ?? 0);
  const [resendCooldown, setResendCooldown] = useState(entry?.resendAfterSeconds ?? 0);
  const [resending, setResending] = useState(false);

  const [resetToken, setResetToken] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const verifyingRef = useRef(false);

  // Countdown tick — only while AWAITING_CODE. Hits 0 → EXPIRED.
  useEffect(() => {
    if (!entry || phase !== 'AWAITING_CODE') return undefined;
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setPhase('EXPIRED');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [entry, phase]);

  // Resend cooldown tick — independent of `phase`, since it also runs while LOCKED/EXPIRED.
  useEffect(() => {
    if (!entry || resendCooldown <= 0) return undefined;
    const id = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [entry, resendCooldown]);

  const verify = async (submittedCode: string) => {
    if (verifyingRef.current || !entry) return;
    verifyingRef.current = true;
    setPhase('VERIFYING');
    setOtpError(null);
    try {
      const res = await api.auth.verifyOtp({ identifier: entry.identifier, code: submittedCode });
      setResetToken(res.resetToken);
      setPhase('SETTING_PASSWORD');
    } catch (err) {
      const networkMsg = networkDownMessage(err);
      if (networkMsg) {
        setOtpError(networkMsg);
        setPhase('AWAITING_CODE');
      } else if (err instanceof CerebroApiError && err.code === 'otp_locked') {
        setOtpError(err.message);
        setPhase('LOCKED');
      } else if (err instanceof CerebroApiError && err.code === 'otp_expired') {
        setOtpError(err.message);
        setPhase('EXPIRED');
      } else if (err instanceof CerebroApiError) {
        setOtpError(err.message);
        setPhase('AWAITING_CODE');
        setCode('');
        setOtpKey((k) => k + 1);   // remount → clears boxes, refocuses box 1
      } else {
        setOtpError('Something went wrong. Try again.');
        setPhase('AWAITING_CODE');
      }
    } finally {
      verifyingRef.current = false;
    }
  };

  const resend = async () => {
    if (!entry || resendCooldown > 0 || resending) return;
    setResending(true);
    setOtpError(null);
    try {
      const res = await api.auth.forgotPassword({ identifier: entry.identifier, channel: entry.channel });
      setSecondsLeft(res.expiresInSeconds);
      setResendCooldown(res.resendAfterSeconds);
      setCode('');
      setOtpKey((k) => k + 1);
      setPhase('AWAITING_CODE');
      toast.success('New code sent.');
    } catch (err) {
      const networkMsg = networkDownMessage(err);
      toast.error(networkMsg ?? (err instanceof CerebroApiError ? err.message : 'Could not resend the code.'));
    } finally {
      setResending(false);
    }
  };

  const onConfirmBlur = () => {
    setConfirmError(confirmPassword && confirmPassword !== newPassword ? "Passwords don't match." : null);
  };

  const onSubmitPassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!resetToken) return;
    if (newPassword !== confirmPassword) {
      setConfirmError("Passwords don't match.");
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await api.auth.resetPassword({ resetToken, password: newPassword });
      setPhase('DONE');
      toast.success('Password updated.');
      navigate('/login', { replace: true });
    } catch (err) {
      const networkMsg = networkDownMessage(err);
      setFormError(networkMsg ?? (err instanceof CerebroApiError ? err.message : 'Something went wrong. Try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  if (status === 'loading') return <RouteLoading />;
  if (status === 'unreachable') return <BackendUnreachable onRetry={refresh} />;
  if (status === 'authenticated') return <Navigate to="/chat" replace />;
  // No identifier in router state — either a hard reload discarded it (correct: the
  // reset token must not survive a refresh) or the screen was reached directly.
  if (!entry) return <Navigate to="/forgot-password" replace />;

  const minLength = capabilities?.passwordMinLength ?? 12;
  const showResend = phase === 'AWAITING_CODE' || phase === 'LOCKED' || phase === 'EXPIRED';
  const attemptsHint = phase === 'LOCKED' || phase === 'EXPIRED' ? null : otpError;

  return (
    <AuthShell
      headline={['Reset your password', "we've got you."]}
      supportingText="Enter the code we sent and choose a new password."
      features={RESET_FEATURE_ROWS}
      headerLinkLabel="Back to sign in"
      headerLinkTo="/login"
    >
      <div className="w-full rounded-lg border border-line bg-surface-raised p-8 shadow-1">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-signal-soft">
            <KeyRound className="size-5 text-signal" aria-hidden="true" />
          </div>
          {phase === 'SETTING_PASSWORD' || phase === 'DONE' ? (
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-bold text-ink">Set a new password</h2>
              <p className="text-sm text-ink-secondary">Sent to {entry.maskedDestination}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <h2 className="text-2xl font-bold text-ink">Enter your code</h2>
              <p className="text-sm text-ink-secondary">Sent to {entry.maskedDestination}</p>
            </div>
          )}
        </div>

        {(phase === 'AWAITING_CODE' || phase === 'VERIFYING' || phase === 'LOCKED' || phase === 'EXPIRED') && (
          <div className="flex flex-col items-center gap-4">
            {(phase === 'AWAITING_CODE' || phase === 'VERIFYING') && (
              <OtpInput
                key={otpKey}
                value={code}
                onChange={setCode}
                onComplete={verify}
                disabled={phase === 'VERIFYING'}
                autoFocus
              />
            )}

            {phase === 'VERIFYING' && (
              <div className="flex items-center gap-2 text-sm text-graphite">
                <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Verifying…
              </div>
            )}

            <div aria-live="polite" role="status" className="min-h-5 text-center text-sm">
              {phase === 'LOCKED' && <span className="text-critical">Too many attempts. Request a new code to try again.</span>}
              {phase === 'EXPIRED' && <span className="text-critical">That code expired. Request a new one.</span>}
              {phase === 'AWAITING_CODE' && attemptsHint && <span className="text-critical">{attemptsHint}</span>}
            </div>

            {phase === 'AWAITING_CODE' && (
              <div className="flex w-full items-center justify-between text-xs text-graphite">
                <span>Expires in {formatCountdown(secondsLeft)}</span>
              </div>
            )}

            {showResend && (
              <Button
                type="button" variant="ghost" size="sm" onClick={resend}
                disabled={resendCooldown > 0 || resending}
              >
                {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
              </Button>
            )}
          </div>
        )}

        {phase === 'SETTING_PASSWORD' && (
          <form onSubmit={onSubmitPassword} className="flex flex-col gap-4" noValidate>
            {formError && (
              <div role="alert" className="rounded-md border border-critical-soft-line bg-critical-soft px-3 py-2 text-sm text-critical-text">
                {formError}
              </div>
            )}
            <PasswordField
              label="New password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              showStrength
              minLength={minLength}
              disabled={submitting}
              helpText={`At least ${minLength} characters. Longer is better than more complicated.`}
            />
            <PasswordField
              label="Confirm password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              onBlur={onConfirmBlur}
              autoComplete="new-password"
              disabled={submitting}
              error={confirmError ?? undefined}
            />
            <Button type="submit" disabled={submitting} className="w-full bg-signal text-signal-on hover:bg-signal-hover">
              {submitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Updating…
                </>
              ) : 'Update password'}
            </Button>
            <p className="text-center text-xs text-graphite">
              A page reload discards this reset link and returns you to Forgot password —
              a single-use credential must not survive a refresh.
            </p>
          </form>
        )}
      </div>
    </AuthShell>
  );
}
