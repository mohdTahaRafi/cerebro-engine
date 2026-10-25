import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';
import { ChatGroq } from '@langchain/groq';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { config } from '../config/index.js';
import { wrap } from './breaker.js';
import { recordUsage } from '../telemetry/usage.js';

// architecture §5.8: Claude Sonnet 5 primary, switched via LLM_PROVIDER — an operator
// decision, never an automatic runtime one (architecture §6.2: Anthropic failure returns
// 503 rather than silently degrading answer quality). Two fallbacks, chosen for different
// reasons: Ollama is the fully-offline option (no network dependency at all, but every
// deployer needs their own model pulled locally — see deployment.md §3.4/§8). Groq is the
// zero-local-setup option — a hosted, OpenAI-compatible API with a free tier (no card,
// 30k tokens/min, 14.4k requests/day as of the models this project targets) — so a
// deployment needs only an API key, the same shape as the Anthropic path, with none of
// Ollama's "the host machine IS the inference server" requirement. Gemini (added
// 2026-10-15, deployment.md §3.5) is the same hosted, key-only shape as Groq, but its
// models are natively multimodal, so scanned-page sources are read from the page image
// rather than from OCR text alone.

// Gemini 2.5+ models think before answering, and the thoughts are generated inside the
// same maxOutputTokens budget as the visible answer — the mechanism that made every
// gpt-oss condense call return empty text at 150 tokens (condense.js). Callers pass
// maxTokens as the visible answer they need (condense 1024, generate 2048), so the Gemini
// branch adds this allowance on top for the thinking. It is a ceiling, not a cost: a call
// is billed for the tokens it generates, not for the room it was given.
export const GEMINI_THINKING_HEADROOM = 4096;
export function chatModel({ temperature = 0, maxTokens = 1024 } = {}) {
  if (config.llm.provider === 'ollama') {
    return new ChatOllama({
      baseUrl: config.llm.ollama.baseUrl,
      model: config.llm.ollama.model,
      temperature,
    });
  }
  if (config.llm.provider === 'gemini') {
    return new ChatGoogleGenerativeAI({
      apiKey: config.llm.gemini.apiKey,
      model: config.llm.gemini.model,
      temperature,
      maxOutputTokens: maxTokens + GEMINI_THINKING_HEADROOM,
    });
  }
  if (config.llm.provider === 'groq') {
    return new ChatGroq({
      apiKey: config.llm.groq.apiKey,
      model: config.llm.groq.model,
      temperature,
      maxTokens,
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

// Phase 5 §7.3: an explicit FR-GEN edge case is LLM_PROVIDER=ollama/groq configured with
// a text-only model while a visual (scanned-page) source was retrieved. Claude always
// reads images; a self-hosted Ollama model or a Groq model only does if it's one of the
// known vision-capable families. When this returns false the generate node omits the
// image content blocks entirely (OCR text is still supplied) and emits a warning — the
// answer degrades to OCR-quality rather than the request failing outright.
//
// 'scout'/'maverick' cover Groq's Llama 4 vision-capable models where an account has
// access to them — verified live 2026-08-17 that this project's own Groq key does not
// (its `GET /v1/models` lists no vision-capable chat model at all: text models only,
// plus audio/guard/agentic ones). This pattern is deliberately name-based rather than a
// hardcoded allowlist for the same reason config/index.js's groq default comment gives:
// Groq's actual per-account model lineup does not reliably match what's documented
// publicly, so matching by name degrades to OCR-quality automatically if a configured
// model is renamed, withdrawn, or was never on the account to begin with, rather than
// erroring. The config default (openai/gpt-oss-120b) is text-only regardless.
//
// gpt-oss models emit a separate `reasoning` field before `content` (visible via a raw
// API response, collapsed into `.content` by LangChain) and reasoning tokens count
// against maxTokens — a tight budget (ping()'s maxTokens: 5) can be fully consumed by
// reasoning, returning empty content with finish_reason "length" rather than an error.
// ping() never inspects content, only that the call resolves, so this doesn't break
// /health. condense.js was the exception that did break: its original 150-token budget
// was consumed by reasoning on every call (raised to 1024 — see its comment).
const VISION_MODEL_PATTERN = /vision|llava|llama3\.2-vision|qwen2?-vl|scout|maverick/i;

export function supportsVision(providerConfig) {
  if (providerConfig.provider === 'anthropic') return true;
  if (providerConfig.provider === 'gemini') return true;   // every current Gemini model takes images
  if (providerConfig.provider === 'groq') return VISION_MODEL_PATTERN.test(providerConfig.groq.model);
  return VISION_MODEL_PATTERN.test(providerConfig.ollama.model);
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
