import { User } from '../../models/User.js';
import { recordActivity } from '../../telemetry/activity.js';

// Not yet mounted on any existing route (phase_5 §1 — that is Phase 6's first task).
// `password.js`, `otp.js`, and the routes this phase adds are the only current callers.
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
  // Best-effort, not awaited — cerebro_active_tenants (phase 8 §5.1) must never add
  // latency to an authenticated request, and a dropped activity ping just means one
  // request doesn't count toward this scrape's 5-minute window, not a wrong answer.
  recordActivity(user._id).catch(() => {});
  next();
}

// `GET /api/auth/session` deliberately does NOT use this middleware: it answers
// `200 {user: null}` when signed out, because an unauthenticated session probe is a
// normal answer and returning 401 would put a red line in the console on every cold
// page load (architecture.md §3 step 1).
