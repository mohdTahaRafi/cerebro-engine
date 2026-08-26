import argon2 from 'argon2';
import { BREACHED } from './breachedPasswords.js';   // Set of 10,000 lowercased strings

// OWASP Password Storage Cheat Sheet minimum for argon2id, verified to land in the
// 250–500 ms band on this project's target hardware (architecture §8). These values are
// the security property; changing them is a security change, not a tuning change.
const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,   // 19 MiB
  timeCost: 2,         // 2 iterations
  parallelism: 1,
};

export function hashPassword(plain) {
  return argon2.hash(plain, ARGON2_OPTS);
}

// §8's enumeration table requires "comparable latency" as well as an identical body on
// every enumeration-sensitive route (signup's collision branch, login's unknown-email
// branch via verifyPassword(null, ...) below, and forgot-password's no-account branch).
// argon2's hash is the dominant cost on the real path in every one of those (the DB
// round trip and Redis session bookkeeping are single-digit milliseconds by comparison),
// so burning one hash call on the short-circuit branch is what actually closes the gap.
export async function burnHashTime() {
  await argon2.hash('dummy-timing-equalizer-000000', ARGON2_OPTS).catch(() => {});
}

// A user with no local identity has passwordHash === null. Returning false BEFORE
// calling argon2 is required: argon2.verify(null, x) throws, and a thrown error on the
// login path is trivially distinguishable by timing from a returned false — which turns
// "does this address have a password" into an oracle.
export async function verifyPassword(hash, plain) {
  if (!hash) {
    // Burn comparable time so an OAuth-only account is not identifiable by a fast 401.
    await argon2.hash(plain, ARGON2_OPTS).catch(() => {});
    return false;
  }
  try { return await argon2.verify(hash, plain); }
  catch { return false; }   // malformed stored hash — treat as a failed login, never a 500
}

// Rehash on login when the parameters have been raised since the hash was written.
export function needsRehash(hash) {
  return argon2.needsRehash(hash, ARGON2_OPTS);
}

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;   // argon2 has no practical limit; this bounds the
                                   //   request body and the hashing time an attacker
                                   //   can force with one submission

export function validatePassword(plain, { email, name } = {}) {
  if (typeof plain !== 'string') return 'Enter a password.';
  if (plain.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (plain.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  const lower = plain.toLowerCase();
  if (BREACHED.has(lower)) {
    return 'That password appears in a public breach list. Choose a different one.';
  }
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && lower.includes(local)) {
    return "Don't use your email address in your password.";
  }
  if (name && name.length >= 4 && lower.includes(name.toLowerCase())) {
    return "Don't use your name in your password.";
  }
  return null;   // valid
}

// No composition rules. Requiring an uppercase letter, a digit, and a symbol reliably
// produces `Password1!`, which is in the breach list this policy actually checks. Length
// plus a breach check is the current guidance and it is what is implemented.
