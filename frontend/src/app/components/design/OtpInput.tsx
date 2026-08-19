// phase_1 §6.4 / DESIGN.md §5.18 — six boxes that behave as one logical field. The
// underlying `input-otp` primitive (ui/input-otp.tsx) renders one real <input> under six
// visual slots, which is what gives paste-distributes-across-all-six and
// backspace-on-empty-moves-left for free — they are native single-input behaviors, not
// something this wrapper re-implements.
import { InputOTP, InputOTPGroup, InputOTPSlot } from '../ui/input-otp';

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}

export function OtpInput({ value, onChange, onComplete, disabled, autoFocus }: OtpInputProps) {
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
      <InputOTPGroup>
        {Array.from({ length: 6 }).map((_, i) => (
          <InputOTPSlot key={i} index={i} className="size-11 text-base" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
