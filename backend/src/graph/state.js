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
  // Phase 6 §2: { userId, contextId } — built once by requireContext and carried
  // unchanged through every node that reaches Qdrant (retrieve, rerank).
  tenant:           Annotation({ reducer: (_, next) => next }),

  // ── Derived ───────────────────────────────────────────────────────────
  history:          Annotation({ reducer: (_, next) => next, default: () => [] }),
  condensedQuery:   Annotation({ reducer: (_, next) => next, default: () => null }),
  candidates:       Annotation({ reducer: (_, next) => next, default: () => [] }),
  sources:          Annotation({ reducer: (_, next) => next, default: () => [] }),
  answer:           Annotation({ reducer: (_, next) => next, default: () => '' }),

  // Phase 7 §2.2, task 7.3: the full pre-floor candidate set, normalized to Trace.js's
  // CandidateSchema shape and stamped with belowFloor — set once by rerankNode and never
  // touched again (generateNode/noContextNode return no `allCandidates` key, so the
  // last-write-wins reducer never sees a second write to clobber it).
  allCandidates:    Annotation({ reducer: (_, next) => next, default: () => [] }),
  // Phase 7 §2.2, task 7.2: the exact prompt blocks the model received, set once by
  // generateNode.
  promptBlocks:     Annotation({ reducer: (_, next) => next, default: () => [] }),
  // Phase 7 §2.2: the raw provider usage the graph observed, forwarded onto state so
  // persistTurn can build Trace.tokens without re-deriving it from llm.js's own
  // recordGenerationUsage call (which writes UsageEvent but returns nothing to the caller).
  usage:            Annotation({ reducer: (_, next) => next, default: () => null }),
  // Phase 7 §2.5: stamped true only by noContextNode — the one place FR-GEN-03's refusal
  // actually runs.
  refused:          Annotation({ reducer: (_, next) => next, default: () => false }),

  // ── Accumulated ───────────────────────────────────────────────────────
  // Append, never replace: each node contributes its own timings and the graph
  // ends holding all of them. A last-write-wins reducer here would leave only
  // the final node's numbers, which is exactly the telemetry bug this avoids.
  timings:  Annotation({ reducer: (prev = {}, next) => ({ ...prev, ...next }), default: () => ({}) }),
  warnings: Annotation({ reducer: (prev = [], next) => [...prev, ...next],   default: () => [] }),

  // ── Control ───────────────────────────────────────────────────────────
  emptyReason: Annotation({ reducer: (_, next) => next, default: () => null }),
});
