import fs from 'fs/promises';
import path from 'path';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command, HeadObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config/index.js';

// StorageAdapter — two drivers behind one four-function interface (NFR-PORT-01: swapping
// vector/storage backends is a config change, not a rewrite of ingestion logic). `driver`
// is read once at module load from config.storage.driver ('filesystem' | 's3'), not
// per-call — a running process's storage backend does not change mid-flight.
//
// Keys are logical paths that already carry their top-level prefix (e.g.
// "pages/<documentId>/10.jpg"), matching what the Python vision service writes under
// PAGE_STORAGE_DIR (Phase 4) and what documents.js writes under UPLOAD_STORAGE_DIR
// (Phase 2). Both drivers treat that key identically as an object identifier — the
// filesystem driver resolves it under ROOT, the S3 driver uses it as the object key
// unchanged (S3 has no real directory concept; "pages/<id>/10.jpg" is just a key
// containing slashes).

// ── Filesystem driver (dev default) ──────────────────────────────────────────────
const ROOT = path.resolve(config.storage.pagesDir, '..');

function resolveKey(key) {
  const full = path.resolve(ROOT, key);
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) {
    // documentId/page values are never user-typed paths, so a key escaping ROOT
    // (e.g. "../../etc/passwd") is always a bug, never a legitimate call.
    throw new Error(`Storage key resolves outside the storage root: ${key}`);
  }
  return full;
}

async function fsPut(key, data) {
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
}

async function fsGet(key) {
  return fs.readFile(resolveKey(key));
}

async function fsDelete(key) {
  await fs.unlink(resolveKey(key)).catch((err) => {
    if (err.code !== 'ENOENT') throw err;   // deleting an already-gone file is not an error
  });
}

async function fsExists(key) {
  try {
    await fs.access(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}

// Phase 2's rollback.js calls this for every failed document; it is a genuine no-op until
// Phase 4 starts writing page images under "pages/<documentId>/" — recursive removal of a
// prefix that was never written is just "directory does not exist", handled below.
async function fsDeletePrefix(prefix) {
  const full = resolveKey(prefix);
  await fs.rm(full, { recursive: true, force: true });
}

// ── S3/MinIO driver (production, phase 6 §8, §12) ────────────────────────────────
let _s3Client = null;
function s3() {
  if (_s3Client) return _s3Client;
  _s3Client = new S3Client({
    endpoint: config.storage.s3.endpoint,
    // MinIO (and most self-hosted S3-compatible stores) serve buckets under
    // <endpoint>/<bucket>/<key>, not <bucket>.<endpoint>/<key> — the AWS SDK's default
    // virtual-hosted-style addressing resolves the latter and 404s against MinIO unless
    // this is forced.
    forcePathStyle: true,
    region: 'us-east-1',   // required by the SDK's config validation; MinIO ignores it
    credentials: {
      accessKeyId: config.storage.s3.accessKeyId,
      secretAccessKey: config.storage.s3.secretAccessKey,
    },
  });
  return _s3Client;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

async function s3Put(key, data) {
  await s3().send(new PutObjectCommand({ Bucket: config.storage.s3.bucket, Key: key, Body: data }));
}

async function s3Get(key) {
  const res = await s3().send(new GetObjectCommand({ Bucket: config.storage.s3.bucket, Key: key }));
  return streamToBuffer(res.Body);
}

async function s3Delete(key) {
  // Unlike fs.unlink, S3's DeleteObject does not error on a missing key — it is
  // idempotent by design, so no ENOENT-style catch is needed here.
  await s3().send(new DeleteObjectCommand({ Bucket: config.storage.s3.bucket, Key: key }));
}

async function s3Exists(key) {
  try {
    await s3().send(new HeadObjectCommand({ Bucket: config.storage.s3.bucket, Key: key }));
    return true;
  } catch (err) {
    if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) return false;
    throw err;
  }
}

async function s3DeletePrefix(prefix) {
  // S3 has no recursive-delete primitive — list every key under the prefix, then delete
  // them one by one. DeleteObjects (batch, up to 1000 keys) would be one round trip
  // instead of N, but a single document's page-image set is small enough (tens of pages,
  // §7.1's phase 4 budget) that the simpler one-key-at-a-time form is the right tradeoff
  // here — this only ever runs on document deletion/rollback, not a hot path.
  let continuationToken;
  do {
    const res = await s3().send(new ListObjectsV2Command({
      Bucket: config.storage.s3.bucket, Prefix: prefix, ContinuationToken: continuationToken,
    }));
    for (const obj of res.Contents ?? []) {
      // eslint-disable-next-line no-await-in-loop
      await s3().send(new DeleteObjectCommand({ Bucket: config.storage.s3.bucket, Key: obj.Key }));
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
}

// ── Public interface — dispatches on config.storage.driver ───────────────────────
const IS_S3 = config.storage.driver === 's3';

export const put = IS_S3 ? s3Put : fsPut;
export const get = IS_S3 ? s3Get : fsGet;
export const exists = IS_S3 ? s3Exists : fsExists;
export const deletePrefix = IS_S3 ? s3DeletePrefix : fsDeletePrefix;
const del = IS_S3 ? s3Delete : fsDelete;
export { del as delete };

// Phase 5 §7.2: buildUserMessage attaches page images by the ROUTE path a source carries
// (`/api/pages/<documentId>/<page>.jpg`, toPublicResult's imageUri — see retrieval/search.js),
// not the raw storage key. The mapping back to a storage key is exactly pages.js's own
// `pages/${documentId}/${page}.jpg` construction run in reverse — identical for both
// drivers, since both key their objects the same way.
export async function readBase64(imageUri) {
  const key = imageUri.replace(/^\/api\/pages\//, 'pages/');
  const buf = await get(key);
  return buf.toString('base64');
}
