import fs from 'fs/promises';
import { checkZipBombRisk } from './zipGuard.js';

// The extension gate in upload.js is advisory. Before any parser touches the bytes, the
// real container type is confirmed by signature (phase 2 §2.2).
const SIGNATURES = [
  { ext: '.pdf', offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },   // %PDF
  { ext: '.docx', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },  // PK.. (zip)
  { ext: '.xlsx', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },  // PK.. (zip)
  { ext: '.xls', offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0] },   // OLE2 compound
];
// .txt/.md/.csv/.json have no signature — validated by decoding instead (parser.js §4.4).

// Phase 8 §3.4 ("upload abuse"): the zip-signature formats (.docx, .xlsx) are the one
// local decompression-bomb vector this codebase has — .xlsx is parsed locally
// (providers/parser.js's `xlsx.readFile`), unlike .pdf/.docx which upload to LlamaParse's
// cloud and are never decompressed here at all. Checked here, not in a separate pass,
// because this IS "before any parser touches the bytes" for the format that needs it.
const ZIP_CONTAINER_EXTS = new Set(['.docx', '.xlsx']);

export async function verifyType(filePath, declaredExt) {
  const expected = SIGNATURES.find((s) => s.ext === declaredExt);
  if (!expected) return { ok: true, kind: 'text' };

  const fh = await fs.open(filePath, 'r');
  const buf = Buffer.alloc(8);
  await fh.read(buf, 0, 8, 0);
  await fh.close();

  const matches = expected.bytes.every((b, i) => buf[expected.offset + i] === b);
  if (!matches) {
    return {
      ok: false,
      reason: `File claims to be ${declaredExt} but its contents do not match that format.`,
    };
  }

  if (ZIP_CONTAINER_EXTS.has(declaredExt)) {
    const zipCheck = await checkZipBombRisk(filePath);
    if (!zipCheck.ok) return { ok: false, reason: zipCheck.reason };
  }

  return { ok: true, kind: 'binary' };
}
