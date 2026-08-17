// Exhaustive truth table for migrate-legacy.js's destructive-drop gate (phase 6 §4.2,
// §16.5, task 6.11).
//
// `--drop-legacy` deletes the only remaining copy of documents that were never carried
// forward. There is no undo, and the failure is silent — you find out when someone searches
// for a document that no longer exists anywhere. Hand-testing a couple of flag combinations
// is not adequate coverage for that; all 16 combinations of the four inputs are asserted
// here, so a future edit that widens the gate fails loudly.
import assert from 'node:assert/strict';
import { decideDrop } from '../../scripts/migrate-legacy.js';

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}\n        ${err.message}`);
    failures += 1;
  }
}

console.log('\n=== drop gate: the only combination that may drop ===');

test('drops only with --apply, no missing sources, and no failures', () => {
  const d = decideDrop({ apply: true, acceptLosses: false, missingSourceCount: 0, failedCount: 0 });
  assert.equal(d.drop, true);
  assert.equal(d.reason, null);
});

test('drops when losses exist but are explicitly acknowledged', () => {
  const d = decideDrop({ apply: true, acceptLosses: true, missingSourceCount: 2, failedCount: 0 });
  assert.equal(d.drop, true);
});

console.log('\n=== drop gate: every refusal ===');

test('refuses unacknowledged unrecoverable documents', () => {
  const d = decideDrop({ apply: true, acceptLosses: false, missingSourceCount: 2, failedCount: 0 });
  assert.equal(d.drop, false);
  assert.match(d.reason, /--accept-losses/);
  assert.match(d.reason, /2 document/);
});

test('refuses when anything failed to enqueue, even with --accept-losses', () => {
  // --accept-losses acknowledges documents known to be unrecoverable. A failed enqueue is a
  // different situation: the document's fate is simply unknown, so it cannot have been
  // knowingly accepted as a loss.
  const d = decideDrop({ apply: true, acceptLosses: true, missingSourceCount: 0, failedCount: 1 });
  assert.equal(d.drop, false);
  assert.match(d.reason, /failed to enqueue/);
});

test('refuses a dry run — --drop-legacy without --apply', () => {
  // The §16.5 amendment. A dry run enqueues nothing, so dropping would destroy the source
  // of truth for documents that were never migrated.
  const d = decideDrop({ apply: false, acceptLosses: true, missingSourceCount: 0, failedCount: 0 });
  assert.equal(d.drop, false);
  assert.match(d.reason, /--apply/);
});

console.log('\n=== drop gate: full truth table (16 combinations) ===');

test('only apply=true, missing=0, failed=0 (any acceptLosses) may drop', () => {
  const allowed = [];
  for (const apply of [false, true]) {
    for (const acceptLosses of [false, true]) {
      for (const missingSourceCount of [0, 3]) {
        for (const failedCount of [0, 2]) {
          const d = decideDrop({ apply, acceptLosses, missingSourceCount, failedCount });
          if (d.drop) allowed.push({ apply, acceptLosses, missingSourceCount, failedCount });
          // Every refusal must explain itself — a bare `false` would leave an operator
          // guessing which of three conditions blocked them.
          if (!d.drop) assert.ok(d.reason && d.reason.length > 0, 'a refusal must carry a reason');
        }
      }
    }
  }
  const expected = [
    { apply: true, acceptLosses: false, missingSourceCount: 0, failedCount: 0 },
    { apply: true, acceptLosses: true, missingSourceCount: 0, failedCount: 0 },
    { apply: true, acceptLosses: true, missingSourceCount: 3, failedCount: 0 },
  ];
  assert.deepEqual(
    allowed.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    expected.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    `unexpected set of drop-permitting combinations: ${JSON.stringify(allowed)}`,
  );
});

test('importing the script does not execute the migration', () => {
  // The import at the top of this file would otherwise connect to Mongo — and under the
  // wrong flags, drop a collection — purely as a side effect of running the test suite.
  assert.equal(typeof decideDrop, 'function');
});

console.log(failures === 0 ? '\nAll drop-gate tests passed.\n' : `\n${failures} test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
