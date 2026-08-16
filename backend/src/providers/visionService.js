import axios from 'axios';
import fs from 'fs/promises';
import { config } from '../config/index.js';
import { wrap } from './breaker.js';

// Not wrapped in a shared opossum breaker (architecture §6.1's breaker table names
// only vision.classify and vision.embedPages — the real domain calls arriving in
// Phase 4). Health polling runs independently and concurrently inside health.js's
// own Promise.all, which already isolates a slow/dead vision service from the rest
// of the /health response; a second layer of circuit breaking here adds nothing.
const HEALTH_TIMEOUT_MS = 5_000;

export async function health() {
  const res = await axios.get(`${config.vision.url}/health`, { timeout: HEALTH_TIMEOUT_MS });
  return res.data;
}

// ── Phase 4: classify, embedPages, embedQuery ────────────────────────────────────────

// phase 1 §13's breaker table: PyMuPDF's metadata-only pass over 500 pages is ~2s; 30s
// covers a pathological file with margin.
const CLASSIFY_TIMEOUT_MS = 30_000;
const classifyBreaker = wrap(
  'vision.classify',
  (pdfBuffer) => axios.post(`${config.vision.url}/classify`, pdfBuffer, {
    headers: { 'Content-Type': 'application/pdf' },
    timeout: CLASSIFY_TIMEOUT_MS,
    maxBodyLength: Infinity, maxContentLength: Infinity,
  }),
  { timeout: CLASSIFY_TIMEOUT_MS },
);

export async function classify(storagePath) {
  const pdfBuffer = await fs.readFile(storagePath);
  const res = await classifyBreaker.fire(pdfBuffer);
  return res.data;
}

// phase 1 §13: 20 pages x ~6s/page = 120s, matching config.vision.timeoutMs.
const embedPagesBreaker = wrap(
  'vision.embedPages',
  (form) => axios.post(`${config.vision.url}/embed_pages`, form, {
    timeout: config.vision.timeoutMs,
    maxBodyLength: Infinity, maxContentLength: Infinity,
  }),
  { timeout: config.vision.timeoutMs },
);

export async function embedPages(storagePath, documentId, pages) {
  const pdfBuffer = await fs.readFile(storagePath);
  // Node's built-in FormData/Blob (undici, global since Node 18) — axios's Node adapter
  // serializes them natively, so no `form-data` dependency is needed (verified live: the
  // resulting request carries a correct multipart boundary and axios sets the
  // content-type header itself from the FormData instance).
  const form = new FormData();
  form.append('documentId', documentId);
  form.append('pages', JSON.stringify(pages));
  form.append('pdfBytes', new Blob([pdfBuffer], { type: 'application/pdf' }), 'document.pdf');

  const res = await embedPagesBreaker.fire(form);
  return res.data;
}

// Query-side embedding — the interactive query path (phase 4 §7.1), not one of phase 1
// §13's ingest-time breaker table entries. 5s matches the reranker's own interactive-path
// breaker (providers/reranker.js): a ColPali query embed that hasn't returned in 5s means
// the service is stuck, not merely slow — the <200ms budget (architecture §6) leaves 25x
// headroom under this.
const EMBED_QUERY_TIMEOUT_MS = 5_000;
const embedQueryBreaker = wrap(
  'vision.embedQuery',
  (query) => axios.post(`${config.vision.url}/embed_query`, { query }, { timeout: EMBED_QUERY_TIMEOUT_MS }),
  { timeout: EMBED_QUERY_TIMEOUT_MS },
);

export async function embedQuery(query) {
  const res = await embedQueryBreaker.fire(query);
  return res.data.multivector;
}
