// Standalone verification script (this repo's test/ convention — see AGENTS.md, no unified
// test framework). Exercises phase 2 task 2.9's acceptance criterion for normalize().
import assert from 'assert';
import { normalize } from '../../src/ingestion/normalize.js';

// Non-Latin and accented text survives unchanged except whitespace collapsing.
assert.strictEqual(
  normalize('café 日本語 x < 3 > y'),
  'café 日本語 x < 3 > y',
  'accented/non-Latin text and comparison operators must survive untouched',
);

// PDF line-wrap de-hyphenation.
assert.strictEqual(
  normalize('informa-\ntion'),
  'information',
  'a hyphen at end-of-line followed by a lowercase continuation must be removed',
);

// CRLF normalization.
assert.strictEqual(normalize('a\r\nb\r\nc'), 'a\nb\nc', 'CRLF must normalize to LF');

// Horizontal whitespace collapses; blank-line runs cap at one.
assert.strictEqual(
  normalize('a\t\t\tb\n\n\n\nc'),
  'a b\n\nc',
  'tabs/spaces collapse to one space; 3+ blank lines cap at one',
);

// Soft hyphen and zero-width space are invisible and must be stripped.
assert.strictEqual(
  normalize('soft­hyphen zero​width'),
  'softhyphen zerowidth',
  'soft hyphen (U+00AD) and zero-width space (U+200B) must be stripped',
);

// Arabic script (right-to-left) must also survive — not just CJK.
const arabic = 'مرحبا بالعالم';
assert.strictEqual(normalize(arabic), arabic, 'Arabic script must survive untouched');

console.log('[normalize.test] PASS — all 6 assertions');
