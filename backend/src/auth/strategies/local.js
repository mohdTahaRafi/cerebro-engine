import { Strategy as LocalStrategy } from 'passport-local';
import { User } from '../../models/User.js';
import { verifyPassword, needsRehash, hashPassword } from '../password.js';
import { authOutcomes } from '../../telemetry/metrics.js';

// `session: false` (see google.js's header comment) — this strategy only decides
// authentic/not; routes/auth.js's login route drives establishSession itself.
//
// The enumeration-resistant response (§8: an unknown email and a wrong password return
// byte-identical bodies) is the ROUTE's job, not this strategy's — it only needs to
// distinguish "credentials were valid" (`done(null, user)`) from "they were not"
// (`done(null, false)`), and never leak which half of "email or password" was wrong.
export function registerLocalStrategy(passport) {
  passport.use('local', new LocalStrategy({
    usernameField: 'email',
    passwordField: 'password',
  }, async (email, password, done) => {
    try {
      const normalizedEmail = String(email ?? '').toLowerCase().trim();
      const user = await User.findOne({ email: normalizedEmail });

      // verifyPassword(null, plain) burns comparable time and returns false — an
      // OAuth-only account (passwordHash === null) is not distinguishable by timing
      // from a wrong password on a real account.
      const ok = await verifyPassword(user?.passwordHash ?? null, password);
      if (!user || !ok) {
        authOutcomes.inc({ method: 'local', outcome: 'invalid' });
        return done(null, false);
      }

      if (user.status !== 'active') {
        authOutcomes.inc({ method: 'local', outcome: 'locked' });
        return done(null, false, { code: 'account_suspended' });
      }

      // Opportunistic rehash: only ever raises the work factor, never on the failure path.
      if (needsRehash(user.passwordHash)) {
        user.passwordHash = await hashPassword(password);
        await user.save();
      }

      authOutcomes.inc({ method: 'local', outcome: 'success' });
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }));
}
