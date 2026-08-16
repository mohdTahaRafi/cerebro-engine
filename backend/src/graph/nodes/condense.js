// condense — rewrites a follow-up question into a standalone one using thread history
// (phase 5 §5). Only reached when history is non-empty (ragGraph.js's conditional edge
// skips this node entirely on a first turn).
import * as llm from '../../providers/llm.js';
import { CONDENSE_PROMPT } from '../prompts.js';

export const CONDENSE_MAX_TOKENS = 150;
export const CONDENSE_TEMPERATURE = 0;

export async function condenseNode(state, config) {
  const t0 = performance.now();
  const model = llm.chatModel({ temperature: CONDENSE_TEMPERATURE, maxTokens: CONDENSE_MAX_TOKENS });

  try {
    const res = await model.invoke(
      CONDENSE_PROMPT
        .replace('{history}', state.history.map((m) => `${m.role}: ${m.content}`).join('\n'))
        .replace('{question}', state.query),
      { signal: config?.signal },
    );

    const condensed = res.content.trim();

    // Guardrail: a condenser that returns something absurdly long or empty has
    // misbehaved (it summarized the conversation instead of rewriting the question).
    // Falling back to the raw query is always safe — worst case the follow-up is
    // under-specified, which is strictly better than retrieving on garbage.
    const usable = condensed.length > 0 && condensed.length <= state.query.length * 8 + 200;

    return {
      condensedQuery: usable ? condensed : state.query,
      timings: { condenseMs: Math.round(performance.now() - t0) },
      warnings: usable ? [] : ['Query condensation produced an unusable result; used the original question.'],
    };
  } catch (err) {
    // Condensation is an optimization, never a requirement. Its failure must not
    // fail the request — retrieval on the raw follow-up still usually works.
    return {
      condensedQuery: state.query,
      timings: { condenseMs: Math.round(performance.now() - t0) },
      warnings: [`Query condensation unavailable: ${err.message}`],
    };
  }
}

// ── The topic-switch case (phase 5 §5.1) ────────────────────────────────────────────
// FR-CONV's edge case "abrupt topic change mid-thread" is handled by the prompt's
// "If the follow-up is already standalone, return it unchanged" instruction rather than
// by a classifier. A genuinely new question ("what is our parental leave policy?" after
// three turns about revenue) is already standalone, so the condenser returns it untouched
// and the stale context never reaches retrieval. This is why the instruction lives in the
// prompt rather than being left implicit — without it, models reliably drag prior topics
// into the rewrite.
