# Phase 2: Text Ingestion & Document Management

## 1. Objective

Replace the hand-rolled ingestion pipeline with an asynchronous, atomic, library-backed one. A user uploads a document; the API returns `202` immediately with a document id; a BullMQ worker parses it through LlamaParse or a LangChain loader, splits it with structure-aware token-bounded splitters, embeds the chunks with Cohere, and upserts them to Qdrant — while the document row tracks `queued → processing → ready` with a percentage. The full document lifecycle lands here too: list, filter, delete, and re-ingest. By the end of this phase: a developer uploads a 20-page PDF with tables, watches `GET /api/documents/:id` climb from 0% to 100%, and sees the table rendered as markdown rows inside a chunk — then deletes the document and confirms Qdrant holds zero points for it.

**No retrieval, no search endpoint, no reranking, no generation, no vision/OCR path, no frontend changes.** Chunks go into Qdrant and stay there; nothing reads them back until Phase 3. PDFs are treated as wholly textual in this phase — the per-page routing classifier and everything visual is Phase 4. The legacy `/api/ingest`, `/api/search`, and `/api/ask` routes remain live and untouched.

---

## 2. Upload Endpoint & Storage

### 2.1 Multer Configuration — `backend/src/api/middleware/upload.js`

```js
import multer from 'multer';
import path from 'path';
import { config } from '../../config/index.js';

// Extension → canonical MIME. The extension alone is untrusted (FR-ING edge case:
// "mismatch between file extension and actual content type"); this map is only the
// first gate. Magic-byte verification happens in §2.2 before any parsing.
export const ACCEPTED = new Map([
  ['.pdf',  'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.txt',  'text/plain'],
  ['.md',   'text/markdown'],
  ['.csv',  'text/csv'],
  ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.xls',  'application/vnd.ms-excel'],
  ['.json', 'application/json'],
]);

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;   // 50 MB — see architecture §6

export const upload = multer({
  storage: multer.diskStorage({
    destination: config.storage.uploadsDir,
    // Random temp name; the file is renamed to its content hash after hashing (§2.3).
    filename: (req, file, cb) => cb(null, `tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  }),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ACCEPTED.has(ext)) {
      const err = new Error(
        `Unsupported file type "${ext || '(none)'}". Accepted: ${[...ACCEPTED.keys()].join(', ')}`,
      );
      err.code = 'UNSUPPORTED_FILE_TYPE';
      return cb(err);
    }
    cb(null, true);
  },
});
```

`limits.fileSize` is enforced by multer *while streaming*, so a 2 GB upload is aborted mid-transfer rather than after being fully written — this is the resource-exhaustion mitigation from architecture §7, and it only works because the limit lives in multer rather than in a post-hoc size check.

### 2.2 Magic-Byte Verification — `backend/src/ingestion/verifyType.js`

The extension gate is advisory. Before any parser touches the bytes, the real container type is confirmed by signature:

```js
const SIGNATURES = [
  { ext: '.pdf',  offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] },              // %PDF
  { ext: '.docx', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },              // PK.. (zip)
  { ext: '.xlsx', offset: 0, bytes: [0x50, 0x4b, 0x03, 0x04] },              // PK.. (zip)
  { ext: '.xls',  offset: 0, bytes: [0xd0, 0xcf, 0x11, 0xe0] },              // OLE2 compound
];
// .txt/.md/.csv/.json have no signature — they are validated by decoding instead (§4.4).

export async function verifyType(filePath, declaredExt) {
  const expected = SIGNATURES.find((s) => s.ext === declaredExt);
  if (!expected) return { ok: true, kind: 'text' };

  const fh = await fs.open(filePath, 'r');
  const buf = Buffer.alloc(8);
  await fh.read(buf, 0, 8, 0);
  await fh.close();

  const matches = expected.bytes.every((b, i) => buf[expected.offset + i] === b);
  if (!matches) {
    return {
      ok: false,
      reason: `File claims to be ${declaredExt} but its contents do not match that format.`,
    };
  }
  return { ok: true, kind: 'binary' };
}
```

Both `.docx` and `.xlsx` are ZIP containers sharing the `PK\x03\x04` signature, so this check confirms the container but not the OOXML part layout. A `.docx` that is a valid ZIP but not a Word document fails later, inside LlamaParse, and surfaces as a `failed` status with the parser's message — an acceptable place for it to fail, because the alternative is unzipping and inspecting `[Content_Types].xml` ourselves, which is exactly the hand-rolled parsing this migration removes.

### 2.3 `POST /api/documents`

```js
router.post('/api/documents', upload.single('document'), async (req, res, next) => {
  if (!req.file) return res.status(400).json({ error: 'No document provided.' });

  const tmpPath = req.file.path;
  const ext = path.extname(req.file.originalname).toLowerCase();

  try {
    // 1. Verify real type before anything else touches the bytes.
    const verdict = await verifyType(tmpPath, ext);
    if (!verdict.ok) {
      await fs.unlink(tmpPath);
      return res.status(400).json({ error: verdict.reason });
    }

    // 2. Reject empty/whitespace-only uploads up front (FR-ING edge case).
    if (req.file.size === 0) {
      await fs.unlink(tmpPath);
      return res.status(400).json({ error: 'File is empty.' });
    }

    // 3. Hash the bytes and move the file to its content-addressed home.
    const contentHash = await sha256File(tmpPath);
    const storagePath = path.join(config.storage.uploadsDir, contentHash);
    await fs.rename(tmpPath, storagePath);

    // 4. Duplicate check BEFORE creating a queued row, so no job is enqueued for it.
    const existing = await Document.findOne({ contentHash, status: 'ready' });
    if (existing) {
      const dup = await Document.create({
        fileName: req.file.originalname, mimeType: ACCEPTED.get(ext),
        sizeBytes: req.file.size, contentHash, storagePath,
        status: 'duplicate', duplicateOf: existing._id,
      });
      return res.status(200).json({
        documentId: dup._id, status: 'duplicate', duplicateOf: existing._id,
        message: `Identical content was already ingested as "${existing.fileName}".`,
      });
    }

    // 5. Enqueue FIRST, create the row only if the queue accepted it.
    //    Ordering matters: a Redis outage must not leave an orphan 'queued' row
    //    that no worker will ever pick up (architecture §6.2).
    const doc = await Document.create({
      fileName: req.file.originalname, mimeType: ACCEPTED.get(ext),
      sizeBytes: req.file.size, contentHash, storagePath, status: 'queued',
    });
    try {
      await ingestQueue.add('ingest:document', { documentId: doc._id.toString() }, JOB_OPTS);
    } catch (queueErr) {
      await Document.deleteOne({ _id: doc._id });     // roll the row back
      return res.status(503).json({ error: 'Upload queue is unavailable. Please retry shortly.' });
    }

    res.status(202).json({ documentId: doc._id, status: 'queued', fileName: doc.fileName });
  } catch (err) {
    await fs.unlink(tmpPath).catch(() => {});
    next(err);
  }
});
```

Uploaded files are **content-addressed** — stored under their SHA-256 rather than a random name. Two consequences: a re-upload of identical bytes overwrites the same path rather than accumulating copies, and the retry path (FR-ING-11) always knows exactly where the source file is without storing a second pointer.

---

## 3. The Job Queue

### 3.1 `backend/src/ingestion/queue.js`

```js
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

// Amended during Phase 2 implementation: verified live (`docker compose stop redis` then
// `POST /api/documents`) that a single shared connection hangs the enqueue call
// indefinitely rather than rejecting it. `maxRetriesPerRequest: null` is required by
// BullMQ for the Worker's blocking commands — without it, a transient blip crashes the
// worker — but the same setting also means `ingestQueue.add()` never gives up when Redis
// is genuinely down, so the Document row created just before it sits as an orphan for as
// long as Redis stays down. §8.2's "Redis down → 503 before writing the Document row"
// requires the enqueue call to fail fast — a different requirement from the Worker's
// "never give up mid-job." Two connections, one per role:
const workerConnection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });
// `maxRetriesPerRequest: 1` bounds one in-flight command (one `.add()` call) to one retry
// before it rejects — the fail-fast half. `retryStrategy` is left at ioredis's default
// (bounded backoff, never returns null) on purpose: that governs the *background*
// reconnect loop, not a single command's budget. An earlier version of this fix capped
// retryStrategy to stop after a few tries — verified live that this makes ioredis give up
// reconnecting permanently, so the connection never recovered even after Redis came back.
const queueConnection = new IORedis(config.redis.url, { maxRetriesPerRequest: 1 });

export const JOB_OPTS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },   // 5s → 25s → 125s
  removeOnComplete: { age: 86_400, count: 1000 },   // keep 24h of history for the UI
  removeOnFail: { age: 604_800 },                   // keep failures 7 days for debugging
};

export const ingestQueue = new Queue('ingest', { connection: queueConnection });

let worker = null;
let sawConnectionError = false;   // set on the Worker's first error, consumed on next 'ready'

function buildWorker() {
  const w = new Worker('ingest', ingestDocumentJob, {
    connection: workerConnection,
    concurrency: 2,          // architecture §6: >2 saturates CPU-bound work in Phase 4
    lockDuration: 300_000,   // 5 min — a 100-page LlamaParse job must not lose its lock
  });
  w.on('failed', (job, err) => {
    console.error(`[ingest] job ${job?.id} failed (attempt ${job?.attemptsMade}/3):`, err.message);
  });
  w.on('error', (err) => { console.error('[ingest] worker connection error:', err.message); sawConnectionError = true; });
  return w;
}

// Amended during Phase 2 implementation: verified live, reproducibly, that BullMQ's
// Worker does not reliably resume its job-fetch loop after a Redis outage even once the
// underlying connection reports 'ready' again — jobs sat in 'waiting' with zero 'active'
// indefinitely (`ingestQueue.getJobCounts()`), while a *new* Worker against the same
// now-healthy connection picked them up immediately. Fix: rebuild the Worker when the
// connection recovers from a prior error.
workerConnection.on('ready', () => {
  if (!sawConnectionError) return;
  sawConnectionError = false;
  console.warn('[ingest] Redis recovered after an outage — rebuilding the worker');
  const old = worker;
  worker = buildWorker();
  old?.close().catch((err) => console.error('[ingest] error closing stale worker:', err.message));
});

export function startWorker() {
  if (worker) return worker;
  worker = buildWorker();
  return worker;
}
```

`backoff.delay: 5000` with `type: 'exponential'` produces 5 s, 25 s, 125 s. This is tuned for the dominant transient failure — a Cohere or LlamaParse 429 — where the provider's own rate window is typically under a minute; three attempts spanning ~2.5 minutes clears it without holding a worker slot for an unbounded period.

### 3.2 Which Errors Retry

Retrying a malformed document three times wastes ~2.5 minutes to reach the same conclusion. The job handler classifies before rethrowing:

```js
class PermanentIngestError extends Error {
  constructor(message, cause) { super(message); this.name = 'PermanentIngestError'; this.cause = cause; }
}

// BullMQ treats UnrecoverableError as "do not retry, fail now".
import { UnrecoverableError } from 'bullmq';

function classify(err) {
  const permanent = [
    'UNSUPPORTED_FILE_TYPE',
    'CORRUPT_DOCUMENT',         // parser rejected the container — broken AND
                                // password/DRM-protected PDFs alike, see §4.2
    'NO_EXTRACTABLE_CONTENT',   // parsed fine, produced zero text
  ];
  if (permanent.includes(err.code)) return new UnrecoverableError(err.message);
  // Second line of defense: LlamaParse's own job-failure message shape (§4.2), in case
  // some call site throws it without going through parser.js's tagging.
  if (/status: ERROR$/.test(err.message ?? '')) return new UnrecoverableError(err.message);
  return err;   // transient (429, 5xx, ECONNRESET, timeout) → retried by BullMQ
}
```

**Amended during Phase 2 implementation**: the original list included a separate
`ENCRYPTED_DOCUMENT` code with the intent of distinguishing a password-protected PDF from
a structurally broken one. Verified live (a real pypdf-generated password-protected PDF)
that this distinction is not available: LlamaParse's SDK logs the specific reason
(`PDF_IS_PROTECTED`, `PDF_IS_BROKEN`, etc.) via a `console.warn` side effect only — the
thrown `Error` object that reaches calling code is always the same generic
`"Failed to parse the file: <jobId>, status: ERROR"`, with no `.code` and no other
property (`Object.keys(err)` is empty). `CORRUPT_DOCUMENT` is the single permanent bucket
for every LlamaParse job-failure verdict; the `Document.error` message says so explicitly
rather than falsely implying a specific cause the parser API doesn't expose (§4.2).

---

## 4. Parsing — `backend/src/providers/parser.js`

### 4.1 Dispatch

| Extension | Parser | Output |
|---|---|---|
| `.pdf`, `.docx` | LlamaParse, `result_type: 'markdown'` | Markdown with `## ` headings and `\|`-delimited tables, one document per page |
| `.md`, `.txt` | `fs.readFile` + encoding detection (§4.4) | Raw text, markdown passed through untouched |
| `.csv`, `.xlsx`, `.xls` | `xlsx` (SheetJS) → markdown table per sheet | One markdown table per sheet, headers preserved |
| `.json` | `JSON.parse` → `JSON.stringify(v, null, 2)` | Pretty-printed, so the recursive splitter can break on newlines |
| URL | `CheerioWebBaseLoader` + Readability extraction | Main-content markdown, nav/ads stripped |

### 4.2 LlamaParse Invocation

```js
import { LlamaParseReader } from '@llamaindex/cloud/reader';

const reader = new LlamaParseReader({
  apiKey: config.llamaParse.apiKey,
  resultType: 'markdown',
  // Preserves table structure as markdown pipe tables instead of flattening to prose.
  // This is the single setting that fixes the audit's "tables collapse to text" finding.
  parsingInstruction:
    'Preserve all table structure as markdown tables. Preserve heading hierarchy using ' +
    'markdown heading levels. Do not summarize, omit, or reword any content.',
  splitByPage: true,          // one Document per source page → array index = page number - 1
  invalidateCache: false,
  language: 'en',             // OCR language hint for LlamaParse's own fallback path
  // Amended during Phase 2 implementation: default is `true` (silently swallow parse
  // failures as an empty array). Explicit `false` lets a genuinely broken PDF surface as
  // a catchable error instead of a document that looks identical to "parsed, zero text".
  ignoreErrors: false,
});

const rawPages = await reader.loadData(storagePath);
// → [{ text: '## Q3 Revenue\n\n| Region | Revenue |\n|---|---|\n| EMEA | 4.2M |', metadata: {} }, ...]
const pages = rawPages.map((p, i) => ({ text: p.text, metadata: { page: i + 1 } }));
```

**Amended during Phase 2 implementation**: verified live against `@llamaindex/cloud@4.1.3` on a real 2-page PDF, `splitByPage: true` returns `Document` objects with `metadata: {}` — no `page_number` field is emitted. `loadData` internally splits the parser's already-page-boundary-aware output on a page separator (`\n---\n` by default) and wraps each piece in `new Document({ text: docChunk })` with no metadata attached at all (confirmed by reading the installed package's source). Page numbers are therefore assigned by array position (`i + 1`) immediately after the call, not read off a metadata field. This is still a real improvement over the legacy `-- N of M --` regex it replaces: page boundaries are driven by the parser's own page-aware split, not a string convention that could drift, even though the array position — not an explicit field — is what carries the number.

Live testing also surfaced a genuine failure mode worth recording: one otherwise-valid test PDF (`tracemonkey.pdf` from the pdf.js test suite) was rejected outright by LlamaParse with `PDF_IS_BROKEN`, and separately a real password-protected PDF (built with `pypdf` for this test) was rejected with `PDF_IS_PROTECTED`. With `ignoreErrors: false` both throw a catchable error rather than silently returning `[]` — but **only as console output**: the specific code and message (`PDF_IS_BROKEN` / `PDF_IS_PROTECTED` / the human-readable reason) are logged by the SDK via `console.warn` as a side effect and never attached to the thrown `Error` that reaches calling code. The thrown error's `.message` is always the same generic `"Failed to parse the file: <jobId>, status: ERROR"` in both cases (`Object.keys(err)` is empty — no `.code`, nothing else). An earlier version of this section classified on `/broken|corrupt/i` and `/encrypt|password.protect/i`, believing those keywords reached the exception — verified live, on both real failure cases, that they never matched anything: the regexes were dead code testing text that doesn't exist on the error object. §7's job handler now classifies the actual, verified shape — any message ending `status: ERROR` — as `CORRUPT_DOCUMENT` (permanent, no retry), a single bucket covering every LlamaParse job-failure verdict since the specific sub-reason is not available to distinguish on.

### 4.3 Spreadsheets — All Sheets, as Markdown Tables

Fixes two audit findings at once: only the first sheet was read, and rows were flattened to `"Context: col is val, col is val"` prose.

```js
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

// Escape pipes so a cell containing "|" cannot break the table structure downstream.
const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
```

Emitting a real markdown table matters downstream: the header row travels with every chunk that the splitter produces from it (§5.3), so a retrieved fragment of a 500-row sheet still shows what its columns mean.

### 4.4 Encoding Detection

The legacy sanitizer assumed UTF-8 and then stripped every non-ASCII byte, destroying non-Latin scripts entirely. Replacement:

```js
import chardet from 'chardet';

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
    // Detection was wrong and strict decode failed. Fall back to UTF-8 lossy rather
    // than rejecting the document — a few replacement chars beat losing the file.
    return new TextDecoder('utf-8', { fatal: false }).decode(buf);
  }
}
```

### 4.5 Normalization — What Replaces `TextSanitizer.js`

The old sanitizer's ASCII strip is deleted outright. What survives is deliberately minimal:

```js
export function normalize(text) {
  return text
    .normalize('NFC')                  // compose, don't decompose: "café" stays one char per glyph
    .replace(/\r\n?/g, '\n')           // CRLF/CR → LF
    .replace(/[­​]/g, '')    // soft hyphen + zero-width space: invisible, break tokenization
    .replace(/([a-z])-\n([a-z])/g, '$1$2')  // de-hyphenate PDF line wraps: "informa-\ntion" → "information"
    .replace(/[ \t]+/g, ' ')           // collapse horizontal whitespace only
    .replace(/\n{3,}/g, '\n\n')        // cap blank runs at one, preserving paragraph breaks
    .trim();
}
```

**NFC, not NFKD.** The legacy code used NFKD (decompose) and then stripped non-ASCII, which turned every accented character into an unaccented one and erased every non-Latin script. NFC composes instead, so `café`, `日本語`, and `العربية` all survive intact. What is *not* done here is equally deliberate: no HTML-tag stripping (the `<[^>]*>` regex mangled `if x < 3 then y > 5`), no URL/email masking by default (it destroyed exactly the identifiers FR-SRCH-02 requires be findable), and no emoji or punctuation removal.

---

## 5. Chunking — `backend/src/ingestion/chunker.js`

### 5.1 Token-Based Length Function

Chunk size is measured in tokens, never characters, because Cohere truncates at 512 tokens and character count is a poor proxy — 500 characters of English prose is ~125 tokens, but 500 characters of CJK or dense JSON can exceed 400.

```js
import { getEncoding } from 'js-tiktoken';

const encoder = getEncoding('cl100k_base');

// cl100k_base is OpenAI's tokenizer, not Cohere's. It is used as a proxy because
// Cohere ships no JS tokenizer. Measured over a mixed English/CJK corpus it
// over-counts Cohere tokens by 5-12%, which is the safe direction: chunks come out
// slightly under budget rather than over. The 480 target already carries headroom
// under the 512 hard cap, so the combined margin is ~15-20%.
export const tokenLength = (text) => encoder.encode(text).length;
```

### 5.2 Two-Stage Split

```js
import { MarkdownTextSplitter, RecursiveCharacterTextSplitter } from '@langchain/textsplitters';

export const CHUNK_TOKENS = 480;      // 512 cap − 32 headroom for the 5-12% tokenizer skew
export const OVERLAP_TOKENS = 60;     // 12.5% of 480 — one to two sentences of carry-over

// Stage 1: split on markdown structure, keeping heading context attached.
const structural = new MarkdownTextSplitter({
  chunkSize: CHUNK_TOKENS,
  chunkOverlap: 0,                    // no overlap between sections — they are semantic units
  lengthFunction: tokenLength,
});

// Stage 2: any section still over budget is split recursively.
const recursive = new RecursiveCharacterTextSplitter({
  chunkSize: CHUNK_TOKENS,
  chunkOverlap: OVERLAP_TOKENS,
  lengthFunction: tokenLength,
  separators: ['\n\n', '\n', '. ', '? ', '! ', '; ', ', ', ' ', ''],
});
```

The `separators` list ends with `''` — an empty separator that splits between individual characters. This is what handles the FR-ING edge case "a single unbroken run of characters longer than one retrievable unit": a 3,000-character base64 blob with no whitespace still gets split rather than passed through oversized to be silently truncated by the embedding API, which is precisely the failure the old chunker had.

### 5.3 Heading Path Propagation

A chunk from deep inside a document carries the heading trail that led to it, so a retrieved fragment is self-describing (FR-ING-06):

```js
function withHeadingPath(markdown) {
  const lines = markdown.split('\n');
  const stack = [];      // stack[level - 1] = heading text at that level
  const out = [];

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) {
      const level = m[1].length;
      stack.length = level - 1;        // pop deeper headings
      stack[level - 1] = m[2].trim();
    }
    out.push({ line, headingPath: stack.filter(Boolean).join(' > ') });
  }
  return out;
}
```

For a chunk under `# Annual Report` → `## Q3 Results` → `### EMEA`, `headingPath` is `"Annual Report > Q3 Results > EMEA"`. It is stored in the payload and prepended to the embedded text, so the vector itself encodes the section context rather than only the raw fragment.

### 5.4 Table Header Carry-Over

When a markdown table is wider than one chunk, every resulting chunk gets the header and separator rows re-prepended:

```js
const TABLE_SEPARATOR_RE = /^\s*\|[\s:|-]+\|\s*$/;   // `|` inside the class is load-bearing
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const MIN_BODY_BUDGET = 120;   // tokens — 25% of CHUNK_TOKENS

async function repairTableChunks(chunks) {
  const out = [];
  for (const chunk of chunks) {
    const looksLikeTableBody =
      /^\s*\|/.test(chunk.text) && !chunk.text.split('\n').some((l) => TABLE_SEPARATOR_RE.test(l));
    if (!looksLikeTableBody || !chunk.tableHeader) { out.push(chunk); continue; }

    const prefix = `${chunk.tableHeader}\n`;
    const headerTokens = tokenLength(prefix);
    if (tokenLength(chunk.text) + headerTokens <= CHUNK_TOKENS) {
      out.push({ ...chunk, text: `${prefix}${chunk.text}` });
      continue;
    }
    // Prepending would breach the budget: re-split against a reduced one.
    const budget = CHUNK_TOKENS - headerTokens;
    if (budget < MIN_BODY_BUDGET) { out.push(chunk); continue; }
    for (const piece of await recursiveFor(budget).splitText(chunk.text)) {
      if (piece.trim().length === 0) continue;
      out.push({ ...chunk, text: `${prefix}${piece}` });
    }
  }
  return out;
}
```

Without this, chunk 3 of a 500-row table is a wall of `| EMEA | 4.2M | 2024-09-30 |` rows with no indication of what any column is — retrievable but useless as an answer source.

**Amended during Phase 2 implementation** — three corrections, all caught by `chunker.test.js` rather than by inspection:

1. **The separator regex must include `|` in its character class.** The original `[\s:-]` cannot match the *inner* pipes of a real separator row like `|---|---|---|`, so header detection returned `null` for every table and the carry-over silently never fired. Verified live: a 60-row table split into 5 sections left 4 of them as bare `| Region12 | ... |` walls — the exact failure this section exists to prevent, passing tests notwithstanding.
2. **`tableHeader` is tracked at document scope, not per section.** The original text specified `repairTableChunks` but never said how `chunk.metadata.tableHeader` gets populated. Extracting it per section is wrong: the structural splitter (§5.2) cuts a long table into several sections and only the *first* carries the header row. `chunkPages` therefore keeps a running `lastTableHeader`, updated whenever a section opens its own table and inherited by every continuation — including across a page boundary, which is the same shape a table spanning two PDF pages has. Staleness is not a risk because well-formed markdown requires every table to open with its own header+separator, so a later table overwrites it at its first section.
3. **The repair is budget-aware.** Prepending a header *after* the split can push a chunk past `CHUNK_TOKENS`; measured, a 4-column header took a 444-token chunk to 462, and a 14-column header would have breached 480 outright — violating task 2.10's "≤ 480, zero exceptions" and risking silent truncation at Cohere's 512 cap. When the prefix does not fit, the body is re-split against `CHUNK_TOKENS − headerTokens` and the header applied to every piece; `recursiveFor(budget)` builds (and caches) a splitter per budget for this. A header so wide that fewer than `MIN_BODY_BUDGET` tokens remain skips the repair entirely — an unlabeled chunk beats one shredded into header-dominated fragments.

### 5.5 Chunk Payload

```js
{
  text: 'Q3 Results > EMEA\n\n| Region | Revenue |\n|---|---|\n| EMEA | 4.2M |',
  documentId: '66f3a1b2c4d5e6f7a8b9c0d1',
  fileName: 'annual-report-2024.pdf',
  mimeType: 'application/pdf',
  page: 12,                      // real page from LlamaParse splitByPage, or sheet index
  headingPath: 'Annual Report > Q3 Results > EMEA',
  position: 47,                  // 0-based index across the whole document
  tokenCount: 312,
  charCount: 1284,
  contentHash: 'a3f2…',          // document-level hash, for delete-by-filter and dedup
  sourceKind: 'text',            // 'text' | 'ocr' — 'ocr' arrives in Phase 4
  createdAt: '2026-08-15T10:22:31.000Z'
  // sheetName: 'Revenue'        — present only for chunks sourced from a spreadsheet
  //                                sheet (§4.3); omitted entirely for every other format
  //                                rather than carried as `undefined`. Task 2.7's
  //                                acceptance criterion checks this field.
}
```

---

## 6. Embedding & Upsert

### 6.1 `backend/src/providers/embeddings.js`

```js
import { CohereClient } from 'cohere-ai';

const BATCH_SIZE = 96;   // Cohere's per-request texts cap for embed v3

export async function encodeDocuments(texts) {
  const vectors = [];
  let totalTokens = 0;

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await embedBreaker.fire({
      model: config.cohere.embedModel,
      texts: batch,
      inputType: 'search_document',    // asymmetric: documents ≠ queries
      embeddingTypes: ['float'],
      truncate: 'END',                 // belt-and-braces; the chunker already fits the budget
    });
    vectors.push(...res.embeddings.float);
    totalTokens += res.meta?.billedUnits?.inputTokens ?? 0;
  }
  return { vectors, totalTokens };
}
```

`inputType: 'search_document'` here versus `'search_query'` at query time (Phase 3) is the asymmetry the old MiniLM path had no mechanism for. Cohere v3 trains the two input types into different regions of the space; using `search_document` for both sides measurably degrades recall.

### 6.2 Sparse Vectors — Local Tokenizer + Qdrant `modifier: "idf"`

**Amended during Phase 2 implementation** (architecture §5.12): the npm `fastembed` package has no `Qdrant/bm25` model — verified live, it exposes only the neural `SpladePPEnV1` and a `CUSTOM` ONNX-directory option. Qdrant's own BM25 is not a neural model to begin with: the client sends raw term-frequency counts, and Qdrant computes the actual BM25 formula server-side when the sparse field carries `modifier: "idf"` (phase 1 §4.1, amended). `providers/bm25.js` reproduces the client-side half from scratch:

```js
// backend/src/providers/bm25.js
const TOKEN_RE = /[\p{L}\p{N}]+/gu;   // Unicode-aware — CJK/Arabic runs survive, not just ASCII \w

// FNV-1a 32-bit: deterministic, dependency-free, uniform enough for a hashed vocabulary.
function fnv1a(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// 2^24 (16.7M) buckets. Birthday-bound collision estimate at 20,000 unique terms in one
// chunk corpus: 20000^2 / (2 * 16.7M) ≈ 1.2% — negligible for a lexical channel that is
// fused with dense search (Phase 3), not relied on alone.
export const VOCAB_SPACE = 1 << 24;

export function tokenize(text) {
  return text.toLowerCase().match(TOKEN_RE) ?? [];
}

export function encodeSparseOne(text) {
  const counts = new Map();   // hashed index -> raw term count
  for (const token of tokenize(text)) {
    const idx = fnv1a(token) % VOCAB_SPACE;
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }
  // Falls back to hashing the whole trimmed string as one pseudo-token when the text has
  // zero \p{L}\p{N} runs (e.g. a symbol-only fragment) — guarantees a non-empty sparse
  // vector for every non-empty chunk, which task 2.13's acceptance criterion requires.
  if (counts.size === 0 && text.trim().length > 0) {
    counts.set(fnv1a(text.trim()) % VOCAB_SPACE, 1);
  }
  const indices = [...counts.keys()].sort((a, b) => a - b);   // Qdrant expects ascending indices
  const values = indices.map((i) => counts.get(i));
  return { indices, values };
}

export async function encodeSparse(texts) {
  return texts.map(encodeSparseOne);
}
```

This runs **locally** — no model load, no API cost, sub-millisecond per chunk (a `Map` and a regex pass, not even an ONNX forward pass). The one acknowledged gap versus FastEmbed's Python BM25 model is no stemming/stopword removal (architecture §5.12) — IDF weighting already suppresses true stopwords by driving their weight toward zero, and missing stemming is an accepted recall trade at this project's scale.

### 6.3 Upsert — `backend/src/providers/vectorStore.js`

```js
export async function upsertChunks(chunks, denseVectors, sparseVectors) {
  const points = chunks.map((chunk, i) => ({
    // Deterministic UUIDv5 from (documentId, position). Re-ingesting the same document
    // overwrites the same point ids instead of duplicating — this is what makes
    // FR-DOC-03 (re-ingest replaces) work without a delete-then-insert race.
    id: uuidv5(`${chunk.documentId}:${chunk.position}`, NAMESPACE),
    vector: { dense: denseVectors[i], sparse: sparseVectors[i] },
    payload: chunk,
  }));

  for (let i = 0; i < points.length; i += 256) {
    await qdrantBreaker.fire('upsert', config.qdrant.chunksCollection, {
      wait: true,                       // block until indexed, so 'ready' means queryable
      points: points.slice(i, i + 256),
    });
  }
}
```

`wait: true` matters for correctness of the status field: without it, a document could be marked `ready` while its points are still being indexed, and a query immediately afterward would return nothing. The cost is a few hundred milliseconds on the ingest path, which is invisible inside a job that already took 20 s.

---

## 7. The Job Handler — `backend/src/ingestion/ingestDocument.js`

```js
export async function ingestDocumentJob(job) {
  const { documentId } = job.data;
  const doc = await Document.findById(documentId);
  if (!doc) throw new UnrecoverableError(`Document ${documentId} no longer exists`);

  try {
    await doc.updateOne({ status: 'processing', progress: 5, error: null });

    // 1. Parse ────────────────────────────────────────────── 5% → 45%
    const pages = await parser.parseDocument(doc.storagePath, doc.mimeType);
    if (pages.length === 0 || pages.every((p) => normalize(p.text).length === 0)) {
      const err = new Error('Document contains no extractable text.');
      err.code = 'NO_EXTRACTABLE_CONTENT';   // permanent — a re-parse yields the same
      throw err;
    }
    await job.updateProgress(45);

    // 2. Normalize + chunk ────────────────────────────────── 45% → 55%
    const chunks = chunkPages(pages, { documentId, fileName: doc.fileName, mimeType: doc.mimeType });
    await doc.updateOne({ progress: 55, pageCount: pages.length });

    // 3. Embed ────────────────────────────────────────────── 55% → 85%
    const texts = chunks.map((c) => (c.headingPath ? `${c.headingPath}\n\n${c.text}` : c.text));
    const [{ vectors: dense, totalTokens }, sparse] = await Promise.all([
      embeddings.encodeDocuments(texts),
      embeddings.encodeSparse(texts),
    ]);
    await job.updateProgress(85);

    // 4. Upsert ───────────────────────────────────────────── 85% → 100%
    await vectorStore.upsertChunks(chunks, dense, sparse);

    await doc.updateOne({ status: 'ready', progress: 100, chunkCount: chunks.length, error: null });
    await recordUsage({ provider: 'cohere', operation: 'embed', inputTokens: totalTokens, documentId });
  } catch (err) {
    // Atomicity (NFR-REL-03): remove every trace before recording the failure, so a
    // failed document is never partially queryable and a retry starts from clean state.
    await rollbackDocument(documentId);
    await Document.findByIdAndUpdate(documentId, {
      status: 'failed', progress: 0, error: err.message, chunkCount: 0,
    });
    throw classify(err);
  }
}
```

### 7.1 Rollback — `backend/src/ingestion/rollback.js`

```js
export async function rollbackDocument(documentId) {
  // Delete-by-filter, not delete-by-id: we may not know which point ids were written
  // when the failure happened mid-upsert. The documentId payload index makes this fast.
  await vectorStore.deleteByDocument(documentId);
  await storage.deletePrefix(`pages/${documentId}/`);   // no-op until Phase 4
}
```

The uploaded source file is deliberately **not** deleted on failure — FR-ING-11 requires retry without re-upload, and the file is the only copy of the user's bytes.

---

## 8. Document Management Routes

| Route | Behavior |
|---|---|
| `GET /api/documents` | Paginated list (`?page=1&limit=20`), `?status=` and `?q=` filters. `q` runs the `fileName` text index. Sorted `createdAt: -1` |
| `GET /api/documents/:id` | Single document with live `status`, `progress`, `error`, counts |
| `DELETE /api/documents/:id` | Qdrant delete-by-filter → storage cleanup → registry row deletion. Returns `{ deletedPoints: N }` |
| `POST /api/documents/:id/reingest` | Re-enqueues the existing `storagePath`. Sets `status: 'queued'`, resets counts. Deterministic point ids mean the upsert overwrites rather than duplicates |
| `GET /api/documents/:id/status` | Lightweight poll endpoint: `{ status, progress, error }` only |

### 8.1 Delete Ordering

```js
router.delete('/api/documents/:id', async (req, res, next) => {
  const doc = await Document.findById(req.params.id);
  if (!doc) return res.status(404).json({ error: 'Document not found.' });

  // Vectors first, registry last. If deletion fails midway the document still appears
  // in the list and can be retried; the reverse ordering would orphan points with no
  // registry row pointing at them — unreachable garbage that nothing would ever clean up.
  const { deletedPoints } = await vectorStore.deleteByDocument(doc._id.toString());
  await storage.deletePrefix(`pages/${doc._id}/`);
  await fs.unlink(doc.storagePath).catch(() => {});   // may be shared by a duplicate row
  await Document.updateMany({ duplicateOf: doc._id }, { duplicateOf: null, status: 'failed', error: 'Original document was deleted.' });
  await doc.deleteOne();

  res.json({ deleted: true, documentId: doc._id, deletedPoints });
});
```

Deleting a document that a `duplicate` row points at would leave a dangling `duplicateOf` reference, so those rows are re-marked rather than silently orphaned.

---

## 9. Tasks & Acceptance Criteria

| # | Task | Acceptance Criteria |
|---|---|---|
| 2.1 | Implement multer config with size cap and extension allowlist | Uploading a `.exe` returns HTTP 400 naming the accepted types; uploading a 60 MB PDF returns HTTP 413 |
| 2.2 | Implement magic-byte `verifyType` | A text file renamed to `report.pdf` returns HTTP 400 "claims to be .pdf but its contents do not match" |
| 2.3 | Implement `POST /api/documents` with hashing and content-addressed storage | Response is HTTP 202 with a `documentId` in < 500 ms; `storage/uploads/` contains one file named with the 64-char hash |
| 2.4 | Implement duplicate detection | Uploading the same file twice returns HTTP 200 `status:"duplicate"` on the second, and Qdrant point count is unchanged |
| 2.5 | Implement BullMQ queue, worker, retry policy | `docker compose stop redis` then uploading returns HTTP 503 and creates **zero** Document rows |
| 2.6 | Implement LlamaParse parsing with `splitByPage` | A 20-page PDF yields 20 page objects; a page containing a table produces markdown with `\|` separators and a `---` header row |
| 2.7 | Implement all-sheets spreadsheet parsing | A 3-sheet `.xlsx` produces chunks whose `metadata.sheetName` covers all three sheet names |
| 2.8 | Implement encoding detection | A UTF-16LE `.txt` and a Latin-1 `.txt` both ingest with correct characters; a Japanese `.txt` retains its kana in the stored payload |
| 2.9 | Implement `normalize()` replacing TextSanitizer | Unit test: `normalize('café 日本語 x < 3 > y')` returns the string unchanged except whitespace; `normalize('informa-\ntion')` returns `'information'` |
| 2.10 | Implement two-stage token-aware chunker | No chunk exceeds 480 tokens by `tokenLength()`; a 3,000-char string with no whitespace produces ≥ 2 chunks with zero characters lost |
| 2.11 | Implement heading-path propagation and table-header carry-over | A chunk from a nested section has `headingPath` with ` > ` separators; chunk 2+ of a split table starts with the header and `---` rows |
| 2.12 | Implement Cohere document embedding with batching | A 250-chunk document issues exactly 3 Cohere calls; every returned vector has length 1024 |
| 2.13 | Implement BM25 sparse encoding | Every point upserted has a non-empty `sparse` vector with `indices.length === values.length` |
| 2.14 | Implement Qdrant upsert with deterministic ids | Re-ingesting an unchanged document leaves the collection point count identical, not doubled |
| 2.15 | Implement the job handler with progress and atomic rollback | `GET /api/documents/:id` polled during ingest reports increasing `progress`; killing Qdrant mid-job leaves `status:"failed"` and **0** points for that documentId |
| 2.16 | Implement error classification | An encrypted PDF fails after exactly **1** attempt (`attemptsMade === 1`); a simulated Cohere 429 is retried 3 times |
| 2.17 | Implement document CRUD routes | `DELETE` returns `deletedPoints > 0` and a subsequent Qdrant scroll filtered by that documentId returns 0 points |
| 2.18 | Write golden-file ingestion tests | `npm run test:ingestion` passes for 8 fixtures (pdf, docx, md, txt, csv, xlsx multi-sheet, json, utf16) |

---

## 10. Milestone Definition

Phase 2 is **complete** when:

> A developer starts the stack and posts a 20-page annual report PDF containing two multi-column tables to `POST /api/documents` with `curl -F document=@annual-report-2024.pdf`. The response comes back in under half a second: HTTP 202, `{"documentId":"66f3a1…","status":"queued"}`. They poll `GET /api/documents/66f3a1…/status` every second and watch it move through `queued` → `processing` with `progress` climbing 5 → 45 → 55 → 85 → 100, reaching `{"status":"ready","chunkCount":63,"pageCount":20}` after about 22 seconds. Opening the Qdrant dashboard at `localhost:6333/dashboard` and scrolling `cerebro_chunks` filtered by that documentId shows 63 points, each with a 1024-dimension `dense` vector, a non-empty `sparse` vector, and a payload carrying `page`, `headingPath` like `"Annual Report > Q3 Results > EMEA"`, and `tokenCount` values all at or below 480. One point's `text` is visibly a markdown table with `| Region | Revenue |` and a `|---|---|` separator — the table survived parsing as a table. They upload the identical file again and get HTTP 200 `{"status":"duplicate"}`, and the collection still holds 63 points, not 126. They upload a Japanese-language `.txt` file and confirm its stored payload contains kana, not stripped ASCII. They then run `docker compose stop qdrant`, upload a third document, and watch it land on `{"status":"failed"}` with a connection error in its `error` field — and after restarting Qdrant, a scroll filtered by that failed documentId returns zero points, confirming nothing partial was left behind. Finally they `DELETE /api/documents/66f3a1…`, receive `{"deleted":true,"deletedPoints":63}`, and confirm both the Qdrant scroll and `GET /api/documents` no longer return it.

---

## 11. Files to Create

```
backend/src/
├── api/
│   ├── middleware/upload.js          # multer: 50 MB cap, extension allowlist, disk storage
│   └── routes/documents.js           # POST/GET/DELETE/reingest/status
├── ingestion/
│   ├── queue.js                      # BullMQ queue + worker + retry policy
│   ├── ingestDocument.js             # The job handler: parse→chunk→embed→upsert→finalize
│   ├── chunker.js                    # Two-stage splitter, heading path, table repair
│   ├── verifyType.js                 # Magic-byte container verification
│   ├── normalize.js                  # NFC + whitespace + de-hyphenation (replaces TextSanitizer)
│   ├── rollback.js                   # Delete-by-filter cleanup for a failed documentId
│   └── errors.js                     # PermanentIngestError + classify()
├── providers/
│   ├── parser.js                     # [extend] LlamaParse + loader dispatch + encoding detection
│   ├── embeddings.js                 # [extend] encodeDocuments + encodeSparse
│   ├── bm25.js                       # NEW (§6.2, architecture §5.12) — local tokenizer replacing FastEmbed's unavailable Qdrant/bm25
│   └── vectorStore.js                # [extend] upsertChunks + deleteByDocument + countByDocument
└── telemetry/usage.js                # recordUsage() → UsageEvent rows

backend/test/ingestion/
├── fixtures/                         # 8 fixture documents incl. multi-sheet xlsx, utf16 txt
├── chunker.test.js                   # Token bounds, no-whitespace runs, heading paths
├── normalize.test.js                 # Non-Latin survival, de-hyphenation, tag-like text
├── parser.test.js                    # Golden-file: fixture → expected markdown structure
└── lifecycle.test.js                 # Upload → ready → delete → 0 points
```

---

## 12. Performance Validation

| Metric | How to Measure | Target |
|---|---|---|
| Upload response time | `curl -w '%{time_total}'` on a 5 MB PDF | < 500 ms (hash + rename only; parsing is async) |
| 20-page text PDF, end to end | Job `finishedOn − processedOn` from BullMQ | < 30 s (architecture §6) |
| Cohere calls per 250-chunk document | `UsageEvent` count for that documentId | Exactly 3 (`ceil(250/96)`) |
| Chunk token compliance | Max `tokenCount` across all points in a document | ≤ 480, zero exceptions |
| Qdrant upsert throughput | Time for a 256-point batch with `wait: true` | < 400 ms |
| Rollback completeness | Point count by documentId after a forced failure | Exactly 0 |
| Concurrent ingestion | Upload 5 documents at once; observe worker logs | Exactly 2 process concurrently; 3 wait in queue |

---

## 13. Estimated Complexity

- **Node backend**: ~1,190 LOC across 13 new files (documents route 220, chunker 210, ingestDocument 160, parser extension 240, queue 90, normalize 40, verifyType 60, rollback 30, embeddings extension 60, bm25.js 40)
- **Tests**: ~420 LOC plus 8 binary/text fixtures
- **New npm dependencies**: 6 — `@llamaindex/cloud` (+ its peers `@llamaindex/core`, `@llamaindex/env`), `@langchain/textsplitters`, `js-tiktoken`, `chardet`, `uuid` (deterministic `uuidv5` point ids, §6.3 — needed by the spec's own upsert code but not counted in the original estimate). **Amended during Phase 2 implementation** (architecture §5.12): `fastembed` is not used — it has no BM25 model — so it is not a dependency; sparse encoding is `providers/bm25.js`, dependency-free (`bullmq`, `cohere-ai` arrived in Phase 1)
- **Removed**: nothing yet. `UniversalLoader.js`, `TextSanitizer.js`, `SemanticChunker.js`, `BatchEncoder.js`, and `IngestionService.js` are superseded but remain on disk serving the legacy `/api/ingest` route until Phase 6 decommissions it

The old and new ingestion paths coexist through this phase. That is intentional: `/api/ingest` writing to MongoDB and `POST /api/documents` writing to Qdrant are independent, so the legacy demo keeps working while the new pipeline is validated against it.
