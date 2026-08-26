// t••••@gmail.com — first character, then fixed-width dots, then the full domain.
// Fixed width, NOT the real local-part length: a mask that reveals length narrows a
// guess, and the user only needs to recognize their own address, not reconstruct it.
export function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local[0]}${'•'.repeat(4)}@${domain}`;
}

// +1 ••• ••• 4471 — last four only, the convention every user already recognizes.
// `e164` is expected in E.164 form (e.g. +14155550137): a leading '+', a country code of
// 1-3 digits, then the subscriber number. Splitting country code from subscriber number
// by a fixed offset would be wrong across countries, so this masks everything except the
// leading '+' and the final 4 digits, grouped in the 3-3-4 pattern US numbers use — the
// only phone format this phase's SMS OTP (Twilio, US $MAIL_FROM-style short code) targets.
export function maskPhone(e164) {
  const digits = e164.replace(/^\+/, '');
  const last4 = digits.slice(-4);
  return `+${digits[0]} ••• ••• ${last4}`;
}

// Validated on the backend as well as the frontend (phase_1 §5.2). Neither is trusted
// alone: the frontend check is UX, this one is the control.
export function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/chat';
  if (value.startsWith('//') || value.includes('\\')) return '/chat';   // protocol-relative
  if (value.startsWith('/api/')) return '/chat';                        // no API endpoints
  return value;
}
