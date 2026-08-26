import 'dotenv/config';

const REQUIRED = [
  'MONGO_URI',
  'QDRANT_URL',
  'REDIS_URL',
  'VISION_SERVICE_URL',
  'COHERE_API_KEY',
  'LLAMA_CLOUD_API_KEY',
  'SESSION_SECRET',
  'PUBLIC_URL',
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
    provider: process.env.LLM_PROVIDER ?? 'anthropic', // 'anthropic' | 'ollama' | 'groq'
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
    },
    ollama: {
      baseUrl: process.env.OLLAMA_API_URL ?? 'http://127.0.0.1:11434',
      model: process.env.OLLAMA_MODEL ?? 'llama3.2-vision:11b',
    },
    // Hosted, OpenAI-compatible, free-tier option (providers/llm.js's header comment) —
    // no local model to install or pull, unlike Ollama. Default model is a Groq-hosted
    // open-weight text model; see providers/llm.js's VISION_MODEL_PATTERN comment for why
    // vision is opt-in via GROQ_MODEL rather than defaulted on. Model availability is
    // per-account, not fixed — verify against `GET /openai/v1/models` for the configured
    // key before assuming a name from Groq's docs/marketing is actually reachable; this
    // default (openai/gpt-oss-120b) was confirmed live against this project's key after
    // llama-3.3-70b-versatile — assumed available from public docs — turned out not to be
    // on this account at all (404 model_not_found, verified 2026-08-17).
    groq: {
      apiKey: process.env.GROQ_API_KEY,
      model: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',
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

  auth: {
    sessionSecret: required('SESSION_SECRET'),     // ≥ 32 chars, fail-fast at startup
    publicUrl: required('PUBLIC_URL'),             // e.g. https://cerebro.example.com —
                                                   //   OAuth callback URLs are built from it
    adminEmails: (process.env.ADMIN_EMAILS ?? '').split(',')
                   .map((s) => s.trim().toLowerCase()).filter(Boolean),
    google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET },
    github: { clientId: process.env.GITHUB_CLIENT_ID, clientSecret: process.env.GITHUB_CLIENT_SECRET },
  },
  mail: {
    host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT ?? 587),
    user: process.env.SMTP_USER, pass: process.env.SMTP_PASS,
    from: process.env.MAIL_FROM,
  },
  sms: {
    accountSid: process.env.TWILIO_ACCOUNT_SID, authToken: process.env.TWILIO_AUTH_TOKEN,
    from: process.env.TWILIO_FROM,
  },
};

// Provider-conditional validation: whichever LLM path is selected needs its key.
// Ollama needs none — it's a local process, not an API key.
if (config.llm.provider === 'anthropic' && !config.llm.anthropic.apiKey) {
  console.error('[config] LLM_PROVIDER=anthropic requires ANTHROPIC_API_KEY.');
  process.exit(1);
}
if (config.llm.provider === 'groq' && !config.llm.groq.apiKey) {
  console.error('[config] LLM_PROVIDER=groq requires GROQ_API_KEY.');
  process.exit(1);
}

// SESSION_SECRET's presence is covered by REQUIRED above; a present-but-short secret
// still passes that check, so its minimum length (a security property, not a presence
// check) is enforced separately here.
if (config.auth.sessionSecret.length < 32) {
  console.error('[config] SESSION_SECRET must be at least 32 characters.');
  process.exit(1);
}
