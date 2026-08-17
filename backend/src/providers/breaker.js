import CircuitBreaker from 'opossum';
import { providerCalls } from '../telemetry/metrics.js';

const DEFAULTS = {
  errorThresholdPercentage: 50,
  volumeThreshold: 3,       // need 3 requests in the window before tripping
  resetTimeout: 10_000,     // 10s before a half-open trial request
};

const registry = new Map();

// Breaker names are "<provider>" or "<provider>.<operation>" (cohere.embed, qdrant.chunks,
// llm.generate, vision.embedPages, ...) — every provider call in the app goes through one
// of these, so this one split is enough to label cerebro_provider_calls_total (phase 6
// §7.2) without a separate counter call at each of the ~10 provider modules.
function splitBreakerName(name) {
  const dot = name.indexOf('.');
  return dot === -1 ? { provider: name, operation: 'default' } : { provider: name.slice(0, dot), operation: name.slice(dot + 1) };
}

export function wrap(name, fn, { timeout }) {
  if (registry.has(name)) return registry.get(name);
  const breaker = new CircuitBreaker(fn, { ...DEFAULTS, timeout, name });
  const { provider, operation } = splitBreakerName(name);
  breaker.on('open', () => console.warn(`[breaker] ${name} OPEN`));
  breaker.on('halfOpen', () => console.info(`[breaker] ${name} HALF-OPEN`));
  breaker.on('close', () => console.info(`[breaker] ${name} CLOSED`));
  breaker.on('success', () => providerCalls.inc({ provider, operation, outcome: 'success' }));
  breaker.on('failure', () => providerCalls.inc({ provider, operation, outcome: 'failure' }));
  breaker.on('timeout', () => providerCalls.inc({ provider, operation, outcome: 'timeout' }));
  // 'reject' fires when the breaker is open and short-circuits without calling `fn` at
  // all — a distinct outcome from 'failure' (fn ran and threw), since a rejection is the
  // breaker protecting the system, not the provider itself erroring.
  breaker.on('reject', () => providerCalls.inc({ provider, operation, outcome: 'circuit_open' }));
  registry.set(name, breaker);
  return breaker;
}

export function breakerStates() {
  return Object.fromEntries(
    [...registry.entries()].map(([name, b]) => [
      name, b.opened ? 'open' : b.halfOpen ? 'half-open' : 'closed',
    ]),
  );
}
