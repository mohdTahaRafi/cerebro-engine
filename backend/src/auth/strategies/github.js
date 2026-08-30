import { Strategy as GitHubStrategy } from 'passport-github2';
import { config } from '../../config/index.js';
import { resolveIdentity } from '../linking.js';
import { authOutcomes } from '../../telemetry/metrics.js';

// GitHub's `/user` profile always returns `email: null` when the user has hidden their
// address, and the profile carries no verification flag at all — a second call to
// `/user/emails` (which DOES need the `user:email` scope) is the only way to get both a
// usable address and whether GitHub itself vouches for it.
async function fetchPrimaryEmail(accessToken) {
  const res = await fetch('https://api.github.com/user/emails', {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'cerebro',
    },
  });
  if (!res.ok) return { email: null, emailVerified: false };
  const list = await res.json();
  const primary = list.find((e) => e.primary) ?? list.find((e) => e.verified) ?? null;
  return {
    email: primary?.email?.toLowerCase() ?? null,
    emailVerified: primary?.verified === true,
  };
}

export function registerGitHubStrategy(passport) {
  if (!config.auth.github.clientId || !config.auth.github.clientSecret) return;   // absent
                                                                                   // from
                                                                                   // /api/auth/capabilities
  passport.use('github', new GitHubStrategy({
    clientID: config.auth.github.clientId,
    clientSecret: config.auth.github.clientSecret,
    callbackURL: `${config.auth.publicUrl}/api/auth/github/callback`,
    scope: ['user:email'],
    state: true,
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const { email, emailVerified } = await fetchPrimaryEmail(accessToken);
      const normalized = {
        provider: 'github',
        providerId: String(profile.id),
        email,
        emailVerified,   // an account whose primary email is unverified yields false here
                        //   and therefore never auto-links (linking.js §6.2 branch 2)
        name: profile.displayName || profile.username || null,
        avatarUrl: profile.photos?.[0]?.value ?? null,
      };
      const result = await resolveIdentity(normalized);
      if (!result.ok) {
        authOutcomes.inc({ method: 'github', outcome: 'invalid' });
        return done(null, false, { code: result.code });
      }
      authOutcomes.inc({ method: 'github', outcome: result.linked ? 'linked' : 'success' });
      return done(null, result.user);
    } catch (err) {
      return done(err);
    }
  }));
}
