// Child process for test/api/shutdown.test.js. Runs the REAL registerGracefulShutdown and
// the REAL activeStreams set from ask.js — not a reimplementation — inside a minimal HTTP
// server, so the parent test can send an actual SIGTERM and observe actual process-exit
// timing rather than asserting against the source code's intentions.
//
// Protocol: prints a line to stdout at each observable milestone, so the parent can await
// them by string match instead of guessing at sleep durations.
import http from 'node:http';
import { activeStreams } from '../../src/api/routes/ask.js';
import { registerGracefulShutdown } from '../../src/shutdown.js';

const HOLD_STREAM_MS = Number(process.env.HOLD_STREAM_MS ?? 0);

const server = http.createServer((req, res) => res.end('ok'));

if (HOLD_STREAM_MS > 0) {
  const token = Symbol('test-stream');
  activeStreams.add(token);
  console.log(`STREAM_OPENED ${activeStreams.size}`);
  setTimeout(() => {
    activeStreams.delete(token);
    console.log(`STREAM_CLOSED ${activeStreams.size}`);
  }, HOLD_STREAM_MS);
}

server.listen(0, () => {
  console.log(`LISTENING ${server.address().port}`);
  registerGracefulShutdown(server, {});
});

// Deliberately no process.on('exit', ...) log here — stdout to a piped child_process is not
// guaranteed to flush before the process actually terminates (a well-known Node gotcha), so
// a log line written during the 'exit' event can be silently lost. The parent test measures
// real exit timing off its own child.on('exit') instead, which Node fires reliably via the
// OS wait status regardless of whether the child's own stdout buffer ever flushed.
