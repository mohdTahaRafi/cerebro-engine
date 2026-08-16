// RagState — the LangGraph channel set for the conversational RAG graph (phase 5 §2).
// Explicit reducers on every channel: LangGraph merges a node's partial return into state
// by field, and the reducer is what decides HOW each field merges. Getting these wrong is
// what causes the class of bug where one node's return silently clobbers another's —
// `timings` and `warnings` below are accumulate-across-nodes fields, everything else is
// last-write-wins.
import { Annotation } from '@langchain/langgraph';

export const RagState = Annotation.Root({
  // ── Inputs ────────────────────────────────────────────────────────────
  query:            Annotation({ reducer: (_, next) => next }),
  threadId:         Annotation({ reducer: (_, next) => next }),
  scopeDocumentIds: Annotation({ reducer: (_, next) => next, default: () => null }),

  // ── Derived ───────────────────────────────────────────────────────────
  history:          Annotation({ reducer: (_, next) => next, default: () => [] }),
  condensedQuery:   Annotation({ reducer: (_, next) => next, default: () => null }),
  candidates:       Annotation({ reducer: (_, next) => next, default: () => [] }),
  sources:          Annotation({ reducer: (_, next) => next, default: () => [] }),
  answer:           Annotation({ reducer: (_, next) => next, default: () => '' }),

  // ── Accumulated ───────────────────────────────────────────────────────
  // Append, never replace: each node contributes its own timings and the graph
  // ends holding all of them. A last-write-wins reducer here would leave only
  // the final node's numbers, which is exactly the telemetry bug this avoids.
  timings:  Annotation({ reducer: (prev = {}, next) => ({ ...prev, ...next }), default: () => ({}) }),
  warnings: Annotation({ reducer: (prev = [], next) => [...prev, ...next],   default: () => [] }),

  // ── Control ───────────────────────────────────────────────────────────
  emptyReason: Annotation({ reducer: (_, next) => next, default: () => null }),
});
