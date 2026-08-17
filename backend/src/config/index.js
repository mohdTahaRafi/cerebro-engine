import 'dotenv/config';

const REQUIRED = [
  'MONGO_URI',
  'QDRANT_URL',
  'REDIS_URL',
  'VISION_SERVICE_URL',
  'COHERE_API_KEY',
  'LLAMA_CLOUD_API_KEY',
];

function required(name) {
  const value = process.env[name];
  if (!value || value.trim() === '') return null;
  return value.trim();
}

const missing = REQUIRED.filter((k) => required(k) === null);
if (missing.length > 0) {
  console.error(`[config] Missing required environment variables:\n  ${missing.join('\n  ')}`);
  console.error('[config] Copy .env.example to .env and fill these in.');
  process.exit(1);
}

export const config = {
  port: Number(process.env.PORT ?? 5000),
  nodeEnv: process.env.NODE_ENV ?? 'development',

  mongo: { uri: required('MONGO_URI') },

  qdrant: {
    url: required('QDRANT_URL'),                       // http://localhost:6333 — @qdrant/js-client-rest
                                                        // is REST-only (no gRPC option); see architecture §5.11
    // `?? undefined` only catches null/undefined, not "" — and dotenv parses an empty
    // .env line (QDRANT_API_KEY=) to "", which the Qdrant client then treats as a real
    // (empty) key, triggering its "Api key is used with unsecure connection" warning
    // over plain HTTP. `|| undefined` normalizes "" to unset, matching the intent
    // (unset locally, set for Qdrant Cloud) — verified live against this exact warning.
    apiKey: process.env.QDRANT_API_KEY || undefined,
    chunksCollection: process.env.QDRANT_CHUNKS_COLLECTION ?? 'cerebro_chunks',
    pagesCollection: process.env.QDRANT_PAGES_COLLECTION ?? 'cerebro_pages',
  },

  redis: { url: required('REDIS_URL') },

  vision: {
    url: required('VISION_SERVICE_URL'),               // http://localhost:8100
    timeoutMs: Number(process.env.VISION_TIMEOUT_MS ?? 120_000), // 20 pages × ~6s
  },

  cohere: {
    apiKey: required('COHERE_API_KEY'),
    embedModel: process.env.COHERE_EMBED_MODEL ?? 'embed-multilingual-v3.0',
    rerankModel: process.env.COHERE_RERANK_MODEL ?? 'rerank-multilingual-v3.0',
    embedDimensions: 1024,                             // fixed by embed-multilingual-v3.0
  },

  llamaParse: { apiKey: required('LLAMA_CLOUD_API_KEY') },

  llm: {
    provider: process.env.LLM_PROVIDER ?? 'anthropic', // 'anthropic' | 'ollama'
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
    },
    ollama: {
      baseUrl: process.env.OLLAMA_API_URL ?? 'http://127.0.0.1:11434',
      model: process.env.OLLAMA_MODEL ?? 'llama3.2-vision:11b',
    },
  },

  storage: {
    driver: process.env.STORAGE_DRIVER ?? 'filesystem', // 'filesystem' | 's3'
    pagesDir: process.env.PAGE_STORAGE_DIR ?? './storage/pages',
    uploadsDir: process.env.UPLOAD_STORAGE_DIR ?? './storage/uploads',
    s3: {
      endpoint: process.env.S3_ENDPOINT,
      bucket: process.env.S3_BUCKET,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
  },

  tracing: {
    enabled: process.env.LANGCHAIN_TRACING_V2 === 'true',
    project: process.env.LANGCHAIN_PROJECT ?? 'cerebro',
    // Phase 6 §2.4: the advanced console's LangSmith deep link needs the org id to build
    // https://smith.langchain.com/o/{org}/projects/p/{project}/r/{runId} — LangSmith has
    // no API to resolve it from just an API key, so it is operator-supplied. Left unset,
    // the console renders the run id without a clickable link rather than a broken one.
    orgId: process.env.LANGSMITH_ORG_ID || null,
  },
};

// Provider-conditional validation: the primary LLM path needs its key.
if (config.llm.provider === 'anthropic' && !config.llm.anthropic.apiKey) {
  console.error('[config] LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY.');
  process.exit(1);
}
