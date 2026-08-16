// persistTurn — writes both sides of an exchange once the graph run has finished (phase
// 5 §10). Runs AFTER the stream completes, never incrementally, so a failed or aborted
// generation does not leave a half-written assistant message in the thread.
import { Message } from '../models/Message.js';
import { Conversation } from '../models/Conversation.js';

export async function persistTurn(conversationId, userQuery, final) {
  await Message.create({
    conversationId, role: 'user', content: userQuery,
    condensedQuery: final.condensedQuery ?? null,
  });
  await Message.create({
    conversationId, role: 'assistant', content: final.answer,
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
}
