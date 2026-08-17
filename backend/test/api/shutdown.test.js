// Graceful shutdown integration test (phase 6 §6.2, §11, task 6.16). The one criterion this
// phase never actually exercised live: "SIGTERM during an active SSE stream lets it finish
// (<= 30s) before exit." Spawns a real child process running the real
// registerGracefulShutdown against the real activeStreams set (shutdownHarness.mjs), sends
// it a real SIGTERM, and times when the OS actually reports the process gone — not an
// assertion about what the source code says it will do.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(__dirname, 'shutdownHarness.mjs');

let failures = 0;
function test(name, fn) {
  return (async () => {
    try {
      await fn();
      console.log(`  PASS  ${name}`);
    } catch (err) {
      console.error(`  FAIL  ${name}\n        ${err.message}`);
      failures += 1;
    }
  })();
}

// A single persistent accumulator per child, attached once at spawn — not one fresh buffer
// per waitForLine call. shutdownHarness.mjs prints STREAM_OPENED before LISTENING (it runs
// before server.listen()), so a per-call buffer that only sees data arriving after it starts
// listening would miss STREAM_OPENED entirely: by the time a second waitForLine call for it
// attaches, that line already arrived and was consumed (and discarded) by the first call's
// listener. Accumulating everything from spawn and checking the full log fixes that — this
// was a real bug in an earlier version of this harness, not in shutdown.js.
function attachLog(child) {
  child.log = '';
  child.stdout.on('data', (chunk) => { child.log += chunk.toString(); });
}

function waitForLine(child, pattern, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const check = () => {
      const m = child.log.match(pattern);
      if (m) { clearInterval(poll); clearTimeout(timer); resolve(m); }
    };
    const poll = setInterval(check, 20);
    const timer = setTimeout(() => {
      clearInterval(poll);
      reject(new Error(`timed out waiting for /${pattern.source}/ on stdout; saw:\n${child.log}`));
    }, timeoutMs);
    check();   // the line may already be in the accumulated log
  });
}

function waitForExit(child) {
  return new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
}

console.log('\n=== graceful shutdown: no active stream ===');

await test('exits promptly when nothing is in flight', async () => {
  const child = spawn('node', [HARNESS], { env: { ...process.env, SSE_DRAIN_TIMEOUT_MS: '2000' } });
  attachLog(child);
  await waitForLine(child, /LISTENING/);

  const t0 = Date.now();
  child.kill('SIGTERM');
  const { code } = await waitForExit(child);
  const elapsedMs = Date.now() - t0;

  assert.equal(code, 0, 'shutdown must exit 0 on a clean SIGTERM');
  assert.ok(elapsedMs < 1500, `expected a near-immediate exit with nothing to drain, took ${elapsedMs}ms`);
});

console.log('\n=== graceful shutdown: SIGTERM during an active SSE stream (task 6.16) ===');

await test('waits for an in-flight stream to finish before exiting', async () => {
  // The stream "completes" 1.5s after SIGTERM; the drain ceiling is set to 10s (well above
  // that) so a pass here specifically proves the process WAITED for the real completion
  // event rather than either exiting immediately or merely surviving until the ceiling.
  const child = spawn('node', [HARNESS], {
    env: { ...process.env, HOLD_STREAM_MS: '1500', SSE_DRAIN_TIMEOUT_MS: '10000' },
  });
  attachLog(child);
  await waitForLine(child, /LISTENING/);
  await waitForLine(child, /STREAM_OPENED 1/);

  const t0 = Date.now();
  child.kill('SIGTERM');
  const { code } = await waitForExit(child);
  const elapsedMs = Date.now() - t0;

  assert.equal(code, 0);
  assert.ok(elapsedMs >= 1400, `must not exit before the stream finished (~1500ms), exited at ${elapsedMs}ms`);
  assert.ok(elapsedMs < 3000, `must exit promptly once the stream finished, took ${elapsedMs}ms`);
});

await test('a stream that never finishes is bounded by the drain ceiling, not waited on forever', async () => {
  // HOLD_STREAM_MS longer than the process lifetime we're willing to wait in this test —
  // the stream is never released. The drain ceiling (1s here) must still force an exit.
  const child = spawn('node', [HARNESS], {
    env: { ...process.env, HOLD_STREAM_MS: '60000', SSE_DRAIN_TIMEOUT_MS: '1000' },
  });
  attachLog(child);
  await waitForLine(child, /LISTENING/);
  await waitForLine(child, /STREAM_OPENED 1/);

  const t0 = Date.now();
  child.kill('SIGTERM');
  const { code } = await waitForExit(child);
  const elapsedMs = Date.now() - t0;

  assert.equal(code, 0, 'must still exit cleanly even when forced past the ceiling');
  assert.ok(elapsedMs >= 950, `must respect the full ceiling before giving up, exited at ${elapsedMs}ms`);
  assert.ok(elapsedMs < 2500, `must not wait meaningfully longer than the ceiling, took ${elapsedMs}ms`);
});

await test('a second SIGTERM mid-drain does not restart the drain sequence', async () => {
  const child = spawn('node', [HARNESS], {
    env: { ...process.env, HOLD_STREAM_MS: '1500', SSE_DRAIN_TIMEOUT_MS: '10000' },
  });
  attachLog(child);
  await waitForLine(child, /LISTENING/);
  await waitForLine(child, /STREAM_OPENED 1/);

  const t0 = Date.now();
  child.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 300));
  child.kill('SIGTERM');   // must be a no-op — shuttingDown is already true
  const { code } = await waitForExit(child);
  const elapsedMs = Date.now() - t0;

  assert.equal(code, 0);
  // If the second SIGTERM restarted the sequence, this would land near 1800ms (300ms
  // already elapsed + a fresh 1500ms wait) rather than the original ~1500ms.
  assert.ok(elapsedMs < 1900, `a second SIGTERM must not restart the drain, took ${elapsedMs}ms`);
});

console.log(failures === 0 ? '\nAll graceful shutdown tests passed.\n' : `\n${failures} test(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
