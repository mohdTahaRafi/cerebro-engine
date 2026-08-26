import { config } from '../config/index.js';

// Shared by the local signup route and linking.js's two "create a new user" branches
// (§6.2 branches 2 and 3) — every code path that creates a User seeds `role` the same
// way. `ADMIN_EMAILS` is operator-set (an env var, not user input), so matching against
// it is the trust boundary; there is no additional verification gate before granting it
// (task 5.20's acceptance criterion is unconditional: "a signup with an allowlisted
// address gets role: 'admin'"). No API exists that changes `role` after creation.
export function roleForEmail(email) {
  return config.auth.adminEmails.includes(email.toLowerCase()) ? 'admin' : 'user';
}
