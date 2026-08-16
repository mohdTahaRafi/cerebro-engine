// mergeByProvenance — the Phase 4 seam (phase 3 §6, task 3.13). Identity today: text
// candidates pass straight through and an empty page-candidate list changes nothing.
// Phase 4 replaces the body with the real visual/text dedup from architecture §5.5 —
// merging by (documentId, page) provenance so the same page is never returned twice under
// both the text and visual channels. The seam exists here, before it is needed, so
// search.js's call site does not change shape when Phase 4 lands.
export function mergeByProvenance(textCandidates, pageCandidates = []) {
  return [...textCandidates, ...pageCandidates];
}
