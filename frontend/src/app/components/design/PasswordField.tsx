// phase_1 §6.2 / DESIGN.md §5.17 — a form field plus a show/hide toggle that is a real
// <button> with aria-pressed, and (on signup) a three-segment advisory strength meter.
import type { ReactNode } from 'react';
import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { cn } from '../ui/utils';

/** Advisory only — never blocks submission except on the length minimum (§5.17). Three
 *  segments: 1 = meets the length minimum only, 2 = meets it with some character variety
 *  or real extra length, 3 = comfortably exceeds it with three character classes (or a
 *  generous length on its own). The real check is the server-side breached-password
 *  list (architecture §7.10); this is a nudge, not a gate. */
export function computePasswordStrength(password: string, minLength: number): 0 | 1 | 2 | 3 {
  if (password.length === 0) return 0;
  if (password.length < minLength) return 1;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes >= 3 || password.length >= minLength + 8) return 3;
  if (classes >= 2 || password.length > minLength) return 2;
  return 1;
}

const STRENGTH_LABEL: Record<0 | 1 | 2 | 3, string> = {
  0: '', 1: 'Weak', 2: 'Fair', 3: 'Strong',
};
const STRENGTH_COLOR: Record<0 | 1 | 2 | 3, string> = {
  0: 'bg-line', 1: 'bg-critical', 2: 'bg-warn', 3: 'bg-positive',
};

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  showStrength?: boolean;
  minLength?: number;
  helpText?: string;
  error?: string;
  onBlur?: () => void;
  disabled?: boolean;
  labelExtra?: ReactNode;
}

export function PasswordField({
  label, value, onChange, autoComplete, showStrength, minLength = 12,
  helpText, error, onBlur, disabled, labelExtra,
}: PasswordFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const [visible, setVisible] = useState(false);
  const strength = showStrength ? computePasswordStrength(value, minLength) : 0;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <Label htmlFor={id}>{label}</Label>
        {labelExtra}
      </div>
      <div className="relative">
        <Input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          minLength={autoComplete === 'new-password' ? minLength : undefined}
          required
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className="pr-10"
        />
        <button
          type="button"
          aria-pressed={visible}
          aria-label={visible ? 'Hide password' : 'Show password'}
          onClick={() => setVisible((v) => !v)}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-graphite outline-none hover:text-ink-secondary focus-visible:ring-[3px] focus-visible:ring-signal-ring"
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
        </button>
      </div>

      {showStrength && (
        <div className="flex flex-col gap-1">
          <div className="flex gap-1" aria-hidden="true">
            {[1, 2, 3].map((seg) => (
              <div key={seg} className={cn('h-1 flex-1 rounded-full transition-colors', seg <= strength ? STRENGTH_COLOR[strength] : 'bg-line')} />
            ))}
          </div>
          <span className="sr-only" aria-live="polite">
            {strength > 0 ? `Password strength: ${STRENGTH_LABEL[strength]}` : ''}
          </span>
        </div>
      )}

      {helpText && !error && <p className="text-xs text-graphite">{helpText}</p>}
      {error && <p id={errorId} role="alert" className="text-xs text-critical">{error}</p>}
    </div>
  );
}
