// Phase 8 §3.1: the double-submit CSRF token. Phase 1 §4.3 already sends an
// `X-CSRF-Token` header when a `cerebro.csrf` cookie exists (frontend/src/api/client.ts);
// this file creates the cookie and enforces the comparison.
//
// SameSite=Lax already blocks cross-site POST in every current browser. This is a
// second, independent control, because SameSite is a browser policy we do not own and
// cannot verify at request time — architecture §9.
import crypto from 'crypto';
import { config } from '../../config/index.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

// §3.1 exemptions: the OAuth handshake (a top-level GET navigation that carries no
// header the app controls) and login/signup (no session exists yet to hold a token;
// both are protected by SameSite=Lax plus rate limiting — auth/limits.js).
const EXEMPT = [
  /^\/api\/auth\/google(\/callback)?$/,
  /^\/api\/auth\/github(\/callback)?$/,
  /^\/api\/auth\/login$/,
  /^\/api\/auth\/signup$/,
];

export function issueCsrfToken(req, res, next) {
  // Amended from the phase doc's literal `if (!req.session) return next()`: express-
  // session's `req.session` object exists on EVERY request regardless of sign-in state
  // (saveUninitialized: false only controls whether it's persisted to the store), so
  // that guard alone still touches req.session.csrf on every anonymous visit —
  // verified live: it made express-session treat the session as modified and mint a
  // `cerebro.sid` cookie for a plain, signed-out `GET /api/auth/session`, exactly the
  // "no cookie for every bot" behavior session.js's own header comment says
  // saveUninitialized: false exists to prevent. Every CSRF-protected route requires
  // auth already (the unauthenticated ones — login/signup/OAuth — are in EXEMPT
  // above), so the token only ever needs to exist by the time a signed-in user makes
  // their first state-changing request; gating on `userId` instead of mere session
  // existence restores the anonymous-visitor property without weakening the control.
  if (!req.session?.userId) return next();
  req.session.csrf ??= crypto.randomBytes(32).toString('base64url');
  // Readable by JavaScript ON PURPOSE — the frontend must echo it into a header.
  // Its secrecy is not the control; the same-origin policy is. An attacker on another
  // origin can cause the browser to SEND the cookie but cannot READ it to build the
  // matching header.
  res.cookie('cerebro.csrf', req.session.csrf, {
    httpOnly: false, secure: config.nodeEnv === 'production',
    sameSite: 'lax', path: '/', maxAge: 7 * 24 * 60 * 60 * 1000,
  });
  next();
}

export function requireCsrf(req, res, next) {
  if (SAFE.has(req.method)) return next();
  if (EXEMPT.some((re) => re.test(req.path))) return next();

  const sent = req.get('X-CSRF-Token') ?? '';
  const expected = req.session?.csrf ?? '';
  const a = Buffer.from(sent), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ code: 'csrf_failed', message: 'Refresh the page and try again.' });
  }
  next();
}
