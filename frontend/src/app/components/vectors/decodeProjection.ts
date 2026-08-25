// phase_4 §4.2 — decodes the packed projection payload (architecture.md §7.9: interleaved
// coordinates as base64 rather than JSON objects). Getting the byte alignment wrong produces
// a cloud that looks plausible and is wrong, so both lengths are asserted rather than assumed:
// a truncated or misaligned buffer throws HERE, with the expected and actual byte counts in
// the message, instead of throwing deep inside three.js on upload or silently rendering a
// shifted cloud.
import type { ProjectionResponse } from '../../../api/contracts.ts';

export interface DecodedProjection {
  positions: Float32Array;   // length = nodeCount * 3, interleaved [x,y,z]
  docIndex: Uint16Array;     // length = nodeCount, indexes response.documents
  colors: Float32Array;      // length = nodeCount * 3, linear-space RGB per instance
  pointIds: string[];
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

// A neutral mid-gray in linear space, used only if docIndex ever addresses a document index
// the payload's `documents` table doesn't have an entry for (a malformed response) — never
// left as an uninitialized (black) point, which would read as "on top of everything."
const FALLBACK_RGB: [number, number, number] = [0.5, 0.5, 0.5];

function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// R3F sets THREE.ColorManagement.enabled = true by default, so a vertex color attribute is
// interpreted as LINEAR — passing sRGB hex values straight through produces a cloud that is
// visibly washed out relative to the same hex used in the surrounding (sRGB) CSS.
function srgbChannelToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function hexToLinearRgb(hex: number): [number, number, number] {
  const r = ((hex >> 16) & 0xff) / 255;
  const g = ((hex >> 8) & 0xff) / 255;
  const b = (hex & 0xff) / 255;
  return [srgbChannelToLinear(r), srgbChannelToLinear(g), srgbChannelToLinear(b)];
}

export function decodeProjection(res: ProjectionResponse): DecodedProjection {
  const posBuf = b64ToBuffer(res.positions);
  const idxBuf = b64ToBuffer(res.docIndex);

  // A Float32Array view REQUIRES 4-byte alignment and an exact length. Both are asserted
  // rather than assumed: a truncated or misaligned buffer would either throw deep inside
  // three.js on upload, or silently render a shifted cloud.
  if (posBuf.byteLength !== res.nodeCount * 3 * 4) {
    throw new Error(
      `projection: expected ${res.nodeCount * 3 * 4} position bytes, got ${posBuf.byteLength}`,
    );
  }
  if (idxBuf.byteLength !== res.nodeCount * 2) {
    throw new Error(
      `projection: expected ${res.nodeCount * 2} docIndex bytes, got ${idxBuf.byteLength}`,
    );
  }

  const positions = new Float32Array(posBuf);
  const docIndex = new Uint16Array(idxBuf);

  // Per-instance color, resolved once on decode rather than in the shader, so the GPU never
  // needs the document table and a re-color (on filter) is a single attribute update rather
  // than a re-upload of positions.
  const palette = res.documents.map((d) => hexToLinearRgb(d.color));
  const colors = new Float32Array(res.nodeCount * 3);
  for (let i = 0; i < res.nodeCount; i++) {
    const c = palette[docIndex[i]] ?? FALLBACK_RGB;
    colors[i * 3] = c[0]; colors[i * 3 + 1] = c[1]; colors[i * 3 + 2] = c[2];
  }

  return { positions, docIndex, colors, pointIds: res.pointIds, bounds: res.bounds };
}
