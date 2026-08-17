#!/usr/bin/env node
// scripts/migrate-legacy.js — carries legacy MongoDB-vector documents forward into the
// new Cohere/Qdrant pipeline (phase 6 §4, tasks 6.10-6.11).
//
// Legacy chunks (backend/src/services/DatabaseService.js's `chunks` collection, written by
// the now-deleted IngestionService.js) carry 384-dimension MiniLM vectors. Those vectors
// are unusable — different model, different dimensionality, different semantic space —
// so they are NEVER re-embedded or copied forward. Only the **source files** carry
// forward: where the original upload still exists on disk, this script re-enqueues it
// through the real ingestion pipeline (ingestion/ingestDocument.js, via the same
// Document + BullMQ queue POST /api/documents uses); where it does not, the loss is
// reported by name and chunk count rather than silently dropped.
//
// Usage:
//   node scripts/migrate-legacy.js                     dry run — prints the plan, mutates nothing
//   node scripts/migrate-legacy.js --apply              enqueues re-ingestion for every recoverable document
//   node scripts/migrate-legacy.js --drop-legacy         drops the legacy `chunks` collection —
//                                                         refused unless every legacy document either
//                                                         migrated successfully or is acknowledged below
//   node scripts/migrate-legacy.js --drop-legacy --accept-losses
//                                                         acknowledges documents with no recoverable
//                                                         source file, letting --drop-legacy proceed anyway
import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { pathToFileURL } from 'url';
import mongoose from 'mongoose';
import { config } from '../src/config/index.js';
import { Document } from '../src/models/Document.js';
import { ingestQueue, JOB_OPTS } from '../src/ingestion/queue.js';

const FLAGS = new Set(process.argv.slice(2));
const APPLY = FLAGS.has('--apply');
const DROP_LEGACY = FLAGS.has('--drop-legacy');
const ACCEPT_LOSSES = FLAGS.has('--accept-losses');

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// Candidate locations for a legacy document's original bytes, checked in order (phase 6
// §4.1's decision, documented rather than left implicit — the anti-punting rule applies to
// this script's own design as much as to the phase spec):
//
//   1. metadata.source verbatim — the exact path the legacy loader read from. Works only
//      if ingestion somehow failed to clean it up, or an operator restored the same path.
//   2. backend/uploads/<fileName> — the legacy multer destination directory
//      (api/index.js's `multer({ dest: 'uploads/' })`), by original filename rather than
//      the random temp name the source path itself carries — the recovery path an operator
//      would actually use: copy the original file back in under its real name before
//      running this script.
//   3. backend/storage/uploads/<fileName> — the *new* pipeline's content-addressed upload
//      directory, checked by filename as a last resort in case the document was already
//      independently re-uploaded through POST /api/documents (STORAGE_DRIVER=filesystem;
//      content-addressed names won't match, so this only catches the coincidental case, not
//      the common one).
//
// Anything not found at any of these resolves to `null` — reported as `missingSource`, not
// silently skipped.
async function resolveLegacySource(source, fileName) {
  const candidates = [
    source,
    path.join('uploads', fileName),
    path.join(config.storage.uploadsDir, fileName),
  ];
  for (const candidate of candidates) {
    if (candidate && (await exists(candidate))) return candidate;
  }
  return null;
}

async function sha256File(filePath) {
  const crypto = await import('crypto');
  const hash = crypto.createHash('sha256');
  const buf = await fs.readFile(filePath);
  hash.update(buf);
  return hash.digest('hex');
}

const EXT_MIME = new Map([
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.txt', 'text/plain'],
  ['.md', 'text/markdown'],
  ['.csv', 'text/csv'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xls', 'application/vnd.ms-excel'],
  ['.json', 'application/json'],
]);

// Mirrors POST /api/documents' enqueue path (api/routes/documents.js) — same Document
// model, same content-hash dedupe, same queue and job options — so a migrated document is
// indistinguishable from one a user uploaded directly through the new pipeline today.
async function enqueueIngestion(sourcePath, fileName) {
  const ext = path.extname(fileName).toLowerCase();
  const stat = await fs.stat(sourcePath);
  const contentHash = await sha256File(sourcePath);

  const existing = await Document.findOne({ contentHash, status: 'ready' });
  if (existing) {
    return { documentId: existing._id, status: 'duplicate', duplicateOf: existing._id };
  }

  const storagePath = path.join(config.storage.uploadsDir, contentHash);
  await fs.mkdir(config.storage.uploadsDir, { recursive: true });
  await fs.copyFile(sourcePath, storagePath);   // copy, not move — the legacy source file is left in place

  const doc = await Document.create({
    fileName, mimeType: EXT_MIME.get(ext) ?? 'application/octet-stream',
    sizeBytes: stat.size, contentHash, storagePath, status: 'queued',
  });
  await ingestQueue.add('ingest:document', { documentId: doc._id.toString() }, JOB_OPTS);
  return { documentId: doc._id, status: 'queued' };
}

// Dropping the legacy collection is irreversible, so the decision is a pure function rather
// than a chain of `if`s buried in main() — it is exhaustively unit-tested against its whole
// truth table (test/migration/dropGate.test.js) instead of only being exercised by whichever
// flag combination someone happened to try by hand.
//
// The three refusals, in priority order:
//   1. Unrecoverable documents exist and were not explicitly acknowledged. Gated on
//      missingSourceCount rather than total document count, because a fully-recovered corpus
//      is safe to drop regardless — --accept-losses exists specifically to acknowledge
//      documents that are about to become permanently unrecoverable (phase 6 §4.2).
//   2. Something failed to enqueue this run. Those documents are neither migrated nor
//      acknowledged as lost, so their state is simply unknown; resolve before destroying
//      the source of truth.
//   3. --apply was not passed. Amended during implementation (§16.5): §4.2 treats
//      --drop-legacy as independent of --apply, but a dry run enqueues nothing, so
//      --drop-legacy alone would delete the legacy collection while migrating zero
//      documents — destroying the only copy of data it never carried forward.
export function decideDrop({ apply, acceptLosses, missingSourceCount, failedCount }) {
  if (missingSourceCount > 0 && !acceptLosses) {
    return {
      drop: false,
      reason: `${missingSourceCount} document(s) have no recoverable source file and would be permanently lost. `
        + 'Re-run with --accept-losses to acknowledge this and proceed.',
    };
  }
  if (failedCount > 0) {
    return {
      drop: false,
      reason: `${failedCount} document(s) failed to enqueue this run — resolve and re-run before dropping.`,
    };
  }
  if (!apply) {
    return {
      drop: false,
      reason: 'pass --apply in the same run so recoverable documents are actually migrated before the legacy collection is removed.',
    };
  }
  return { drop: true, reason: null };
}

async function main() {
  await mongoose.connect(config.mongo.uri);

  const db = mongoose.connection.db;
  const collections = await db.listCollections({ name: 'chunks' }).toArray();
  if (collections.length === 0) {
    console.log('No legacy `chunks` collection found — nothing to migrate.');
    await mongoose.disconnect();
    return;
  }

  const legacy = await db.collection('chunks').aggregate([
    { $group: {
      _id: '$metadata.source',
      fileName: { $first: '$metadata.fileName' },
      chunkCount: { $sum: 1 },
    } },
  ]).toArray();

  const report = { migrated: [], duplicate: [], missingSource: [], failed: [] };

  for (const doc of legacy) {
    const fileName = doc.fileName || path.basename(doc._id || 'unknown');
    const sourcePath = await resolveLegacySource(doc._id, fileName);

    if (!sourcePath) {
      report.missingSource.push({ fileName, chunkCount: doc.chunkCount, legacySource: doc._id });
      continue;
    }

    if (!APPLY) {
      report.migrated.push({ fileName, chunkCount: doc.chunkCount, sourcePath, planned: true });
      continue;
    }

    try {
      const created = await enqueueIngestion(sourcePath, fileName);
      if (created.status === 'duplicate') {
        report.duplicate.push({ fileName, documentId: created.documentId, duplicateOf: created.duplicateOf });
      } else {
        report.migrated.push({ fileName, chunkCount: doc.chunkCount, documentId: created.documentId, sourcePath });
      }
    } catch (err) {
      report.failed.push({ fileName, error: err.message });
    }
  }

  console.log(`\n${APPLY ? 'Migration run' : 'DRY RUN — no data was mutated (pass --apply to enqueue)'}`);
  console.log(`Legacy documents found: ${legacy.length}\n`);

  console.log(`Recoverable source, ${APPLY ? 'enqueued' : 'would enqueue'} (${report.migrated.length}):`);
  for (const m of report.migrated) console.log(`  - ${m.fileName} (${m.chunkCount} legacy chunks) <- ${m.sourcePath}`);

  if (report.duplicate.length > 0) {
    console.log(`\nAlready ingested under the new pipeline, skipped (${report.duplicate.length}):`);
    for (const d of report.duplicate) console.log(`  - ${d.fileName} -> existing document ${d.duplicateOf}`);
  }

  console.log(`\nNo recoverable source file (${report.missingSource.length}):`);
  for (const m of report.missingSource) console.log(`  - ${m.fileName} (${m.chunkCount} legacy chunks, was at ${m.legacySource})`);

  if (report.failed.length > 0) {
    console.log(`\nFailed to enqueue (${report.failed.length}):`);
    for (const f of report.failed) console.log(`  - ${f.fileName}: ${f.error}`);
  }

  if (DROP_LEGACY) {
    const decision = decideDrop({
      apply: APPLY,
      acceptLosses: ACCEPT_LOSSES,
      missingSourceCount: report.missingSource.length,
      failedCount: report.failed.length,
    });
    if (decision.drop) {
      await db.collection('chunks').drop();
      console.log('\nLegacy `chunks` collection dropped.');
    } else {
      console.error(`\n--drop-legacy refused: ${decision.reason}`);
      process.exitCode = 1;
    }
  } else if (legacy.length > 0) {
    console.log('\n(Run with --drop-legacy once recoverable documents have migrated to remove the legacy collection.)');
  }

  await ingestQueue.close();
  await mongoose.disconnect();
  // ingestion/queue.js opens a second, module-level IORedis connection for the BullMQ
  // Worker role (workerConnection) as a side effect of import, even though this script
  // never starts a worker — that handle has no owning close() call reachable from here and
  // would otherwise keep the event loop alive indefinitely. An explicit exit is the correct
  // fix for a one-shot CLI script that legitimately has nothing left to do, not a leak this
  // script itself introduced.
  process.exit(process.exitCode ?? 0);
}

// Only run the migration when this file is invoked directly. Without this guard, importing
// it to unit-test decideDrop() would run the whole migration as an import side effect —
// connecting to Mongo, and under the right flags dropping a collection. A destructive script
// must not do anything merely by being imported.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Migration failed:', err);
    process.exitCode = 1;
    process.exit(1);
  });
}
