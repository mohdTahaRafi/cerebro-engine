// phase_1 §4.2 — every type the frontend will ever need, including for endpoints that do
// not exist yet. This file is the contract Phases 5–7 are built to satisfy; a backend
// change that breaks it is a breaking change by definition.

// ── Envelope ────────────────────────────────────────────────────────────────
export interface ApiError {
  status: number;
  code: string;          // machine-readable: 'invalid_credentials', 'otp_expired', …
  message: string;       // human-readable, already user-safe — rendered verbatim
  fields?: Record<string, string>;   // field-level validation, keyed by input name
}

export interface Paginated<T> {
  items: T[];
  page: number; limit: number; total: number; totalPages: number;
}

// ── Auth (Epic 1) ───────────────────────────────────────────────────────────
export type Role = 'user' | 'admin';

export interface SessionUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  avatarUrl: string | null;
  role: Role;
  identities: Array<'google' | 'github' | 'local'>;
  phone: string | null;
  phoneVerified: boolean;
  createdAt: string;
}

/** GET /api/auth/session — 200 with `user: null` when signed out, never 401. */
export interface SessionResponse { user: SessionUser | null; }

export interface SignupRequest { email: string; password: string; name?: string; }
export interface LoginRequest  { email: string; password: string; }

/** Which OTP channels the server can actually deliver on. Drives whether the
 *  UI offers "send to my phone" at all — an unconfigured channel is ABSENT,
 *  never a button that fails (architecture §4). */
export interface AuthCapabilities {
  providers: Array<'google' | 'github'>;
  otpChannels: Array<'email' | 'sms'>;
  passwordMinLength: number;
}

export type OtpChannel = 'email' | 'sms';

export interface ForgotPasswordRequest { identifier: string; channel: OtpChannel; }
/** Always 202 with this body, whether or not the account exists (architecture §7.10). */
export interface ForgotPasswordResponse {
  sent: true;
  channel: OtpChannel;
  maskedDestination: string;   // "t••••@gmail.com" / "+1 ••• ••• 4471"
  expiresInSeconds: number;    // 600
  resendAfterSeconds: number;  // 60
}
export interface VerifyOtpRequest  { identifier: string; code: string; }
export interface VerifyOtpResponse { resetToken: string; expiresInSeconds: number; }
export interface ResetPasswordRequest { resetToken: string; password: string; }

// ── Contexts (Epic 2) ───────────────────────────────────────────────────────
export interface KnowledgeContext {
  id: string;
  title: string;
  description: string | null;
  documentCount: number;
  chunkCount: number;
  status: 'active' | 'deleting';
  createdAt: string;
  updatedAt: string;
}
export interface CreateContextRequest { title: string; description?: string; }

// ── Documents (Epic 2) ──────────────────────────────────────────────────────
export type DocumentStatus = 'queued' | 'processing' | 'ready' | 'failed' | 'duplicate';
/** The five PRD-named lifecycle stages. Interim: derived on the client from
 *  status + progress until Phase 7 adds a real `stage` field (phase_2 §5.3). */
export type IngestStage = 'queued' | 'parsing' | 'chunking' | 'embedding' | 'ready' | 'failed';

export interface DocumentRecord {
  id: string; contextId: string;
  fileName: string; mimeType: string; sizeBytes: number;
  status: DocumentStatus;
  stage: IngestStage;
  progress: number;              // 0–100
  chunkCount: number; pageCount: number;
  textPageCount: number; visualPageCount: number;
  error: string | null; warnings: string[];
  createdAt: string;
}

// ── Chat (Epic 3) ───────────────────────────────────────────────────────────
export type SourceKind = 'text' | 'page';
export type SourceBranch = 'dense' | 'sparse' | 'both' | 'colpali';

/** Unchanged from v1's toPublicResult projection (backend/src/retrieval/search.js).
 *  Re-declared here rather than imported so the boundary owns its own contract. */
export interface ProvenanceSource {
  pointId: string; kind: SourceKind; text: string | null; score: number | null;
  documentId: string; fileName: string | null; page: number | null;
  headingPath: string | null; position: number | null;
  imageUri: string | null; ocrQuality: string | null;
  absorbedChunks: string[] | null;
  branch: SourceBranch | null; fusionRank: number | null; finalRank: number | null;
}

/** Unchanged from v1's buildTelemetry (backend/src/telemetry/pipelineTelemetry.js).
 *  A stage that did not run is `null`, NEVER 0 — see architecture §1. */
export interface PipelineTelemetry {
  condenseMs: number | null;      condenseStartMs: number | null;
  embedMs: number | null;         embedStartMs: number | null;
  sparseMs: number | null;        sparseStartMs: number | null;
  colpaliMs: number | null;       colpaliStartMs: number | null;
  chunkRetrieveMs: number | null; chunkRetrieveStartMs: number | null;
  pageRetrieveMs: number | null;  pageRetrieveStartMs: number | null;
  mergeMs: number | null;         mergeStartMs: number | null;
  rerankMs: number | null;        rerankStartMs: number | null;
  generateMs: number | null;      generateStartMs: number | null;
  firstTokenMs: number | null;
  totalMs: number;
  candidatesRetrieved: number; candidatesAfterMerge: number; candidatesAfterFloor: number;
  rerankSkipped: boolean; warnings: string[];
}

export interface AskRequest {
  query: string; contextId: string;
  threadId?: string; scopeDocumentIds?: string[];
}

export type AskEvent =
  | { event: 'threadId';  threadId: string }
  | { event: 'sources';   sources: ProvenanceSource[] }
  | { event: 'token';     token: string }
  | { event: 'telemetry'; telemetry: PipelineTelemetry; runId: string;
                          traceId: string | null;
                          langsmith: { orgId: string | null; project: string } | null }
  | { event: 'error';     error: string };

// ── Traces (Epic 4) ─────────────────────────────────────────────────────────
export interface TraceSummary {
  id: string; threadId: string; messageId: string; contextId: string; contextTitle: string;
  query: string; totalMs: number; sourceCount: number;
  rerankSkipped: boolean; warningCount: number; createdAt: string;
}
export interface TracePromptBlock {
  role: 'system' | 'user'; kind: 'text' | 'image';
  content: string;            // image blocks carry the served page URI, never base64
  approxTokens: number | null;
}
export interface TraceDetail extends TraceSummary {
  condensedQuery: string | null;
  telemetry: PipelineTelemetry;
  candidates: ProvenanceSource[];      // full pre-floor set, with fusionRank + finalRank
  prompt: TracePromptBlock[];
  tokens: { input: number; output: number; provider: string; model: string } | null;
  runId: string | null;
  langsmithUrl: string | null;
  truncated: boolean;                  // prompt exceeded the 256KB cap (architecture §8)
}

// ── Vectors (Epic 5) ────────────────────────────────────────────────────────
export type ProjectionStaleness = 'fresh' | 'rebuilding' | 'absent';
/** Packed payload — architecture §7.9. `positions` is base64 of a Float32Array of
 *  interleaved [x,y,z]; `docIndex` is base64 of a Uint16Array indexing `documents`. */
export interface ProjectionResponse {
  staleness: ProjectionStaleness;
  reason: string | null;              // populated when staleness !== 'fresh'
  nodeCount: number;
  positions: string;
  docIndex: string;
  pointIds: string[];
  documents: Array<{ id: string; fileName: string; color: number }>;
  bounds: { min: [number, number, number]; max: [number, number, number] };
  fittedAt: string | null;
}
export interface ProjectQueryRequest  { contextId: string; query: string; }
export interface ProjectQueryResponse {
  beacon: [number, number, number];
  neighbors: Array<{ pointId: string; index: number; distance: number;
                     rerankScore: number | null; finalRank: number | null }>;
}
export interface VectorNodeDetail {
  pointId: string; text: string; documentId: string; fileName: string;
  page: number | null; headingPath: string | null; position: number;
  norm: number; neighborCount: number;
}

// ── Admin (Epic 6) ──────────────────────────────────────────────────────────
export interface HealthResponse {
  status: 'up' | 'degraded' | 'down';
  version: string;
  breakers: Record<string, 'closed' | 'half-open' | 'open'>;
  dependencies: Record<string, { name: string; status: 'up' | 'down';
                                 latencyMs: number; error?: string }>;
  queue: { waiting: number; active: number; failed: number; completed: number } | null;
  collections: Record<string, number> | null;
  timestamp: string;
}
export interface QueueStats {
  depth: { waiting: number; active: number; failed: number; completed: number };
  throughputPerMin: number; workerConcurrency: number; activeWorkers: number;
  oldestWaitingAgeMs: number | null;
}
export interface PipelineErrorRecord {
  id: string; kind: 'parse' | 'embed' | 'vision' | 'rerank' | 'generate' | 'queue' | 'notify';
  message: string; documentId: string | null; fileName: string | null;
  contextId: string | null; stack: string | null; retryable: boolean; createdAt: string;
}
