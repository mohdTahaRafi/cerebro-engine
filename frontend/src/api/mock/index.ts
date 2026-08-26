// phase_1 §4.4 — dev-only mock layer, active only under VITE_API_MOCK=1 and stripped from
// production builds entirely (api/index.ts's MOCK_ON constant fold).
//
// Amended phase_2: `contexts` and `documents` are NO LONGER special-cased here. Phase 1
// mocked them as a temporary bridge ("ahead of Phase 2's real routes"); Phase 2 landed
// `documents` against the real backend, and Phase 6 landed a real Context model
// (backend/src/models/Context.js) — `endpoints/contexts.ts` now always hits the real
// backend too, exactly like documents/threads/chat/health below. `traces`/`vectors`/
// `admin` are different (phase_4 §1.2): those backend routes do not exist AT ALL until
// Phase 7, so passing them through would just mean every call 404s — they are backed by
// fixtures instead, defined below.
//
// Amended phase_5: `auth` is NO LONGER special-cased here either, for the exact same reason
// contexts/documents stopped being in phase_2 — the real backend routes now exist
// (backend/src/api/routes/auth.js, password.js). `mockAuth` and its fixtures
// (fixtures/users.ts, fixtures/otp.ts) are deleted rather than left as inactive dead code;
// `endpoints/auth.ts` is passed through unchanged, same as threads/chat/health/contexts.
import { CerebroApiError } from '../client';
import { documents } from '../endpoints/documents';
import { threads } from '../endpoints/threads';
import { chat } from '../endpoints/chat';
import { health } from '../endpoints/health';
import { contexts } from '../endpoints/contexts';
import { auth } from '../endpoints/auth';
import type { ListTracesParams } from '../endpoints/traces';
import type { ProjectQueryRequest } from '../contracts';
import * as tracesFixture from './fixtures/traces';
import * as vectorsFixture from './fixtures/vectors';
import * as adminFixture from './fixtures/admin';

export const MOCKED_ENDPOINTS = new Set([
  // phase_4 §1.2 — mocked until Phase 7 implements the real backend routes.
  'traces.list', 'traces.get',
  'vectors.projection', 'vectors.query', 'vectors.node',
  'admin.queueStats', 'admin.pipelineErrors',
]);

// phase_4 §1.2 — traces/vectors/admin have no backend routes at all until Phase 7 (traces,
// vectors) and never (admin.queueStats/pipelineErrors are dev-mock-only demo data, real from
// Phase 7 too). Unlike documents/threads/chat/health/contexts/auth below, these three are NOT
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

export const mockApi = {
  auth, documents, threads, chat, health, contexts, traces, vectors, admin,
};
