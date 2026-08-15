import { ChatAnthropic } from '@langchain/anthropic';
import { ChatOllama } from '@langchain/ollama';
import { config } from '../config/index.js';
import { wrap } from './breaker.js';

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
