// Standalone verification script (this repo's test/ convention — see AGENTS.md). Exercises
// task 5.5's and 5.6's acceptance criteria: hashing, the null-hash timing guard, and the
// breach-list/composition-free password policy. No network, no live SMTP.
import assert from 'node:assert/strict';
import {
  hashPassword, verifyPassword, needsRehash, validatePassword, PASSWORD_MIN, PASSWORD_MAX,
} from '../../src/auth/password.js';

let failures = 0;

function test(name, fn) {
  return (async () => {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
    } catch (err) {
      console.error(`  FAIL  ${name}\n        ${err.message}`);
      failures += 1;
    }
  })();
}

async function run() {
  await test('hashPassword produces a hash verifyPassword accepts', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.ok(hash.startsWith('$argon2id$'), 'hash should be argon2id');
    assert.equal(await verifyPassword(hash, 'correct horse battery staple'), true);
    assert.equal(await verifyPassword(hash, 'wrong password entirely'), false);
  });

  await test('needsRehash is false for a hash written with current params', async () => {
    const hash = await hashPassword('correct horse battery staple');
    assert.equal(needsRehash(hash), false);
  });

  await test('verifyPassword(null, x) returns false without throwing', async () => {
    assert.equal(await verifyPassword(null, 'anything'), false);
  });

  // task 5.5's acceptance criterion, precisely: verifyPassword(null, x) must land within
  // 25% of a real verify's time, averaged over 20 runs — a real verify's dominant cost is
  // the single argon2 op (hash writes it, verify reads it), so both are timed doing
  // exactly one argon2 call each.
  await test('verifyPassword(null, x) timing is within 25% of a real verify (20 runs)', async () => {
    const knownHash = await hashPassword('correct horse battery staple');
    const timeRuns = async (fn) => {
      const samples = [];
      for (let i = 0; i < 20; i += 1) {
        const start = performance.now();
        await fn();
        samples.push(performance.now() - start);
      }
      return samples.reduce((a, b) => a + b, 0) / samples.length;
    };
    const realAvg = await timeRuns(() => verifyPassword(knownHash, 'wrong password'));
    const nullAvg = await timeRuns(() => verifyPassword(null, 'wrong password'));
    const pctDiff = Math.abs(realAvg - nullAvg) / realAvg;
    assert.ok(pctDiff <= 0.25,
      `expected within 25%, got ${(pctDiff * 100).toFixed(1)}% (real=${realAvg.toFixed(1)}ms, null=${nullAvg.toFixed(1)}ms)`);
  });

  await test('validatePassword rejects below the minimum length', async () => {
    assert.equal(validatePassword('short1'), `Use at least ${PASSWORD_MIN} characters.`);
  });

  await test('validatePassword rejects above the maximum length', async () => {
    assert.equal(validatePassword('x'.repeat(PASSWORD_MAX + 1)), `Use at most ${PASSWORD_MAX} characters.`);
  });

  await test("validatePassword rejects 'unbelievable' naming the breach list", async () => {
    // A real entry in breachedPasswords.js's top-10k set (SecLists rockyou-derived,
    // fetched live for this phase) that also happens to meet PASSWORD_MIN — see this
    // phase's completion notes for why 'password1234' (the spec's original example) was
    // swapped for this one: it is not actually in the real top-10,000 list.
    const result = validatePassword('unbelievable');
    assert.match(result, /breach list/);
  });

  await test("validatePassword accepts 'correct horse battery staple'", async () => {
    assert.equal(validatePassword('correct horse battery staple'), null);
  });

  await test('validatePassword rejects the email local-part inside the password', async () => {
    const result = validatePassword('mytahapassword12', { email: 'taha@example.com' });
    assert.match(result, /email address/);
  });

  await test('validatePassword rejects the name inside the password', async () => {
    const result = validatePassword('supertaharocks1', { name: 'Taha' });
    assert.match(result, /name/);
  });

  console.log(failures === 0 ? '\nAll password.js tests passed.\n' : `\n${failures} test(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
