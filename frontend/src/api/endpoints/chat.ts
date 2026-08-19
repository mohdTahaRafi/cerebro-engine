import { streamEvents } from '../client';
import type { AskEvent } from '../contracts';

export interface AskParams {
  query: string;
  threadId?: string | null;
  scopeDocumentIds?: string[];
  signal: AbortSignal;
}

export const chat = {
  ask({ query, threadId, scopeDocumentIds, signal }: AskParams) {
    return streamEvents<AskEvent>('/ask', {
      query,
      threadId: threadId ?? undefined,
      scopeDocumentIds: scopeDocumentIds?.length ? scopeDocumentIds : undefined,
    }, signal);
  },
};
