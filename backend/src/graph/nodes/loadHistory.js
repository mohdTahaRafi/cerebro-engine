// loadHistory — the graph's entry node (phase 5 §4). Loads the most recent turns of a
// thread so condense/generate have conversational context; a brand-new thread (no
// threadId yet) has no history to load and the graph routes straight to retrieve.
import { Message } from '../../models/Message.js';

export const HISTORY_TURNS = 6;    // 3 exchanges — architecture §5.6

export async function loadHistoryNode(state) {
  if (!state.threadId) return { history: [] };

  // Sorting descending with a limit and then reversing in memory takes the **most
  // recent** 6 turns. Sorting ascending with a limit would take the oldest 6 — the exact
  // opposite — and would look correct in every test with fewer than 7 messages, which is
  // why it is spelled out here.
  const messages = await Message.find({ conversationId: state.threadId })
    .sort({ createdAt: -1 })
    .limit(HISTORY_TURNS)
    .lean();

  return { history: messages.reverse().map((m) => ({ role: m.role, content: m.content })) };
}
