// PipelineTelemetry — mirrors backend/src/telemetry/pipelineTelemetry.js exactly (phase 6
// §2.1). Every `| null` here is load-bearing: a skipped stage (condense on a first turn,
// colpali with no visual corpus, rerank while degraded) is `null`, never `0` — a `0` would
// be indistinguishable from an instantaneous stage in the waterfall below.
//
// Each stage carries a duration (`<stage>Ms`) AND a measured start offset from the
// request's own origin (`<stage>StartMs`). The offsets are what make §2.2's "real elapsed
// time from request start, not a stacked sum" x-axis possible — without them the console
// could only reconstruct bar positions by stacking durations, which is precisely the
// layout §2.2 forbids.
export interface PipelineTelemetry {
  condenseMs: number | null;            // null => skipped (first turn)
  condenseStartMs: number | null;
  embedMs: number | null;               // Cohere query embedding (dense)
  embedStartMs: number | null;
  sparseMs: number | null;              // local BM25 — typically 2-4ms
  sparseStartMs: number | null;
  colpaliMs: number | null;             // null => vision unavailable or no visual corpus
  colpaliStartMs: number | null;
  chunkRetrieveMs: number | null;       // Qdrant hybrid query incl. server-side RRF
  chunkRetrieveStartMs: number | null;
  pageRetrieveMs: number | null;        // Qdrant MAX_SIM
  pageRetrieveStartMs: number | null;
  mergeMs: number | null;               // provenance dedup
  mergeStartMs: number | null;
  rerankMs: number | null;              // null => reranker degraded
  rerankStartMs: number | null;
  generateMs: number | null;
  generateStartMs: number | null;
  firstTokenMs: number | null;          // a duration INSIDE generate, not an offset
  totalMs: number;
  candidatesRetrieved: number;
  candidatesAfterMerge: number;
  candidatesAfterFloor: number;
  rerankSkipped: boolean;
  warnings: string[];
}

// One row of the waterfall (§2.2). `parallelGroup` stages sharing the same value are drawn
// under one bracket, because embed+sparse+colpali (and chunkRetrieve+pageRetrieve) are
// dispatched concurrently. Note the bracket is now a *label* for a fan-out the measured
// offsets already prove — the bars overlap on the timeline because their real start
// offsets overlap, not because the renderer forces them to.
export interface StageSpec {
  durationKey: keyof PipelineTelemetry;
  startKey: keyof PipelineTelemetry;
  label: string;
  parallelGroup?: string;
  skippedReason: string;
}

export const STAGES: StageSpec[] = [
  { durationKey: 'condenseMs', startKey: 'condenseStartMs', label: 'condense', skippedReason: 'first turn — no history to condense' },
  { durationKey: 'embedMs', startKey: 'embedStartMs', label: 'embed', parallelGroup: 'encode', skippedReason: 'query embedding unavailable' },
  { durationKey: 'sparseMs', startKey: 'sparseStartMs', label: 'sparse', parallelGroup: 'encode', skippedReason: 'sparse encoding unavailable' },
  { durationKey: 'colpaliMs', startKey: 'colpaliStartMs', label: 'colpali', parallelGroup: 'encode', skippedReason: 'vision service unavailable or no visual corpus' },
  { durationKey: 'chunkRetrieveMs', startKey: 'chunkRetrieveStartMs', label: 'chunk-retrieve', parallelGroup: 'retrieve', skippedReason: 'chunk retrieval unavailable' },
  { durationKey: 'pageRetrieveMs', startKey: 'pageRetrieveStartMs', label: 'page-retrieve', parallelGroup: 'retrieve', skippedReason: 'no ColPali query vector to retrieve pages with' },
  { durationKey: 'mergeMs', startKey: 'mergeStartMs', label: 'merge', skippedReason: 'nothing to merge' },
  { durationKey: 'rerankMs', startKey: 'rerankStartMs', label: 'rerank', skippedReason: 'reranker degraded — results are in fusion order' },
  { durationKey: 'generateMs', startKey: 'generateStartMs', label: 'generate', skippedReason: 'no sources cleared the relevance floor' },
];

// Branch attribution for the provenance panel (§2.3) — derived server-side from Qdrant
// prefetch membership (dense/sparse/both) or fixed at 'colpali' for a visual-page hit.
export type SourceBranch = 'dense' | 'sparse' | 'both' | 'colpali';

export interface ProvenanceSource {
  pointId: string;
  kind: 'text' | 'page';
  text: string;
  score: number | null;
  documentId: string;
  fileName: string;
  page: number | null;
  headingPath: string | null;
  imageUri: string | null;
  ocrQuality: number | null;
  absorbedChunks: string[] | null;
  branch: SourceBranch | null;
  fusionRank: number | null;
  finalRank: number | null;
}

export interface LangSmithLink {
  orgId: string | null;
  project: string;
}

export function langSmithUrl(link: LangSmithLink | null | undefined, runId: string | null | undefined): string | null {
  if (!link?.orgId || !runId) return null;
  return `https://smith.langchain.com/o/${link.orgId}/projects/p/${encodeURIComponent(link.project)}/r/${runId}`;
}
