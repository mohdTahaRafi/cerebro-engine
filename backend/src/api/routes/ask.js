// POST /api/ask — SSE transport for the conversational RAG graph (phase 5 §9). Replaces
// the legacy inline handler in api/index.js: same path, new event-discriminated envelope,
// thread persistence, and real mid-stream abort instead of a client-side-only Stop button.
import express from 'express';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';
import { ragGraph } from '../../graph/ragGraph.js';
import { Conversation } from '../../models/Conversation.js';
import { persistTurn } from '../../conversation/persistTurn.js';
import { MAX_QUERY_CHARS } from '../../retrieval/constants.js';

const router = express.Router();

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function isArrayOfObjectIds(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && OBJECT_ID_RE.test(v));
}

router.post('/api/ask', async (req, res) => {
  const { query, threadId, scopeDocumentIds } = req.body ?? {};

  if (typeof query !== 'string' || !query.trim()) {
    return res.status(400).json({ error: 'Query text is required.' });
  }
  if (query.length > MAX_QUERY_CHARS) {
    return res.status(400).json({ error: `Query exceeds ${MAX_QUERY_CHARS} characters.` });
  }
  if (threadId !== undefined && !mongoose.Types.ObjectId.isValid(threadId)) {
    return res.status(400).json({ error: 'threadId is not a valid id.' });
  }
  if (scopeDocumentIds !== undefined && !isArrayOfObjectIds(scopeDocumentIds)) {
    return res.status(400).json({ error: 'scopeDocumentIds must be an array of document ids.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');   // no-transform stops proxy buffering
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');                   // nginx: disable response buffering
  res.flushHeaders();

  const emit = (event, data) => {
    if (res.writableEnded) return;
    res.write(`data: ${JSON.stringify({ event, ...data })}\n\n`);
  };

  // Client disconnect (tab closed, Stop pressed) aborts the graph so an abandoned
  // request stops burning generation tokens rather than streaming into a dead socket.
  const abort = new AbortController();
  req.on('close', () => { if (!res.writableEnded) abort.abort(); });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n');     // comment frame; ignored by EventSource
  }, 15_000);

  try {
    const conversationId = threadId ?? (await Conversation.create({}))._id;
    // Emitted before the graph runs at all — deliberately earlier than §9.1's table
    // shows, because a brand-new thread's id must reach the client even if the request
    // then errors or gets aborted before the `telemetry` frame (the only other place the
    // id appears). Without this, a first turn that fails after thread creation leaves the
    // client with no id to resume, and a retry silently spawns a second empty thread.
    emit('threadId', { threadId: conversationId });

    const final = await ragGraph.invoke(
      { query, threadId: conversationId, scopeDocumentIds: scopeDocumentIds ?? null },
      { configurable: { emit }, signal: abort.signal, runName: 'ragGraph', runId: randomUUID() },
    );

    await persistTurn(conversationId, query, final);
    emit('telemetry', { threadId: conversationId, telemetry: final.timings, warnings: final.warnings });
    res.write('data: [DONE]\n\n');
  } catch (err) {
    if (err.name === 'AbortError') return;    // client left; nothing to report
    console.error('[ask] request failed:', err);
    emit('error', { error: err.message });
  } finally {
    clearInterval(heartbeat);
    res.end();
  }
});

// ── Event envelope (phase 5 §9.1, extended with `threadId`) ─────────────────────────
// Every frame carries an `event` discriminator, replacing the legacy stream's implicit
// shape-sniffing (`if (parsed.sources)` / `if (parsed.token)`):
//
//   threadId   { threadId }                    once, first — before the graph even runs
//   sources    { sources: [...] }               once, before the first token
//   token      { token: "…" }                   per generated token
//   telemetry  { telemetry: {...}, warnings }   once, after generation
//   error      { error: "…" }                   on failure, terminal
//   [DONE]     raw sentinel                      always last on success
//
// The 15-second heartbeat exists because a slow first token (a cold Ollama model can
// take 20+ s) looks identical to a dead connection to intermediaries; proxies and load
// balancers commonly close idle connections at 30-60 s. A comment frame keeps the socket
// demonstrably alive without the client needing to handle it.

export default router;
