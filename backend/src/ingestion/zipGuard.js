// Phase 8 §3.4 ("upload abuse"): a zip bomb refused before parsing. `.xlsx` is parsed
// locally with `xlsx.readFile` (providers/parser.js), which decompresses the archive
// in this process — unlike `.pdf`/`.docx`, which are uploaded to LlamaParse's cloud and
// never decompressed on our infrastructure at all (parser.js's own imports). `.xlsx`
// (and `.docx`, sharing the same zip container format — verifyType.js's SIGNATURES) is
// therefore the one local decompression-bomb vector this codebase has, and this is the
// gap-closing control for it: read the zip's End Of Central Directory + Central
// Directory records — small, fixed-size structures at the tail of the file — and sum
// every entry's DECLARED uncompressed size WITHOUT decompressing anything, then refuse
// if that sum is implausible. This is metadata-only: a hostile zip bomb's whole point is
// that its declared uncompressed size is enormous relative to its on-disk size, and that
// declared size is readable without inflating a single byte.
import fs from 'fs/promises';

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIR_SIGNATURE = 0x02014b50;
const MAX_COMMENT_LENGTH = 65535;
const EOCD_MIN_SIZE = 22;

// Absolute cap on total declared uncompressed content. A legitimate xlsx workbook well
// past anything a human edits by hand (millions of cells, embedded images) stays under
// this by a wide margin; it exists as a hard ceiling independent of the ratio check
// below, so a bomb built from many small, individually-plausible-ratio entries is still
// caught.
const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;   // 2 GiB

// Ratio cap. A real .xlsx (its content is mostly repetitive XML) commonly compresses
// 5-20x; 200x gives generous headroom above that before anything is flagged, while
// still catching the canonical zip-bomb construction (nested/highly-redundant streams
// compressing 1,000x or more).
const MAX_COMPRESSION_RATIO = 200;

export async function checkZipBombRisk(filePath) {
  const stat = await fs.stat(filePath);
  const fileSize = stat.size;
  if (fileSize < EOCD_MIN_SIZE) return { ok: true };   // too small to be a valid zip; verifyType's signature check already gates this

  const fh = await fs.open(filePath, 'r');
  try {
    // Locate the EOCD record by scanning backward from the end of the file. Its
    // signature can be preceded by up to 65535 bytes of an (optional) archive comment,
    // so the search window is the smaller of the whole file or that maximum.
    const tailSize = Math.min(fileSize, EOCD_MIN_SIZE + MAX_COMMENT_LENGTH);
    const tailStart = fileSize - tailSize;
    const tail = Buffer.alloc(tailSize);
    await fh.read(tail, 0, tailSize, tailStart);

    let eocdOffset = -1;
    for (let i = tail.length - EOCD_MIN_SIZE; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIGNATURE) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) {
      // Not a well-formed zip at all — verifyType's magic-byte check already confirmed
      // the PK signature at offset 0, so a missing EOCD means a truncated/corrupt
      // archive. Let the real parser produce that error; this guard only judges size.
      return { ok: true };
    }

    const entryCount = tail.readUInt16LE(eocdOffset + 10);
    const centralDirOffset = tail.readUInt32LE(eocdOffset + 16);

    // Read the whole central directory in one shot — it is metadata only (one fixed
    // 46-byte header plus three short variable-length names/fields per entry), never
    // file content, so even a "bomb" with a huge DECLARED uncompressed size has a small
    // central directory on disk.
    const centralDirSize = tailStart + eocdOffset - centralDirOffset;
    if (centralDirSize <= 0 || centralDirSize > 64 * 1024 * 1024) {
      // A 64MB central directory implies an implausible entry count for a spreadsheet;
      // treat as suspicious rather than trust-and-read an attacker-sized buffer.
      return { ok: false, reason: 'This file\'s internal structure is unusually large and was rejected before parsing.' };
    }
    const centralDir = Buffer.alloc(centralDirSize);
    await fh.read(centralDir, 0, centralDirSize, centralDirOffset);

    let totalUncompressed = 0;
    let totalCompressed = 0;
    let offset = 0;
    let entriesRead = 0;
    while (offset + 46 <= centralDir.length && entriesRead < entryCount) {
      if (centralDir.readUInt32LE(offset) !== CENTRAL_DIR_SIGNATURE) break;
      const compressedSize = centralDir.readUInt32LE(offset + 20);
      const uncompressedSize = centralDir.readUInt32LE(offset + 24);
      const nameLen = centralDir.readUInt16LE(offset + 28);
      const extraLen = centralDir.readUInt16LE(offset + 30);
      const commentLen = centralDir.readUInt16LE(offset + 32);

      totalCompressed += compressedSize;
      totalUncompressed += uncompressedSize;
      offset += 46 + nameLen + extraLen + commentLen;
      entriesRead += 1;
    }

    if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
      return {
        ok: false,
        reason: `This file expands to over ${Math.round(MAX_UNCOMPRESSED_BYTES / (1024 * 1024))} MB and was rejected before parsing.`,
      };
    }
    const ratio = totalCompressed > 0 ? totalUncompressed / totalCompressed : (totalUncompressed > 0 ? Infinity : 0);
    if (ratio > MAX_COMPRESSION_RATIO) {
      return {
        ok: false,
        reason: 'This file\'s compression ratio is implausibly high and was rejected before parsing.',
      };
    }

    return { ok: true };
  } finally {
    await fh.close();
  }
}
