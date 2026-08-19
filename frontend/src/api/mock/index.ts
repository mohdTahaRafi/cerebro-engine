// phase_1 §4.4 — dev-only auth mock. Only auth is mocked this phase; documents, threads,
// chat and health stay on the real backend even when VITE_API_MOCK=1, because that path
// already works against the real backend pre-Phase-1 (phase_1 §7.3's Sidebar note, §4.4).
import { CerebroApiError } from '../client';
import { documents } from '../endpoints/documents';
import { threads } from '../endpoints/threads';
import { chat } from '../endpoints/chat';
import { health } from '../endpoints/health';
import { contexts } from '../endpoints/contexts';
import { traces } from '../endpoints/traces';
import { vectors } from '../endpoints/vectors';
import { admin } from '../endpoints/admin';
import * as usersFixture from './fixtures/users';
import * as otpFixture from './fixtures/otp';
import type {
  SessionResponse, SignupRequest, LoginRequest, AuthCapabilities,
  ForgotPasswordRequest, ForgotPasswordResponse, VerifyOtpRequest, VerifyOtpResponse,
  ResetPasswordRequest, SessionUser,
} from '../contracts';

export const MOCKED_ENDPOINTS = new Set([
  'auth.session', 'auth.signup', 'auth.login', 'auth.logout', 'auth.capabilities',
  'auth.forgotPassword', 'auth.verifyOtp', 'auth.resetPassword',
]);
// Phase 1 mocks ONLY auth. documents/threads/health/ask stay on the real backend.

// A tiny artificial delay so `status: 'loading'` is actually observable in the demo,
// the same way a real network round-trip would be, rather than resolving synchronously.
const LATENCY_MS = 150;
const delay = () => new Promise((r) => setTimeout(r, LATENCY_MS));

// Plain module state, not sessionStorage: the user TABLE itself (fixtures/users.ts) is
// also module state that resets on every full reload, so persisting only the "who's
// signed in" pointer to storage would survive a reload while the record it points at
// vanished underneath it — session() would then (correctly, but confusingly) report
// signed-out anyway. Keeping both in the same place keeps them consistent: a mock
// session is memory-only and resets on reload, same as the fixture data behind it.
let currentEmail: string | null = null;

function currentUser(): SessionUser | null {
  if (!currentEmail) return null;
  const user = usersFixture.findByEmail(currentEmail);
  return user ? usersFixture.toSessionUser(user) : null;
}

const mockAuth = {
  async session(): Promise<SessionResponse> {
    await delay();
    return { user: currentUser() };
  },

  async capabilities(): Promise<AuthCapabilities> {
    await delay();
    return { providers: ['google', 'github'], otpChannels: ['email'], passwordMinLength: 12 };
  },

  async signup(body: SignupRequest): Promise<SessionResponse> {
    await delay();
    if (usersFixture.findByEmail(body.email)) {
      // DESIGN.md §6.2 — the server responds identically either way; here that means
      // no session is established, and the caller (AuthContext.signUp) routes to
      // /login with the "already exists" banner rather than reading a distinguishing
      // error code.
      return { user: null };
    }
    const user = usersFixture.createUser(body.email, body.password, body.name ?? null);
    currentEmail = user.email;
    return { user: usersFixture.toSessionUser(user) };
  },

  async login(body: LoginRequest): Promise<SessionResponse> {
    await delay();
    const user = usersFixture.findByEmail(body.email);
    if (!user || user.password !== body.password) {
      throw new CerebroApiError({
        status: 401, code: 'invalid_credentials',
        message: "That email and password don't match an account.",
      });
    }
    currentEmail = user.email;
    return { user: usersFixture.toSessionUser(user) };
  },

  async logout(): Promise<void> {
    await delay();
    currentEmail = null;
  },

  async forgotPassword(body: ForgotPasswordRequest): Promise<ForgotPasswordResponse> {
    await delay();
    // Always 202-equivalent with the same shape whether or not the account exists
    // (architecture §7.10) — the mock issues a code unconditionally.
    const issued = otpFixture.issue(body.identifier, body.channel);
    return { sent: true, channel: body.channel, ...issued };
  },

  async verifyOtp(body: VerifyOtpRequest): Promise<VerifyOtpResponse> {
    await delay();
    try {
      return otpFixture.verify(body.identifier, body.code);
    } catch (err) {
      if (err instanceof otpFixture.OtpError) {
        const message = err.code === 'otp_invalid'
          ? `That code isn't right. ${err.attemptsRemaining} attempt${err.attemptsRemaining === 1 ? '' : 's'} left.`
          : err.message;
        throw new CerebroApiError({
          status: err.code === 'otp_locked' ? 429 : 400,
          code: err.code, message,
        });
      }
      throw err;
    }
  },

  async resetPassword(body: ResetPasswordRequest): Promise<void> {
    await delay();
    const identifier = otpFixture.consumeResetToken(body.resetToken);
    if (!identifier) {
      throw new CerebroApiError({
        status: 400, code: 'reset_token_invalid',
        message: 'That reset link has expired. Request a new one.',
      });
    }
    usersFixture.setPassword(identifier, body.password);
  },
};

export const mockApi = {
  auth: mockAuth,
  documents, threads, chat, health, contexts, traces, vectors, admin,
};
