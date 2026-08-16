// mergeByProvenance — real dedup (phase 4 §7.2, architecture §5.5), replacing the Phase 3
// identity stub. Problem it solves: a visual page is indexed twice by design (architecture
// §5.3) — once as a ColPali multivector, once as OCR chunks — so the same scanned page can
// arrive from both branches and would otherwise occupy two reranker slots and two result
// rows carrying identical evidence.
export function mergeByProvenance(chunkCandidates, pageCandidates = []) {
  // Key on (documentId, page) — the identity of a physical page.
  const pageIndex = new Map(pageCandidates.map((p) => [`${p.documentId}:${p.page}`, p]));
  const absorbed = new Set();

  for (const chunk of chunkCandidates) {
    if (chunk.sourceKind !== 'ocr') continue;          // only OCR chunks can collide
    const key = `${chunk.documentId}:${chunk.page}`;
    const page = pageIndex.get(key);
    if (!page) continue;

    // The page entry wins: it carries the image, which the chunk does not, and the
    // chunk's text is already reachable through the page's ocrText payload.
    (page.absorbedChunks ??= []).push(chunk.pointId);
    absorbed.add(chunk.pointId);
  }

  return [
    ...chunkCandidates.filter((c) => !absorbed.has(c.pointId)),
    ...pageCandidates,
  ];
}
