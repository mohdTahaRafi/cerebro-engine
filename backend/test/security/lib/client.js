// Minimal cookie-jar HTTP client for the phase 8 §3.4 live security suite — real HTTP
// against a running backend (BASE_URL, default http://localhost:5000), no framework.
// Node 22's global fetch has no automatic cookie jar, so this hand-rolls the small
// subset these tests need: capture Set-Cookie on every response, replay it on every
// subsequent request from the same Client instance (one instance = "one browser").
export const BASE_URL = process.env.SECURITY_TEST_BASE_URL ?? 'http://localhost:5000';

function parseSetCookie(headerValue) {
  // A `name=value` pair per Set-Cookie header; fetch's Headers.getSetCookie() (Node 22)
  // already splits multiple Set-Cookie headers into an array, so each entry here is one
  // cookie's own attributes — only name=value is kept, matching what a real browser
  // sends back on the next request (attributes are the server's instructions, not part
  // of the replayed Cookie header).
  const [pair] = headerValue.split(';');
  const eq = pair.indexOf('=');
  return { name: pair.slice(0, eq).trim(), value: pair.slice(eq + 1).trim() };
}

export class Client {
  constructor() {
    this.cookies = new Map();
  }

  cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  get(name) {
    return this.cookies.get(name);
  }

  async request(path, { method = 'GET', headers = {}, body, csrf = false } = {}) {
    const h = { ...headers };
    const cookieHeader = this.cookieHeader();
    if (cookieHeader) h.Cookie = cookieHeader;
    if (csrf) {
      const token = this.cookies.get('cerebro.csrf');
      if (token) h['X-CSRF-Token'] = token;
    }
    if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';

    const res = await fetch(`${BASE_URL}${path}`, {
      method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: 'manual',   // this suite inspects redirects itself (open-redirect check)
    });

    for (const setCookie of res.headers.getSetCookie?.() ?? []) {
      const { name, value } = parseSetCookie(setCookie);
      this.cookies.set(name, value);
    }

    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON — fine, e.g. a 204 or an HTML error page */ }

    return { status: res.status, headers: res.headers, text, json };
  }

  get_(path, opts) { return this.request(path, { ...opts, method: 'GET' }); }
  post(path, body, opts) { return this.request(path, { ...opts, method: 'POST', body, csrf: true }); }
  postNoCsrf(path, body, opts) { return this.request(path, { ...opts, method: 'POST', body }); }
}
