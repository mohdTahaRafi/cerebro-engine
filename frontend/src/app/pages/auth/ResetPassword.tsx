// phase_1 §6.4 — /reset-password. The most stateful screen in the phase, built as an
// explicit state machine: AWAITING_CODE → VERIFYING → (AWAITING_CODE | LOCKED | EXPIRED)
// → SETTING_PASSWORD → DONE. `resetToken` is held in component state ONLY — never
// localStorage, never the URL — so a page reload discards it and returns to
// /forgot-password, which is correct: a single-use credential must not survive a
// refresh (the same reload also loses router state, which is what actually triggers the
// redirect below).
//
// Unlike /login, /signup and /forgot-password, this page does NOT use AuthShell's
// hero+card grid. The approved desktop composition (DESIGN.md §6.4) is three fixed
// regions, not a generic two-column flex: a 342px-wide left branding rail (logo,
// compact supporting copy, "remembered your password?", copyright — all pinned to
// their own coordinates within the rail), a main area holding one large card at a
// fixed offset from the rail (never centered across the full viewport), and the
// deliberate empty space right of the card. Below `lg` there's no room for that fixed
// geometry, so the page instead falls back to AuthShell's ordinary stacked/centered
// flow (mobile-only blocks marked `lg:hidden` below) — the same fallback pattern
// AuthShell itself uses for its features row.
// It still reuses AuthShell's AuthHeader and every form primitive so it reads as the
// same auth system, just arranged differently on desktop.
import type { FormEvent } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ArrowRight, Loader2, Lock, Pencil, Waypoints } from 'lucide-react';
import { AtmosphericBackground } from '../../components/design/AtmosphericBackground';
import { AuthHeader } from '../../components/auth/AuthShell';
import { BackendUnreachable } from '../../components/design/BackendUnreachable';
import { RouteLoading } from '../../components/design/RouteLoading';
import { OtpInput } from '../../components/design/OtpInput';
import { PasswordField } from '../../components/design/PasswordField';
import { ThemeToggle } from '../../components/design/ThemeToggle';
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

const labelClass = 'text-[15px] font-semibold text-ink';
const fieldClass = 'h-[54px] rounded-[10px] border-line-strong text-[16px]';

// Rendered twice — once pinned inside the desktop rail, once inline in the mobile
// stacked flow (DESIGN.md §6.4) — so it's a tiny local component instead of two
// hand-copied blocks. Holds no form state, so duplicating the DOM node across the two
// `lg:hidden` / rail placements is harmless, unlike the card below.
function ResetSupportBlurb({ className }: { className?: string }) {
  return (
    <div className={className}>
      <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-signal-soft">
        <Lock className="size-5 text-signal" aria-hidden="true" strokeWidth={1.75} />
      </div>
      <div className="mt-4 flex flex-col gap-2">
        <h1 className="text-[24px] font-bold leading-tight text-ink">Reset your password</h1>
        <p className="max-w-[260px] text-[16px] leading-[1.5] text-ink-secondary">
          Enter the code sent to your email and set a new password.
        </p>
      </div>
    </div>
  );
}

function RememberedPasswordLink({ className }: { className?: string }) {
  return (
    <p className={className}>
      Remembered your password?{' '}
      <Link
        to="/login"
        className="inline-flex items-center gap-1 font-medium text-signal outline-none hover:text-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm"
      >
        Sign in <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </p>
  );
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
    if (!resetToken) {
      // Button is disabled until this exists, so this only fires on a stray Enter
      // keypress before the background verify (triggered by OtpInput's onComplete) has
      // resolved — tell the person what's missing instead of doing nothing.
      setFormError('Enter the 6-digit code sent to your email first.');
      return;
    }
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
  // Resend stays reachable even after a successful verify — someone who mistyped, or
  // whose code they just entered is stale, needs a way back to AWAITING_CODE without
  // reloading (which would just bounce them to /forgot-password instead).
  const showResend = phase !== 'DONE' && phase !== 'VERIFYING';
  const attemptsHint = phase === 'LOCKED' || phase === 'EXPIRED' ? null : otpError;
  const showingCode = phase === 'AWAITING_CODE' || phase === 'VERIFYING' || phase === 'LOCKED' || phase === 'EXPIRED';
  // The approved design (DESIGN.md §6.4) is ONE form: code, password and confirm are all
  // visible and editable together — there is no separate "verify" screen. The password
  // fields stay interactive the whole time; only actual submission is gated on having a
  // `resetToken`, which the OTP's onComplete already fetches in the background the
  // instant the 6th digit lands. That gate is enforced on the button (disabled) and in
  // onSubmitPassword, never by hiding the fields.
  const passwordFieldsDisabled = submitting || phase === 'DONE';

  return (
    <div className="relative flex min-h-screen w-full flex-col bg-surface lg:h-screen lg:flex-row lg:overflow-hidden">
      <AtmosphericBackground />

      {/* REGION A — fixed left branding rail (desktop only, DESIGN.md §6.4). Its own
          `bg-surface` sits above AtmosphericBackground, which is why the network pattern
          never shows through it even though the background spans the whole page. */}
      <aside className="relative z-10 hidden w-[342px] shrink-0 flex-col border-r border-line bg-surface lg:flex">
        <Link
          to="/login"
          className="absolute left-[34px] top-[29px] flex items-center gap-3 outline-none focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm"
        >
          <Waypoints className="size-12 shrink-0 text-signal" aria-hidden="true" strokeWidth={1.75} />
          <span className="flex flex-col leading-none">
            <span className="text-[27px] font-bold tracking-wide text-ink">CEREBRO</span>
            <span className="mt-1 text-[15px] text-ink-secondary">Grounded answers. Full context.</span>
          </span>
        </Link>

        <ResetSupportBlurb className="absolute left-[35px] top-[380px] max-w-[270px]" />

        <RememberedPasswordLink className="absolute bottom-[64px] left-[35px] text-[15px] text-ink-secondary" />
        <span className="absolute bottom-[24px] left-[35px] text-[13px] text-graphite">
          © {new Date().getFullYear()} Cerebro. All rights reserved.
        </span>
      </aside>

      {/* REGION B+C — main area. At `lg` this is one `relative` box spanning the full
          column height, holding three independently `absolute`-positioned pieces (header
          controls, the card, the legal links) at the reference's fixed coordinates —
          never centered or stacked in normal flow. Below `lg` those three lose their
          `lg:absolute` positioning and the mobile-only siblings (hidden at `lg`) take
          over, so the page reverts to an ordinary stacked column. */}
      <div className="relative z-10 flex min-h-0 w-full flex-1 flex-col gap-8 px-8 pb-6 pt-4 sm:px-10 lg:h-full lg:gap-0 lg:px-0 lg:pb-0 lg:pt-0">
        <div className="lg:hidden">
          <AuthHeader headerLinkLabel="Back to sign in" headerLinkTo="/login" />
        </div>

        <div className="hidden items-center gap-5 lg:absolute lg:right-10 lg:top-[29px] lg:flex">
          <Link
            to="/login"
            className="text-base font-medium text-ink-secondary outline-none hover:text-signal focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm"
          >
            Back to sign in
          </Link>
          <ThemeToggle />
        </div>

        <ResetSupportBlurb className="lg:hidden" />

        {/* The dominant element: one large card. Shared DOM node across breakpoints —
            never duplicate this (it holds every controlled form field) — only its
            position/width change at `lg`: centered in normal flow on mobile; on desktop
            this wrapper covers the whole main area (`lg:inset-0`) and centers the card
            *within that area* (not the full viewport, which would pull it toward the
            rail) via ordinary flex centering, `lg:pt-[107px]` holding its vertical
            position instead of centering it top-to-bottom too (DESIGN.md §6.4). */}
        <div className="flex w-full flex-1 items-center justify-center lg:absolute lg:inset-0 lg:items-start lg:pt-[107px]">
          <div className="w-[600px] max-w-full rounded-2xl border border-line bg-surface-raised px-10 py-9 shadow-1 lg:w-[584px] lg:max-w-[calc(100%-80px)] lg:px-[68px]">
              <div className="mb-7 flex flex-col items-center gap-4 text-center">
                <div className="flex size-20 shrink-0 items-center justify-center rounded-full bg-signal-soft">
                  <Lock className="size-9 text-signal" aria-hidden="true" strokeWidth={1.75} />
                </div>
                <div className="flex flex-col gap-1.5">
                  <h2 className="text-[32px] font-bold leading-tight text-ink">Reset your password</h2>
                  <p className="text-[16px] leading-[1.5] text-ink-secondary">
                    Enter the 6-digit code sent to
                    <br />
                    <span className="inline-flex items-center gap-1.5 font-medium text-ink">
                      {entry.maskedDestination}
                      <button
                        type="button"
                        onClick={() => navigate('/forgot-password')}
                        aria-label="Send the code to a different email address"
                        title="Send the code to a different email address"
                        className="text-signal outline-none hover:text-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm"
                      >
                        <Pencil className="size-[15px]" aria-hidden="true" />
                      </button>
                    </span>
                  </p>
                </div>
              </div>

              {/* Shared form grid (DESIGN.md §6.4): the OTP row, both password inputs
                  and the submit button all belong to this one 440px-wide, left-aligned
                  column, so their left/right edges line up exactly — only the header
                  above stays centered. 440px isn't arbitrary: 6 boxes × 60px + 5 gaps ×
                  16px = 440px, so the OTP row fills it edge-to-edge with no leftover
                  space for `justify-between` to distribute, same math as the password
                  inputs which are simply `w-full` of this column. */}
              <div className="mx-auto flex w-full max-w-[440px] flex-col">
                <div className="flex flex-col gap-2">
                  <span className="text-[15px] font-semibold text-ink">Verification code</span>
                  {showingCode ? (
                    <OtpInput
                      key={otpKey}
                      value={code}
                      onChange={setCode}
                      onComplete={verify}
                      disabled={phase === 'VERIFYING'}
                      autoFocus
                      groupClassName="w-full gap-4"
                      slotClassName="size-[60px]"
                    />
                  ) : (
                    // Read-only recap of the code already verified — kept visible for
                    // continuity while the password fields are filled in, never re-editable
                    // (changing it here would have no effect: verification already happened).
                    <OtpInput
                      value={code}
                      onChange={() => {}}
                      onComplete={() => {}}
                      disabled
                      groupClassName="w-full gap-4"
                      slotClassName="size-[60px]"
                    />
                  )}
                </div>

                {phase === 'VERIFYING' && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-sm text-graphite">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" /> Verifying…
                  </div>
                )}

                <div aria-live="polite" role="status" className="mt-3 min-h-5 text-center text-sm">
                  {phase === 'LOCKED' && <span className="text-critical">Too many attempts. Request a new code to try again.</span>}
                  {phase === 'EXPIRED' && <span className="text-critical">That code expired. Request a new one.</span>}
                  {phase === 'AWAITING_CODE' && attemptsHint && <span className="text-critical">{attemptsHint}</span>}
                </div>

                {phase === 'AWAITING_CODE' && (
                  <p className="mt-1 text-center text-[14px] text-graphite">
                    Code expires in <span className="font-medium text-signal">{formatCountdown(secondsLeft)}</span>
                  </p>
                )}

                <form onSubmit={onSubmitPassword} className="mt-7 flex flex-col gap-5" noValidate>
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
                    disabled={passwordFieldsDisabled}
                    helpText={`At least ${minLength} characters. Longer is better than more complicated.`}
                    showLeftIcon
                    labelClassName={labelClass}
                    inputClassName={fieldClass}
                  />
                  <PasswordField
                    label="Confirm new password"
                    value={confirmPassword}
                    onChange={setConfirmPassword}
                    onBlur={onConfirmBlur}
                    autoComplete="new-password"
                    disabled={passwordFieldsDisabled}
                    error={confirmError ?? undefined}
                    showLeftIcon
                    labelClassName={labelClass}
                    inputClassName={fieldClass}
                  />
                  <Button
                    type="submit"
                    disabled={passwordFieldsDisabled || !resetToken}
                    className="h-[54px] w-full rounded-[10px] bg-signal text-[16px] font-semibold text-signal-on hover:bg-signal-hover"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        Updating…
                      </>
                    ) : 'Reset password'}
                  </Button>
                </form>

                {showResend && (
                  <p className="mt-6 text-center text-[14px] text-ink-secondary">
                    Didn't receive the code?{' '}
                    <button
                      type="button"
                      onClick={resend}
                      disabled={resendCooldown > 0 || resending}
                      className="font-medium text-signal outline-none hover:text-signal-hover focus-visible:ring-[3px] focus-visible:ring-signal-ring rounded-sm disabled:cursor-not-allowed disabled:text-graphite disabled:hover:text-graphite"
                    >
                      {resendCooldown > 0 ? `Resend code (${resendCooldown}s)` : 'Resend code'}
                    </button>
                  </p>
                )}

                {phase === 'SETTING_PASSWORD' && (
                  <p className="mt-4 text-center text-xs text-graphite">
                    A page reload discards this reset link and returns you to Forgot password —
                    a single-use credential must not survive a refresh.
                  </p>
                )}
              </div>
          </div>
        </div>

        <RememberedPasswordLink className="text-center text-[15px] text-ink-secondary lg:hidden" />

        {/* Footer split by DESIGN.md §6.4: copyright lives in the rail (above), so only
            the legal links sit in the main area, bottom-right — desktop only, matching
            AuthFooter's own `hidden ... lg:flex` convention of dropping the footer on
            mobile entirely rather than squeezing it into the stacked flow. */}
        <div className="hidden items-center gap-2 text-[13px] text-graphite lg:absolute lg:bottom-6 lg:right-10 lg:flex">
          <span>Privacy</span>
          <span aria-hidden="true">•</span>
          <span>Terms</span>
          <span aria-hidden="true">•</span>
          <span>Security</span>
        </div>
      </div>
    </div>
  );
}
