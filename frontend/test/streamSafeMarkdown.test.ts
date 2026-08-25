// task 3.9 — the six listed cases from phase_3_chat_ui.md §4.2, plus the table-row guard.
// Run directly with `node test/streamSafeMarkdown.test.ts` (Node 22's built-in type
// stripping), matching this repo's existing test/*.test.mjs convention.
import assert from 'node:assert/strict';
import { streamSafeMarkdown } from '../src/app/components/chat/streamSafeMarkdown.ts';

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL - ${name}`);
    console.error(err);
  }
}

check('an unclosed ``` fence gets a matching closer', () => {
  const out = streamSafeMarkdown('some text\n```python\nprint(1)');
  assert.equal(out, 'some text\n```python\nprint(1)\n```');
});

check('~~~ is not closed by ``` (different fence characters do not match)', () => {
  const out = streamSafeMarkdown('~~~js\nconsole.log(1)');
  assert.equal(out, '~~~js\nconsole.log(1)\n~~~');
});

check('a closed ``` fence is left untouched', () => {
  const buf = 'before\n```js\ncode\n```\nafter';
  assert.equal(streamSafeMarkdown(buf), buf);
});

check('a longer closing fence closes a shorter opener, but not vice versa', () => {
  // opener ``` (3), closer ```` (4) — closes, since closer length >= opener length
  assert.equal(streamSafeMarkdown('```\ncode\n````'), '```\ncode\n````');
  // opener ```` (4), closer ``` (3) — does not close, stays open
  const out = streamSafeMarkdown('````\ncode\n```');
  assert.equal(out, '````\ncode\n```\n````');
});

check('the buffer "costs $4.2M and" gains NO trailing $ (no complete $…$ pair exists yet)', () => {
  const out = streamSafeMarkdown('costs $4.2M and');
  assert.equal(out, 'costs $4.2M and');
});

check('the buffer "$x$ and $y" gains one trailing $ (a complete pair already exists)', () => {
  const out = streamSafeMarkdown('$x$ and $y');
  assert.equal(out, '$x$ and $y$');
});

check('an unclosed $$ display block gets a matching closer', () => {
  const out = streamSafeMarkdown('The formula is $$E = mc^2');
  assert.equal(out, 'The formula is $$E = mc^2$$');
});

check('a closed $$ display block is left untouched', () => {
  const buf = 'The formula is $$E = mc^2$$ and that is it';
  assert.equal(streamSafeMarkdown(buf), buf);
});

check('a $$ or $ inside an open code fence is not treated as math', () => {
  const out = streamSafeMarkdown('```\nprice = "$4.2M"\n');
  // Only the fence guard should fire; no trailing $ or $$ appended from the fenced text.
  assert.equal(out, '```\nprice = "$4.2M"\n\n```');
});

check('a trailing partial table row with no newline yet is dropped', () => {
  const out = streamSafeMarkdown('| Region | Revenue |\n| --- | --- |\n| EMEA | $4.2');
  assert.equal(out, '| Region | Revenue |\n| --- | --- |');
});

check('a complete table row (already newline-terminated) is left alone', () => {
  const buf = '| Region | Revenue |\n| --- | --- |\n| EMEA | $4.2M |\n';
  assert.equal(streamSafeMarkdown(buf), buf);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
