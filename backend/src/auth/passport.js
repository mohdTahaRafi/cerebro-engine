import passport from 'passport';
import { User } from '../models/User.js';
import { registerGoogleStrategy } from './strategies/google.js';
import { registerGitHubStrategy } from './strategies/github.js';
import { registerLocalStrategy } from './strategies/local.js';

registerLocalStrategy(passport);
registerGoogleStrategy(passport);     // no-ops when GOOGLE_CLIENT_ID/SECRET are unset
registerGitHubStrategy(passport);     // no-ops when GITHUB_CLIENT_ID/SECRET are unset

// Defined for completeness even though every strategy above runs with `session: false`
// (this app's own cookie session — sessionLifecycle.js's establishSession — is what
// actually signs a request in, not Passport's). Kept minimal and correct so
// `passport.session()` would work if a future phase ever mounts it.
passport.serializeUser((user, done) => done(null, String(user._id)));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).lean();
    done(null, user ?? false);
  } catch (err) {
    done(err);
  }
});

export { passport };
