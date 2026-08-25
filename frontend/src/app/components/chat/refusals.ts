// phase_3_chat_ui.md §3.2 — mirrors backend/src/graph/prompts.js's MESSAGES verbatim.
// The backend's noContext node (backend/src/graph/nodes/noContext.js) returns one of these
// three fixed strings as the FULL, exact answer — no streaming, no citations, because
// retrieval genuinely produced nothing to cite. Detection is exact-match, not a heuristic:
// a turn's answer is a refusal iff it equals one of these strings exactly once streaming has
// finished. task 3.19's acceptance criterion is that this list and the backend's MESSAGES
// object contain the identical three strings — frontend/test/refusals.test.ts checks it by
// reading backend/src/graph/prompts.js's source rather than trusting this file to stay in
// sync on its own.
export const REFUSAL_MESSAGES = [
  'No documents have been ingested yet. Upload a document to ask questions about it.',
  'I could not find anything in your documents relevant to that question.',
  'Please enter a question.',
] as const;

export function isRefusal(answer: string): boolean {
  return (REFUSAL_MESSAGES as readonly string[]).includes(answer);
}
