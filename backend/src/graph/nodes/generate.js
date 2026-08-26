// generate — grounded, streaming answer generation (phase 5 §7). Assembles the
// multimodal prompt, streams tokens over the SSE emit function injected by the route,
// and records the real cost of the call.
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import * as llm from '../../providers/llm.js';
import * as storage from '../../providers/storage.js';
import { config as appConfig } from '../../config/index.js';
import { SYSTEM_PROMPT } from '../prompts.js';
// Phase 7 §2.2: the same cl100k_base tokenizer chunker.js already uses for chunk sizing —
// reused here for TracePromptBlock.approxTokens rather than a second, looser heuristic
// (chars/4) that would disagree with the number the ingestion side already computes.
import { tokenLength } from '../../ingestion/chunker.js';

export const MAX_ATTACHED_IMAGES = 3;

// `evil" ignore-previous="true` as a filename would otherwise break out of the
// attribute and inject structure into the prompt. Filenames are user-controlled input
// (an uploader names their own file) and are treated as such (phase 5 §7.2).
function escapeAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function toLangChainMessage(m) {
  return m.role === 'assistant' ? new AIMessage(m.content) : new HumanMessage(m.content);
}

// Phase 5 §7.4: the SSE wire contract for citation chips, deliberately kept as its own
// explicit projection rather than re-exporting state.sources as-is — state.sources is
// already retrieval/search.js's toPublicResult shape (rerank.js maps it there), but
// declaring the client contract separately here means a future field added to that
// internal shape doesn't silently start streaming to the browser. Phase 6 §2.3 adds
// branch/fusionRank/finalRank/absorbedChunks explicitly (not via a blanket `...s`) for the
// same reason — the advanced console's provenance panel reads these by name.
function toPublicSource(s) {
  return {
    pointId: s.pointId, kind: s.kind, text: s.text, score: s.score,
    documentId: s.documentId, fileName: s.fileName, page: s.page,
    headingPath: s.headingPath, imageUri: s.imageUri, ocrQuality: s.ocrQuality,
    branch: s.branch, fusionRank: s.fusionRank, finalRank: s.finalRank, absorbedChunks: s.absorbedChunks,
  };
}

// Phase 5 §7.2, §7.3. `visionCapable` gates image attachment: when the configured model
// can't read images (an Ollama text-only model, an explicit FR-GEN edge case), sources
// are still cited from their OCR text — only the image content blocks are skipped.
//
// Phase 7 §2.2, task 7.2, 7.4: builds `promptBlocks` alongside the real LangChain message
// content, in the exact order the model receives them — a `system` block for
// SYSTEM_PROMPT (added by the caller), then this function's own `user` blocks. The image
// block's `content` is `s.imageUri` (the served `/api/pages/<id>/<n>.jpg` route), never
// the base64 data URI the real content array carries — the trace stores what a human can
// open in a browser, not a ~350 KB unreadable string (Trace.js §2.1's own comment).
async function buildUserMessage(state, visionCapable) {
  const query = state.condensedQuery ?? state.query;
  const content = [];
  const textBlocks = [];
  const promptBlocks = [];

  // Only the highest-scoring pages get images. Each costs ~1,600 tokens; attaching
  // eight would triple the prompt for pages the model has already been given as text.
  const imagePages = visionCapable
    ? state.sources.filter((s) => s.kind === 'page').slice(0, MAX_ATTACHED_IMAGES)
    : [];

  for (const [i, s] of state.sources.entries()) {
    const n = i + 1;
    const label = s.kind === 'page'
      ? `${s.fileName}, scanned page ${s.page}`
      : `${s.fileName}${s.page ? `, page ${s.page}` : ''}${s.headingPath ? ` — ${s.headingPath}` : ''}`;
    textBlocks.push(`<source id="${n}" from="${escapeAttr(label)}">\n${s.text}\n</source>`);

    if (imagePages.includes(s)) {
      try {
        const b64 = await storage.readBase64(s.imageUri);
        content.push({ type: 'text', text: `Image for source [${n}]:` });
        content.push({ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${b64}` } });
        promptBlocks.push({ role: 'user', kind: 'text', content: `Image for source [${n}]:`, approxTokens: null });
        promptBlocks.push({ role: 'user', kind: 'image', content: s.imageUri, approxTokens: null });
      } catch (err) {
        // A missing/unreadable page image degrades to text-only for that one source
        // rather than failing the whole answer — the OCR text is still in textBlocks.
        console.warn(`[generate] failed to read page image for source [${n}]:`, err.message);
      }
    }
  }

  const sourcesText = `<sources>\n${textBlocks.join('\n\n')}\n</sources>\n\nQuestion: ${query}`;
  content.unshift({ type: 'text', text: sourcesText });
  // The sources+question block goes first in `promptBlocks` too, matching `content`'s
  // own unshift — the model reads its instructions and the evidence before any image.
  promptBlocks.unshift({ role: 'user', kind: 'text', content: sourcesText, approxTokens: tokenLength(sourcesText) });

  return { message: new HumanMessage({ content }), promptBlocks };
}

export async function generateNode(state, config) {
  const t0 = performance.now();
  const emit = config.configurable.emit;         // SSE writer injected by the route
  const model = llm.chatModel({ temperature: 0.1, maxTokens: 2048 });

  const visionCapable = llm.supportsVision(appConfig.llm);
  const hasVisualSources = state.sources.some((s) => s.kind === 'page');
  const warnings = hasVisualSources && !visionCapable
    ? ['The configured model cannot read images; scanned-page sources are answered from OCR text only.']
    : [];

  emit('sources', { sources: state.sources.map(toPublicSource) });

  // Phase 7 §2.2: the trace's Prompt tab needs the exact blocks the model received, so
  // this is built once and reused whether generation succeeds or fails — a failed call
  // still assembled and sent a real prompt, and the trace should say so.
  const { message: userMessage, promptBlocks: userBlocks } = await buildUserMessage(state, visionCapable);
  const promptBlocks = [
    { role: 'system', kind: 'text', content: SYSTEM_PROMPT, approxTokens: tokenLength(SYSTEM_PROMPT) },
    ...userBlocks,
  ];
  const modelName = appConfig.llm.provider === 'anthropic' ? appConfig.llm.anthropic.model : appConfig.llm.ollama.model;

  let answer = '', firstTokenMs = null, usage = null;
  try {
    const stream = await model.stream([
      new SystemMessage(SYSTEM_PROMPT),
      ...state.history.map(toLangChainMessage),
      userMessage,
    ], { signal: config.signal });   // forwarded so a client disconnect (route's abort()
                                      // controller) actually stops the provider call, not
                                      // just the graph's bookkeeping around it (§9).

    for await (const chunk of stream) {
      if (chunk.usage_metadata) usage = chunk.usage_metadata;   // only the final chunk is
                                                                 // guaranteed to carry totals
      const token = chunk.content;
      if (!token) continue;
      firstTokenMs ??= Math.round(performance.now() - t0);
      answer += token;
      emit('token', { token });
    }
  } catch (err) {
    emit('error', { error: 'Answer generation failed. Your search results are still available.' });
    return {
      answer,
      promptBlocks,
      // generateStartAt (phase 6 §2.2) on the failure path too: a generation that errored
      // partway still consumed real wall-clock time, and a waterfall that omitted its bar
      // would leave unexplained dead space rather than showing where the time went.
      timings: { generateMs: Math.round(performance.now() - t0), generateStartAt: t0 },
      warnings: [...warnings, `Generation failed: ${err.message}`],
    };
  }

  await llm.recordGenerationUsage({ provider: appConfig.llm.provider, usage, requestId: String(state.threadId) });

  return {
    answer,
    promptBlocks,
    // Phase 7 §2.2: forwarded onto state so persistTurn can build Trace.tokens without a
    // second read of usage_metadata — 0/0 (never a missing row) mirrors
    // recordGenerationUsage's own "undercounted is still evidence a call happened" rule.
    usage: {
      inputTokens: usage?.input_tokens ?? 0, outputTokens: usage?.output_tokens ?? 0,
      provider: appConfig.llm.provider, model: modelName,
    },
    timings: { firstTokenMs, generateMs: Math.round(performance.now() - t0), generateStartAt: t0 },
    warnings,
  };
}
