// task 3.19 — parity check between frontend/src/app/components/chat/refusals.ts and
// backend/src/graph/prompts.js's MESSAGES. Reads the backend source as text rather than
// importing it (it's a separate Node package with its own module graph) so a drift between
// the two lists is caught here instead of degrading the chat UI silently.
// Run directly with `node test/refusals.test.ts` (Node 22's built-in type stripping),
// matching this repo's existing test/*.test.mjs convention — see frontend/test/stage.test.ts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { REFUSAL_MESSAGES, isRefusal } from '../src/app/components/chat/refusals.ts';

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

const backendPath = fileURLToPath(new URL('../../backend/src/graph/prompts.js', import.meta.url));
const backendSource = readFileSync(backendPath, 'utf8');

// Extracts each string literal value assigned inside the MESSAGES object. Matches both
// single- and double-quoted values, in source order.
function extractBackendMessages(source: string): string[] {
  const blockMatch = /export const MESSAGES = \{([\s\S]*?)\};/.exec(source);
  assert.ok(blockMatch, 'backend prompts.js must export a MESSAGES object');
  const body = blockMatch[1];
  const values: string[] = [];
  const re = /:\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    values.push(m[2]);
  }
  return values;
}

check('backend MESSAGES has exactly three entries', () => {
  const backendValues = extractBackendMessages(backendSource);
  assert.equal(backendValues.length, 3, `expected 3 MESSAGES, found ${backendValues.length}`);
});

check('frontend REFUSAL_MESSAGES has exactly three entries', () => {
  assert.equal(REFUSAL_MESSAGES.length, 3);
});

check('frontend and backend refusal strings match exactly (order-independent)', () => {
  const backendValues = extractBackendMessages(backendSource).sort();
  const frontendValues = [...REFUSAL_MESSAGES].sort();
  assert.deepEqual(frontendValues, backendValues);
});

check('isRefusal matches each known refusal string', () => {
  for (const msg of REFUSAL_MESSAGES) assert.equal(isRefusal(msg), true, msg);
});

check('isRefusal rejects an ordinary answer, including one containing a refusal as substring', () => {
  assert.equal(isRefusal('EMEA revenue was $4.2M in Q3.'), false);
  assert.equal(isRefusal('I could not find anything in your documents relevant to that question. But here is a guess.'), false);
});

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll checks passed.`);
