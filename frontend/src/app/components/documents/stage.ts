// INTERIM (phase_2 §5.2). The backend does not yet report a lifecycle stage; this derives
// the five PRD-named stages from `status` + `progress`. Phase 7 adds a real `stage` field
// to the Document model and THIS ENTIRE FILE IS DELETED — the mapping is not a long-term
// abstraction, it is a bridge with a scheduled demolition date.
//
// Band boundaries mirror backend/src/ingestion/ingestDocument.js's updateProgress() calls.
// If those move, this moves. There is no test that can catch the drift, so the boundaries
// are named in both files with a pointer to the other.
import type { DocumentRecord, IngestStage } from '../../../api/contracts';

export function deriveStage(doc: Pick<DocumentRecord,
  'status' | 'progress' | 'visualPageCount'>): IngestStage {
  switch (doc.status) {
    case 'queued':    return 'queued';
    case 'ready':     return 'ready';
    case 'failed':    return 'failed';
    case 'duplicate': return 'ready';   // resolved against an already-ready original
    case 'processing':
      if (doc.progress < 75)  return 'parsing';     // classify + parse + OCR/ColPali (§5.2)
      if (doc.progress < 85)  return 'chunking';
      return 'embedding';                            // 85 → 100
  }
}

/** Extra line under the stage chip. Real values only — returns null rather than
 *  inventing detail the row does not carry. */
export function stageDetail(doc: Pick<DocumentRecord,
  'status' | 'progress' | 'visualPageCount'>): string | null {
  if (deriveStage(doc) !== 'parsing') return null;
  if (doc.progress >= 45 && doc.visualPageCount > 0) {
    return `${doc.visualPageCount} scanned page${doc.visualPageCount === 1 ? '' : 's'}`;
  }
  return null;
}
