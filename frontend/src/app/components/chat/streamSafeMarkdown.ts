// phase_3_chat_ui.md §4.2
//
// Closes constructs that are still open at the end of a partial buffer, so a
// half-arrived answer renders as what it is becoming rather than as damage.
// Applied ONLY while status === 'streaming'; a completed answer is rendered raw.

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Strips fenced code blocks (```/~~~) from a buffer so a `$$` or `$` inside a code
 *  sample is never mistaken for an open math delimiter — it's literal text there. */
function stripFencedBlocks(buffer: string): string {
  const lines = buffer.split('\n');
  const out: string[] = [];
  let open: string | null = null;
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (m) {
      const token = m[1][0].repeat(m[1].length);
      if (open === null) { open = token; continue; }
      if (m[1][0] === open[0] && m[1].length >= open.length) { open = null; continue; }
    }
    if (open === null) out.push(line);
  }
  return out.join('\n');
}

export function streamSafeMarkdown(buffer: string): string {
  const lines = buffer.split('\n');
  let out = buffer;

  // 1. Code fences. Count openers/closers; an odd count means one is open.
  //    The closing token must match the opener's character and be at least as
  //    long — ```` ``` ```` does not close ```` ~~~~ ````.
  let open: string | null = null;
  for (const line of lines) {
    const m = FENCE.exec(line);
    if (!m) continue;
    if (open === null) open = m[1][0].repeat(m[1].length);
    else if (m[1][0] === open[0] && m[1].length >= open.length) open = null;
  }
  if (open !== null) out += `\n${open}`;

  // 2. Display math. $$ pairs; an odd count means one is open. Counted only
  //    outside code spans, since $$ inside a fence is literal text.
  const outsideCode = stripFencedBlocks(out);
  if ((outsideCode.match(/\$\$/g)?.length ?? 0) % 2 === 1) out += '$$';

  // 3. Inline math. Single $ delimiters, same parity rule, but ONLY when the
  //    buffer contains at least one $$-free $ pair already — otherwise a lone
  //    dollar sign in prose ("costs $4.2M") would be treated as an opener and
  //    every subsequent token would render as math. Verified against the exact
  //    phrasing this app produces: financial figures are the most common source
  //    of a stray $ in a grounded answer about earnings documents.
  const inline = outsideCode.replace(/\$\$/g, '');
  const dollars = inline.match(/(?<!\\)\$/g)?.length ?? 0;
  if (dollars % 2 === 1 && /(?<!\\)\$[^$\n]+(?<!\\)\$/.test(inline)) out += '$';

  // 4. A trailing partial table row (a line starting with | and no newline yet)
  //    is dropped rather than closed — a half-written row has no honest
  //    rendering, and it will arrive complete within a few tokens.
  const last = out.slice(out.lastIndexOf('\n') + 1);
  if (/^\s*\|/.test(last) && !out.endsWith('\n')) out = out.slice(0, out.lastIndexOf('\n'));

  return out;
}
