// Mounted at /api/auth — these three routes are `/auth/forgot-password`,
// `/auth/verify-otp`, `/auth/reset-password`. phase_5 §7 originally spelled these
// `/auth/password/forgot|verify-otp|reset` plus a fourth, dedicated `/auth/password/resend`;
// amended during implementation to match `frontend/src/api/endpoints/auth.ts`, which
// Phase 1 already shipped with the flat `/auth/forgot-password` etc. paths and no resend
// call of its own — see this phase's completion notes for the reasoning, including why a
// dedicated resend route was dropped rather than added to the frontend.
import express from 'express';
import { User } from '../../models/User.js';
import { hit, LIMITS, hashId } from '../../auth/limits.js';
import { issueOtp, verifyOtp, consumeResetToken, discardOtp, OTP_TTL_SECONDS, OTP_RESEND_COOLDOWN } from '../../auth/otp.js';
import { validatePassword, hashPassword, burnHashTime } from '../../auth/password.js';
import { maskEmail, maskPhone } from '../../auth/mask.js';
import { destroyAllSessions } from '../../auth/sessionLifecycle.js';
import * as mailer from '../../notify/email.js';
import * as sms from '../../notify/sms.js';
import { recordPipelineError } from '../../telemetry/pipelineError.js';
import { otpOutcomes } from '../../telemetry/metrics.js';

const router = express.Router();

const OTP_TTL_MINUTES = OTP_TTL_SECONDS / 60;

function standardForgotBody(channel, maskedDestination) {
  return {
    sent: true,
    channel,
    maskedDestination,
    expiresInSeconds: OTP_TTL_SECONDS,
    resendAfterSeconds: OTP_RESEND_COOLDOWN,
  };
}

// POST /api/auth/forgot-password — public, always 202 unless rate-limited. Doubles as
// "resend": the frontend's Resend button (ResetPassword.tsx) calls this same endpoint
// again rather than a separate route. issueOtp()'s own 60s cooldown makes a too-fast
// resend a silent no-op (still 202, no new mail) instead of a 429 — a cooldown-triggered
// 429 would itself be an oracle, since the cooldown key only ever exists for accounts
// that actually received a code (§8).
router.post('/api/auth/forgot-password', async (req, res, next) => {
  try {
    const { identifier, channel } = req.body ?? {};
    if (typeof identifier !== 'string' || !identifier.includes('@')) {
      return res.status(400).json({ code: 'invalid_request', message: 'Enter a valid email address.' });
    }
    const requestedChannel = channel === 'sms' ? 'sms' : 'email';
    if (requestedChannel === 'sms' && !sms.configured()) {
      return res.status(400).json({ code: 'channel_unavailable', message: 'Text message delivery is not configured.' });
    }

    const ip = req.ip;
    const [idLimit, ipLimit] = await Promise.all([
      hit(LIMITS.otpPerIdentifier, identifier),
      hit(LIMITS.otpPerIp, ip),
    ]);
    if (idLimit.exceeded || ipLimit.exceeded) {
      return res.status(429).json({
        code: 'rate_limited',
        message: 'Too many requests. Try again later.',
        retryAfterSeconds: Math.max(idLimit.retryAfterSec, ipLimit.retryAfterSec),
      });
    }

    const normalizedEmail = identifier.toLowerCase().trim();
    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      await burnHashTime();
      return res.status(202).json(standardForgotBody(requestedChannel, maskEmail(normalizedEmail)));
    }

    if (requestedChannel === 'sms' && !user.phone) {
      // No phone on file. Still 202, masked as if a code were sent — revealing "this
      // account has no phone" would itself distinguish it from an account that does.
      // No code is actually issued.
      return res.status(202).json(standardForgotBody('sms', maskPhone('+10000000000')));
    }

    const destination = requestedChannel === 'sms' ? user.phone : user.email;
    const masked = requestedChannel === 'sms' ? maskPhone(destination) : maskEmail(destination);

    const issued = await issueOtp(String(user._id), requestedChannel);
    if (!issued.throttled) {
      try {
        const send = requestedChannel === 'sms' ? sms.sendOtp : mailer.sendOtp;
        await send({ to: destination, code: issued.code, expiresInMinutes: OTP_TTL_MINUTES });
        otpOutcomes.inc({ channel: requestedChannel, outcome: 'sent' });
      } catch (err) {
        // §5.4: delete the record (not the cooldown key) so the next request isn't
        // blocked by a code that was never delivered, but the retry is still paced.
        await discardOtp(user._id);
        await recordPipelineError('notify', err, { userId: user._id, retryable: true });
        otpOutcomes.inc({ channel: requestedChannel, outcome: 'send_failed' });
      }
    }

    return res.status(202).json(standardForgotBody(requestedChannel, masked));
  } catch (err) { next(err); }
});

// POST /api/auth/verify-otp — public. `pseudoId` keeps a nonexistent account on the
// exact same code path (a real Redis HGETALL that always misses) as an existing account
// that never requested a reset, so this endpoint carries no enumeration signal of its
// own without needing a dummy-timing branch.
router.post('/api/auth/verify-otp', async (req, res, next) => {
  try {
    const { identifier, code } = req.body ?? {};
    if (typeof identifier !== 'string' || typeof code !== 'string') {
      return res.status(400).json({ code: 'invalid_request', message: 'Enter the code you received.' });
    }
    const user = await User.findOne({ email: identifier.toLowerCase().trim() });
    const pseudoId = user ? String(user._id) : hashId(identifier);
    const result = await verifyOtp(pseudoId, code);
    // §5.1's expired branch carries no channel to label with (otp.js's own comment) —
    // every other branch does, since a record existed to read one off.
    if (result.channel) otpOutcomes.inc({ channel: result.channel, outcome: result.ok ? 'verified' : result.reason });

    if (result.ok) {
      return res.status(200).json({ resetToken: result.resetToken, expiresInSeconds: result.expiresInSeconds });
    }
    if (result.reason === 'locked') {
      return res.status(400).json({ code: 'otp_locked', message: 'Too many attempts. Request a new code.' });
    }
    if (result.reason === 'expired') {
      return res.status(400).json({ code: 'otp_expired', message: 'That code has expired. Request a new one.' });
    }
    return res.status(400).json({
      code: 'otp_invalid',
      message: `That code isn't right. ${result.attemptsRemaining} attempt${result.attemptsRemaining === 1 ? '' : 's'} left.`,
      attemptsRemaining: result.attemptsRemaining,
    });
  } catch (err) { next(err); }
});

// POST /api/auth/reset-password — public. Consumes the token atomically; two concurrent
// calls with the same token race consumeResetToken's GETDEL, and exactly one wins.
router.post('/api/auth/reset-password', async (req, res, next) => {
  try {
    const { resetToken, password } = req.body ?? {};
    if (typeof resetToken !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ code: 'invalid_request', message: 'Missing reset token or password.' });
    }
    const userId = await consumeResetToken(resetToken);
    if (!userId) {
      return res.status(400).json({ code: 'token_invalid', message: 'That reset link has expired. Request a new one.' });
    }
    const user = await User.findById(userId);
    if (!user) {
      return res.status(400).json({ code: 'token_invalid', message: 'That reset link has expired. Request a new one.' });
    }

    const validationError = validatePassword(password, { email: user.email, name: user.name });
    if (validationError) {
      return res.status(400).json({ code: 'weak_password', message: validationError, fields: { password: validationError } });
    }

    user.passwordHash = await hashPassword(password);
    // A completed reset is real proof of mailbox control — the same proof an OAuth
    // provider's verified-email assertion represents (§6.2 branch 4's "both sides
    // verified the same address"). Setting it here is what lets a later "Continue with
    // Google" for the same address auto-link instead of hitting branch 5.
    user.emailVerified = true;
    // §6.3: "the flow works and sets a password, adding a local identity." An OAuth-only
    // account (passwordHash was null) has no 'local' entry in `identities` yet — without
    // pushing one here, toSessionUser's `identities: user.identities.map(i => i.provider)`
    // would keep reporting only the OAuth provider even though the user can now sign in
    // with a password, which is what the frontend's "connected accounts" list reads.
    // Guarded so an ordinary local-account reset (which already has this entry) never
    // double-pushes and trips the (provider, providerId) unique index.
    if (!user.identities.some((i) => i.provider === 'local')) {
      user.identities.push({
        provider: 'local', providerId: String(user._id),
        providerEmail: user.email, emailVerified: true, linkedAt: new Date(),
      });
    }
    // Bumped so every session issued under the old password dies at its next request
    // (requireAuth's credentialVersion check) — an attacker holding a stolen cookie
    // loses access at exactly the moment the victim believes they fixed the problem.
    user.credentialVersion += 1;
    await user.save();

    await destroyAllSessions(user._id);

    return res.status(204).send();
  } catch (err) { next(err); }
});

export default router;
