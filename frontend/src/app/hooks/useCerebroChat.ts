import { useRef, useState } from 'react';
import { api } from '../../api';
import type { LangSmithLink } from '../components/core/TelemetryTypes';
import type { PipelineTelemetry, ProvenanceSource } from '../../api/contracts';

// Matches retrieval/search.js's toPublicResult projection (backend), re-declared in
// api/contracts.ts so the api boundary owns its own contract (phase_1 §4.2) rather than
// this hook reaching past it into backend-shaped types.
export type ChatSource = ProvenanceSource;
export type ChatTelemetry = PipelineTelemetry;

export function useCerebroChat() {
  const [answer, setAnswer] = useState<string>('');
  const [sources, setSources] = useState<ChatSource[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [threadId, setThreadId] = useState<string | null>(null);
  const [telemetry, setTelemetry] = useState<ChatTelemetry | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [langsmith, setLangsmith] = useState<LangSmithLink | null>(null);
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
    setRunId(null);
    setLangsmith(null);

    const activeThreadId = options.threadId ?? threadId;

    try {
      for await (const evt of api.chat.ask({
        query, threadId: activeThreadId, scopeDocumentIds: options.scopeDocumentIds, signal: controller.signal,
      })) {
        // Event-discriminated envelope (phase 5 §9.1) — switches on `event` rather than
        // sniffing for `evt.sources` / `evt.token`, which is ambiguous the moment a
        // frame could legitimately carry neither.
        switch (evt.event) {
          case 'threadId':
            setThreadId(evt.threadId);
            break;
          case 'sources':
            setSources(evt.sources);
            break;
          case 'token':
            setAnswer((prev) => prev + evt.token);
            break;
          case 'telemetry':
            setTelemetry(evt.telemetry);
            setRunId(evt.runId ?? null);
            setLangsmith(evt.langsmith ?? null);
            break;
          case 'error':
            setError(evt.error);
            break;
          default:
            console.warn('Unknown SSE event:', evt);
        }
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        // Either superseded by a newer query, or the user pressed Stop — neither is a
        // real error. req.on('close') on the server honors this same AbortController,
        // so the provider call itself stops too, not just the client-side render.
        return;
      }
      setError(err?.message ?? 'Failed to start generation stream');
    } finally {
      if (abortRef.current === controller) {
        setIsGenerating(false);
      }
    }
  };

  const askCerebro = (query: string, scopeDocumentIds?: string[]) => run(query, { scopeDocumentIds });

  // Loads a previously-saved thread's transcript into view (not re-run through
  // api.chat.ask — GET /api/threads/:id already returns the persisted exchange).
  const loadThread = (id: string) => {
    setThreadId(id);
    setAnswer('');
    setSources([]);
    setError(null);
    setTelemetry(null);
    setRunId(null);
    setLangsmith(null);
  };

  const startNewThread = () => {
    abortRef.current?.abort();
    setThreadId(null);
    setAnswer('');
    setSources([]);
    setError(null);
    setTelemetry(null);
    setRunId(null);
    setLangsmith(null);
    lastQueryRef.current = null;
  };

  const stopGenerating = () => {
    abortRef.current?.abort();
  };

  // Re-posts the last user message on the same threadId after the caller has removed
  // the trailing assistant message from view.
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
    runId,
    langsmith,
    askCerebro,
    loadThread,
    startNewThread,
    stopGenerating,
    regenerate,
  };
}
