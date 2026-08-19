// phase_1 task 1.3a — confirms no two of the eight --stage-* tokens are within CIE76
// ΔE 10 of each other, in either theme, so eight adjacent ribbon/waterfall segments
// remain mutually distinguishable side by side (phase_1 §2.1, §2.2's note on why
// --stage-* is graded for mutual distinguishability rather than background contrast).
// Values are copied from theme.css's :root/.dark blocks — kept in sync by hand, same
// stated limitation as contrast.test.mjs.
import assert from 'node:assert/strict';

const LIGHT = {
  condense: '#7C8AA8', embed: '#3B7DD8', sparse: '#2E9E7A', colpali: '#8B5CD6',
  retrieve: '#D9822B', merge: '#C2568F', rerank: '#4B6FD6', generate: '#1FA6A6',
};
const DARK = {
  condense: '#94A3BE', embed: '#6BA3F0', sparse: '#5CC8A0', colpali: '#B18CEC',
  retrieve: '#F0A65C', merge: '#E086B4', rerank: '#6C63D6', generate: '#4FC9C9',
};

const MIN_DELTA_E = 10;

function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// sRGB -> CIE XYZ -> CIE L*a*b*, D65 reference white. Standard formulas (no shortcuts —
// phase_1's anti-punting rule: math gets written out, not named-and-skipped).
function rgbToLab([r, g, b]) {
  const toLinear = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [rl, gl, bl] = [r, g, b].map(toLinear);
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.0721750;
  const z = rl * 0.0193339 + gl * 0.1191920 + bl * 0.9503041;

  const [xn, yn, zn] = [0.95047, 1.0, 1.08883]; // D65 white point
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x / xn), fy = f(y / yn), fz = f(z / zn);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE76(hexA, hexB) {
  const [l1, a1, b1] = rgbToLab(hexToRgb(hexA));
  const [l2, a2, b2] = rgbToLab(hexToRgb(hexB));
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}

function checkTheme(name, tokens) {
  const stages = Object.keys(tokens);
  console.log(`\n${name} — pairwise ΔE (min ${MIN_DELTA_E} required):`);
  let minSeen = Infinity;
  let minPair = null;
  let violations = 0;
  for (let i = 0; i < stages.length; i += 1) {
    for (let j = i + 1; j < stages.length; j += 1) {
      const de = deltaE76(tokens[stages[i]], tokens[stages[j]]);
      if (de < minSeen) { minSeen = de; minPair = [stages[i], stages[j]]; }
      if (de < MIN_DELTA_E) {
        console.log(`  FAIL  ${stages[i].padEnd(9)} vs ${stages[j].padEnd(9)} = ΔE ${de.toFixed(2)}`);
        violations += 1;
      }
    }
  }
  console.log(`  Closest pair: ${minPair[0]} / ${minPair[1]} at ΔE ${minSeen.toFixed(2)}`);
  return violations;
}

const lightViolations = checkTheme('Light theme', LIGHT);
const darkViolations = checkTheme('Dark theme', DARK);

assert.equal(lightViolations, 0, `${lightViolations} stage-color pair(s) below ΔE ${MIN_DELTA_E} in light theme`);
assert.equal(darkViolations, 0, `${darkViolations} stage-color pair(s) below ΔE ${MIN_DELTA_E} in dark theme`);

console.log('\nAll 28 pairs (8 choose 2) clear ΔE 10 in both themes.');
console.log('PASS');
