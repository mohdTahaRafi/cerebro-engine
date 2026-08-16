import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/index.js';

// StorageAdapter — filesystem driver (dev). The S3/MinIO driver lands in Phase 6
// (NFR-PORT-01: swapping vector/storage backends is a config change, not a rewrite
// of ingestion logic) behind this same four-function interface.
//
// Keys are logical paths that already carry their top-level prefix (e.g.
// "pages/<documentId>/10.jpg"), matching what the Python vision service writes
// under PAGE_STORAGE_DIR (Phase 4). ROOT is that directory's parent, so a
// "pages/..." key resolves to exactly where the vision container writes it.
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

export async function put(key, data) {
  const full = resolveKey(key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
}

export async function get(key) {
  return fs.readFile(resolveKey(key));
}

async function del(key) {
  await fs.unlink(resolveKey(key)).catch((err) => {
    if (err.code !== 'ENOENT') throw err;   // deleting an already-gone file is not an error
  });
}
export { del as delete };

// Phase 5 §7.2: buildUserMessage attaches page images by the ROUTE path a source carries
// (`/api/pages/<documentId>/<page>.jpg`, toPublicResult's imageUri — see retrieval/search.js),
// not the raw storage key. The mapping back to a storage key is exactly pages.js's own
// `pages/${documentId}/${page}.jpg` construction run in reverse.
export async function readBase64(imageUri) {
  const key = imageUri.replace(/^\/api\/pages\//, 'pages/');
  const buf = await get(key);
  return buf.toString('base64');
}

export async function exists(key) {
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
export async function deletePrefix(prefix) {
  const full = resolveKey(prefix);
  await fs.rm(full, { recursive: true, force: true });
}
