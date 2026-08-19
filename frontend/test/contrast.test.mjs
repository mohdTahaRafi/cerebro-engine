// phase_1 task 1.3 — verifies every light-mode contrast pair in phase_1 §2.2 against its
// stated WCAG 2.1 minimum, using the same hex values theme.css defines (kept in sync by
// hand — this script has no CSS parser, so a value that drifts in theme.css without a
// matching update here is a real gap; that's an accepted, stated limitation, not a
// silent one). It also confirms the two documented failing tokens are never used for
// visible text anywhere in the app, which is what makes the "fails, and that's fine"
// verdict actually true.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, '../src/app');

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// WCAG 2.1 relative luminance (§1.4.3's formula, via the spec's own reference algorithm).
function relativeLuminance({ r, g, b }) {
  const toLinear = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [r, g, b].map(toLinear);
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

function contrastRatio(hexA, hexB) {
  const la = relativeLuminance(hexToRgb(hexA));
  const lb = relativeLuminance(hexToRgb(hexB));
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

// Light-mode hex values, copied from theme.css §2.1's :root block.
const TOKENS = {
  ink: '#080D1C',
  'ink-secondary': '#293858',
  graphite: '#64779A',
  'graphite-faint': '#8B9AB8',
  signal: '#004FFE',
  'signal-on': '#FFFFFF',
  'positive-text': '#047857',
  positive: '#059669',
  'positive-soft': '#ECFDF5',
  line: '#DFE5F2',
  white: '#FFFFFF',
};

// [foreground, background, minimum ratio, expected verdict]
const PAIRS = [
  ['ink', 'white', 4.5, 'pass'],
  ['ink-secondary', 'white', 4.5, 'pass'],
  ['graphite', 'white', 4.5, 'pass'],
  ['graphite-faint', 'white', 3.0, 'fail'],
  ['signal', 'white', 4.5, 'pass'],
  ['signal-on', 'signal', 4.5, 'pass'],
  ['positive-text', 'positive-soft', 4.5, 'pass'],
  ['positive', 'positive-soft', 4.5, 'fail'],
  // line/white is a non-text separator — no minimum, printed but not asserted.
];

console.log('Light-mode contrast pairs (phase_1 §2.2):\n');
let failures = 0;
for (const [fg, bg, min, expected] of PAIRS) {
  const ratio = contrastRatio(TOKENS[fg], TOKENS[bg]);
  const verdict = ratio >= min ? 'pass' : 'fail';
  const marker = verdict === expected ? 'OK' : 'MISMATCH';
  console.log(`  ${fg.padEnd(16)} on ${bg.padEnd(14)} = ${ratio.toFixed(2)}:1  (need >= ${min})  ${verdict}  [expected ${expected}]  ${marker}`);
  if (marker === 'MISMATCH') failures += 1;
}
const lineRatio = contrastRatio(TOKENS.line, TOKENS.white);
console.log(`  ${'line'.padEnd(16)} on ${'white'.padEnd(14)} = ${lineRatio.toFixed(2)}:1  (non-text separator — no minimum)`);

assert.equal(failures, 0, `${failures} pair(s) did not match their documented pass/fail verdict`);

// The two documented failures are restricted-use tokens (phase_1 §2.2, restrictions 1-2):
// graphite-faint must never carry visible text, and a bare status color (positive/warn/
// critical, i.e. NOT the -text variant) must never sit as small body text on that
// status's -soft background. Grepping for the forbidden CLASS is a reasonable proxy for
// both — it is what makes the token reachable as visible text at all.
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(APP_DIR);
const graphiteFaintTextUses = [];
const bareStatusOnSoftUses = [];
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  // `text-graphite-faint` is the only way this token reaches visible text (the
  // restriction is a review discipline, not a lint rule — phase_1 §2.2 says as much).
  if (/\btext-graphite-faint\b/.test(src)) graphiteFaintTextUses.push(file);
  // A bare `text-positive` / `text-warn` / `text-critical` (not `-text`) on the SAME
  // line as that status's `-soft` background is the restricted pattern; this is a
  // heuristic, not a full DOM analysis — stated plainly, the way frontend/test's
  // existing renderConsole.test.mjs states its own coverage limits.
  for (const line of src.split('\n')) {
    if (/\btext-(positive|warn|critical)\b(?!-)/.test(line) && /\b(positive|warn|critical)-soft\b/.test(line)) {
      bareStatusOnSoftUses.push(file);
      break;
    }
  }
}

assert.deepEqual(graphiteFaintTextUses, [], 'text-graphite-faint used for visible text in: ' + graphiteFaintTextUses.join(', '));
assert.deepEqual(bareStatusOnSoftUses, [], 'a bare status color used as text on its own -soft background in: ' + bareStatusOnSoftUses.join(', '));

console.log('\nBoth restricted tokens (graphite-faint, bare status-on-soft) are absent from visible-text usage across frontend/src/app/.');
console.log('\nPASS');
