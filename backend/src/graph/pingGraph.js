// THROWAWAY — proves the LangGraph runtime and the tracing pipeline both work
// before Phase 5 depends on them. Phase 5 deletes this file and replaces it with
// ragGraph.js (phase 1 §9.2).
import { StateGraph, Annotation, END, START } from '@langchain/langgraph';

const PingState = Annotation.Root({
  input:  Annotation({ reducer: (_, next) => next }),
  steps:  Annotation({ reducer: (prev = [], next) => [...prev, ...next] }),
  output: Annotation({ reducer: (_, next) => next }),
});

const graph = new StateGraph(PingState)
  .addNode('normalize', async (state) => ({
    steps: ['normalize'],
    input: state.input.trim().toLowerCase(),
  }))
  .addNode('respond', async (state) => ({
    steps: ['respond'],
    output: `pong: ${state.input}`,
  }))
  .addEdge(START, 'normalize')
  .addEdge('normalize', 'respond')
  .addEdge('respond', END);

export const pingGraph = graph.compile();
