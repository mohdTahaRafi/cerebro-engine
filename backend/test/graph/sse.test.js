// Standalone verification script (repo convention — see AGENTS.md, no unified test
// framework). Exercises phase 5 tasks 5.11, 5.13, 5.14 against a LIVE backend
// (`npm run dev` in another shell, full stack up: Mongo, Redis, Qdrant, and a working
// LLM_PROVIDER). Spends real generation tokens. Run with:
//
//   BASE_URL=http://localhost:5000 node test/graph/sse.test.js
//
// The heartbeat assertion only fires if the LLM genuinely takes >15s to produce a first
// token — it is skipped (not faked as a pass) when a fast model finishes first, since
// this script has no way to force provider latency.
import assert from 'assert';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:5000';

// Parses one SSE byte stream into { event, ...payload } frames plus raw comment lines
// (heartbeats), stopping at [DONE] or stream end.
async function collectFrames(response, { onFrame, signal } = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  const frames = [];
  const raw = [];
  let buffer = '';

  while (true) {
    if (signal?.aborted) { await reader.cancel().catch(() => {}); break; }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx = buffer.indexOf('\n\n');
    while (idx !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      raw.push(line);
      if (line.startsWith('data: ')) {
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return { frames, raw, done: true };
        const parsed = JSON.parse(payload);
        frames.push(parsed);
        onFrame?.(parsed);
      }
      idx = buffer.indexOf('\n\n');
    }
  }
  return { frames, raw, done: false };
}

// ── 5.14: every non-[DONE] frame carries an `event` discriminator ──────────────────
// ── 5.11: the `sources` frame arrives before any `token` frame ─────────────────────
{
  // An off-corpus question routes to noContext (§8), which still emits `sources` before
  // `token` — same envelope guarantee as generation, at zero LLM cost.
  const res = await fetch(`${BASE_URL}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `nonsense query ${Date.now()} unrelated to any document` }),
  });
  assert.strictEqual(res.status, 200, 'POST /api/ask must return 200 and start an SSE stream');
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/, 'response must be text/event-stream');

  let threadIdIndex = -1, sourcesIndex = -1, firstTokenIndex = -1;
  const { frames } = await collectFrames(res, {
    onFrame: (f) => {
      assert.ok('event' in f, `every frame must carry an event discriminator, got: ${JSON.stringify(f)}`);
    },
  });
  frames.forEach((f, i) => {
    if (f.event === 'threadId' && threadIdIndex === -1) threadIdIndex = i;
    if (f.event === 'sources' && sourcesIndex === -1) sourcesIndex = i;
    if (f.event === 'token' && firstTokenIndex === -1) firstTokenIndex = i;
  });
  assert.ok(threadIdIndex !== -1, 'a threadId frame must be present');
  assert.ok(sourcesIndex !== -1, 'a sources frame must be present');
  assert.ok(firstTokenIndex !== -1, 'a token frame must be present');
  assert.ok(threadIdIndex < sourcesIndex, 'the threadId frame must arrive before the sources frame');
  assert.ok(sourcesIndex < firstTokenIndex, 'the sources frame must arrive before the first token frame');
  console.log('[sse.test] PASS — every frame is event-discriminated; threadId precedes sources precedes token');
}

// ── 5.13: heartbeat after 15s of slow generation ────────────────────────────────────
{
  const controller = new AbortController();
  const res = await fetch(`${BASE_URL}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'Write an exhaustive, detailed, multi-paragraph analysis of everything in the corpus.' }),
    signal: controller.signal,
  });

  const start = Date.now();
  const { raw } = await collectFrames(res);
  const elapsedMs = Date.now() - start;
  const sawHeartbeat = raw.some((line) => line.startsWith(': keepalive'));

  if (elapsedMs > 15_000) {
    assert.ok(sawHeartbeat, 'a request that ran past 15s must have emitted at least one ": keepalive" comment frame');
    console.log('[sse.test] PASS — heartbeat observed on a %dms request', elapsedMs);
  } else {
    console.log('[sse.test] SKIP — request finished in %dms, under the 15s heartbeat interval; nothing to observe', elapsedMs);
  }
}

// ── 5.13: abort on client close stops the stream without crashing the server ───────
{
  const controller = new AbortController();
  const pending = fetch(`${BASE_URL}/api/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'Write a long, detailed essay about the entire corpus, in full.' }),
    signal: controller.signal,
  });

  await new Promise((r) => setTimeout(r, 1500));
  controller.abort();
  await assert.rejects(pending, /abort/i, 'the client fetch must reject with an AbortError once cancelled');

  // The server must still be serving — a crash here would mean the abort path threw
  // somewhere it shouldn't have. (The route logging "the abort" server-side is verified
  // by inspecting server stdout during the milestone walkthrough, not asserted here — this
  // script only has visibility into the client side of the connection.)
  const health = await fetch(`${BASE_URL}/health`).catch(() => null);
  assert.ok(health && health.ok, 'the server must still respond to /health after a client aborts mid-stream');
  console.log('[sse.test] PASS — client abort rejects cleanly and the server keeps serving');
}

console.log('[sse.test] PASS — all assertions');
