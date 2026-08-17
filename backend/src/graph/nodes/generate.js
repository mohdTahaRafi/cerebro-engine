// generate — grounded, streaming answer generation (phase 5 §7). Assembles the
// multimodal prompt, streams tokens over the SSE emit function injected by the route,
// and records the real cost of the call.
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import * as llm from '../../providers/llm.js';
import * as storage from '../../providers/storage.js';
import { config as appConfig } from '../../config/index.js';
import { SYSTEM_PROMPT } from '../prompts.js';

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
async function buildUserMessage(state, visionCapable) {
  const query = state.condensedQuery ?? state.query;
  const content = [];
  const textBlocks = [];

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
      } catch (err) {
        // A missing/unreadable page image degrades to text-only for that one source
        // rather than failing the whole answer — the OCR text is still in textBlocks.
        console.warn(`[generate] failed to read page image for source [${n}]:`, err.message);
      }
    }
  }

  content.unshift({
    type: 'text',
    text: `<sources>\n${textBlocks.join('\n\n')}\n</sources>\n\nQuestion: ${query}`,
  });
  return new HumanMessage({ content });
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

  let answer = '', firstTokenMs = null, usage = null;
  try {
    const stream = await model.stream([
      new SystemMessage(SYSTEM_PROMPT),
      ...state.history.map(toLangChainMessage),
      await buildUserMessage(state, visionCapable),
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
    timings: { firstTokenMs, generateMs: Math.round(performance.now() - t0), generateStartAt: t0 },
    warnings,
  };
}
