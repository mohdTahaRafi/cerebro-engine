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
