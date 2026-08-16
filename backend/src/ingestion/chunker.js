import { getEncoding } from 'js-tiktoken';
import { MarkdownTextSplitter, RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { normalize } from './normalize.js';

const encoder = getEncoding('cl100k_base');

// cl100k_base is OpenAI's tokenizer, not Cohere's. It is used as a proxy because Cohere
// ships no JS tokenizer. Measured over a mixed English/CJK corpus it over-counts Cohere
// tokens by 5-12%, which is the safe direction: chunks come out slightly under budget
// rather than over. The 480 target already carries headroom under the 512 hard cap, so
// the combined margin is ~15-20%.
export const tokenLength = (text) => encoder.encode(text).length;

export const CHUNK_TOKENS = 480;    // 512 cap - 32 headroom for the 5-12% tokenizer skew
export const OVERLAP_TOKENS = 60;   // 12.5% of 480 - one to two sentences of carry-over

// Stage 1: split on markdown structure, keeping heading context attached.
const structural = new MarkdownTextSplitter({
  chunkSize: CHUNK_TOKENS,
  chunkOverlap: 0,                  // no overlap between sections - they are semantic units
  lengthFunction: tokenLength,
});

// Stage 2: any section still over budget is split recursively. The separators list ends
// with '' - an empty separator that splits between individual characters. This handles
// a 3,000-character base64 blob with no whitespace: it still gets split rather than
// passed through oversized to be silently truncated by the embedding API.
//
// Built per budget rather than as a single singleton: table-continuation chunks get their
// header row prepended after splitting (§5.4), so they must be split against a *reduced*
// budget that leaves room for it, or the repair would push them past CHUNK_TOKENS. Cached
// because a splitter is cheap but not free and there are only ever a handful of budgets.
const recursiveByBudget = new Map();
function recursiveFor(budget) {
  if (!recursiveByBudget.has(budget)) {
    recursiveByBudget.set(budget, new RecursiveCharacterTextSplitter({
      chunkSize: budget,
      // Overlap must stay well under the budget or the splitter makes no forward progress.
      chunkOverlap: Math.min(OVERLAP_TOKENS, Math.floor(budget / 4)),
      lengthFunction: tokenLength,
      separators: ['\n\n', '\n', '. ', '? ', '! ', '; ', ', ', ' ', ''],
    }));
  }
  return recursiveByBudget.get(budget);
}
const recursive = recursiveFor(CHUNK_TOKENS);

// Heading-path propagation (phase 2 §5.3). Walks a markdown string line by line, tracking
// the open heading stack, and returns the heading path active at each line. The stack is
// passed in (not created fresh) so it persists across pages within one document: a
// document's heading hierarchy declared on page 11 still applies to page 12's content
// until a new heading appears — resetting per page would falsely blank the path for every
// page that continues a section without repeating its heading.
function withHeadingPath(markdown, stack) {
  const lines = markdown.split('\n');
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

// Table header carry-over (phase 2 §5.4). Detects the header+separator row pair at the
// top of a markdown table so it can be re-prepended to any chunk that lands mid-table
// after splitting.
// A separator row's interior is only pipes, dashes, colons (alignment markers) and spaces
// — e.g. `|---|---|` or `|:---|---:|`. The `|` in this class is load-bearing: an earlier
// version used `[\s:-]`, which cannot match the inner pipes of `|---|---|---|`, so this
// function returned null for every real table and the §5.4 carry-over silently never fired
// (caught by chunker.test.js, not by inspection). `-` sits last so it is a literal, not a
// range endpoint.
const TABLE_SEPARATOR_RE = /^\s*\|[\s:|-]+\|\s*$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;

function extractTableHeader(text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length - 1; i++) {
    if (TABLE_ROW_RE.test(lines[i]) && TABLE_SEPARATOR_RE.test(lines[i + 1])) {
      return `${lines[i]}\n${lines[i + 1]}`;
    }
  }
  return null;
}

// A header wider than this leaves too little room for actual rows to be worth prepending.
// At that point the chunk is better off unlabeled than shredded into header-dominated
// fragments, so the repair is skipped and the raw body kept intact.
const MIN_BODY_BUDGET = 120;   // tokens - 25% of CHUNK_TOKENS

async function repairTableChunks(chunks) {
  const out = [];
  for (const chunk of chunks) {
    // Starts with a pipe (so it is table content) but contains no separator row anywhere
    // (so it is a continuation, not a table that already carries its own header).
    const looksLikeTableBody =
      /^\s*\|/.test(chunk.text) && !chunk.text.split('\n').some((l) => TABLE_SEPARATOR_RE.test(l));
    if (!looksLikeTableBody || !chunk.tableHeader) {
      out.push(chunk);
      continue;
    }

    const prefix = `${chunk.tableHeader}\n`;
    const headerTokens = tokenLength(prefix);

    if (tokenLength(chunk.text) + headerTokens <= CHUNK_TOKENS) {
      out.push({ ...chunk, text: `${prefix}${chunk.text}` });
      continue;
    }

    // Prepending would breach CHUNK_TOKENS. Re-split the body against a budget that
    // reserves room for the header on every piece, so task 2.10's "no chunk exceeds 480
    // tokens, zero exceptions" holds structurally rather than by luck of header width.
    const budget = CHUNK_TOKENS - headerTokens;
    if (budget < MIN_BODY_BUDGET) {
      out.push(chunk);
      continue;
    }
    for (const piece of await recursiveFor(budget).splitText(chunk.text)) {
      if (piece.trim().length === 0) continue;
      out.push({ ...chunk, text: `${prefix}${piece}` });
    }
  }
  return out;
}

// Finds the line index that `section` starts at within `page`, using a forward-only
// cursor since structural.splitText produces sections in order with zero overlap
// (chunkOverlap: 0) — each section's start is always at or after the previous one's.
function makeLineFinder(pageText) {
  const lines = pageText.split('\n');
  let searchFrom = 0;   // character cursor into pageText, forward-only
  let lineFrom = 0;     // line index cursor into lines, forward-only
  return (sectionText) => {
    const firstLine = sectionText.split('\n', 1)[0];
    for (let i = lineFrom; i < lines.length; i++) {
      if (lines[i].includes(firstLine.slice(0, 200))) {
        lineFrom = i;
        return i;
      }
    }
    return lineFrom;   // section text didn't match a line verbatim (rare) - best-effort
  };
}

// Orchestrates the two-stage split across every page of a parsed document into the final
// flat chunk-payload list (phase 2 §5.5). The spec defines each building block (tokenLength,
// the two splitters, withHeadingPath, repairTableChunks, the payload shape) but not their
// wiring — this function is that wiring, decided and documented here:
//
//   1. Normalize each page's text (NFC, de-hyphenate, collapse whitespace).
//   2. Run the structural (markdown-header) splitter per page, producing heading-bounded
//      sections.
//   3. For each section, resolve its headingPath by locating where it starts in the
//      page's line-by-line heading trail (built with a stack that persists across pages).
//   4. If a section still exceeds CHUNK_TOKENS, split it further with the recursive
//      splitter. Every resulting subchunk inherits its parent section's headingPath and
//      tableHeader — sub-splitting never crosses a heading or table boundary because the
//      structural stage already bounded the section to one.
//   5. Repair table chunks (re-prepend the header+separator row to any chunk that starts
//      mid-table).
//   6. Assign the final flat payload fields, including `position` (0-based across the
//      whole document, assigned only once every page is processed).
export async function chunkPages(pages, { documentId, fileName, mimeType, contentHash, sourceKind = 'text' }) {
  const stack = [];              // heading stack, shared across all pages of this document
  const rawChunks = [];          // { text, headingPath, page, tableHeader }

  // Last table header+separator pair seen anywhere in this document. Persists across
  // sections *and* pages, which is what makes §5.4 actually work: the structural splitter
  // cuts a long table into several sections and only the first one contains the header
  // row, so a per-section lookup finds null for every continuation chunk (verified live —
  // a 60-row table split into 5 sections left 4 of them as bare `| Region12 | ... |` walls).
  // A table spanning a PDF page boundary has the same shape, hence document scope rather
  // than page scope. Staleness is not a risk: well-formed markdown requires every table to
  // open with its own header+separator, so a later table overwrites this at its first
  // section, and repairTableChunks only ever applies it to chunks that already look like
  // table bodies.
  let lastTableHeader = null;

  for (const rawPage of pages) {
    const pageText = normalize(rawPage.text);
    if (pageText.length === 0) continue;   // a blank page contributes no chunks

    const annotated = withHeadingPath(pageText, stack);
    const findLine = makeLineFinder(pageText);
    const sections = await structural.splitText(pageText);

    for (const section of sections) {
      if (section.trim().length === 0) continue;

      // Resolve the heading path at the section's LAST line, not its first.
      //
      // Amended during Phase 2 implementation: resolving at the first line was wrong
      // whenever the structural splitter packs several headings into one section — which
      // is the common case, since it merges small sections up to the token budget. A
      // section reading `# Operating Review` / `## Regional Detail` / <paragraphs>
      // resolved to just "Operating Review", losing the nesting the whole feature exists
      // to provide (caught by the milestone walk: real ingested chunks visibly contained
      // both headings yet carried a single-level path). The last line is the heading
      // context governing the section's trailing content — which is the bulk of it — and
      // is identical to the first line's path for any section containing no headings.
      const startIdx = findLine(section);
      const endIdx = Math.min(startIdx + section.split('\n').length - 1, annotated.length - 1);
      const headingPath = annotated[Math.max(0, endIdx)]?.headingPath ?? '';

      // A section that opens its own table updates the running header; a continuation
      // section inherits whatever was last seen.
      const ownHeader = extractTableHeader(section);
      if (ownHeader) lastTableHeader = ownHeader;
      const tableHeader = lastTableHeader;

      if (tokenLength(section) <= CHUNK_TOKENS) {
        rawChunks.push({ text: section, headingPath, page: rawPage.metadata.page, sheetName: rawPage.metadata.sheetName, tableHeader });
        continue;
      }

      const subchunks = await recursive.splitText(section);
      for (const sub of subchunks) {
        if (sub.trim().length === 0) continue;
        rawChunks.push({ text: sub, headingPath, page: rawPage.metadata.page, sheetName: rawPage.metadata.sheetName, tableHeader });
      }
    }
  }

  const repaired = await repairTableChunks(rawChunks);

  return repaired.map((chunk, position) => {
    const payload = {
      text: chunk.text,
      documentId,
      fileName,
      mimeType,
      page: chunk.page,
      headingPath: chunk.headingPath,
      position,
      tokenCount: tokenLength(chunk.text),
      charCount: chunk.text.length,
      contentHash,
      sourceKind,           // 'text' | 'ocr' - phase 4 passes 'ocr' for chunked OCR text
      createdAt: new Date().toISOString(),
    };
    // sheetName only exists for spreadsheet sources (parser.js's parseSpreadsheet) — omit
    // the field entirely for every other format rather than carrying an undefined key.
    if (chunk.sheetName) payload.sheetName = chunk.sheetName;
    return payload;
  });
}
