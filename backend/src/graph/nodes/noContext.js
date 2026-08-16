// noContext — the graph's refusal path (phase 5 §8). Reached only when rerank produced
// zero sources, so "I don't know" costs zero generation tokens and cannot be talked out
// of by a persuasive query. The refusal is a fixed string, not a model output, which
// makes FR-GEN-03 mechanically guaranteed rather than prompt-dependent.
import { MESSAGES } from '../prompts.js';

export async function noContextNode(state, config) {
  const emit = config.configurable.emit;
  const answer = MESSAGES[state.emptyReason] ?? MESSAGES.no_relevant_matches;
  emit('sources', { sources: [] });
  emit('token', { token: answer });     // same event shape as generation, so the client needs no branch
  return { answer };
}
