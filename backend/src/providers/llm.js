import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';
import { config } from '../config/index.js';
import { wrap } from './breaker.js';
import { recordUsage } from '../telemetry/usage.js';

// architecture §5.8: Claude Sonnet 5 primary, Ollama llama3.2-vision:11b fallback,
// switched via LLM_PROVIDER — an operator decision, never an automatic runtime one
// (architecture §6.2: Anthropic failure returns 503 rather than silently degrading
// answer quality).
export function chatModel({ temperature = 0, maxTokens = 1024 } = {}) {
  if (config.llm.provider === 'ollama') {
    return new ChatOllama({
      baseUrl: config.llm.ollama.baseUrl,
      model: config.llm.ollama.model,
      temperature,
    });
  }
  return new ChatAnthropic({
    apiKey: config.llm.anthropic.apiKey,
    model: config.llm.anthropic.model,
    temperature,
    maxTokens,
  });
}

// architecture §6.1: a long grounded answer streams for up to ~90s; the breaker guards
// a hung socket, not slowness. Phase 1 only exercises this with a trivial ping; Phase 5's
// generation node fires the same breaker with the real prompt.
const llmBreaker = wrap('llm.generate', (model, input) => model.invoke(input), { timeout: 120_000 });

// Phase 1 only implements chatModel() + ping(). Streaming generation lands in Phase 5.
export async function ping() {
  const model = chatModel({ temperature: 0, maxTokens: 5 });
  await llmBreaker.fire(model, 'Reply with the single word: pong');
}

// Phase 5 §7.3: an explicit FR-GEN edge case is LLM_PROVIDER=ollama configured with a
// text-only model while a visual (scanned-page) source was retrieved. Claude always
// reads images; a self-hosted Ollama model only does if it's one of the known
// vision-capable model families. When this returns false the generate node omits the
// image content blocks entirely (OCR text is still supplied) and emits a warning —
// the answer degrades to OCR-quality rather than the request failing outright.
export function supportsVision(providerConfig) {
  if (providerConfig.provider === 'anthropic') return true;
  return /vision|llava|llama3\.2-vision|qwen2?-vl/i.test(providerConfig.ollama.model);
}

// Streaming itself needs no wrapper here — chatModel() returns a LangChain ChatModel and
// the generate node calls its standard .stream() directly (phase 5 §7.4). This function
// is the token-accounting half of that same node: one UsageEvent row per completed
// generation call, independent of the zero-cost noContext path (§8), which never calls
// this at all — that's what makes "zero generation tokens for a refusal" true in
// UsageEvent rather than merely true in the response body.
//
// Anthropic and Ollama both surface token counts via LangChain's usage_metadata on
// streamed chunks, but not reliably on *every* chunk — only the last chunk is guaranteed
// to carry the final totals, and some Ollama versions omit it entirely. The generate node
// therefore passes whatever it last saw; a missing count is recorded as 0/0 rather than
// skipping the row, because a UsageEvent that undercounts is still evidence a call
// happened, which a missing row is not.
export async function recordGenerationUsage({ provider, usage, requestId }) {
  await recordUsage({
    provider,
    operation: 'generate',
    inputTokens: usage?.input_tokens ?? 0,
    outputTokens: usage?.output_tokens ?? 0,
    requestId,
  });
}
