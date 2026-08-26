import { User } from '../models/User.js';
import { roleForEmail } from './roles.js';

// The security-critical decision in this phase. Auto-linking on an unverified email is a
// one-step account takeover: an attacker creates a provider account claiming the
// victim's address and signs straight into the victim's Cerebro account. `profile` is
// the normalized shape strategies/google.js and strategies/github.js both produce:
// { provider, providerId, email, emailVerified, name, avatarUrl }.
//
// Returns { ok: true, user } on success, or { ok: false, code } naming which of the two
// refusal branches fired — the OAuth callback route turns `code` into a redirect.
export async function resolveIdentity(profile) {
  const { provider, providerId, email, emailVerified, name, avatarUrl } = profile;

  // 1. The common path. Never consults email at all, so a user who changed their email
  //    at the provider still lands on their account.
  const byIdentity = await User.findOne({
    identities: { $elemMatch: { provider, providerId } },
  });
  if (byIdentity) {
    return { ok: true, user: byIdentity, created: false };
  }

  const identitySubdoc = {
    provider, providerId,
    providerEmail: email,
    emailVerified: emailVerified === true,
    linkedAt: new Date(),
  };

  // 2. Unverified (or absent) email from the provider → a brand-new user, never linked
  //    and never merged into anything that already exists.
  if (!email || emailVerified !== true) {
    try {
      const user = await User.create({
        email: email ?? `${provider}.${providerId}@unverified.invalid`,
        emailVerified: false,
        passwordHash: null,
        name: name ?? null,
        avatarUrl: avatarUrl ?? null,
        role: email ? roleForEmail(email) : 'user',
        identities: [identitySubdoc],
      });
      return { ok: true, user, created: true };
    } catch (err) {
      // A duplicate-email collision on the unique index: an unverified provider
      // assertion does not get to touch an existing account, verified or not.
      if (err.code === 11000) {
        return { ok: false, code: 'email_taken_unverified' };
      }
      throw err;
    }
  }

  // 3/4/5. A verified email from the provider — look for an existing account.
  const existing = await User.findOne({ email });

  if (!existing) {
    // 3. No collision: create a new user, verified, identity attached.
    const user = await User.create({
      email,
      emailVerified: true,
      passwordHash: null,
      name: name ?? null,
      avatarUrl: avatarUrl ?? null,
      role: roleForEmail(email),
      identities: [identitySubdoc],
    });
    return { ok: true, user, created: true };
  }

  if (existing.emailVerified === true) {
    // 4. Both sides verified the same address, so they are the same person.
    existing.identities.push(identitySubdoc);
    if (!existing.name && name) existing.name = name;
    if (!existing.avatarUrl && avatarUrl) existing.avatarUrl = avatarUrl;
    await existing.save();
    return { ok: true, user: existing, created: false };
  }

  // 5. The local account claimed this address but never proved it. Promoting an
  //    unverified local account by way of a verified provider assertion would let
  //    anyone who can sign up with an address claim an existing unverified account
  //    that used it — so this does not link. The user is told to sign in with their
  //    password instead (which, on their own account, still works).
  return { ok: false, code: 'verify_existing_first' };
}
