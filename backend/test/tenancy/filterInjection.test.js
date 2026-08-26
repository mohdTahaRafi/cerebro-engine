// Standalone verification script (this repo's test/ convention — see AGENTS.md, no
// unified test framework). Static-shape test with no external dependencies — every
// tenant-guarded exported function of vectorStore.js is called with four malformed
// tenants and must throw a TypeError naming the function BEFORE issuing any Qdrant
// request (assertTenant/assertConcreteContext is the first statement in every one of
// them, verified by construction — this test never needs a live Qdrant to prove it).
// Every guarded function is `async`, so the throw surfaces as a REJECTED promise, not a
// synchronous exception — `assert.rejects`, not `assert.throws`, is what actually proves it.
//
// The second half of this file is what makes it load-bearing rather than a snapshot of
// today's function list: it enumerates vectorStore.js's ACTUAL exports and fails loudly
// if one is neither in the guarded table below nor the small, explicit allowlist of
// deliberately-unguarded infra exports (phase 6 §8.1's own acceptance criterion — "adding
// a new export without a guard fails the test").
import assert from 'node:assert/strict';
import * as vectorStore from '../../src/providers/vectorStore.js';

let failures = 0;
async function test(name, fn) {
  try {
    await fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    failures += 1;
  }
}

// Every exported function that reaches Qdrant (phase 6 §2.3, plus deletePagesByContext —
// an addition this implementation made over §2.3's own list; see the amendment note at
// the bottom of docs/planning/v2/phase_6_tenancy_and_contexts.md). Each entry's `call`
// supplies plausible-shaped placeholder args — assertTenant throws before any of them are
// ever inspected, so their exact values don't matter, only their presence (some of these
// functions destructure their second argument, and a wrong ARITY, not a wrong tenant,
// would be a different bug than the one this test exists to catch).
const GUARDED_FUNCTIONS = [
  ['hybridQuery', (t) => vectorStore.hybridQuery(t, { denseVector: [], sparseVector: {}, limit: 1 })],
  ['multivectorQuery', (t) => vectorStore.multivectorQuery(t, { queryMultivector: [], limit: 1 })],
  ['countPoints', (t) => vectorStore.countPoints(t)],
  ['countPagePoints', (t) => vectorStore.countPagePoints(t)],
  ['upsertChunks', (t) => vectorStore.upsertChunks(t, [], [], [])],
  ['upsertPages', (t) => vectorStore.upsertPages(t, [], 'doc-1', 'file.pdf')],
  ['deleteByDocument', (t) => vectorStore.deleteByDocument(t, 'doc-1')],
  ['deletePagesByDocument', (t) => vectorStore.deletePagesByDocument(t, 'doc-1')],
  ['deleteByContext', (t) => vectorStore.deleteByContext(t)],
  ['deletePagesByContext', (t) => vectorStore.deletePagesByContext(t)],
  ['countByDocument', (t) => vectorStore.countByDocument(t, 'doc-1')],
  // Phase 7 §4.3: the query beacon's real nearest-neighbor lookup.
  ['nearestDense', (t) => vectorStore.nearestDense(t, [], 12)],
];

// Deliberately NOT tenant-guarded, and deliberately excluded from GUARDED_FUNCTIONS —
// see each one's own header comment in vectorStore.js for why.
const UNGUARDED_ALLOWLIST = new Set([
  'client', 'ping', 'ensureCollections', 'countAllPoints', 'countAllPagePoints',
  // Phase 7 §4.6: retrieve-by-id has no tenant to filter on (Qdrant's retrieve API takes
  // no filter) — routes/vectors.js checks ownership on the RETURNED payload instead, one
  // layer up. See retrieveById's own header comment in vectorStore.js.
  'retrieveById',
]);

// task 6.19's four malformed tenants.
const BAD_TENANTS = [
  ['undefined', undefined],
  ['{}', {}],
  ["{userId: ''}", { userId: '' }],
  ['{userId: 123}', { userId: 123 }],
];

async function run() {
  for (const [fnName, call] of GUARDED_FUNCTIONS) {
    for (const [label, badTenant] of BAD_TENANTS) {
      // eslint-disable-next-line no-await-in-loop
      await test(`${fnName}(${label}, ...) rejects with a TypeError naming "${fnName}"`, async () => {
        await assert.rejects(
          () => call(badTenant),
          (err) => {
            assert.ok(err instanceof TypeError, `expected a TypeError, got ${err?.constructor?.name}`);
            assert.ok(
              err.message.includes(fnName),
              `error message must name "${fnName}" — got: ${err.message}`,
            );
            return true;
          },
        );
      });
    }
  }

  // The structural guarantee itself: every actual export is accounted for.
  await test('every exported function is either guarded or explicitly allowlisted', () => {
    const guardedNames = new Set(GUARDED_FUNCTIONS.map(([name]) => name));
    const unaccounted = Object.keys(vectorStore).filter(
      (name) => typeof vectorStore[name] === 'function' && !guardedNames.has(name) && !UNGUARDED_ALLOWLIST.has(name),
    );
    assert.deepEqual(
      unaccounted, [],
      `vectorStore.js exports a function not covered by this test: ${unaccounted.join(', ')}. ` +
      'Add tenant guarding (assertTenant) and a GUARDED_FUNCTIONS entry, or add it to ' +
      'UNGUARDED_ALLOWLIST with a comment explaining why it is deliberately unscoped.',
    );
  });

  console.log(failures === 0 ? '\nAll filterInjection tests passed.\n' : `\n${failures} test(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

await run();
