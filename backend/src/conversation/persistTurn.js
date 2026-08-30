// persistTurn — writes both sides of an exchange once the graph run has finished (phase
// 5 §10). Runs AFTER the stream completes, never incrementally, so a failed or aborted
// generation does not leave a half-written assistant message in the thread.
//
// Phase 7 §2.4: also writes the Trace for this turn, in the same call, after the
// assistant message has an `_id` (Trace.messageId is required and unique). The trace
// write is failure-isolated — a failure is caught and logged, and the turn still
// persists, because a trace is an inspection artifact and must never be able to lose a
// user's conversation.
import { Message } from '../models/Message.js';
import { Conversation } from '../models/Conversation.js';
import { Trace } from '../models/Trace.js';
import { buildTrace } from '../telemetry/traceCapture.js';
import { recordPipelineError } from '../telemetry/pipelineError.js';

export async function persistTurn(conversationId, tenant, userQuery, final, { telemetry, runId } = {}) {
  await Message.create({
    conversationId, userId: tenant.userId, role: 'user', content: userQuery,
    condensedQuery: final.condensedQuery ?? null,
  });
  const assistantMessage = await Message.create({
    conversationId, userId: tenant.userId, role: 'assistant', content: final.answer,
    sources: final.sources.map((s) => ({
      kind: s.kind === 'page' ? 'page' : 'chunk',
      pointId: s.pointId, documentId: s.documentId, page: s.page ?? null, score: s.score,
    })),
  });

  // Title the thread from its first question, truncated on a word boundary.
  const convo = await Conversation.findById(conversationId);
  if (convo.title === 'New conversation') {
    convo.title = userQuery.length <= 60 ? userQuery : `${userQuery.slice(0, 57).replace(/\s+\S*$/, '')}…`;
  }
  convo.lastMessageAt = new Date();
  await convo.save();

  let traceId = null;
  try {
    const doc = buildTrace({
      tenant, threadId: conversationId, messageId: assistantMessage._id,
      state: final, telemetry, runId, usage: final.usage,
    });
    const trace = await Trace.create(doc);
    traceId = trace._id;
  } catch (err) {
    console.error('[persistTurn] failed to write trace:', err.message);
    await recordPipelineError('trace', err, {
      userId: tenant.userId, contextId: tenant.contextId, retryable: false,
    });
  }

  return { traceId };
}

// persistFailedTurn — writes only the user's half of an exchange when the graph run
// throws (ask.js's catch block) after the thread already exists. Conversation.create
// and the `threadId` SSE frame both happen before ragGraph.invoke (ask.js), so by the
// time a failure can occur the client has already echoed the question into its own
// transcript state — but that state lives only in the browser (useTranscript's `turns`
// array) and is never durable. Without this, a failed turn leaves zero Message docs
// behind: navigating away or hard-refreshing has nothing to reload, and the question
// silently vanishes even though the user watched it get asked.
//
// The assistant side is deliberately never written here — there is no real content for
// a role: 'assistant' message that never generated a reply, and Message.content is
// required (models/Message.js). The absence of a paired assistant message IS the
// persisted signal that this turn failed: useTranscript.ts's loadTranscript reconstructs
// `status: 'error'` for exactly this shape (a user message with no assistant message
// immediately after it) rather than needing a stored error string.
export async function persistFailedTurn(conversationId, tenant, userQuery) {
  await Message.create({ conversationId, userId: tenant.userId, role: 'user', content: userQuery });

  // Same titling rule as persistTurn's success path (§ above) — a thread whose first-ever
  // turn failed should still pick up a real title from that question rather than sitting
  // as "New conversation" forever.
  const convo = await Conversation.findById(conversationId);
  if (convo.title === 'New conversation') {
    convo.title = userQuery.length <= 60 ? userQuery : `${userQuery.slice(0, 57).replace(/\s+\S*$/, '')}…`;
  }
  convo.lastMessageAt = new Date();
  await convo.save();
}
