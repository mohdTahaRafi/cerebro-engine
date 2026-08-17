// CORS origin policy (phase 6 §6.2), pulled into its own pure function so it can be unit
// tested directly (test/api/corsOptions.test.js) rather than only exercised by spinning up
// the whole app — a pattern that paid off once already on scripts/migrate-legacy.js's
// decideDrop(), and applies here for the same reason: this is a decision function with
// distinct branches, and getting the "which origins pass" question wrong is a real security
// question, not a stylistic one.
//
// An explicit allowlist in production rather than the permissive `cors()` this used to be —
// an unlisted origin's browser-side fetch is rejected before it reaches any route.
// Development stays permissive to *localhost* (any port) so Vite's dev server, which picks
// its own port, needs no per-run configuration — this is not the same as staying permissive
// to the public internet, which only NODE_ENV=production ever faces.
const DEV_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function buildCorsOptions(nodeEnv, corsAllowedOriginsEnv) {
  if (nodeEnv !== 'production') {
    return { origin: DEV_ORIGIN_RE };
  }
  return {
    origin(origin, callback) {
      const allowed = (corsAllowedOriginsEnv ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      // No Origin header (server-to-server, curl, same-origin) is not a cross-origin
      // browser request at all — nothing for CORS to police.
      if (!origin || allowed.includes(origin)) return callback(null, true);
      const err = new Error(`Origin "${origin}" is not in CORS_ALLOWED_ORIGINS.`);
      err.status = 403;   // errorHandler.js reads err.status; a policy rejection is 403, not the 500 default
      callback(err);
    },
  };
}
