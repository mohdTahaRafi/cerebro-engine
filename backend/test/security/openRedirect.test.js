// Phase 8 §3.4 — "returnTo of //evil.com, https://evil.com, /\evil, /api/auth/logout
// all land on /chat." safeReturnTo() (auth/mask.js) is the single control point both
// OAuth start routes (routes/auth.js) run every returnTo through before storing it in
// req.session.returnTo — a pure function, so this is a direct unit test rather than a
// live OAuth round trip (this dev environment has no GOOGLE_CLIENT_ID/GITHUB_CLIENT_ID
// configured to actually complete a handshake against).
import assert from 'node:assert/strict';
import { safeReturnTo } from '../../src/auth/mask.js';

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  PASS  ${name}`); }
  catch (err) { console.error(`  FAIL  ${name}\n        ${err.message}`); failures += 1; }
}

const CASES = [
  ['//evil.com', '/chat'],              // protocol-relative
  ['https://evil.com', '/chat'],        // absolute — doesn't even start with '/'
  ['/\\evil', '/chat'],                 // backslash — browsers treat as another protocol-relative form
  ['/api/auth/logout', '/chat'],        // no API endpoints as a post-login destination
  ['/chat', '/chat'],                   // a genuinely safe relative path passes through
  ['/contexts/507f1f77bcf86cd799439011', '/contexts/507f1f77bcf86cd799439011'],
  [null, '/chat'],                      // absent
  [42, '/chat'],                        // wrong type
];

function main() {
  console.log('[security.openRedirect] safeReturnTo()');
  for (const [input, expected] of CASES) {
    test(`safeReturnTo(${JSON.stringify(input)}) === ${JSON.stringify(expected)}`, () => {
      assert.equal(safeReturnTo(input), expected);
    });
  }
  console.log(`\n[security.openRedirect] ${failures === 0 ? 'PASS' : `${failures} FAILURE(S)`}`);
  if (failures > 0) process.exit(1);
}

main();
