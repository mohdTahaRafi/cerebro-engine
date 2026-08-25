// phase_1 §6.4 / DESIGN.md §5.18 — six boxes that behave as one logical field. The
// underlying `input-otp` primitive (ui/input-otp.tsx) renders one real <input> under six
// visual slots, which is what gives paste-distributes-across-all-six and
// backspace-on-empty-moves-left for free — they are native single-input behaviors, not
// something this wrapper re-implements.
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../ui/input-otp';
import { cn } from '../ui/utils';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Overrides the row's own layout (default: centered) — /reset-password sets this to
   *  `justify-between` so the row spans and left/right-aligns to the shared form grid
   *  instead of sitting as a centered block narrower than the grid (DESIGN.md §6.4). */
  groupClassName?: string;
  /** Overrides each box's size — default 56px matches the design system's OTP spec, but
   *  /reset-password derives a size from the shared 440px form width instead. */
  slotClassName?: string;
}

export function OtpInput({ value, onChange, onComplete, disabled, autoFocus, groupClassName, slotClassName }: OtpInputProps) {
  return (
    <InputOTP
      maxLength={6}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      autoFocus={autoFocus}
      inputMode="numeric"
      pattern="^[0-9]*$"
      autoComplete="one-time-code"
      aria-label="Verification code"
      containerClassName="justify-center"
    >
      <InputOTPGroup className={cn('gap-3', groupClassName)}>
        {Array.from({ length: 6 }).map((_, i) => (
          <InputOTPSlot key={i} index={i} className={cn('size-14 rounded-[10px] text-[18px] font-semibold', slotClassName)} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
