import CircuitBreaker from 'opossum';

const DEFAULTS = {
  errorThresholdPercentage: 50,
  volumeThreshold: 3,       // need 3 requests in the window before tripping
  resetTimeout: 10_000,     // 10s before a half-open trial request
};

const registry = new Map();

export function wrap(name, fn, { timeout }) {
  if (registry.has(name)) return registry.get(name);
  const breaker = new CircuitBreaker(fn, { ...DEFAULTS, timeout, name });
  breaker.on('open', () => console.warn(`[breaker] ${name} OPEN`));
  breaker.on('halfOpen', () => console.info(`[breaker] ${name} HALF-OPEN`));
  breaker.on('close', () => console.info(`[breaker] ${name} CLOSED`));
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
