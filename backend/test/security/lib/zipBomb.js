// Builds a real, valid, minimal ZIP archive with one entry whose UNCOMPRESSED size is
// large but whose on-disk size is tiny — the actual zip-bomb construction
// ingestion/zipGuard.js exists to catch, used here to prove it does. Hand-rolled rather
// than pulled from a library: Node 22 ships everything needed (zlib.deflateRawSync,
// zlib.crc32) and a bomb is small enough (one entry, no subdirectories) that the format
// is worth writing out directly rather than adding a zip-authoring dependency for one
// test file.
import zlib from 'zlib';

function u16(n) { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; }
function u32(n) { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; }

export function buildZipBomb({ uncompressedBytes = 50 * 1024 * 1024, fileName = 'bomb.xlsx' } = {}) {
  // All-zero content compresses extremely well with plain DEFLATE — this is the
  // canonical zip-bomb construction (a "highly redundant stream"), not a contrived
  // worst case for this specific guard.
  const content = Buffer.alloc(uncompressedBytes, 0);
  const compressed = zlib.deflateRawSync(content, { level: 9 });
  const crc = zlib.crc32(content);
  const nameBuf = Buffer.from(fileName, 'utf8');

  const localHeader = Buffer.concat([
    u32(0x04034b50), u16(20), u16(0), u16(8),   // version, flags, method=DEFLATE
    u16(0), u16(0),                              // mod time/date — unused by this guard
    u32(crc), u32(compressed.length), u32(content.length),
    u16(nameBuf.length), u16(0), nameBuf,
  ]);

  const centralHeader = Buffer.concat([
    u32(0x02014b50), u16(20), u16(20), u16(0), u16(8),
    u16(0), u16(0),
    u32(crc), u32(compressed.length), u32(content.length),
    u16(nameBuf.length), u16(0), u16(0), u16(0), u16(0), u32(0),
    u32(0),   // local header offset — 0, the only entry, at the start of the file
    nameBuf,
  ]);

  const eocd = Buffer.concat([
    u32(0x06054b50), u16(0), u16(0), u16(1), u16(1),
    u32(centralHeader.length), u32(localHeader.length + compressed.length), u16(0),
  ]);

  return Buffer.concat([localHeader, compressed, centralHeader, eocd]);
}
