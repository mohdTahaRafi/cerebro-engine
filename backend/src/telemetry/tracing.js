import { Client } from 'langsmith';
import { config } from '../config/index.js';

let client = null;

// Phase 3 §7.3: search.js's traced stages (embed/retrieve/rerank) need this same
// redacting client, but ES module import order means their top-level `traceable(...)`
// calls run before api/index.js gets to call initTracing() below. Built lazily and
// cached here so either call site gets the same instance regardless of which runs
// first — construction alone does no network I/O, so building it even when tracing
// ends up disabled is harmless (traceable no-ops on the env-var check either way).
export function getTracingClient() {
  if (client) return client;
  // NFR-SEC-01: hide document text from traces. Structure, timing, and scores are
  // preserved; the payloads that would mirror private content are not.
  client = new Client({
    hideInputs: (inputs) => redact(inputs),
    hideOutputs: (outputs) => redact(outputs),
  });
  return client;
}

// LangChain.js reads LANGCHAIN_TRACING_V2, LANGCHAIN_API_KEY, and LANGCHAIN_PROJECT
// from the environment automatically. This module's job is redaction and explicit
// opt-out, not wiring.
export function initTracing() {
  if (!config.tracing.enabled) {
    console.info('[tracing] LANGCHAIN_TRACING_V2 is not "true" — tracing disabled');
    return null;
  }
  if (!process.env.LANGCHAIN_API_KEY) {
    console.warn('[tracing] tracing enabled but LANGCHAIN_API_KEY is unset — disabling');
    process.env.LANGCHAIN_TRACING_V2 = 'false';
    return null;
  }
  return getTracingClient();
}

const SENSITIVE = new Set(['text', 'content', 'pageContent', 'ocrText', 'sources', 'documents']);

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => (
      SENSITIVE.has(k)
        ? [k, typeof v === 'string' ? `[redacted ${v.length} chars]` : `[redacted ${Array.isArray(v) ? v.length : 1} items]`]
        : [k, redact(v)]
    )));
  }
  return value;
}
