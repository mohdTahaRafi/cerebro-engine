// phase_1 §4.4 — the only module components import from. Because
// `import.meta.env.DEV` is `false` at production build time, Vite's constant folding
// removes the entire MOCK_ON branch, and with it the dynamic import — so `src/api/mock/**`
// and every fixture it references is absent from the production bundle (verified by
// task 1.17).
import { auth } from './endpoints/auth';
import { documents } from './endpoints/documents';
import { threads } from './endpoints/threads';
import { chat } from './endpoints/chat';
import { health } from './endpoints/health';
import { contexts } from './endpoints/contexts';
import { traces } from './endpoints/traces';
import { vectors } from './endpoints/vectors';
import { admin } from './endpoints/admin';

const real = { auth, documents, threads, chat, health, contexts, traces, vectors, admin };

const MOCK_ON = import.meta.env.DEV && import.meta.env.VITE_API_MOCK === '1';

export const api = MOCK_ON
  ? (await import('./mock')).mockApi
  : real;

export const IS_MOCKED = MOCK_ON;

export * from './contracts';
export { CerebroApiError, EndpointUnavailableError } from './client';
