import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { User } from '../../src/models/User.js';

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

async function run() {
  try {
    await mongoose.connect(mongoUri);

    // Wait for indexes to be built before running any assertions
    await User.init();

    // Test 1: Unique index on (provider, providerId) prevents duplicates
    await test('unique index on (provider, providerId) rejects duplicate identities', async () => {
      // Clean up any prior test data
      await User.deleteMany({
        'identities.provider': 'google',
        'identities.providerId': 'test-google-123'
      });

      // Insert first user with a Google identity
      const user1 = await User.create({
        email: 'user1@example.com',
        identities: [
          {
            provider: 'google',
            providerId: 'test-google-123',
            providerEmail: 'user1@gmail.com'
          }
        ]
      });

      // Try to insert second user with the same Google identity — should fail
      let duplicateErrorCaught = false;
      try {
        await User.create({
          email: 'user2@example.com',
          identities: [
            {
              provider: 'google',
              providerId: 'test-google-123',
              providerEmail: 'user2@gmail.com'
            }
          ]
        });
      } catch (err) {
        if (err.code === 11000 && err.message.includes('identities.provider_1_identities.providerId_1')) {
          duplicateErrorCaught = true;
        }
      }

      assert.ok(duplicateErrorCaught, 'Expected duplicate key error for (provider, providerId) index');

      // Clean up
      await User.deleteMany({
        'identities.provider': 'google',
        'identities.providerId': 'test-google-123'
      });
    });

    // Test 2: Unique index on email prevents duplicates
    await test('unique index on email rejects duplicate emails', async () => {
      // Clean up any prior test data
      await User.deleteMany({ email: 'duplicate-test@example.com' });

      // Insert first user
      await User.create({
        email: 'duplicate-test@example.com',
        identities: []
      });

      // Try to insert second user with same email — should fail
      let duplicateErrorCaught = false;
      try {
        await User.create({
          email: 'duplicate-test@example.com',
          identities: []
        });
      } catch (err) {
        if (err.code === 11000) {
          duplicateErrorCaught = true;
        }
      }

      assert.ok(duplicateErrorCaught, 'Expected duplicate key error for email index');

      // Clean up
      await User.deleteMany({ email: 'duplicate-test@example.com' });
    });

    // Test 3: Email normalization (case-insensitive) — uppercase email should collide with lowercase
    await test('email normalization enforces case-insensitive uniqueness', async () => {
      // Clean up any prior test data
      await User.deleteMany({ email: 'casetest@example.com' });

      // Insert user with lowercase email
      await User.create({
        email: 'casetest@example.com',
        identities: []
      });

      // Try to insert user with uppercase version of same email — should fail
      let duplicateErrorCaught = false;
      try {
        await User.create({
          email: 'CASETEST@EXAMPLE.COM',
          identities: []
        });
      } catch (err) {
        if (err.code === 11000) {
          duplicateErrorCaught = true;
        }
      }

      assert.ok(duplicateErrorCaught, 'Expected duplicate key error when attempting to insert uppercase variant of existing email');

      // Verify the stored email is normalized to lowercase
      const user = await User.findOne({ email: 'casetest@example.com' });
      assert.ok(user, 'User should exist');
      assert.equal(user.email, 'casetest@example.com', 'Email should be stored in lowercase');

      // Clean up
      await User.deleteMany({ email: 'casetest@example.com' });
    });

    console.log(failures === 0 ? '\nAll User model index tests passed.\n' : `\n${failures} test(s) FAILED.\n`);

  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }

  process.exit(failures === 0 ? 0 : 1);
}

run().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
