// phase_1 §4.3 — the one request path every endpoint module funnels through. The SSE
// reader (streamEvents) is lifted verbatim from useCerebroChat.ts's buffer loop.
import type { ApiError } from './contracts';

const BASE = '/api';

export class CerebroApiError extends Error implements ApiError {
  status: number; code: string; fields?: Record<string, string>;
  constructor(e: ApiError) { super(e.message); this.status = e.status; this.code = e.code; this.fields = e.fields; }
}

/** Thrown when an endpoint does not exist yet (404 with no JSON body) or the
 *  network is unreachable. Components render <Unavailable> for this and a normal
 *  error state for everything else — the distinction is what keeps a
 *  not-yet-built panel from looking like a broken one. */
export class EndpointUnavailableError extends CerebroApiError {}

function readCookie(name: string): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export async function request<T>(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set('Content-Type', 'application/json');
  const csrf = readCookie('cerebro.csrf');            // Phase 8 wires the server side;
  if (csrf) headers.set('X-CSRF-Token', csrf);        //   harmless until then

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...rest,
      headers,
      credentials: 'include',                          // the session cookie, always
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch (cause) {
    throw new EndpointUnavailableError({
      status: 0, code: 'network_unreachable',
      message: 'Cerebro is not reachable. Check that the backend is running.',
    });
  }

  if (res.status === 204) return undefined as T;

  const text = await res.text();
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON: handled below */ }

  if (!res.ok) {
    // A 404 with an HTML body is Vite's dev server or Caddy's SPA fallback answering
    // for a route the backend does not serve — i.e. an endpoint that does not exist yet.
    // A 404 with a JSON body is a real "not found" for a resource that could exist.
    if (res.status === 404 && body === null) {
      throw new EndpointUnavailableError({
        status: 404, code: 'endpoint_unavailable',
        message: 'This is not available yet.',
      });
    }
    const e = body as Partial<ApiError> & { error?: string } | null;
    throw new CerebroApiError({
      status: res.status,
      code: e?.code ?? 'unknown_error',
      message: e?.message ?? e?.error ?? `Request failed (${res.status}).`,
      fields: e?.fields,
    });
  }
  return body as T;
}

async function toApiError(res: Response): Promise<CerebroApiError> {
  const text = await res.text().catch(() => '');
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (res.status === 404 && body === null) {
    return new EndpointUnavailableError({
      status: 404, code: 'endpoint_unavailable', message: 'This is not available yet.',
    });
  }
  const e = body as Partial<ApiError> & { error?: string } | null;
  return new CerebroApiError({
    status: res.status,
    code: e?.code ?? 'unknown_error',
    message: e?.message ?? e?.error ?? `Request failed (${res.status}).`,
    fields: e?.fields,
  });
}

export async function* streamEvents<E>(path: string, json: unknown, signal: AbortSignal)
  : AsyncGenerator<E> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST', credentials: 'include', signal,
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json),
  });
  if (!res.ok || !res.body) throw await toApiError(res);

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buffer.indexOf('\n\n')) !== -1) {
      const line = buffer.slice(0, i).trim();
      buffer = buffer.slice(i + 2);
      if (!line.startsWith('data: ')) continue;        // ': keepalive' comment frames
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') return;
      try { yield JSON.parse(payload) as E; }
      catch { console.warn('[api] unparseable SSE frame', payload); }
    }
  }
}
