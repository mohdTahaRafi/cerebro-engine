import * as vectorStore from '../providers/vectorStore.js';
import * as storage from '../providers/storage.js';

// Delete-by-filter, not delete-by-id: we may not know which point ids were written when
// the failure happened mid-upsert. The documentId payload index makes this fast (NFR-REL-03).
export async function rollbackDocument(documentId) {
  await vectorStore.deleteByDocument(documentId);
  await vectorStore.deletePagesByDocument(documentId);   // phase 4: was a no-op collection until now
  await storage.deletePrefix(`pages/${documentId}/`);
}
