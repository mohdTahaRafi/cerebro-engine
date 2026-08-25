import { streamEvents } from '../client';
import type { AskEvent } from '../contracts';

export interface AskParams {
  query: string;
  threadId?: string | null;
  contextId?: string | null;
  scopeDocumentIds?: string[];
  signal: AbortSignal;
}

export const chat = {
  ask({ query, threadId, contextId, scopeDocumentIds, signal }: AskParams) {
    return streamEvents<AskEvent>('/ask', {
      query,
      threadId: threadId ?? undefined,
      // phase_3_chat_ui.md header note: sent unconditionally; the current backend
      // ignores an unrecognized field, which is harmless and becomes load-bearing once
      // retrieval is actually scoped to a context (Phase 6).
      contextId: contextId ?? undefined,
      scopeDocumentIds: scopeDocumentIds?.length ? scopeDocumentIds : undefined,
    }, signal);
  },
};
