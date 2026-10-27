import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import chardet from 'chardet';
import xlsx from 'xlsx';
import { config } from '../config/index.js';
import { wrap } from './breaker.js';

const BASE_URL = 'https://api.cloud.llamaindex.ai';

async function requestRaw(reqPath, options = {}) {
  const res = await axios.request({
    baseURL: BASE_URL,
    url: reqPath,
    headers: { Authorization: `Bearer ${config.llamaParse.apiKey}` },
    ...options,
  });
  return res.data;
}

// architecture §6.1: a 100-page PDF takes 60-120s and this runs inside a BullMQ
// worker, not a request — the long timeout matches the Phase 2 parse call, not
// Phase 1's lightweight ping.
const llamaParseBreaker = wrap('llamaparse', (reqPath, options) => requestRaw(reqPath, options), { timeout: 180_000 });

// Phase 1: account reachability via GET /api/v1/projects, the lightest authenticated
// endpoint LlamaCloud exposes.
export async function ping() {
  await llamaParseBreaker.fire('/api/v1/projects', { method: 'GET' });
}

// ── Phase 2: real parsing ────────────────────────────────────────────────────

// A distinct breaker name from 'llamaparse' (ping's) — same provider, different
// operation, same pattern as 'cohere.embed' vs 'cohere.rerank' (architecture §6.1).
const parseBreaker = wrap('llamaparse.parse', (fn) => fn(), { timeout: 180_000 });

// Amended 2026-10-28: LlamaParse's v2 Parse API, called directly. The previous
// implementation used @llamaindex/cloud's LlamaParseReader (deprecated since 4.1.0),
// which speaks only the v1 API — and v1 now answers "The v1 Parse API is not available
// for this account. Use the v2 Parse API instead" for newer accounts, so every PDF and
// DOCX upload failed in production. Verified live with this deployment's key: upload →
// PENDING → COMPLETED in ~6s for one page; `expand=markdown` returns
// markdown.pages[] = { page_number, markdown, success }.
//
// cost_effective tier: text-layer PDFs and DOCX are what reach this parser (scanned
// pages are routed through the vision service's OCR, phase 4), and its markdown output
// keeps tables as pipe tables and headings as `#` levels — what the v1 parsingInstruction
// asked for. agentic/agentic_plus spend several times the credits per page for layout
// reasoning this pipeline does not use.
const PARSE_TIER = 'cost_effective';
const POLL_INTERVAL_MS = 2_000;   // a one-page job completes in ~6s; 2s keeps the added latency small
const JOB_DEADLINE_MS = 170_000;  // inside parseBreaker's 180s, so the breaker's timeout never pre-empts this one's clearer error

async function runParseJob(storagePath, ext) {
  const form = new FormData();
  // The stored file is named by its content hash, with no extension; LlamaParse detects
  // the format from the uploaded filename, so give it one.
  form.append('file', new Blob([await fs.readFile(storagePath)]), `document${ext}`);
  form.append('configuration', JSON.stringify({ tier: PARSE_TIER, version: 'latest' }));
  const created = await requestRaw('/api/v2/parse/upload', { method: 'POST', data: form });

  const deadline = Date.now() + JOB_DEADLINE_MS;
  for (;;) {
    const { job } = await requestRaw(`/api/v2/parse/${created.id}`, { method: 'GET' });
    if (job.status === 'COMPLETED') break;
    if (job.status === 'FAILED') {
      // LlamaParse ran the job to completion and its own verdict was failure — a
      // deterministic, per-document outcome a same-file retry reproduces, so it is
      // classified as CORRUPT_DOCUMENT (not retried) rather than left to BullMQ.
      const e = new Error(`LlamaParse could not extract this document: ${job.error_message ?? 'no reason given'}`);
      e.code = 'CORRUPT_DOCUMENT';
      throw e;
    }
    if (job.status === 'CANCELLED') throw new Error(`LlamaParse job ${created.id} was cancelled`);
    if (Date.now() > deadline) throw new Error(`LlamaParse job ${created.id} still ${job.status} after ${JOB_DEADLINE_MS / 1000}s`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  const { markdown } = await requestRaw(`/api/v2/parse/${created.id}`, { method: 'GET', params: { expand: 'markdown' } });
  return markdown.pages;
}

async function parsePdfOrDocx(storagePath, ext) {
  // Anything other than CORRUPT_DOCUMENT (an axios 429/5xx, a network error, a timeout)
  // is transient and propagates to BullMQ's retry via classify().
  const pages = await parseBreaker.fire(() => runParseJob(storagePath, ext));
  return pages.map((p) => ({ text: p.markdown ?? '', metadata: { page: p.page_number } }));
}

// Escape pipes so a cell containing "|" cannot break the table structure downstream.
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();

function parseSpreadsheet(filePath) {
  const workbook = xlsx.readFile(filePath, { cellDates: true });
  const documents = [];

  for (const [index, sheetName] of workbook.SheetNames.entries()) {   // ALL sheets
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet, { header: 1, blankrows: false, defval: '' });
    if (rows.length === 0) continue;

    const [header, ...body] = rows;
    const lines = [
      `## ${sheetName}`,
      '',
      `| ${header.map(cell).join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
      ...body.map((r) => `| ${header.map((_, i) => cell(r[i])).join(' | ')} |`),
    ];
    documents.push({ text: lines.join('\n'), metadata: { page: index + 1, sheetName } });
  }
  return documents;
}

// Encoding detection (phase 2 §4.4). The legacy sanitizer assumed UTF-8 and stripped
// every non-ASCII byte, destroying non-Latin scripts entirely.
async function readTextFile(filePath) {
  const buf = await fs.readFile(filePath);
  // BOM wins over statistical detection — it is definitive when present.
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);

  const detected = chardet.detect(buf) ?? 'UTF-8';
  try {
    return new TextDecoder(detected, { fatal: true }).decode(buf);
  } catch {
    // Detection was wrong and strict decode failed. Fall back to UTF-8 lossy rather than
    // rejecting the document — a few replacement chars beat losing the file.
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
}

async function parseJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  let value;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    const e = new Error(`File is not valid JSON: ${err.message}`);
    e.code = 'CORRUPT_DOCUMENT';
    throw e;
  }
  // Pretty-printed so the recursive splitter (chunker.js) can break on newlines.
  return [{ text: JSON.stringify(value, null, 2), metadata: { page: 1 } }];
}

const SPREADSHEET_EXTS = new Set(['.csv', '.xlsx', '.xls']);
const TEXT_EXTS = new Set(['.txt', '.md']);
const DOC_EXTS = new Set(['.pdf', '.docx']);

// Dispatch by extension (phase 2 §4.1 table). `ext` is the lowercased extension from the
// document's original fileName — the only reliable place to read it once the file is
// stored under its content hash with no extension.
export async function parseDocument(storagePath, ext) {
  if (DOC_EXTS.has(ext)) return parsePdfOrDocx(storagePath, ext);
  if (SPREADSHEET_EXTS.has(ext)) return parseSpreadsheet(storagePath);
  if (ext === '.json') return parseJson(storagePath);
  if (TEXT_EXTS.has(ext)) {
    const text = await readTextFile(storagePath);
    return [{ text, metadata: { page: 1 } }];
  }
  const err = new Error(`No parser registered for extension "${ext}".`);
  err.code = 'UNSUPPORTED_FILE_TYPE';
  throw err;
}
