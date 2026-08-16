import axios from 'axios';
import fs from 'fs/promises';
import path from 'path';
import chardet from 'chardet';
import xlsx from 'xlsx';
import { LlamaParseReader } from '@llamaindex/cloud/reader';
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
// The wrapped function is `reader.loadData` itself, invoked with a bound reader per
// call (a fresh LlamaParseReader per document, since parsingInstruction/language never
// change but the SDK carries no reusable connection worth pooling).
const parseBreaker = wrap('llamaparse.parse', (fn) => fn(), { timeout: 180_000 });

async function parsePdfOrDocx(storagePath) {
  const reader = new LlamaParseReader({
    apiKey: config.llamaParse.apiKey,
    resultType: 'markdown',
    // Preserves table structure as markdown pipe tables instead of flattening to prose —
    // the single setting that fixes the audit's "tables collapse to text" finding.
    parsingInstruction:
      'Preserve all table structure as markdown tables. Preserve heading hierarchy using ' +
      'markdown heading levels. Do not summarize, omit, or reword any content.',
    splitByPage: true,
    invalidateCache: false,
    language: 'en',
    // Amended during Phase 2 implementation (phase 2 §4.2): default is true (silently
    // swallows parse failures as []). False lets a genuinely broken PDF surface as a
    // catchable error distinguishable from "parsed, zero text".
    ignoreErrors: false,
  });

  let rawPages;
  try {
    rawPages = await parseBreaker.fire(() => reader.loadData(storagePath));
  } catch (err) {
    // Amended during Phase 2 implementation: an earlier version of this catch pattern-
    // matched err.message against /broken|corrupt/i and /encrypt|password.protect/i,
    // believing LlamaParse's specific failure reason (e.g. "PDF_IS_BROKEN",
    // "PDF_IS_PROTECTED") reached the thrown error. Verified live against both a broken
    // PDF and a real password-protected one (pypdf-generated) that it does not: the SDK
    // logs the specific code/message via console.warn as a side effect, but the actual
    // thrown Error's `.message` is always the generic
    // "Failed to parse the file: <jobId>, status: ERROR" — confirmed via
    // `Object.keys(err)` being empty, no `.code`, no structured detail at all. The two
    // regexes above never matched anything real; this is the corrected version.
    //
    // What IS a reliable signal: this specific message shape means LlamaParse ran the
    // job to completion and its own verdict was ERROR — a deterministic, per-document
    // outcome that a same-file retry will reproduce identically. Any other shape
    // (ECONNRESET, timeout, an axios 429/5xx during upload or polling) is a transport-
    // level failure with no such guarantee, so it is left to fall through and retry.
    if (/status: ERROR$/.test(err.message ?? '')) {
      const e = new Error(
        `LlamaParse could not extract this document (broken file, or password/DRM ` +
        `protected — the specific reason is not exposed by the parser API): ${err.message}`,
      );
      e.code = 'CORRUPT_DOCUMENT';
      throw e;
    }
    throw err;   // transient (429, 5xx, network) — retried by BullMQ via classify()
  }

  // Amended during Phase 2 implementation (phase 2 §4.2): verified live against
  // @llamaindex/cloud@4.1.3 — Document objects returned with splitByPage:true carry
  // metadata: {} (empty). Page numbers are the array position, not a metadata field.
  return rawPages.map((p, i) => ({ text: p.text, metadata: { page: i + 1 } }));
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
  if (DOC_EXTS.has(ext)) return parsePdfOrDocx(storagePath);
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
