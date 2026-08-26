// phase_1 §4.4 — dev-only mock layer, active only under VITE_API_MOCK=1 and stripped from
// production builds entirely (api/index.ts's MOCK_ON constant fold).
//
// Amended phase_2: `contexts` and `documents` are NO LONGER special-cased here. Phase 1
// mocked them as a temporary bridge ("ahead of Phase 2's real routes"); Phase 2 landed
// `documents` against the real backend, and Phase 6 landed a real Context model
// (backend/src/models/Context.js) — `endpoints/contexts.ts` now always hits the real
// backend too, exactly like documents/threads/chat/health below.
//
// Amended phase_5: `auth` is NO LONGER special-cased here either, for the exact same reason
// contexts/documents stopped being in phase_2 — the real backend routes now exist
// (backend/src/api/routes/auth.js, password.js).
//
// Amended phase_7: `traces`/`vectors`/`admin` are NO LONGER special-cased either — the
// backend routes phase_4 §1.2 deferred to "Phase 7" now exist
// (backend/src/api/routes/{traces,vectors,admin}.js). `fixtures/{traces,vectors,admin}.ts`
// are deleted rather than left as inactive dead code, matching phase_5's own precedent for
// `mockAuth`. MOCKED_ENDPOINTS is now permanently empty — every endpoint module is passed
// through to the real backend under VITE_API_MOCK=1 exactly as it is without it.
import { documents } from '../endpoints/documents';
import { threads } from '../endpoints/threads';
import { chat } from '../endpoints/chat';
import { health } from '../endpoints/health';
import { contexts } from '../endpoints/contexts';
import { auth } from '../endpoints/auth';
import { traces } from '../endpoints/traces';
import { vectors } from '../endpoints/vectors';
import { admin } from '../endpoints/admin';

export const MOCKED_ENDPOINTS = new Set<string>();

export const mockApi = {
  auth, documents, threads, chat, health, contexts, traces, vectors, admin,
};
