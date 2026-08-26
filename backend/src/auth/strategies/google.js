import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { config } from '../../config/index.js';
import { resolveIdentity } from '../linking.js';

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

// `session: false` throughout this phase's Passport usage (§3): the app's own session
// shape (`req.session.userId` / `credentialVersion`, sessionLifecycle.js) is what
// establishes a signed-in cookie, not Passport's `serializeUser`/`req.login()`. Passport
// here is only the OAuth2-with-PKCE handshake and profile-normalization framework — the
// route (routes/auth.js) reads `user`/`info` off the verify callback and drives
// establishSession itself.
export function registerGoogleStrategy(passport) {
  if (!config.auth.google.clientId || !config.auth.google.clientSecret) return;   // absent
                                                                                   // from
                                                                                   // /api/auth/capabilities
  passport.use('google', new GoogleStrategy({
    clientID: config.auth.google.clientId,
    clientSecret: config.auth.google.clientSecret,
    callbackURL: `${config.auth.publicUrl}/api/auth/google/callback`,
    scope: ['openid', 'email', 'profile'],
    state: true,                       // CSRF protection on the OAuth handshake; requires
                                       //   the session cookie on the callback, which is why
                                       //   sameSite is 'lax' and not 'strict' (§3.1)
    pkce: true,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const result = await resolveIdentity(normalizeGoogle(profile));
      if (!result.ok) return done(null, false, { code: result.code });
      return done(null, result.user);
    } catch (err) {
      return done(err);
    }
  }));
}
