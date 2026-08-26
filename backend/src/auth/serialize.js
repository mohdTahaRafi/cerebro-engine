// The one place a User document becomes the `SessionUser` shape
// (frontend/src/api/contracts.ts) — used by GET /session and POST /login so the two
// never drift into slightly different projections of the same document.
export function toSessionUser(user) {
  return {
    id: String(user._id),
    email: user.email,
    emailVerified: user.emailVerified,
    name: user.name ?? null,
    avatarUrl: user.avatarUrl ?? null,
    role: user.role,
    identities: user.identities.map((i) => i.provider),
    phone: user.phone ?? null,
    phoneVerified: user.phoneVerified,
    createdAt: user.createdAt.toISOString(),
  };
}
