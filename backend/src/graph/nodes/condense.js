// condense — rewrites the user's question into a standalone search query using thread
// history and the context's document names (phase 5 §5, amended 2026-10-15). Runs on
// every turn, including the first: a first question can be just as vague ("who is the
// person?" in a one-document context) and the document list is what resolves it. The only
// turn it skips the LLM call on is one with no history AND no ready documents — there is
// nothing to resolve the question against, and retrieval will refuse an empty corpus anyway.
import * as llm from '../../providers/llm.js';
import { loadContextDocuments } from '../contextDocuments.js';
import { CONDENSE_PROMPT } from '../prompts.js';

// A file name is ~10–20 tokens, so 25 names stay under ~500 prompt tokens. Past ~25 a
// vague "the document" can't be pinned to one file anyway; the most recently updated ones
// are listed because a follow-up is most likely about what the user just uploaded.
export const MAX_LISTED_DOCUMENTS = 25;

// Ready documents in the request's context, by file name (graph/contextDocuments.js).
async function loadDocumentNames(tenant) {
  return (await loadContextDocuments(tenant, { limit: MAX_LISTED_DOCUMENTS })).names;
}

// 1024, not the original 150: reasoning models (Groq's openai/gpt-oss-120b, the configured
// provider) spend hidden reasoning tokens out of the same max_tokens budget before emitting
// any visible text. Verified live: at 150 every condense call hit finish_reason 'length'
// with empty content, so the guardrail below rejected it and every follow-up ("who is the
// person?") was retrieved on its raw, context-free wording. At 1024 the same call stops
// naturally at ~200 tokens. The cap is a ceiling, not a cost — the length guardrail below
// still rejects a runaway rewrite.
export const CONDENSE_MAX_TOKENS = 1024;
export const CONDENSE_TEMPERATURE = 0;

export async function condenseNode(state, config) {
  const t0 = performance.now();
  const history = state.history ?? [];
  // `documentNames` on the incoming state is a test seam (test/graph/condense.test.js
  // calls this node directly, with no Mongo connection); it is not a graph channel, so
  // under ragGraph it is always undefined and the names come from the context.
  const documentNames = state.documentNames ?? await loadDocumentNames(state.tenant);

  if (history.length === 0 && documentNames.length === 0) {
    return { condensedQuery: state.query, warnings: [] };
  }

  const model = llm.chatModel({ temperature: CONDENSE_TEMPERATURE, maxTokens: CONDENSE_MAX_TOKENS });

  try {
    // Replacement *functions*, not strings: String.prototype.replace interprets `$&`,
    // `$'` and friends inside a replacement string, and both file names and chat
    // messages are user-controlled text that can contain them.
    const res = await model.invoke(
      CONDENSE_PROMPT
        .replace('{documents}', () => (documentNames.length > 0
          ? documentNames.map((name) => `- ${name}`).join('\n')
          : '(no documents listed)'))
        .replace('{history}', () => (history.length > 0
          ? history.map((m) => `${m.role}: ${m.content}`).join('\n')
          : '(no earlier messages)'))
        .replace('{question}', () => state.query),
      { signal: config?.signal },
    );

    const condensed = res.text.trim();   // `.text`: string or multi-part content alike

    // Guardrail: a condenser that returns something absurdly long or empty has
    // misbehaved (it summarized the conversation instead of rewriting the question).
    // Falling back to the raw query is always safe — worst case the follow-up is
    // under-specified, which is strictly better than retrieving on garbage.
    const usable = condensed.length > 0 && condensed.length <= state.query.length * 8 + 200;

    return {
      condensedQuery: usable ? condensed : state.query,
      // condenseStartAt (phase 6 §2.2): the absolute performance.now() instant this stage
      // began, converted to an offset from the request origin by buildTelemetry. Emitted
      // on both the success and failure paths — a condensation that failed still occupied
      // real wall-clock time the waterfall must account for.
      timings: { condenseMs: Math.round(performance.now() - t0), condenseStartAt: t0 },
      warnings: usable ? [] : ['Query condensation produced an unusable result; used the original question.'],
    };
  } catch (err) {
    // Condensation is an optimization, never a requirement. Its failure must not
    // fail the request — retrieval on the raw follow-up still usually works.
    return {
      condensedQuery: state.query,
      timings: { condenseMs: Math.round(performance.now() - t0), condenseStartAt: t0 },
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
