# Phase 5: Accounts & Sessions (backend)

> Depends on: Phases 1–4 (the frontend contracts in `frontend/src/api/contracts.ts` are the
> specification this phase implements against).
> This is the first backend phase. It introduces identity. It does **not** introduce tenancy —
> no existing record gains a `userId` here, and no query is scoped. That is Phase 6, and the
> separation is deliberate: authentication and authorization fail in different ways and are
> tested differently.

## 1. Objective

At the end of this phase Cerebro knows who is using it. A visitor signs up with an email and
a password or with Google or GitHub; the session lives in Redis behind an `HttpOnly` cookie
and is revocable; a forgotten password is recovered with a one-time code delivered to email
(or SMS where configured); and an OAuth identity links to an existing local account only when
both sides' email addresses are verified.

By the end of this phase: a user signs up at `/signup`, signs out, requests a password reset,
receives a real 6-digit code in their inbox, sets a new password, then signs in with Google
using the same address and lands on the **same account** with both identities attached.

**No `userId` on documents, no contexts, no scoped retrieval, no trace persistence.** Every
existing route still serves the flat global pool exactly as before. The only behavioral change
to existing endpoints is that `requireAuth` is **not yet applied** to them — that is Phase 6's
first task, and applying it here would break the app for a whole phase.

---

## 2. Data Model

### 2.1 `backend/src/models/User.js`

```js
import mongoose from 'mongoose';

// One federated or local identity. A user may hold several; the pair
// (provider, providerId) is globally unique, enforced by the index below.
const IdentitySchema = new mongoose.Schema({
  provider:      { type: String, required: true, enum: ['google', 'github', 'local'] },
  // For OAuth: the provider's stable subject id (Google `sub`, GitHub numeric `id`).
  // For 'local': the user's own _id as a string, so the tuple stays uniformly shaped
  // and the unique index does not need a partial filter.
  providerId:    { type: String, required: true },
  // What the provider ASSERTED at link time. Kept separately from User.email because a
  // user can change their Cerebro email; this records what the provider said, which is
  // what the linking rule (§6) is allowed to trust.
  providerEmail: { type: String, default: null },
  emailVerified: { type: Boolean, default: false },
  linkedAt:      { type: Date, default: Date.now },
}, { _id: false });

const UserSchema = new mongoose.Schema({
  // Always stored lowercase and trimmed. Case-insensitive uniqueness is enforced by
  // normalizing on write, NOT by a collation index — a collation index makes every
  // query against this field require the same collation, which is a footgun waiting
  // for the first contributor who writes User.findOne({ email }) without it.
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  emailVerified: { type: Boolean, default: false },

  // Null for an OAuth-only account. A null hash must NEVER be treated as "any password
  // matches" — verifyPassword() (§4.2) returns false on null before touching argon2.
  passwordHash:  { type: String, default: null },
  // Bumped on every password change and on "sign out everywhere". Sessions carry the
  // value they were minted with; a mismatch invalidates the session at load time (§5.4).
  credentialVersion: { type: Number, default: 0 },

  name:          { type: String, default: null, maxlength: 120 },
  avatarUrl:     { type: String, default: null },

  // E.164, e.g. +14155550137. Only present when the user opted into SMS OTP.
  phone:         { type: String, default: null },
  phoneVerified: { type: Boolean, default: false },

  role:          { type: String, enum: ['user', 'admin'], default: 'user', index: true },

  identities:    { type: [IdentitySchema], default: [] },

  lastLoginAt:   { type: Date, default: null },
  // Set when a login attempt is refused for reasons the user must resolve out of band
  // (currently only 'suspended'); reserved so the login path has a place to branch that
  // is not "delete the user".
  status:        { type: String, enum: ['active', 'suspended'], default: 'active' },
}, { timestamps: true });

// A single provider account can back exactly one Cerebro user. Sparse is wrong here —
// every identity has both fields — but the index must be on the array path so Mongo
// indexes each subdocument.
UserSchema.index({ 'identities.provider': 1, 'identities.providerId': 1 }, { unique: true });
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });

export const User = mongoose.model('User', UserSchema);
```

### 2.2 Redis key space

Everything transient lives in Redis with an explicit TTL. Three prefixes, none of which
collide with BullMQ's `bull:`:

| Key | Type | TTL | Contents |
|---|---|---|---|
| `sess:<sid>` | string (JSON) | 7 d, rolling | `connect-redis`'s session payload — `{userId, credentialVersion, createdAt}` |
| `usess:<userId>` | set | 7 d | every live `sid` for this user; drives *sign out everywhere* |
| `otp:pwreset:<userId>` | hash | 600 s | `{hash, channel, attempts, issuedAt}` |
| `otp:cooldown:<userId>` | string | 60 s | presence blocks a resend |
| `otp:reset-token:<tokenHash>` | string | 300 s | `userId` — the short-lived credential returned by a successful OTP verify |
| `rl:login:<emailHash>` | string | 900 s | counter |
| `rl:login:ip:<ip>` | string | 900 s | counter |
| `rl:otp:<emailHash>` | string | 3600 s | counter |
| `rl:otp:ip:<ip>` | string | 3600 s | counter |

`<emailHash>` is `sha256(lowercased email)` truncated to 32 hex characters. The plaintext
address is never a Redis key: keys appear in `SCAN` output, `MONITOR`, and slow-log entries,
and a rate-limit key set is otherwise an enumerable list of every address that has tried to
sign in.

---

## 3. Sessions

### 3.1 Configuration — `backend/src/auth/session.js`

```js
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { redisClient } from '../redis.js';
import { config } from '../config/index.js';

export const sessionMiddleware = session({
  name: 'cerebro.sid',                 // not 'connect.sid' — the default advertises the stack
  store: new RedisStore({ client: redisClient, prefix: 'sess:', ttl: 7 * 24 * 60 * 60 }),
  secret: config.auth.sessionSecret,   // fail-fast validated at startup; ≥ 32 chars
  resave: false,                       // the store is not touched unless the session changed
  saveUninitialized: false,            // no cookie for an anonymous visitor — this is what
                                       // keeps GET /api/auth/session from minting a session
                                       // for every bot that loads the page
  rolling: true,                       // each request extends the 7-day window
  proxy: config.nodeEnv === 'production',   // trust X-Forwarded-Proto from Caddy, so
                                            // `secure: true` does not reject every request
  cookie: {
    httpOnly: true,                    // unreadable from JavaScript — architecture §7.2
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',                   // blocks cross-site POST; 'strict' would break the
                                       // OAuth callback, which IS a cross-site GET back
                                       // into our origin
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
  },
});
```

`sameSite: 'lax'` rather than `'strict'` is a decision with a specific cause: the OAuth
provider redirects the browser to `/api/auth/google/callback`, which is a cross-site
navigation. Under `'strict'` the cookie is withheld on that request, the OAuth state check
cannot find its stored nonce, and every federated login fails. `'lax'` sends the cookie on
top-level GET navigations, which is exactly the callback and nothing dangerous.

### 3.2 Why not JWT

Covered in [architecture.md §5](architecture.md). Restated here because it is the decision
most likely to be revisited: a stateless token cannot be revoked before it expires without a
server-side denylist, and a denylist is a session store with worse ergonomics. Logout here is
`DEL sess:<sid>` and `SREM usess:<userId> <sid>`, and it is instantaneous.

### 3.3 Session lifecycle

```
signup / login / oauth callback / password reset
        │
        ├─ req.session.regenerate()          ← new sid; defeats fixation (architecture §9)
        ├─ req.session.userId = user._id
        ├─ req.session.credentialVersion = user.credentialVersion
        ├─ SADD usess:<userId> <newSid>      ← so logout-all can find it
        └─ EXPIRE usess:<userId> 604800

every subsequent request
        └─ requireAuth: load user; if user.credentialVersion !== session.credentialVersion
           → destroy this session, respond 401 { code: 'session_invalidated' }

logout       → DEL sess:<sid> · SREM usess:<userId> <sid>
logout-all   → for each sid in usess:<userId>: DEL sess:<sid> · then DEL usess:<userId>
```

`credentialVersion` is what makes a password change kill other sessions. Without it, an
attacker who stole a session cookie keeps access after the victim resets their password,
which is precisely the moment the victim believes they have fixed the problem.

### 3.4 `requireAuth` — `backend/src/api/middleware/requireAuth.js`

```js
export async function requireAuth(req, res, next) {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ code: 'unauthenticated', message: 'Sign in to continue.' });
  }
  const user = await User.findById(userId).lean();
  if (!user || user.status !== 'active') {
    req.session.destroy(() => {});
    return res.status(401).json({ code: 'unauthenticated', message: 'Sign in to continue.' });
  }
  if (user.credentialVersion !== req.session.credentialVersion) {
    req.session.destroy(() => {});
    return res.status(401).json({
      code: 'session_invalidated',
      message: 'Your password changed. Sign in again.',
    });
  }
  req.user = user;
  next();
}
```

`GET /api/auth/session` deliberately does **not** use this middleware: it answers
`200 {user: null}` when signed out, because an unauthenticated session probe is a normal
answer and returning 401 would put a red line in the console on every cold page load
([architecture.md §3](architecture.md) step 1).

---

## 4. Local Credentials

### 4.1 Hashing — `backend/src/auth/password.js`

```js
import argon2 from 'argon2';

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
```

### 4.2 Password policy — the same file

```js
import { BREACHED } from './breachedPasswords.js';   // Set of 10,000 lowercased strings

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
```

No composition rules. Requiring an uppercase letter, a digit, and a symbol reliably produces
`Password1!`, which is in the breach list this policy actually checks. Length plus a breach
check is the current guidance and it is what is implemented.

`breachedPasswords.js` ships the top 10,000 entries from the SecLists rockyou-derived set as
a frozen `Set` — roughly 90 KB, loaded once at startup. It is not fetched at runtime: an
outbound call on the signup path is an availability dependency for account creation, and the
k-anonymity HIBP API would leak a password prefix to a third party on every signup.

---

## 5. OTP and Password Reset

### 5.1 The service — `backend/src/auth/otp.js`

```js
import crypto from 'crypto';
import { redisClient as redis } from '../redis.js';

export const OTP_LENGTH = 6;
export const OTP_TTL_SECONDS = 600;        // 10 minutes — long enough for a slow inbox,
                                           //   short enough that a shoulder-surfed code
                                           //   is not useful an hour later
export const OTP_MAX_ATTEMPTS = 5;         // 5 tries over 10^6 codes = 1 in 200,000
export const OTP_RESEND_COOLDOWN = 60;     // seconds
export const RESET_TOKEN_TTL_SECONDS = 300;

// crypto.randomInt, NOT Math.random. A predictable reset code is a full account takeover,
// and Math.random is seeded per-process and is not a CSPRNG.
function generateCode() {
  return String(crypto.randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, '0');
}

// Salted with the userId so two users holding the same 6-digit code do not share a hash,
// and so a stolen hash cannot be matched against a precomputed table of 10^6 codes.
function hashCode(code, userId) {
  return crypto.createHash('sha256').update(`${code}:${userId}`).digest('hex');
}

export async function issueOtp(userId, channel) {
  const cooling = await redis.exists(`otp:cooldown:${userId}`);
  if (cooling) return { throttled: true };

  const code = generateCode();
  const key = `otp:pwreset:${userId}`;
  // A pipeline, not sequential awaits: an OTP that is written but whose TTL fails to set
  // is a code that never expires.
  await redis.multi()
    .del(key)
    .hset(key, { hash: hashCode(code, userId), channel, attempts: '0', issuedAt: String(Date.now()) })
    .expire(key, OTP_TTL_SECONDS)
    .set(`otp:cooldown:${userId}`, '1', 'EX', OTP_RESEND_COOLDOWN)
    .exec();

  return { throttled: false, code, expiresInSeconds: OTP_TTL_SECONDS };
}

export async function verifyOtp(userId, submitted) {
  const key = `otp:pwreset:${userId}`;
  const record = await redis.hgetall(key);
  if (!record?.hash) return { ok: false, reason: 'expired' };

  // Increment FIRST, then compare. The reverse order lets an attacker who can abort the
  // connection mid-request retry indefinitely without ever incrementing the counter.
  const attempts = await redis.hincrby(key, 'attempts', 1);
  if (attempts > OTP_MAX_ATTEMPTS) {
    await redis.del(key);
    return { ok: false, reason: 'locked' };
  }

  const expected = Buffer.from(record.hash, 'hex');
  const actual = Buffer.from(hashCode(String(submitted), userId), 'hex');
  // Both buffers are always 32 bytes (sha256), so timingSafeEqual cannot throw on a
  // length mismatch. A plain === here leaks the shared-prefix length through timing.
  if (!crypto.timingSafeEqual(expected, actual)) {
    return { ok: false, reason: 'invalid', attemptsRemaining: OTP_MAX_ATTEMPTS - attempts };
  }

  // Single use: the code dies the moment it succeeds, before the password is written.
  await redis.del(key);

  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  await redis.set(`otp:reset-token:${tokenHash}`, String(userId), 'EX', RESET_TOKEN_TTL_SECONDS);
  return { ok: true, resetToken: token, expiresInSeconds: RESET_TOKEN_TTL_SECONDS };
}

export async function consumeResetToken(token) {
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  const key = `otp:reset-token:${tokenHash}`;
  // GETDEL is atomic — two concurrent resets with the same token must not both succeed.
  const userId = await redis.getdel(key);
  return userId ?? null;
}
```

The reset token is stored **hashed**, exactly like the code, and for the same reason: it is a
live credential for five minutes and a Redis dump must not contain usable ones.

### 5.2 Rate limiting — three axes

```js
// backend/src/auth/limits.js
export const LIMITS = {
  otpPerIdentifier: { key: (id) => `rl:otp:${hashId(id)}`,       max: 5,  windowSec: 3600 },
  otpPerIp:         { key: (ip) => `rl:otp:ip:${ip}`,            max: 20, windowSec: 3600 },
  loginPerIdentifier:{ key: (id) => `rl:login:${hashId(id)}`,    max: 10, windowSec: 900 },
  loginPerIp:       { key: (ip) => `rl:login:ip:${ip}`,          max: 50, windowSec: 900 },
  signupPerIp:      { key: (ip) => `rl:signup:ip:${ip}`,         max: 10, windowSec: 3600 },
};

// INCR then EXPIRE-if-new. Not `SET ... EX` — that would reset the window on every hit
// and make the limit unreachable.
export async function hit({ key, max, windowSec }, subject) {
  const k = key(subject);
  const n = await redis.incr(k);
  if (n === 1) await redis.expire(k, windowSec);
  return { exceeded: n > max, count: n, retryAfterSec: await redis.ttl(k) };
}
```

The per-identifier and per-IP limits are both required and neither is sufficient. Per-IP alone
lets an attacker with a proxy pool grind one account; per-identifier alone lets an attacker
spray one attempt each across ten thousand accounts.

### 5.3 Delivery — `backend/src/notify/`

```js
// email.js
import nodemailer from 'nodemailer';
import { config } from '../config/index.js';

let transport = null;
export function configured() { return Boolean(config.mail.host && config.mail.from); }

function getTransport() {
  if (!configured()) return null;
  transport ??= nodemailer.createTransport({
    host: config.mail.host, port: config.mail.port, secure: config.mail.port === 465,
    auth: config.mail.user ? { user: config.mail.user, pass: config.mail.pass } : undefined,
    pool: true, maxConnections: 3,
    connectionTimeout: 8_000, socketTimeout: 8_000,   // bounded: the reset request awaits
                                                     //   only SMTP acceptance, and an
                                                     //   unbounded wait would hold the
                                                     //   request open behind a dead relay
  });
  return transport;
}

export async function sendOtp({ to, code, expiresInMinutes }) {
  const t = getTransport();
  if (!t) throw new NotifyUnavailable('email');
  await t.sendMail({
    from: config.mail.from, to,
    subject: `${code} is your Cerebro reset code`,   // the code in the subject line is
                                                     //   what makes it usable from a phone
                                                     //   notification without opening mail
    text: OTP_TEXT({ code, expiresInMinutes }),
    html: OTP_HTML({ code, expiresInMinutes }),
  });
}
```

The plain-text body, verbatim — the wording is part of the spec because a reset email is
phishing-shaped by nature and its copy is a security control:

```
Your Cerebro password reset code is:

    {code}

It expires in {expiresInMinutes} minutes and can be used once.

If you didn't ask to reset your password, you can ignore this message.
Your password has not changed and no one can change it without this code.

Cerebro will never ask you for this code by email, chat, or phone.
```

`sms.js` mirrors the interface. `configured()` returns false when `TWILIO_*` is unset, and
`GET /api/auth/capabilities` omits `'sms'` from `otpChannels`, so the frontend never renders a
channel it cannot deliver on ([phase_1 §6.3](phase_1_design_system_and_auth_ui.md)).

### 5.4 Failure mode: the mail provider is down

`POST /api/auth/password/forgot` **still returns `202`** with the standard body. The send
failure is written to `pipeline_errors` with `kind: 'notify'` and surfaces on `/admin/health`'s
error stream. The OTP record is **deleted** on a send failure so the user's next request is not
blocked by a code that was never delivered — but the cooldown key is left in place, so the
retry is paced.

Returning anything other than 202 here would make delivery success observable, which is an
enumeration oracle ([architecture.md §9](architecture.md)). The user experiences it as "no code
arrived, request another"; the operator sees exactly why.

---

## 6. Federated Identity and Linking

### 6.1 Strategies

```js
// backend/src/auth/strategies/google.js — passport-google-oauth20
new GoogleStrategy({
  clientID: config.auth.google.clientId,
  clientSecret: config.auth.google.clientSecret,
  callbackURL: `${config.publicUrl}/api/auth/google/callback`,
  scope: ['openid', 'email', 'profile'],
  state: true,                       // CSRF protection on the OAuth handshake; requires
                                     //   the session cookie on the callback, which is why
                                     //   sameSite is 'lax' and not 'strict' (§3.1)
  pkce: true,
}, verify);

// Normalized profile — the only shape the rest of the codebase sees.
function normalizeGoogle(profile) {
  return {
    provider: 'google',
    providerId: profile.id,                                   // the OIDC `sub`
    email: profile.emails?.[0]?.value?.toLowerCase() ?? null,
    emailVerified: profile._json?.email_verified === true,    // Google asserts this; it is
                                                              //   the ONLY input the linking
                                                              //   rule is allowed to trust
    name: profile.displayName || null,
    avatarUrl: profile.photos?.[0]?.value ?? null,
  };
}
```

GitHub needs one extra call. `passport-github2` returns a public profile whose `email` is
`null` whenever the user has hidden it, and the profile carries no verification flag at all:

```js
// backend/src/auth/strategies/github.js
async function fetchPrimaryEmail(accessToken) {
  const res = await fetch('https://api.github.com/user/emails', {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json',
               'User-Agent': 'cerebro' },
  });
  if (!res.ok) return { email: null, emailVerified: false };
  const list = await res.json();
  const primary = list.find((e) => e.primary) ?? list.find((e) => e.verified) ?? null;
  return { email: primary?.email?.toLowerCase() ?? null,
           emailVerified: primary?.verified === true };
}
```

The `user:email` scope is required for this. A GitHub account whose primary email is
unverified yields `emailVerified: false` and therefore never auto-links (§6.2).

### 6.2 The linking rule — `backend/src/auth/linking.js`

This is the security-critical decision in the phase. Auto-linking on an unverified email is a
one-step account takeover: an attacker creates a provider account claiming the victim's
address and signs straight into the victim's Cerebro account.

```
resolveIdentity(profile):

  1. identity = User.findOne({ identities: { $elemMatch:
                   { provider, providerId } } })
     → found: sign in. This is the common path and it never consults email at all,
       so a user who changed their email at the provider still lands on their account.

  2. profile.email is null OR profile.emailVerified is false
     → create a NEW user with emailVerified: false and no local password.
       Never link. Never merge. If that produces a duplicate-email collision on the
       unique index, fail the login with 'email_taken_unverified' and tell the user to
       sign in with their original method — an unverified provider assertion does not
       get to touch an existing account.

  3. existing = User.findOne({ email: profile.email })
     → none: create a new user, emailVerified: true, identity attached.

  4. existing found AND existing.emailVerified === true
     → LINK: push the identity onto existing.identities, sign in as existing.
       Both sides verified the same address, so they are the same person.

  5. existing found AND existing.emailVerified === false
     → DO NOT LINK. The local account claimed this address but never proved it.
       Respond 'verify_existing_first' and instruct the user to sign in with their
       password. Promoting an unverified local account by way of a verified provider
       assertion would let anyone who can sign up with an address claim an existing
       unverified account that used it.
```

Step 5 is the subtle one and is the reason `emailVerified` exists on `User` separately from
the per-identity flag.

### 6.3 A local account created by OAuth

A user who signs up with Google has `passwordHash: null`. If they later use *Forgot password*,
the flow works and **sets** a password, adding a `local` identity. That is intended: it is the
standard way to add a password to a federated account, and it is safe because it requires
control of the verified email address, which is the same thing the OAuth login required.

---

## 7. Routes

All under `backend/src/api/routes/auth.js` and `password.js`. Every response body matches
`frontend/src/api/contracts.ts` exactly.

| Method | Path | Auth | Behavior |
|---|---|---|---|
| `GET` | `/api/auth/capabilities` | public | `{providers, otpChannels, passwordMinLength}` — computed from config, so an unconfigured provider is absent, not broken |
| `GET` | `/api/auth/session` | public | `200 {user}` or `200 {user: null}`. Never 401 |
| `POST` | `/api/auth/signup` | public | Validates, hashes, creates, regenerates the session. Existing email → `202` with the identical body and a *"someone tried to sign up"* email instead (§8) |
| `POST` | `/api/auth/login` | public | argon2 verify, rate-limited on two axes, regenerates the session, opportunistic rehash |
| `POST` | `/api/auth/logout` | session | `DEL sess:<sid>`, `SREM usess:…`, clears the cookie. `204` |
| `POST` | `/api/auth/logout-all` | required | Bumps `credentialVersion`, deletes every `sid` in `usess:<userId>`. `204` |
| `GET` | `/api/auth/google` | public | Passport start. Stores a validated `returnTo` in the session |
| `GET` | `/api/auth/google/callback` | public | Resolve → link/create → regenerate → `302` to `returnTo` |
| `GET` | `/api/auth/github` / `/callback` | public | as above |
| `POST` | `/api/auth/password/forgot` | public | **Always `202`** with `{sent, channel, maskedDestination, expiresInSeconds, resendAfterSeconds}` |
| `POST` | `/api/auth/password/resend` | public | Same shape; `429` with `retryAfterSeconds` while the cooldown key exists |
| `POST` | `/api/auth/password/verify-otp` | public | `{resetToken, expiresInSeconds}` on success; `400` with `otp_invalid`/`otp_expired`/`otp_locked` and `attemptsRemaining` |
| `POST` | `/api/auth/password/reset` | public | Consumes the token atomically, validates the password, writes the hash, **bumps `credentialVersion`**, kills every session, `204` |

### 7.1 Masking

```js
// t••••@gmail.com — first character, then fixed-width dots, then the full domain.
// Fixed width, NOT the real local-part length: a mask that reveals length narrows a
// guess, and the user only needs to recognize their own address, not reconstruct it.
export function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local[0]}${'•'.repeat(4)}@${domain}`;
}
// +1 ••• ••• 4471 — last four only, the convention every user already recognizes.
export function maskPhone(e164) { /* … */ }
```

### 7.2 The `returnTo` allowlist

```js
// Validated on the backend as well as the frontend (phase_1 §5.2). Neither is trusted
// alone: the frontend check is UX, this one is the control.
export function safeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/')) return '/chat';
  if (value.startsWith('//') || value.includes('\\')) return '/chat';   // protocol-relative
  if (value.startsWith('/api/')) return '/chat';                        // no API endpoints
  return value;
}
```

---

## 8. Enumeration Resistance, Concretely

Three endpoints could otherwise answer "does this account exist". Each is closed the same way:
identical body, identical status, comparable latency.

| Endpoint | Existing account | Nonexistent account |
|---|---|---|
| `signup` | `202 {ok: true}`; sends *"someone tried to sign up with your address — if it was you, sign in or reset your password"* | `202 {ok: true}`; creates the account and signs in |
| `login` | `401 {code:'invalid_credentials', message:"That email and password don't match an account."}` | the identical response, after a dummy argon2 hash so the timing matches |
| `password/forgot` | `202` + code sent | `202`, no code sent, **and a dummy `argon2.hash` is still performed** so the response time sits in the same band |

The signup case has a wrinkle worth stating: a `202` for an existing account means the client
cannot distinguish "signed up" from "already existed", so it cannot know whether a session was
created. It resolves this by calling `GET /api/auth/session` immediately after — which is
already how `AuthContext` works ([phase_1 §5.1](phase_1_design_system_and_auth_ui.md)) — and
routing to `/login` with an explanatory banner when no session came back.

---

## 9. Configuration

```js
// backend/src/config/index.js — additions
auth: {
  sessionSecret: required('SESSION_SECRET'),     // ≥ 32 chars, fail-fast at startup
  publicUrl: required('PUBLIC_URL'),             // e.g. https://cerebro.example.com —
                                                 //   OAuth callback URLs are built from it
  adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',')
                 .map((s) => s.trim().toLowerCase()).filter(Boolean),
  google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
  github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET },
},
mail: {
  host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587),
  user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
  from: process.env.MAIL_FROM,
},
sms: {
  accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN,
  from: process.env.TWILIO_FROM,
},
```

`SESSION_SECRET` and `PUBLIC_URL` join the existing fail-fast `REQUIRED` list. Provider
credentials are **not** required — an unconfigured provider is simply absent from
`/api/auth/capabilities`, and a deployment with only local accounts is valid.

**There is no `AUTH_DEV_BYPASS`.** Local development requires real OAuth client IDs (both
Google and GitHub issue them free for `http://localhost` redirect URIs). A bypass flag is one
misconfigured environment variable away from being an authentication bypass in production, and
the setup cost it saves is ten minutes, once.

---

## 10. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 5.1 | Add `SESSION_SECRET` and `PUBLIC_URL` to the fail-fast config | Starting with `SESSION_SECRET` unset exits non-zero and names it; a 20-character secret is rejected |
| 5.2 | Implement the `User` model with both unique indexes | Inserting two users with the same `(provider, providerId)` fails on the index; two users with the same email fail on `email` |
| 5.3 | Wire `express-session` + `connect-redis` per §3.1 | An anonymous `GET /api/auth/session` sets **no** cookie (`saveUninitialized: false`); after login, `redis-cli KEYS 'sess:*'` shows exactly one key |
| 5.4 | Implement `requireAuth` with the `credentialVersion` check | Signing in on two browsers, then resetting the password in one, makes the other's next request return `401 session_invalidated` |
| 5.5 | Implement `hashPassword`/`verifyPassword`/`needsRehash` | `verifyPassword(null, 'x')` returns false and takes within 25% of the time of a real verify (measured over 20 runs) |
| 5.6 | Implement `validatePassword` with the breach list | `'password1234'` is rejected naming the breach list; `'correct horse battery staple'` is accepted; `'taha@example'` for `taha@example.com` is rejected |
| 5.7 | Implement `POST /api/auth/signup` with enumeration resistance | Signing up twice with the same email returns two identical `202` bodies; the second creates no user and sends the "someone tried" mail |
| 5.8 | Implement `POST /api/auth/login` with two-axis rate limiting | The 11th attempt for one email in 15 minutes returns `429` with `retryAfterSeconds`; a wrong password and an unknown email return byte-identical bodies |
| 5.9 | Implement `logout` and `logout-all` | After `logout-all`, `redis-cli KEYS 'sess:*'` for that user returns nothing and every other browser is signed out |
| 5.10 | Implement the OTP service per §5.1 | Unit tests: a code verifies once and only once; the 6th attempt returns `locked` and deletes the key; a code issued 11 minutes ago returns `expired`; `verifyOtp` increments before comparing |
| 5.11 | Implement the three-axis rate limits | The 6th forgot-password request for one email in an hour returns `429`; the 21st from one IP returns `429` |
| 5.12 | Implement `sendOtp` over nodemailer with bounded timeouts | Against a dead SMTP host the request still returns `202` within 10 s and writes a `pipeline_errors` row with `kind: 'notify'` |
| 5.13 | Implement the SMS channel with capability gating | With `TWILIO_*` unset, `GET /api/auth/capabilities` omits `'sms'` and `forgot` with `channel: 'sms'` returns `400` |
| 5.14 | Implement `verify-otp` → `reset` with an atomic single-use token | Two concurrent `reset` calls with the same token: exactly one returns `204`, the other `400 token_invalid` |
| 5.15 | Bump `credentialVersion` and kill sessions on reset | After a reset, every previously-issued session is gone from Redis |
| 5.16 | Implement the Google strategy with `state` and PKCE | A callback with a tampered `state` fails; a clean flow signs in and stores `providerEmail` + `emailVerified` |
| 5.17 | Implement the GitHub strategy with the `/user/emails` call | An account with a hidden email still resolves a primary address; an unverified primary yields `emailVerified: false` |
| 5.18 | Implement `resolveIdentity` per §6.2 | All five branches covered by tests. Branch 5 (existing unverified local) returns `verify_existing_first` and does **not** link |
| 5.19 | Implement `safeReturnTo` | `//evil.com`, `https://evil.com`, `/api/auth/logout`, and `/\evil` all fall back to `/chat`; `/admin/traces` is preserved |
| 5.20 | Seed `role` from `ADMIN_EMAILS` at user creation | A signup with an allowlisted address gets `role: 'admin'`; no API exists that changes `role` |
| 5.21 | Implement `maskEmail`/`maskPhone` with fixed-width masking | `taha@gmail.com` and `t@gmail.com` both mask to a four-dot local part |
| 5.22 | Swap the frontend off the auth mock | With `VITE_API_MOCK` unset, every Phase 1 auth screen works against the real backend; `MOCKED_ENDPOINTS` no longer contains any `auth.*` entry |
| 5.23 | Write `npm run test:auth` | `node test/auth/{password,otp,linking,session}.test.js` all pass offline (no network, no live SMTP) |

---

## 11. Milestone Definition

Phase 5 is **complete** when:

> An operator starts the backend with `SESSION_SECRET` unset and it exits immediately naming
> the variable. They set it, set `PUBLIC_URL`, `GOOGLE_CLIENT_ID`/`SECRET`, and SMTP
> credentials, and start again.
>
> A visitor opens the app with `VITE_API_MOCK` **unset** — nothing is mocked — and is
> redirected to `/login`. The page renders a *Continue with Google* button and no GitHub
> button, because `GITHUB_CLIENT_ID` is unset and `/api/auth/capabilities` therefore omits it.
> The browser has no `cerebro.sid` cookie at all: `saveUninitialized: false` means the
> anonymous session probe minted nothing.
>
> They sign up as `taha@example.com` with `password1234`, and the form rejects it: *"That
> password appears in a public breach list. Choose a different one."* They use a real
> passphrase instead and land on `/chat`. `redis-cli KEYS 'sess:*'` shows exactly one key.
> They open a second browser and sign in there too; now there are two, and
> `SMEMBERS usess:<id>` lists both.
>
> They sign up again from a third browser with the same address. The response is a `202` with
> a body byte-identical to the first signup's — but no second user is created, and
> `taha@example.com` receives a mail reading *"someone tried to sign up with your address"*.
> The third browser, finding no session, lands back on `/login` with an explanatory banner. In
> the same browser they try to sign in with a wrong password and get *"That email and password
> don't match an account."*; they try `nobody@nowhere.test` and get the identical sentence,
> with the two responses timed at 312 ms and 298 ms.
>
> They click *Forgot your password?*, enter the address, and the response is `202` in under two
> seconds. A real email arrives with the subject **"418362 is your Cerebro reset code"**. They
> enter `000000` five times: the first four return *"That code isn't right. N attempts left."*
> with N counting down, and the fifth returns *"Too many attempts."* — and
> `redis-cli EXISTS otp:pwreset:<id>` now returns `0`. They request a new code; the immediate
> retry returns `429` with `retryAfterSeconds: 58`, and after a minute it succeeds. They enter
> the real code, set a new password, and are returned to `/login`.
>
> At that moment both other browsers are signed out: their next request returns
> `401 session_invalidated`, and `redis-cli KEYS 'sess:*'` for that user returns nothing —
> `credentialVersion` did its job.
>
> They sign in with the new password, then sign out and click **Continue with Google**, using
> the Google account for the same `taha@example.com`. Google redirects back, and they land on
> `/chat` **on the same account** — `GET /api/auth/session` shows `identities: ['local',
> 'google']` and one user document in Mongo. A colleague repeats the Google flow with an
> address that has no Cerebro account and gets a brand-new user with `emailVerified: true` and
> no password hash.
>
> Finally the operator stops the SMTP server and requests another reset. The endpoint still
> returns `202` in under ten seconds with the same body; no code arrives; and a
> `pipeline_errors` row exists with `kind: 'notify'` naming the connection failure. They run
> `npm run test:auth` and all four suites pass with no network access.

---

## 12. Files to Create

```
backend/src/
├── models/User.js
├── auth/
│   ├── session.js                    # express-session + connect-redis (§3.1)
│   ├── passport.js                   # strategy registration, serialize/deserialize
│   ├── strategies/{google,github,local}.js
│   ├── password.js                   # argon2id, policy, needsRehash (§4)
│   ├── breachedPasswords.js          # frozen Set, top 10k, ~90 KB
│   ├── otp.js                        # issue / verify / consume (§5.1)
│   ├── limits.js                     # three-axis rate limits (§5.2)
│   ├── linking.js                    # resolveIdentity, the five branches (§6.2)
│   └── mask.js                       # maskEmail, maskPhone, safeReturnTo
├── notify/
│   ├── email.js  sms.js
│   └── templates/otpEmail.js  signupCollision.js
├── models/PipelineError.js           # written here so notify failures have a home;
│                                     #   read by /admin/errors in Phase 7
├── api/
│   ├── middleware/requireAuth.js  requireAdmin.js
│   ├── routes/auth.js  password.js
│   └── index.js                      # [extend] sessionMiddleware + passport + routers
└── config/index.js                   # [extend] auth / mail / sms blocks (§9)

backend/test/auth/
├── password.test.js                  # hashing, null-hash timing, policy, breach list
├── otp.test.js                       # issue/verify/lock/expire/single-use/increment-first
├── linking.test.js                   # all five resolveIdentity branches
└── session.test.js                   # regenerate, credentialVersion, logout-all
```

**New dependencies:** `express-session`, `connect-redis`, `passport`,
`passport-google-oauth20`, `passport-github2`, `passport-local`, `argon2`, `nodemailer`,
`twilio` (optional at runtime, but a declared dependency).

---

## 13. Performance Validation

| Metric | How to Measure | Target |
|---|---|---|
| `GET /api/auth/session` | `autocannon -c 10 -d 20` with a valid cookie | < 15 ms p95 |
| argon2id hash | 20-run benchmark on target hardware | 250–500 ms |
| Login end to end | Network panel | < 600 ms p95 (dominated by argon2, by design) |
| OAuth callback | Network panel, warm | < 800 ms p95 |
| `forgot` with SMTP up | Network panel | < 2 s p95 |
| `forgot` with SMTP dead | Network panel | < 10 s, still `202` (bounded by the 8 s socket timeout) |
| Timing gap, existing vs. unknown email on login | 50 runs each, compare medians | < 15% |
| Redis memory per session | `MEMORY USAGE sess:<sid>` | < 1 KB |
