// phase_1 §5.2 — `returnTo` is captured on redirect and consumed after a successful
// sign-in. Validated on both ends (frontend here, and again on the backend in Phase 5 —
// neither is trusted alone): must start with a single `/`, must not contain `\` or begin
// with `//` (an open-redirect vector: `//evil.com` is browser-parsed as a
// protocol-relative URL, not a same-origin path).
const FALLBACK = '/chat';

// The /login URL a signed-out visitor to `path` is sent to. `/` (which index-redirects to
// /chat) and /chat itself are where a sign-in lands anyway, so they carry no returnTo —
// `/login?returnTo=%2F` says nothing the bare `/login` doesn't. Deep links keep it.
export function loginPathFor(path: string): string {
  if (path === '/' || path === FALLBACK) return '/login';
  return `/login?returnTo=${encodeReturnTo(path)}`;
}

export function encodeReturnTo(path: string): string {
  return encodeURIComponent(path);
}

export function sanitizeReturnTo(raw: string | null): string {
  if (!raw) return FALLBACK;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return FALLBACK; }
  if (!decoded.startsWith('/')) return FALLBACK;
  if (decoded.startsWith('//')) return FALLBACK;
  if (decoded.includes('\\')) return FALLBACK;
  return decoded;
}
