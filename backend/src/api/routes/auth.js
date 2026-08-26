import express from 'express';
import { passport } from '../../auth/passport.js';
import { config } from '../../config/index.js';
import { User } from '../../models/User.js';
import { hit, LIMITS } from '../../auth/limits.js';
import { validatePassword, hashPassword, burnHashTime, PASSWORD_MIN } from '../../auth/password.js';
import { roleForEmail } from '../../auth/roles.js';
import { safeReturnTo } from '../../auth/mask.js';
import { toSessionUser } from '../../auth/serialize.js';
import { establishSession, destroySession, destroyAllSessions } from '../../auth/sessionLifecycle.js';
import { requireAuth } from '../middleware/requireAuth.js';
import * as mailer from '../../notify/email.js';
import * as sms from '../../notify/sms.js';
import { recordPipelineError } from '../../telemetry/pipelineError.js';

const router = express.Router();

// GET /api/auth/capabilities — public. Computed from config, so an unconfigured
// provider/channel is absent from the response, never a button or option that fails.
router.get('/api/auth/capabilities', (req, res) => {
  const providers = [];
  if (config.auth.google.clientId) providers.push('google');
  if (config.auth.github.clientId) providers.push('github');

  const otpChannels = [];
  if (mailer.configured()) otpChannels.push('email');
  if (sms.configured()) otpChannels.push('sms');

  res.status(200).json({ providers, otpChannels, passwordMinLength: PASSWORD_MIN });
});

// GET /api/auth/session — public, NEVER 401. requireAuth is deliberately not used here:
// an anonymous probe is a normal answer (architecture §3 step 1).
router.get('/api/auth/session', async (req, res, next) => {
  try {
    const userId = req.session?.userId;
    if (!userId) return res.status(200).json({ user: null });

    const user = await User.findById(userId).lean();
    if (!user || user.status !== 'active' || user.credentialVersion !== req.session.credentialVersion) {
      req.session.destroy(() => {});
      return res.status(200).json({ user: null });
    }
    return res.status(200).json({ user: toSessionUser(user) });
  } catch (err) { next(err); }
});

// POST /api/auth/signup — public. §7/§8: an existing address gets the SAME 202 { ok:
// true } body a genuinely new signup gets — no `user` field, on purpose. The client
// cannot tell "created and signed in" from "already existed" from this response alone,
// which is the point; AuthContext.signUp resolves the ambiguity by calling
// GET /api/auth/session immediately after (frontend/src/app/context/AuthContext.tsx).
//
// Amended from phase_5's original draft, which had this endpoint return the full
// SessionResponse ({user: SessionUser | null}) and described the "call session()
// after" behavior only in prose (§8) without changing the route table's response type —
// a SessionResponse with `user: null` on collision is trivially distinguishable from one
// carrying a real user, which defeats the enumeration resistance §8 itself argues for.
// { ok: true } in both branches is what the prose actually requires.
router.post('/api/auth/signup', async (req, res, next) => {
  try {
    const { email, password, name } = req.body ?? {};
    if (typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ code: 'invalid_request', message: 'Enter a valid email address.' });
    }
    const normalizedEmail = email.toLowerCase().trim();

    const ipLimit = await hit(LIMITS.signupPerIp, req.ip);
    if (ipLimit.exceeded) {
      return res.status(429).json({
        code: 'rate_limited', message: 'Too many requests. Try again later.',
        retryAfterSeconds: ipLimit.retryAfterSec,
      });
    }

    const validationError = validatePassword(password, { email: normalizedEmail, name });
    if (validationError) {
      return res.status(400).json({ code: 'weak_password', message: validationError, fields: { password: validationError } });
    }

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      await burnHashTime();   // §8: comparable latency to the real-signup branch below
      mailer.sendSignupCollision({ to: normalizedEmail }).catch(async (err) => {
        await recordPipelineError('notify', err, { retryable: true });
      });
      return res.status(202).json({ ok: true });
    }

    const user = new User({
      email: normalizedEmail,
      emailVerified: false,
      passwordHash: await hashPassword(password),
      name: name?.trim() || null,
      role: roleForEmail(normalizedEmail),
    });
    // The user's own _id as providerId (User model §2.1) — generated client-side by
    // Mongoose before the insert, so it's available here without a second round trip.
    user.identities.push({
      provider: 'local', providerId: String(user._id),
      providerEmail: normalizedEmail, emailVerified: false, linkedAt: new Date(),
    });
    await user.save();

    await establishSession(req, user);
    return res.status(202).json({ ok: true });
  } catch (err) { next(err); }
});

// POST /api/auth/login — public. Two-axis rate limiting BEFORE the strategy runs, so a
// blocked attempt never touches argon2 at all.
router.post('/api/auth/login', async (req, res, next) => {
  try {
    const { email } = req.body ?? {};
    const normalizedEmail = String(email ?? '').toLowerCase().trim();

    const [idLimit, ipLimit] = await Promise.all([
      hit(LIMITS.loginPerIdentifier, normalizedEmail),
      hit(LIMITS.loginPerIp, req.ip),
    ]);
    if (idLimit.exceeded || ipLimit.exceeded) {
      return res.status(429).json({
        code: 'rate_limited', message: 'Too many attempts. Try again later.',
        retryAfterSeconds: Math.max(idLimit.retryAfterSec, ipLimit.retryAfterSec),
      });
    }

    passport.authenticate('local', { session: false }, async (err, user, info) => {
      try {
        if (err) return next(err);
        if (!user) {
          if (info?.code === 'account_suspended') {
            return res.status(401).json({ code: 'account_suspended', message: 'This account has been suspended.' });
          }
          // §8: byte-identical whether the email doesn't exist or the password is
          // wrong — the local strategy already collapses both to `done(null, false)`.
          return res.status(401).json({ code: 'invalid_credentials', message: "That email and password don't match an account." });
        }
        await establishSession(req, user);
        return res.status(200).json({ user: toSessionUser(user) });
      } catch (innerErr) { next(innerErr); }
    })(req, res, next);
  } catch (err) { next(err); }
});

// POST /api/auth/logout — session required in the sense that it needs one to remove;
// an already-signed-out caller still gets a clean 204 rather than a 401, since the end
// state ("no session") is identical either way.
router.post('/api/auth/logout', async (req, res, next) => {
  try {
    if (req.session?.userId) await destroySession(req);
    res.clearCookie('cerebro.sid', { path: '/' });
    return res.status(204).send();
  } catch (err) { next(err); }
});

// POST /api/auth/logout-all — requireAuth. Bumps credentialVersion (so a session that
// was mid-flight when this ran also dies at its next request) and deletes every sid.
router.post('/api/auth/logout-all', requireAuth, async (req, res, next) => {
  try {
    await User.updateOne({ _id: req.user._id }, { $inc: { credentialVersion: 1 } });
    await destroyAllSessions(req.user._id);
    res.clearCookie('cerebro.sid', { path: '/' });
    return res.status(204).send();
  } catch (err) { next(err); }
});

// GET /api/auth/google — public. Passport start; stores a validated returnTo in the
// session so the callback below knows where to send the browser next. Absent from
// /api/auth/capabilities (and so from the frontend's button set) whenever
// GOOGLE_CLIENT_ID/SECRET are unset — 404 here is the same "not configured" answer,
// reached only if something calls this route directly.
router.get('/api/auth/google', (req, res, next) => {
  if (!config.auth.google.clientId) {
    return res.status(404).json({ code: 'not_found', message: 'Google sign-in is not configured.' });
  }
  req.session.returnTo = safeReturnTo(typeof req.query.returnTo === 'string' ? req.query.returnTo : null);
  passport.authenticate('google')(req, res, next);
});

// GET /api/auth/google/callback — public. Resolve → link/create (linking.js §6.2) →
// regenerate → 302 to returnTo. A tampered `state` or a linking refusal both land back
// on /login with `?error=<code>` rather than a raw failure page — Login.tsx renders it
// as the same banner style Signup.tsx's collision redirect uses.
router.get('/api/auth/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, async (err, user, info) => {
    try {
      const returnTo = req.session?.returnTo || '/chat';
      if (err) {
        console.error('[oauth] google callback error:', err.message);
        return res.redirect('/login?error=oauth_failed');
      }
      if (!user) {
        return res.redirect(`/login?error=${encodeURIComponent(info?.code ?? 'oauth_failed')}`);
      }
      delete req.session.returnTo;
      await establishSession(req, user);
      return res.redirect(returnTo);
    } catch (innerErr) { next(innerErr); }
  })(req, res, next);
});

// GET /api/auth/github and /callback — same shape as Google, above.
router.get('/api/auth/github', (req, res, next) => {
  if (!config.auth.github.clientId) {
    return res.status(404).json({ code: 'not_found', message: 'GitHub sign-in is not configured.' });
  }
  req.session.returnTo = safeReturnTo(typeof req.query.returnTo === 'string' ? req.query.returnTo : null);
  passport.authenticate('github')(req, res, next);
});

router.get('/api/auth/github/callback', (req, res, next) => {
  passport.authenticate('github', { session: false }, async (err, user, info) => {
    try {
      const returnTo = req.session?.returnTo || '/chat';
      if (err) {
        console.error('[oauth] github callback error:', err.message);
        return res.redirect('/login?error=oauth_failed');
      }
      if (!user) {
        return res.redirect(`/login?error=${encodeURIComponent(info?.code ?? 'oauth_failed')}`);
      }
      delete req.session.returnTo;
      await establishSession(req, user);
      return res.redirect(returnTo);
    } catch (innerErr) { next(innerErr); }
  })(req, res, next);
});

export default router;
