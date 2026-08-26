// phase_4 §1.2 — dev-only demo data for /admin/traces and /admin/traces/:id, active only
// under VITE_API_MOCK=1 (src/api/mock/index.ts). Real trace history is Phase 7. Generated
// deterministically per demo context id (mock/fixtures/demoContexts.ts — small and fixed,
// unrelated to any real user's contexts since Phase 6 gave Contexts a real backend) with a
// seeded PRNG rather than persisted to localStorage — this is read-only inspection data
// over queries that never actually ran, so there is nothing to "keep" across a reload the
// way a real context or document would need to be.
import type {
  TraceSummary, TraceDetail, PipelineTelemetry, ProvenanceSource, TracePromptBlock,
  SourceBranch,
} from '../../contracts';
import { DEMO_CONTEXTS } from './demoContexts';

const TRACES_PER_CONTEXT = 9;
const RELEVANCE_FLOOR = 0.15; // fixture-only illustrative value — see contracts.ts's
                               // TraceDetail.relevanceFloor doc comment; the real backend
                               // constant (backend/src/retrieval/constants.js) is unrelated
                               // production tuning this dev-only mock has no need to mirror.

function seedFrom(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUERIES = [
  'what was EMEA revenue in Q3?',
  'summarize the risk factors section',
  'how does APAC growth compare to last quarter?',
  'what were the board decisions on capex?',
  'list every customer churn reason mentioned',
  'what changed since the last filing?',
  'give me the headline numbers for the quarter',
  'were there any compliance flags this cycle?',
  'what is our guidance for next quarter?',
];
const CONDENSED = [
  null,
  'How did EMEA revenue in Q3 2024 compare to the $3.8M reported in Q2?',
  null,
  'What capex decisions did the board make in the Q3 2024 meeting?',
  null,
  'What changed in the filing between Q2 2024 and Q3 2024?',
  null,
  null,
  'What is management guidance for Q4 2024?',
];
const DOCS = [
  { fileName: 'q3-earnings.pdf', kind: 'text' as const },
  { fileName: 'notes.md', kind: 'text' as const },
  { fileName: 'scan.pdf', kind: 'page' as const },
  { fileName: 'risk-factors.pdf', kind: 'text' as const },
  { fileName: 'board-deck.pdf', kind: 'page' as const },
];
const BRANCHES: SourceBranch[] = ['dense', 'sparse', 'both', 'colpali'];
const HEADINGS = ['Revenue › Regional breakdown', 'Risk factors › Market', 'Guidance › Next quarter', null];

function buildTelemetry(rand: () => number, opts: { condenseSkipped: boolean; refused: boolean; rerankSkipped: boolean }): PipelineTelemetry {
  const embedMs = Math.round(180 + rand() * 60);
  const sparseMs = Math.round(2 + rand() * 3);
  const colpaliMs = Math.round(110 + rand() * 60);
  const encodeStart = opts.condenseSkipped ? 0 : Math.round(140 + rand() * 40);
  const encodeSpan = Math.max(embedMs, sparseMs, colpaliMs);
  const chunkRetrieveMs = Math.round(150 + rand() * 60);
  const retrieveStart = encodeStart + encodeSpan + Math.round(rand() * 10);
  const mergeMs = Math.round(1 + rand() * 3);
  const mergeStart = retrieveStart + chunkRetrieveMs + Math.round(rand() * 5);
  const rerankMs = opts.rerankSkipped ? null : Math.round(180 + rand() * 80);
  const rerankStart = mergeStart + mergeMs;
  const generateStart = rerankStart + (rerankMs ?? 0) + Math.round(rand() * 15);
  const generateMs = opts.refused ? null : Math.round(1400 + rand() * 600);
  const firstTokenMs = opts.refused || generateMs == null ? null : Math.round(400 + rand() * 300);
  const totalMs = generateStart + (generateMs ?? Math.round(40 + rand() * 40)) + Math.round(80 + rand() * 250);

  return {
    condenseMs: opts.condenseSkipped ? null : Math.round(60 + rand() * 40),
    condenseStartMs: opts.condenseSkipped ? null : 0,
    embedMs, embedStartMs: encodeStart,
    sparseMs, sparseStartMs: encodeStart,
    colpaliMs, colpaliStartMs: encodeStart,
    chunkRetrieveMs, chunkRetrieveStartMs: retrieveStart,
    pageRetrieveMs: null, pageRetrieveStartMs: null,
    mergeMs, mergeStartMs: mergeStart,
    rerankMs, rerankStartMs: opts.rerankSkipped ? null : rerankStart,
    generateMs, generateStartMs: opts.refused ? null : generateStart,
    firstTokenMs,
    totalMs,
    candidatesRetrieved: 18, candidatesAfterMerge: 14,
    candidatesAfterFloor: opts.refused ? 0 : 4,
    rerankSkipped: opts.rerankSkipped,
    warnings: opts.rerankSkipped ? ['Reranker degraded — results are in fusion order.'] : [],
  };
}

function buildCandidates(rand: () => number, opts: { refused: boolean; rerankSkipped: boolean }): ProvenanceSource[] {
  const count = 18;
  const survivorCount = opts.refused ? 0 : 4;
  const candidates: ProvenanceSource[] = [];
  const finalOrder = [...Array(count).keys()].sort(() => rand() - 0.5).slice(0, survivorCount);

  for (let i = 0; i < count; i++) {
    const doc = DOCS[i % DOCS.length];
    const branch = BRANCHES[i % BRANCHES.length];
    const fusionRank = i + 1;
    const isSurvivor = !opts.rerankSkipped && finalOrder.includes(i);
    const finalRank = isSurvivor ? finalOrder.indexOf(i) + 1 : null;
    const score = opts.rerankSkipped ? null : isSurvivor
      ? Number((RELEVANCE_FLOOR + rand() * (0.9 - RELEVANCE_FLOOR)).toFixed(4))
      : Number((rand() * RELEVANCE_FLOOR).toFixed(4));
    candidates.push({
      pointId: `pt-${i}`,
      kind: doc.kind,
      text: `"…${doc.fileName} passage ${i + 1} of demo content for the reranking matrix…"`,
      score,
      documentId: `doc-${i % DOCS.length}`,
      fileName: doc.fileName,
      page: doc.kind === 'page' ? 1 + (i % 12) : null,
      headingPath: HEADINGS[i % HEADINGS.length],
      position: i,
      imageUri: doc.kind === 'page' ? `/api/pages/doc-${i % DOCS.length}/${1 + (i % 12)}.jpg` : null,
      ocrQuality: null,
      absorbedChunks: null,
      branch,
      fusionRank,
      finalRank: opts.rerankSkipped ? null : finalRank,
      belowFloor: opts.rerankSkipped ? undefined : !isSurvivor,
    });
  }
  return candidates;
}

function buildPrompt(candidates: ProvenanceSource[], refused: boolean): TracePromptBlock[] {
  if (refused) {
    return [{ role: 'system', kind: 'text', content: 'You answer questions using only the sources provided below. If no sources are provided, say you cannot answer.', approxTokens: 42 }];
  }
  const kept = candidates.filter((c) => !c.belowFloor).sort((a, b) => (a.finalRank ?? 0) - (b.finalRank ?? 0));
  const textSources = kept.filter((c) => c.kind === 'text');
  const imageSources = kept.filter((c) => c.kind === 'page');
  const blocks: TracePromptBlock[] = [
    {
      role: 'system', kind: 'text',
      content: 'You answer questions using only the sources provided below. Cite each claim with the matching [n] marker. If the sources do not contain the answer, say so plainly.',
      approxTokens: 118,
    },
  ];
  if (textSources.length > 0) {
    blocks.push({
      role: 'user', kind: 'text',
      content: textSources.map((c, i) =>
        `<source n="${i + 1}" file="${c.fileName}" section="${c.headingPath ?? ''}">\n${c.text}\n</source>`,
      ).join('\n\n'),
      approxTokens: 412,
    });
  }
  for (const img of imageSources) {
    blocks.push({ role: 'user', kind: 'image', content: img.imageUri!, approxTokens: 1600 });
  }
  return blocks;
}

interface GeneratedTrace { summary: TraceSummary; detail: TraceDetail }

function generateForContext(contextId: string, contextTitle: string): GeneratedTrace[] {
  const rand = mulberry32(seedFrom(contextId));
  const now = Date.now();
  const ageSteps = [2, 8, 45, 130, 480, 1440, 2880, 5760, 10080]; // minutes ago, spread over ~7 days

  const out: GeneratedTrace[] = [];
  for (let i = 0; i < TRACES_PER_CONTEXT; i++) {
    const condenseSkipped = i === 0 || CONDENSED[i % CONDENSED.length] == null;
    const refused = i % 5 === 4;
    const rerankSkipped = i === 6;
    const truncated = i === 3;
    const telemetry = buildTelemetry(rand, { condenseSkipped, refused, rerankSkipped });
    const candidates = buildCandidates(rand, { refused, rerankSkipped });
    const kept = candidates.filter((c) => !c.belowFloor);
    const id = `trace-${contextId}-${i}`;
    const createdAt = new Date(now - ageSteps[i % ageSteps.length] * 60_000).toISOString();

    const summary: TraceSummary = {
      id, threadId: `thread-${contextId}-${i}`, messageId: `msg-${contextId}-${i}`,
      contextId, contextTitle,
      query: QUERIES[i % QUERIES.length],
      totalMs: telemetry.totalMs,
      sourceCount: refused ? 0 : kept.length,
      telemetry,
      refused,
      rerankSkipped,
      warningCount: telemetry.warnings.length,
      createdAt,
    };
    const detail: TraceDetail = {
      ...summary,
      condensedQuery: condenseSkipped ? null : CONDENSED[i % CONDENSED.length],
      candidates,
      relevanceFloor: RELEVANCE_FLOOR,
      prompt: buildPrompt(candidates, refused),
      tokens: i % 8 === 7 ? null : { input: Math.round(900 + rand() * 400), output: Math.round(150 + rand() * 200), provider: 'anthropic', model: 'claude-sonnet-5' },
      runId: `run-${id}`,
      langsmithUrl: null, // no LANGSMITH_ORG_ID configured in this dev environment
      truncated,
    };
    out.push({ summary, detail });
  }
  return out;
}

function allGenerated(): GeneratedTrace[] {
  return DEMO_CONTEXTS.flatMap((c) => generateForContext(c.id, c.title));
}

export function list(params: { contextId?: string; window?: '1h' | '24h' | '7d' | 'all' }): TraceSummary[] {
  const windowMs: Record<string, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 };
  const cutoff = params.window && params.window !== 'all' ? Date.now() - windowMs[params.window] : null;

  return allGenerated()
    .filter((t) => !params.contextId || t.summary.contextId === params.contextId)
    .filter((t) => cutoff == null || new Date(t.summary.createdAt).getTime() >= cutoff)
    .map((t) => t.summary)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function get(id: string): TraceDetail | undefined {
  return allGenerated().find((t) => t.detail.id === id)?.detail;
}
