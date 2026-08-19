// Deterministic OTP for the dev mock — always "123456", printed to the console on every
// send/resend so the milestone's "enter the code the mock prints to the console" flow has
// a real console line to point at, without demanding the developer decode a random value.
const CODE = '123456';
const EXPIRES_IN_SECONDS = 600;   // 10 minutes
const RESEND_AFTER_SECONDS = 60;
const MAX_ATTEMPTS = 5;

interface OtpEntry {
  code: string;
  identifier: string;
  channel: 'email' | 'sms';
  expiresAt: number;
  attemptsRemaining: number;
  resetToken: string | null;
}

let entry: OtpEntry | null = null;
let tokenCounter = 0;

/** "taylor@gmail.com" → "t••••@gmail.com"; "dev@example.com" → "d••@example.com" —
 *  first character kept, up to 4 bullets for the rest of the local part, domain intact. */
export function maskEmail(identifier: string): string {
  const at = identifier.indexOf('@');
  if (at <= 0) return identifier;   // not an email-shaped identifier (e.g. a phone number)
  const local = identifier.slice(0, at);
  const domain = identifier.slice(at);
  const dots = Math.min(local.length - 1, 4);
  return `${local[0]}${'•'.repeat(dots)}${domain}`;
}

export function issue(identifier: string, channel: 'email' | 'sms') {
  entry = {
    code: CODE, identifier, channel,
    expiresAt: Date.now() + EXPIRES_IN_SECONDS * 1000,
    attemptsRemaining: MAX_ATTEMPTS,
    resetToken: null,
  };
  // eslint-disable-next-line no-console
  console.log(`[mock] OTP for ${identifier} (${channel}): ${CODE}`);
  return {
    maskedDestination: maskEmail(identifier),
    expiresInSeconds: EXPIRES_IN_SECONDS,
    resendAfterSeconds: RESEND_AFTER_SECONDS,
  };
}

export class OtpError extends Error {
  code: 'otp_invalid' | 'otp_expired' | 'otp_locked';
  attemptsRemaining?: number;
  constructor(code: 'otp_invalid' | 'otp_expired' | 'otp_locked', message: string, attemptsRemaining?: number) {
    super(message);
    this.code = code;
    this.attemptsRemaining = attemptsRemaining;
  }
}

export function verify(identifier: string, code: string): { resetToken: string; expiresInSeconds: number } {
  if (!entry || entry.identifier !== identifier) {
    throw new OtpError('otp_expired', 'That code expired. Request a new one.');
  }
  if (Date.now() > entry.expiresAt) {
    throw new OtpError('otp_expired', 'That code expired. Request a new one.');
  }
  if (code !== entry.code) {
    entry.attemptsRemaining -= 1;
    if (entry.attemptsRemaining <= 0) {
      throw new OtpError('otp_locked', 'Too many attempts. Request a new code to try again.');
    }
    throw new OtpError('otp_invalid', "That code isn't right.", entry.attemptsRemaining);
  }
  const resetToken = `mock_reset_${++tokenCounter}`;
  entry.resetToken = resetToken;
  return { resetToken, expiresInSeconds: EXPIRES_IN_SECONDS };
}

export function consumeResetToken(resetToken: string): string | null {
  if (!entry || entry.resetToken !== resetToken) return null;
  const identifier = entry.identifier;
  entry = null;   // single-use — a page reload already discarded the client's copy
  return identifier;
}
