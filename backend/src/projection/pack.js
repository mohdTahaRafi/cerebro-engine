// pack — turns a UMAP embedding plus its source points into the binary Projection payload
// (phase 7 §4.1, architecture §7.9). Float32Array positions and Uint16Array docIndex, not
// JSON arrays of numbers: 5,000 × 3 floats as a Mongo array of Doubles is ~360 KB of BSON,
// as a Buffer it is exactly 60,000 bytes — the same ratio is why the wire response
// (routes/vectors.js) base64-encodes these same buffers rather than re-expanding them.

// A fixed, evenly-spaced hue wheel rather than a hash of the document id: a hash-based
// color risks two documents landing on visually adjacent hues by coincidence, which reads
// as "these are related" when they are not. Evenly spacing N hues around the wheel
// guarantees maximum separation for however many documents are actually present.
// Saturation/lightness (62%/55%) are fixed at values that stay legible on both the light
// and dark canvas background (DESIGN.md's vector-space treatment) — pure primaries (100%
// saturation) clip on a dark canvas and pastels (>70% lightness) wash out on a light one.
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const toByte = (n) => Math.round(f(n) * 255);
  return (toByte(0) << 16) | (toByte(8) << 8) | toByte(4);
}

function paletteFor(documentIds) {
  const n = documentIds.length;
  return documentIds.map((id, i) => ({
    id,
    // Golden-angle-adjacent spacing (137.5° would clump for small N); a plain even split
    // (360/n) is what actually maximizes pairwise hue separation for a known, fixed N —
    // the palette is built once per fit, after every document id is already known, so
    // there is no "one more document arrives later" case a golden-angle sequence would
    // otherwise be for.
    color: hslToHex((360 * i) / Math.max(n, 1), 62, 55),
  }));
}

// `sample` is the (possibly downsampled) point list fitContext scrolled from Qdrant;
// `embedding` is umap-js's output, one [x, y, z] triple per sample point, same order.
export function packProjection(sample, embedding, { fileNameById }) {
  const nodeCount = sample.length;
  const positions = new Float32Array(nodeCount * 3);
  const pointIds = new Array(nodeCount);

  const documentIds = [...new Set(sample.map((p) => String(p.payload.documentId)))];
  const documents = paletteFor(documentIds).map((d) => ({
    id: d.id, fileName: fileNameById.get(d.id) ?? 'Unknown document', color: d.color,
  }));
  const docOrder = new Map(documentIds.map((id, i) => [id, i]));

  const docIndex = new Uint16Array(nodeCount);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < nodeCount; i++) {
    const [x, y, z] = embedding[i];
    positions[i * 3] = x; positions[i * 3 + 1] = y; positions[i * 3 + 2] = z;
    min[0] = Math.min(min[0], x); max[0] = Math.max(max[0], x);
    min[1] = Math.min(min[1], y); max[1] = Math.max(max[1], y);
    min[2] = Math.min(min[2], z); max[2] = Math.max(max[2], z);
    pointIds[i] = sample[i].id;
    docIndex[i] = docOrder.get(String(sample[i].payload.documentId)) ?? 0;
  }

  return {
    status: 'fresh',
    nodeCount,
    pointIds,
    positions: Buffer.from(positions.buffer, positions.byteOffset, positions.byteLength),
    docIndex: Buffer.from(docIndex.buffer, docIndex.byteOffset, docIndex.byteLength),
    documents,
    bounds: { min, max },
  };
}
