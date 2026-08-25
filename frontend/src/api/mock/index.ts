// phase_1 §4.4 — dev-only auth mock, active only under VITE_API_MOCK=1 and stripped from
// production builds entirely (api/index.ts's MOCK_ON constant fold).
//
// Amended phase_2: `contexts` and `documents` are NO LONGER special-cased here. Phase 1
// mocked them as a temporary bridge ("ahead of Phase 2's real routes"); now that Phase 2
// has landed, `endpoints/contexts.ts` is itself always a local, localStorage-backed
// adapter (regardless of this dev flag — see that file's header), and
// `endpoints/documents.ts` always hits the real backend. Re-mocking either here would mean
// two competing sources of truth for the same data. Both are passed through unchanged,
// exactly like threads/chat/health below. `traces`/`vectors`/`admin` are different (phase_4
// §1.2): those backend routes do not exist AT ALL until Phase 7, so passing them through
// would just mean every call 404s — they are backed by fixtures instead, defined below.
import { CerebroApiError } from '../client';
import { documents } from '../endpoints/documents';
import { threads } from '../endpoints/threads';
import { chat } from '../endpoints/chat';
import { health } from '../endpoints/health';
import { contexts } from '../endpoints/contexts';
import type { ListTracesParams } from '../endpoints/traces';
import type { ProjectQueryRequest } from '../contracts';
import * as usersFixture from './fixtures/users';
import * as otpFixture from './fixtures/otp';
import * as tracesFixture from './fixtures/traces';
import * as vectorsFixture from './fixtures/vectors';
import * as adminFixture from './fixtures/admin';
import type {
  SessionResponse, SignupRequest, LoginRequest, AuthCapabilities,
  ForgotPasswordRequest, ForgotPasswordResponse, VerifyOtpRequest, VerifyOtpResponse,
  ResetPasswordRequest, SessionUser,
} from '../contracts';

export const MOCKED_ENDPOINTS = new Set([
  'auth.session', 'auth.signup', 'auth.login', 'auth.logout', 'auth.capabilities',
  'auth.forgotPassword', 'auth.verifyOtp', 'auth.resetPassword',
  // phase_4 §1.2 — mocked until Phase 7 implements the real backend routes.
  'traces.list', 'traces.get',
  'vectors.projection', 'vectors.query', 'vectors.node',
  'admin.queueStats', 'admin.pipelineErrors',
]);

// phase_4 §1.2 — traces/vectors/admin have no backend routes at all until Phase 7 (traces,
// vectors) and never (admin.queueStats/pipelineErrors are dev-mock-only demo data, real from
// Phase 7 too). Unlike documents/threads/chat/health/contexts below, these three are NOT
// passed through to the real endpoint modules — there is no real route for them to reach.
const traces = {
  list: async (params: ListTracesParams = {}) => {
    await delay();
    return { traces: tracesFixture.list(params) };
  },
  get: async (id: string) => {
    await delay();
    const trace = tracesFixture.get(id);
    if (!trace) throw new CerebroApiError({ status: 404, code: 'trace_not_found', message: 'That trace does not exist.' });
    return trace;
  },
};

const vectors = {
  projection: async (contextId: string) => {
    await delay();
    return vectorsFixture.projection(contextId);
  },
  query: async (body: ProjectQueryRequest) => {
    await delay();
    return vectorsFixture.query(body);
  },
  node: async (pointId: string) => {
    await delay();
    const node = vectorsFixture.node(pointId);
    if (!node) throw new CerebroApiError({ status: 404, code: 'node_not_found', message: 'That node does not exist.' });
    return node;
  },
};

const admin = {
  queueStats: async () => { await delay(); return adminFixture.queueStats(); },
  pipelineErrors: async () => { await delay(); return { errors: adminFixture.pipelineErrors() }; },
};

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
