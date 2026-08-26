// Standalone verification script (this repo's test/ convention — see AGENTS.md). Exercises
// task 5.4's/5.9's acceptance criteria: session.regenerate, the credentialVersion
// invalidation check, and logout-all. Uses a minimal fake `req.session` (regenerate/save/
// destroy with the same callback shape express-session gives sessionLifecycle.js) against
// the real local Mongo + Redis this repo's dev stack runs — the full HTTP-level behavior
// (an actual `cerebro.sid` cookie, connect-redis's `sess:*` keys) was verified live against
// the running server during this phase's implementation; this script isolates the pure
// session-lifecycle and requireAuth logic. No network, no live SMTP.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { User } from '../../src/models/User.js';
import { redisClient } from '../../src/redis.js';
import { establishSession, destroySession, destroyAllSessions } from '../../src/auth/sessionLifecycle.js';
import { requireAuth } from '../../src/api/middleware/requireAuth.js';

const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/cerebro';
const redis = redisClient();
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

// Mirrors express-session's callback shape exactly (regenerate/save/destroy all take a
// Node-style `(err) => void` callback) — sessionLifecycle.js's establishSession/
// destroySession call these the same way whether the real store (connect-redis) or this
// fake backs them.
function makeFakeReq() {
  let sid = `fake-${crypto.randomBytes(8).toString('hex')}`;
  const session = {
    userId: undefined,
    credentialVersion: undefined,
    regenerate(cb) {
      sid = `fake-${crypto.randomBytes(8).toString('hex')}`;   // new sid — defeats fixation
      cb(null);
    },
    save(cb) { cb(null); },
    destroy(cb) { cb(null); },
  };
  return {
    get sessionID() { return sid; },
    session,
  };
}

async function run() {
  if (redis.status !== 'ready') {
    await new Promise((resolve, reject) => { redis.once('ready', resolve); redis.once('error', reject); });
  }
  await mongoose.connect(mongoUri);

  const createdIds = [];
  try {
    await test('establishSession regenerates the sid and sets userId/credentialVersion', async () => {
      const user = await User.create({ email: `session-a-${crypto.randomBytes(4).toString('hex')}@example.com` });
      createdIds.push(user._id);
      const req = makeFakeReq();
      const sidBefore = req.sessionID;

      await establishSession(req, user);

      assert.notEqual(req.sessionID, sidBefore, 'regenerate must assign a new sid');
      assert.equal(req.session.userId, String(user._id));
      assert.equal(req.session.credentialVersion, user.credentialVersion);
      assert.deepEqual(await redis.smembers(`usess:${user._id}`), [req.sessionID]);

      await destroyAllSessions(user._id);
    });

    await test('requireAuth 401s with session_invalidated when credentialVersion drifts', async () => {
      const user = await User.create({ email: `session-b-${crypto.randomBytes(4).toString('hex')}@example.com` });
      createdIds.push(user._id);
      const req = makeFakeReq();
      await establishSession(req, user);

      // Simulate a password reset elsewhere: bump credentialVersion in Mongo without
      // this session knowing — exactly what "sign in on two browsers, then reset the
      // password in one" produces for the OTHER browser's still-old session.
      await User.updateOne({ _id: user._id }, { $inc: { credentialVersion: 1 } });

      let statusCode = null;
      let body = null;
      let destroyed = false;
      const res = {
        status(code) { statusCode = code; return this; },
        json(payload) { body = payload; },
      };
      req.session.destroy = (cb) => { destroyed = true; cb(); };
      await requireAuth(req, res, () => { throw new Error('next() must not be called'); });

      assert.equal(statusCode, 401);
      assert.equal(body.code, 'session_invalidated');
      assert.equal(destroyed, true);

      await destroyAllSessions(user._id);
    });

    await test('logout-all (destroyAllSessions) removes every sid for the user', async () => {
      const user = await User.create({ email: `session-c-${crypto.randomBytes(4).toString('hex')}@example.com` });
      createdIds.push(user._id);

      const reqA = makeFakeReq();
      const reqB = makeFakeReq();
      await establishSession(reqA, user);
      await establishSession(reqB, user);
      assert.equal((await redis.smembers(`usess:${user._id}`)).length, 2);

      // A real `sess:<sid>` key each fake req's `save()` never actually writes (the fake
      // has no store behind it) — set them directly so destroyAllSessions has a real key
      // to delete, matching what connect-redis's RedisStore would have written for a
      // genuine request.
      await redis.set(`sess:${reqA.sessionID}`, '{}');
      await redis.set(`sess:${reqB.sessionID}`, '{}');

      await destroyAllSessions(user._id);

      assert.equal(await redis.exists(`usess:${user._id}`), 0);
      assert.equal(await redis.exists(`sess:${reqA.sessionID}`), 0);
      assert.equal(await redis.exists(`sess:${reqB.sessionID}`), 0);
    });

    await test('destroySession removes only the caller\'s own sid from usess', async () => {
      const user = await User.create({ email: `session-d-${crypto.randomBytes(4).toString('hex')}@example.com` });
      createdIds.push(user._id);

      const reqA = makeFakeReq();
      const reqB = makeFakeReq();
      await establishSession(reqA, user);
      await establishSession(reqB, user);

      await destroySession(reqA);

      const remaining = await redis.smembers(`usess:${user._id}`);
      assert.deepEqual(remaining, [reqB.sessionID]);

      await destroyAllSessions(user._id);
    });

    console.log(failures === 0 ? '\nAll session lifecycle tests passed.\n' : `\n${failures} test(s) FAILED.\n`);
  } finally {
    if (createdIds.length > 0) await User.deleteMany({ _id: { $in: createdIds } });
    if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
    redis.disconnect();
  }
  process.exit(failures === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error('Test runner error:', error);
  process.exit(1);
});
