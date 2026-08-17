// Graceful shutdown (phase 6 §6.2, §11). SIGTERM/SIGINT: stop accepting new connections,
// wait for in-flight SSE streams to finish (bounded — a stream that's still open after
// DRAIN_TIMEOUT_MS is not waited on forever), close the BullMQ worker so an in-flight
// ingestion job finishes or requeues cleanly instead of being killed mid-write, then exit.
import { activeStreams } from './api/routes/ask.js';

// 30s (phase 6 §6.2's own number): long enough for a slow-starting LLM's first token to
// land and the rest of a typical answer to stream out, short enough that a container
// orchestrator's own SIGKILL grace period (commonly 30s, e.g. Kubernetes' default
// terminationGracePeriodSeconds) doesn't fire first and cut every stream mid-sentence.
//
// Overridable via SSE_DRAIN_TIMEOUT_MS, added during Phase 6 verification: the alternative
// to an override is a test suite that either waits out a real 30s ceiling on every run or
// never actually exercises the "still open after the deadline" branch at all. Unset in
// every real deployment; test/api/shutdown.test.js sets it to run that branch in under a
// second instead of thirty.
const DRAIN_TIMEOUT_MS = Number(process.env.SSE_DRAIN_TIMEOUT_MS ?? 30_000);
const POLL_INTERVAL_MS = 250;

export function registerGracefulShutdown(server, { worker } = {}) {
  let shuttingDown = false;

  async function shutdown(signal) {
    if (shuttingDown) return;   // a second SIGTERM mid-drain must not restart the sequence
    shuttingDown = true;
    console.log(`[shutdown] ${signal} received — no longer accepting new connections`);

    server.close();
    // Node 18.2+: frees idle keep-alive sockets immediately. server.close() alone only
    // stops accepting *new* connections and waits for every open socket to close on its
    // own — an idle keep-alive connection with no request in flight would otherwise sit
    // open (and block the process from exiting) until its own idle timeout, which has
    // nothing to do with the drain this shutdown is actually waiting on.
    server.closeIdleConnections?.();

    const deadline = Date.now() + DRAIN_TIMEOUT_MS;
    while (activeStreams.size > 0 && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    if (activeStreams.size > 0) {
      console.warn(
        `[shutdown] ${activeStreams.size} SSE stream(s) still open after ${DRAIN_TIMEOUT_MS}ms — ` +
        'exiting anyway; their connections will be cut mid-stream.',
      );
    } else {
      console.log('[shutdown] all in-flight SSE streams finished');
    }

    if (worker) {
      // BullMQ Worker.close() lets whatever job is currently executing finish (or, if it
      // doesn't finish before BullMQ's own lock expires, requeues it for the next worker
      // to pick up) rather than the process disappearing mid-job — the ingestion pipeline
      // is not written to resume partway through a stage, only to retry a whole job.
      await worker.close();
      console.log('[shutdown] ingest worker closed');
    }

    console.log('[shutdown] exiting');
    process.exit(0);
  }

  process.on('SIGTERM', () => { shutdown('SIGTERM'); });
  process.on('SIGINT', () => { shutdown('SIGINT'); });
}
