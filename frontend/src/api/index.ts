// phase_1 §4.4 — the only module components import from. Every endpoint module talks to
// the real backend; the dev-only mock adapter this file once switched to (VITE_API_MOCK=1)
// was emptied endpoint by endpoint as Phases 2–7 landed real routes, and then deleted.
import { auth } from './endpoints/auth';
import { documents } from './endpoints/documents';
import { threads } from './endpoints/threads';
import { chat } from './endpoints/chat';
import { health } from './endpoints/health';
import { contexts } from './endpoints/contexts';
import { traces } from './endpoints/traces';
import { vectors } from './endpoints/vectors';
import { admin } from './endpoints/admin';

export const api = { auth, documents, threads, chat, health, contexts, traces, vectors, admin };

export * from './contracts';
export { CerebroApiError, EndpointUnavailableError } from './client';
