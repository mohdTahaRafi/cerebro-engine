import { requireAuth } from './requireAuth.js';

// Not mounted on any route in this phase — Phase 5 adds no admin endpoints. Provided now
// (phase_5 §12's file list) so Phase 6/7's admin routes (`/admin/health`, `/admin/errors`)
// have a ready middleware rather than each hand-rolling the same role check.
export function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ code: 'forbidden', message: 'Admin access required.' });
    }
    next();
  });
}
