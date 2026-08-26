// Standalone verification script (this repo's test/ convention — see AGENTS.md). Exercises
// task 5.18's acceptance criterion: all five resolveIdentity branches (phase_5 §6.2).
// No network, no live SMTP — talks only to the local Mongo this repo's dev stack runs.
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import crypto from 'node:crypto';
import { User } from '../../src/models/User.js';
import { resolveIdentity } from '../../src/auth/linking.js';

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/cerebro';
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

function uniqueEmail(tag) {
  return `linking-${tag}-${crypto.randomBytes(4).toString('hex')}@example.com`;
}

// A genuinely EMPTY `identities` array is not what a real local signup ever produces
// (routes/auth.js's signup route always pushes a `local` identity before saving) — and
// it turns out not to be safe as a test fixture either: `identities: []` indexes as a
// single {provider: null, providerId: null} entry on the unique multikey index (§2.1),
// so two users both fixture-seeded with an empty array collide with EACH OTHER on that
// index, not with anything real. Every "pre-existing local account" fixture below gets a
// real local identity instead, mirroring how routes/auth.js actually creates one.
async function createLocalUser({ email, emailVerified }) {
  const user = new User({ email, emailVerified, passwordHash: null });
  user.identities.push({
    provider: 'local', providerId: String(user._id),
    providerEmail: email, emailVerified: false, linkedAt: new Date(),
  });
  await user.save();
  return user;
}

async function run() {
  const createdIds = [];
  try {
    await mongoose.connect(mongoUri);

    await test('branch 1: an existing (provider, providerId) signs in without touching email', async () => {
      const email = uniqueEmail('b1');
      const providerId = crypto.randomUUID();
      const seed = await User.create({
        email, emailVerified: true,
        identities: [{ provider: 'google', providerId, providerEmail: email, emailVerified: true, linkedAt: new Date() }],
      });
      createdIds.push(seed._id);

      const result = await resolveIdentity({
        provider: 'google', providerId, email: 'a-changed-address@example.com',
        emailVerified: true, name: null, avatarUrl: null,
      });
      assert.equal(result.ok, true);
      assert.equal(String(result.user._id), String(seed._id));
      assert.equal(result.created, false);
    });

    await test('branch 2: an unverified provider email creates a brand-new, unlinked user', async () => {
      const claimedEmail = uniqueEmail('b2-victim');
      const victim = await createLocalUser({ email: claimedEmail, emailVerified: true });
      createdIds.push(victim._id);

      const result = await resolveIdentity({
        provider: 'github', providerId: crypto.randomUUID(), email: claimedEmail,
        emailVerified: false, name: 'Attacker', avatarUrl: null,
      });
      // Never links, never merges — a duplicate-email collision on the unique index is
      // reported as email_taken_unverified rather than touching the victim's account.
      assert.equal(result.ok, false);
      assert.equal(result.code, 'email_taken_unverified');

      const victimAfter = await User.findById(victim._id);
      assert.equal(victimAfter.identities.length, 1, "the victim's account must be untouched");
      assert.equal(victimAfter.identities[0].provider, 'local');
    });

    await test('branch 2b: an unverified provider email with NO collision creates a real new user', async () => {
      const result = await resolveIdentity({
        provider: 'github', providerId: crypto.randomUUID(), email: uniqueEmail('b2b'),
        emailVerified: false, name: 'Someone', avatarUrl: null,
      });
      assert.equal(result.ok, true);
      assert.equal(result.created, true);
      assert.equal(result.user.emailVerified, false);
      assert.equal(result.user.passwordHash, null);
      createdIds.push(result.user._id);
    });

    await test('branch 3: a verified email with no collision creates a new, verified user', async () => {
      const email = uniqueEmail('b3');
      const result = await resolveIdentity({
        provider: 'google', providerId: crypto.randomUUID(), email,
        emailVerified: true, name: 'New Person', avatarUrl: null,
      });
      assert.equal(result.ok, true);
      assert.equal(result.created, true);
      assert.equal(result.user.email, email);
      assert.equal(result.user.emailVerified, true);
      assert.equal(result.user.identities[0].provider, 'google');
      createdIds.push(result.user._id);
    });

    await test('branch 4: a verified email matching a verified existing user links', async () => {
      const email = uniqueEmail('b4');
      const existing = await createLocalUser({ email, emailVerified: true });
      createdIds.push(existing._id);

      const result = await resolveIdentity({
        provider: 'google', providerId: crypto.randomUUID(), email,
        emailVerified: true, name: null, avatarUrl: null,
      });
      assert.equal(result.ok, true);
      assert.equal(String(result.user._id), String(existing._id));
      assert.equal(result.user.identities.length, 2, 'local + newly-linked google');
      assert.ok(result.user.identities.some((i) => i.provider === 'google'));
    });

    await test('branch 5: a verified email matching an UNVERIFIED existing user does not link', async () => {
      const email = uniqueEmail('b5');
      const existing = await createLocalUser({ email, emailVerified: false });
      createdIds.push(existing._id);

      const result = await resolveIdentity({
        provider: 'google', providerId: crypto.randomUUID(), email,
        emailVerified: true, name: null, avatarUrl: null,
      });
      assert.equal(result.ok, false);
      assert.equal(result.code, 'verify_existing_first');

      const existingAfter = await User.findById(existing._id);
      assert.equal(existingAfter.identities.length, 1, 'branch 5 must not link — still just the local identity');
    });

    console.log(failures === 0 ? '\nAll linking.js tests passed.\n' : `\n${failures} test(s) FAILED.\n`);
  } finally {
    if (createdIds.length > 0) await User.deleteMany({ _id: { $in: createdIds } });
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  }
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
