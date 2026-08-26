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
  // Phase 7 §2.5: the only place `refused: true` is ever set — persistTurn/traceCapture
  // read this to mark the trace, and its candidates (rerankNode's `allCandidates`,
  // already on state) are every one of them `belowFloor: true` by construction, since the
  // graph only reaches this node when nothing cleared the floor.
  return { answer, refused: true };
}
