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
import { buildTelemetry } from '../../telemetry/pipelineTelemetry.js';
import { recordPipelineTelemetry } from '../../telemetry/metrics.js';
import { config } from '../../config/index.js';

const router = express.Router();

const OBJECT_ID_RE = /^[a-f0-9]{24}$/i;

function isArrayOfObjectIds(value) {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && OBJECT_ID_RE.test(v));
}

// Phase 6 §6.2, §11: graceful shutdown waits for in-flight SSE streams (up to 30s) before
// closing the ingest worker and exiting — shutdown.js needs to know how many are still
// open, and there is no built-in Express/Node API for "count of active handlers on this
// route," so this route tracks its own. A plain Set of opaque tokens, not request objects
// themselves — shutdown.js only ever needs the count/emptiness, and holding response
// objects here would be an easy way to leak them past their natural lifecycle.
export const activeStreams = new Set();

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
  //
  // Listens on `res`, not `req` — verified live against Node 22 / Express 5: `req`
  // (IncomingMessage)'s 'close' event fires as soon as the *request* body has been fully
  // read (express.json() already did that before this handler even ran), not when the
  // underlying connection actually closes. Wiring the abort to `req.on('close', ...)`
  // therefore aborted every single request within milliseconds of it starting — the graph
  // never got to run, every reply was a silently-dropped AbortError, and the client saw
  // only the `threadId` frame before the stream ended. `res` (ServerResponse)'s 'close'
  // event is what actually correlates with the connection terminating; combined with the
  // `!res.writableEnded` guard it still no-ops on the ordinary "we finished, then the
  // socket closed" case.
  const abort = new AbortController();
  res.on('close', () => { if (!res.writableEnded) abort.abort(); });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': keepalive\n\n');     // comment frame; ignored by EventSource
  }, 15_000);

  const streamToken = Symbol('sse-stream');
  activeStreams.add(streamToken);

  const requestT0 = performance.now();
  // Generated up front (not left to LangGraph to assign) so it is known before the graph
  // runs and can be handed straight to `emit('telemetry', ...)` below — this is the same
  // id LangSmith records the root run under, which is what the console's deep link
  // (phase 6 §2.4) resolves.
  const runId = randomUUID();

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
      { configurable: { emit }, signal: abort.signal, runName: 'ragGraph', runId },
    );

    await persistTurn(conversationId, query, final);
    // totalMs is computed here, from the route's own request-entry timestamp, rather than
    // read off any single node's internal timer (phase 6 §2.1) — no individual node's
    // timer spans condense+retrieve+rerank+generate, so only the route itself can measure
    // the true end-to-end total the console's waterfall total bar shows.
    // requestT0 is both the total's origin and the waterfall's zero point (phase 6 §2.2):
    // every node's `*StartAt` instant is a raw performance.now() from this same process, so
    // buildTelemetry subtracts this one origin from all of them to place each bar on a
    // single real-elapsed-time axis.
    const telemetry = buildTelemetry(
      { ...final.timings, totalMs: Math.round(performance.now() - requestT0), warnings: final.warnings },
      requestT0,
    );
    recordPipelineTelemetry(telemetry);
    emit('telemetry', {
      threadId: conversationId,
      telemetry,
      runId,
      langsmith: config.tracing.enabled
        ? { orgId: config.tracing.orgId, project: config.tracing.project }
        : null,
    });
    res.write('data: [DONE]\n\n');
  } catch (err) {
    if (err.name === 'AbortError') return;    // client left; nothing to report
    console.error('[ask] request failed:', err);
    emit('error', { error: err.message });
  } finally {
    clearInterval(heartbeat);
    activeStreams.delete(streamToken);
    res.end();
  }
});

// ── Event envelope (phase 5 §9.1, extended with `threadId`) ─────────────────────────
// Every frame carries an `event` discriminator, replacing the legacy stream's implicit
// shape-sniffing (`if (parsed.sources)` / `if (parsed.token)`):
//
//   threadId   { threadId }                                       once, first — before the graph even runs
//   sources    { sources: [...] }                                  once, before the first token
//   token      { token: "…" }                                      per generated token
//   telemetry  { telemetry: PipelineTelemetry, runId, langsmith }  once, after generation
//   error      { error: "…" }                                      on failure, terminal
//   [DONE]     raw sentinel                                         always last on success
//
// Phase 6 §2.1, §2.4: `telemetry` is the full PipelineTelemetry shape (backend/src/
// telemetry/pipelineTelemetry.js) — warnings live at `telemetry.warnings`, not as a
// sibling field. `runId` and `langsmith` (null when tracing is disabled) are what the
// console's deep link builds `https://smith.langchain.com/o/{org}/projects/p/{project}/r/{runId}` from.
//
// The 15-second heartbeat exists because a slow first token (a cold Ollama model can
// take 20+ s) looks identical to a dead connection to intermediaries; proxies and load
// balancers commonly close idle connections at 30-60 s. A comment frame keeps the socket
// demonstrably alive without the client needing to handle it.

export default router;
