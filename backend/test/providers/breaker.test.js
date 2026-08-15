// Standalone verification script (this repo's test/ convention — see AGENTS.md,
// no unified test framework). Exercises phase 1 task 1.8's acceptance criterion:
// a wrapped fn failing 3x consecutively leaves breaker.opened === true.
import assert from 'assert';
import { wrap } from '../../src/providers/breaker.js';

async function alwaysFails() {
  throw new Error('simulated provider failure');
}

const breaker = wrap('test.alwaysFails', alwaysFails, { timeout: 1_000 });

for (let i = 0; i < 3; i++) {
  try {
    await breaker.fire();
  } catch {
    // expected — volumeThreshold: 3 + errorThresholdPercentage: 50 means the 3rd
    // consecutive failure trips the breaker open.
  }
}

assert.strictEqual(breaker.opened, true, 'breaker should be OPEN after 3 consecutive failures');
console.log('[breaker.test] PASS — breaker.opened === true after 3 consecutive failures');
