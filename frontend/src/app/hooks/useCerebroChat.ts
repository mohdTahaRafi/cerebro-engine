import { useRef, useState } from 'react';

// Matches retrieval/search.js's toPublicResult projection (backend), which rerank.js
// (graph/nodes/rerank.js) uses to populate RagState.sources — the same shape the
// generation prompt is built from and the shape /api/ask streams to the client (phase 5
// §6, §7.4).
export interface ChatSource {
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
}

export interface ChatTelemetry {
  condenseMs?: number | null;
  embedMs?: number | null;
  retrieveMs?: number | null;
  colpaliMs?: number | null;
  pageRetrieveMs?: number | null;
  retrieveTotalMs?: number;
  rerankMs?: number | null;
  firstTokenMs?: number | null;
  generateMs?: number;
}

export function useCerebroChat() {
  const [answer, setAnswer] = useState<string>('');
  const [sources, setSources] = useState<ChatSource[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<ChatTelemetry | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Regenerate re-posts the *last* user query on the same thread — kept alongside
  // threadId rather than re-derived from message history, since this hook has no
  // history array of its own (single in-flight Q&A, not a transcript).
  const lastQueryRef = useRef<string | null>(null);

  const run = async (query: string, options: { threadId?: string | null; scopeDocumentIds?: string[] } = {}) => {
    if (!query.trim()) return;

    // Cancel any still-in-flight request so a slow previous stream can't clobber
    // this newer one's state (no request-sequencing existed before this).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    lastQueryRef.current = query;
    setIsGenerating(true);
    setAnswer('');
    setSources([]);
    setError(null);
    setTelemetry(null);

    const activeThreadId = options.threadId ?? threadId;

    try {
      const response = await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          threadId: activeThreadId ?? undefined,
          scopeDocumentIds: options.scopeDocumentIds?.length ? options.scopeDocumentIds : undefined,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || 'Failed to start generation stream');
      }
      if (!response.body) {
        throw new Error('No readable stream available');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');

      let done = false;
      let buffer = '';

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;

        if (value) {
          buffer += decoder.decode(value, { stream: true });

          let doubleNewlineIndex = buffer.indexOf('\n\n');
          while (doubleNewlineIndex !== -1) {
            const line = buffer.substring(0, doubleNewlineIndex).trim();
            buffer = buffer.substring(doubleNewlineIndex + 2);

            if (line.startsWith('data: ')) {
              const dataStr = line.replace('data: ', '').trim();

              if (dataStr === '[DONE]') {
                done = true;
                break;
              }

              try {
                const parsed = JSON.parse(dataStr);
                // Event-discriminated envelope (phase 5 §9.1) — switches on `event`
                // rather than sniffing for `parsed.sources` / `parsed.token`, which is
                // ambiguous the moment a frame could legitimately carry neither.
                switch (parsed.event) {
                  case 'threadId':
                    setThreadId(parsed.threadId);
                    break;
                  case 'sources':
                    setSources(parsed.sources);
                    break;
                  case 'token':
                    setAnswer((prev) => prev + parsed.token);
                    break;
                  case 'telemetry':
                    setTelemetry(parsed.telemetry);
                    break;
                  case 'error':
                    setError(parsed.error);
                    break;
                  default:
                    console.warn('Unknown SSE event:', parsed);
                }
              } catch (e) {
                console.error('Failed to parse SSE JSON:', e);
              }
            }
            doubleNewlineIndex = buffer.indexOf('\n\n');
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        // Either superseded by a newer query, or the user pressed Stop — neither is a
        // real error. req.on('close') on the server honors this same AbortController,
        // so the provider call itself stops too (phase 5 §9, §11 point 4), not just the
        // client-side render.
        return;
      }
      setError(err.message);
    } finally {
      if (abortRef.current === controller) {
        setIsGenerating(false);
      }
    }
  };

  const askCerebro = (query: string, scopeDocumentIds?: string[]) => run(query, { scopeDocumentIds });

  // Loads a previously-saved thread's transcript into view (not re-run through /api/ask —
  // GET /api/threads/:id already returns the persisted exchange).
  const loadThread = (id: string) => {
    setThreadId(id);
    setAnswer('');
    setSources([]);
    setError(null);
    setTelemetry(null);
  };

  const startNewThread = () => {
    abortRef.current?.abort();
    setThreadId(null);
    setAnswer('');
    setSources([]);
    setError(null);
    setTelemetry(null);
    lastQueryRef.current = null;
  };

  const stopGenerating = () => {
    abortRef.current?.abort();
  };

  // Re-posts the last user message on the same threadId after the caller has removed
  // the trailing assistant message from view (phase 5 §11 point 5).
  const regenerate = () => {
    if (!lastQueryRef.current) return;
    run(lastQueryRef.current, { threadId });
  };

  return {
    answer,
    sources,
    isGenerating,
    error,
    threadId,
    telemetry,
    askCerebro,
    loadThread,
    startNewThread,
    stopGenerating,
    regenerate,
  };
}
