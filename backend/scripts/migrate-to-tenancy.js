#!/usr/bin/env node
// scripts/migrate-to-tenancy.js — one-time backfill that gives every pre-Phase-6 record and
// vector a real owner (phase 6 §7). Everything ingested before this phase has no
// `userId`/`contextId` at all; a tenant-filtered query returns zero results against it, so
// every pre-existing document becomes invisible the moment Phase 6 ships, until this script
// runs. This is why the migration is part of the deploy, not a follow-up.
//
// Usage:
//   node scripts/migrate-to-tenancy.js --user <email>              dry run — prints the plan, mutates nothing
//   node scripts/migrate-to-tenancy.js --user <email> --commit      backfills Mongo and Qdrant, then verifies
//
// `--user` must resolve to an existing account, created through the normal signup flow.
// This script does NOT create a user: minting an account with no password would be an
// account with no owner.
import 'dotenv/config';
import { pathToFileURL } from 'url';
import mongoose from 'mongoose';
import { config } from '../src/config/index.js';
import { User } from '../src/models/User.js';
import { Context } from '../src/models/Context.js';
import { Document } from '../src/models/Document.js';
import { Conversation } from '../src/models/Conversation.js';
import { Message } from '../src/models/Message.js';
import * as vectorStore from '../src/providers/vectorStore.js';

const args = process.argv.slice(2);
const COMMIT = args.includes('--commit');
const userFlagIndex = args.indexOf('--user');
const USER_EMAIL = userFlagIndex >= 0 ? args[userFlagIndex + 1] : null;

const BATCH_SIZE = 512;   // §7.1 step 4 — matches upsertChunks' own batching order of magnitude

// Every point without exactly this userId — on a genuinely unmigrated collection nothing
// carries ANY userId yet, so this is equivalent to "missing userId" without needing a
// dedicated is_empty filter. Re-running after a partial migration still narrows correctly:
// a point this script already touched now carries the bootstrap userId and is excluded.
function unmigratedFilter(userId) {
  return { must_not: [{ key: 'userId', match: { any: [userId] } }] };
}

async function countUnmigrated(collection, userId) {
  const { count } = await vectorStore.client().count(collection, {
    filter: unmigratedFilter(userId), exact: true,
  });
  return count;
}

// Scrolls every unmigrated point in `collection` and additively sets userId/contextId onto
// its existing payload, 512 ids at a time. `setPayload` is additive — it does NOT replace
// the existing payload, so text, page, headingPath and every other field survive.
// `overwritePayload` would erase them, which is the mistake this comment exists to prevent.
async function backfillCollection(collection, userId, contextId) {
  let migrated = 0;
  let offset;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { points, next_page_offset: nextOffset } = await vectorStore.client().scroll(collection, {
      filter: unmigratedFilter(userId),
      limit: BATCH_SIZE,
      offset,
      with_payload: false,
      with_vector: false,
    });
    if (points.length === 0) break;

    // eslint-disable-next-line no-await-in-loop
    await vectorStore.client().setPayload(collection, {
      payload: { userId, contextId },
      points: points.map((p) => p.id),
    });
    migrated += points.length;

    if (!nextOffset) break;
    offset = nextOffset;
  }
  return migrated;
}

async function main() {
  if (!USER_EMAIL) {
    console.error('Usage: node scripts/migrate-to-tenancy.js --user <email> [--commit]');
    process.exitCode = 1;
    return;
  }

  await mongoose.connect(config.mongo.uri);

  // 1. Resolve the bootstrap user. Refuses to run if the email does not resolve.
  const normalizedEmail = USER_EMAIL.toLowerCase().trim();
  const user = await User.findOne({ email: normalizedEmail });
  if (!user) {
    console.error(`No user found for "${normalizedEmail}". This script does not create accounts — sign up first.`);
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }

  // 2. Create (or reuse) a context titled "Default" owned by that user.
  let defaultContext = await Context.findOne({ userId: user._id, title: 'Default' });
  const willCreateContext = !defaultContext;
  if (COMMIT && !defaultContext) {
    defaultContext = await Context.create({ userId: user._id, title: 'Default' });
  }
  // In a dry run with no existing "Default" context, use a placeholder id purely for the
  // plan's own bookkeeping — nothing is written under it.
  const contextId = defaultContext?._id ?? new mongoose.Types.ObjectId();

  // Pre-migration counts — what the plan reports (unmigrated rows/points only, so a
  // second run correctly shows 0), plus the collection-wide totals §7.1 step 6's
  // post-commit verification compares against — captured now, before anything is
  // mutated, since that IS "the pre-migration unfiltered total" the spec means.
  const [
    documentsToMigrate, conversationsToMigrate, messagesToMigrate,
    chunkPointsToMigrate, pagePointsToMigrate,
    preMigrationChunkTotal, preMigrationPageTotal,
  ] = await Promise.all([
    Document.countDocuments({ userId: { $exists: false } }),
    Conversation.countDocuments({ userId: { $exists: false } }),
    Message.countDocuments({ userId: { $exists: false } }),
    countUnmigrated(config.qdrant.chunksCollection, String(user._id)),
    countUnmigrated(config.qdrant.pagesCollection, String(user._id)),
    vectorStore.countAllPoints(),
    vectorStore.countAllPagePoints(),
  ]);

  console.log(
    `\n${COMMIT ? 'MIGRATION RUN' : 'DRY RUN — no data was mutated (pass --commit to apply)'}\n` +
    `${documentsToMigrate} documents, ${conversationsToMigrate} conversations, ${messagesToMigrate} messages, ` +
    `${chunkPointsToMigrate} chunk points, ${pagePointsToMigrate} page points -> user ${normalizedEmail}, ` +
    `context '${defaultContext?.title ?? 'Default'}' (${willCreateContext ? 'to be created' : 'existing'})\n`,
  );

  if (!COMMIT) {
    await mongoose.disconnect();
    return;
  }

  // 3. Mongo backfill, in this order.
  const docResult = await Document.updateMany(
    { userId: { $exists: false } }, { $set: { userId: user._id, contextId } },
  );
  const convoResult = await Conversation.updateMany(
    { userId: { $exists: false } }, { $set: { userId: user._id, contextId } },
  );
  const msgResult = await Message.updateMany(
    { userId: { $exists: false } }, { $set: { userId: user._id } },
  );
  console.log(
    `Mongo backfilled: ${docResult.modifiedCount} document(s), ${convoResult.modifiedCount} conversation(s), ` +
    `${msgResult.modifiedCount} message(s).`,
  );

  // 4. Qdrant backfill, per collection.
  const chunkMigrated = await backfillCollection(config.qdrant.chunksCollection, String(user._id), String(contextId));
  const pageMigrated = await backfillCollection(config.qdrant.pagesCollection, String(user._id), String(contextId));
  console.log(`Qdrant backfilled: ${chunkMigrated} chunk point(s), ${pageMigrated} page point(s).`);

  // 5. Recompute the context's counters from the migrated documents.
  const { recomputeContextCounters } = await import('../src/contexts/counters.js');
  const counters = await recomputeContextCounters(contextId);
  console.log(`Context counters recomputed: ${counters.documentCount} document(s), ${counters.chunkCount} chunk(s).`);

  // 6. Verify: countPoints({userId, contextId: null}) must equal the pre-migration
  //    unfiltered total captured above, BEFORE this run touched anything. The widened
  //    contextId:null query ("every context this user owns") matters here specifically
  //    because a context could in principle already have held documents of this user's
  //    own before this script ran — the verification is scoped to this user's whole
  //    total, not just the Default context this run created or reused.
  const verifiedChunkTotal = await vectorStore.countPoints({ userId: String(user._id), contextId: null });
  const verifiedPageTotal = await vectorStore.countPagePoints({ userId: String(user._id), contextId: null });

  if (verifiedChunkTotal !== preMigrationChunkTotal || verifiedPageTotal !== preMigrationPageTotal) {
    console.error(
      `\nVERIFICATION FAILED: pre-migration totals were ${preMigrationChunkTotal} chunk point(s) and ` +
      `${preMigrationPageTotal} page point(s); found ${verifiedChunkTotal} and ${verifiedPageTotal} under ` +
      `user ${normalizedEmail} afterward. Some point(s) may belong to another tenant already, or the ` +
      `backfill was interrupted — re-run this script (it is idempotent) before trusting the corpus.`,
    );
    process.exitCode = 1;
    await mongoose.disconnect();
    return;
  }
  console.log(
    `\nVerified: ${verifiedChunkTotal} chunk point(s) and ${verifiedPageTotal} page point(s) now resolve ` +
    `under user ${normalizedEmail}, matching the pre-migration total exactly.`,
  );

  if (documentsToMigrate === 0 && conversationsToMigrate === 0 && messagesToMigrate === 0 &&
      chunkPointsToMigrate === 0 && pagePointsToMigrate === 0) {
    console.log('0 changes — this run was a no-op (already fully migrated).');
  }

  await mongoose.disconnect();
}

// Only run the migration when this file is invoked directly — same guard migrate-legacy.js
// uses, for the same reason: a destructive script must not do anything merely by being
// imported (e.g. by a future test that unit-tests a helper this file exports).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
    process.exit(1);
  });
}
