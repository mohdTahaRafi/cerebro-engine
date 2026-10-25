# Manual Testing Guide

A hands-on walkthrough of the core v2 flows against a local dev stack. It complements the
scripted checks in [`AGENTS.md`](../AGENTS.md#checks); nothing here spends API credits
beyond the uploads and questions you choose to make.

## 1. Start the services

```bash
docker compose up -d     # from the repo root: MongoDB, Qdrant, Redis, vision service
docker compose ps        # all four should report "healthy"
```

## 2. Start the backend

```bash
cd backend
npm run dev
```

Leave this terminal open. A healthy start prints:

```
[CEREBRO] MongoDB Connected
[CEREBRO] Backend Online at http://localhost:5000
[CEREBRO] Ingest worker started (concurrency 2)
[CEREBRO] Context-delete worker started (concurrency 1)
[CEREBRO] Projection worker started (concurrency 1)
```

If it exits with `[config] Missing required environment variables`, `backend/.env` is
incomplete — the message names every missing key.

## 3. Start the frontend

```bash
cd frontend
npm run dev              # prints Local: http://localhost:5173/
```

Open **http://localhost:5173** — the only URL you visit in the browser. Port 5000 is the
API; Vite proxies `/api` to it. Docker, the backend terminal and the frontend terminal must
all stay running while you test.

## 4. Core flows

| Step | Do | Expect |
|---|---|---|
| Sign up | Create an account at `/signup` (password ≥ 12 characters) | You land in the app, signed in |
| Session survives refresh | Reload the page | Still signed in — sessions are server-side (Redis), not browser storage |
| Ingest | Create a context, upload a PDF into it | The row moves through parsing → chunking → embedding → ready |
| Grounded answer | Ask about the document's content in `/chat` | An answer citing the document |
| Refusal | Ask something the document cannot answer | A refusal, not an invented answer |
| Forgot password | Request a reset at `/forgot-password` | The request is accepted and shows a masked address. Mail is only sent when `SMTP_*` is configured |
| OAuth | Look at `/login` | Google/GitHub buttons appear only when their client credentials are set (`GET /api/auth/capabilities`) |

## 5. Tenant isolation (two users)

1. In your normal browser window, sign up as **User A**, create a context, upload a
   document, and ask a question about it.
2. In a private window or a different browser, sign up as **User B**.
3. As User B you see **zero** contexts and documents. Upload a different document and ask
   about it.
4. Back in User A's window, refresh: User A still sees only their own context and document.

Any case where one user sees the other's data is a real isolation bug, not a setup issue —
contexts, documents, Qdrant points and traces are all filtered by account server-side.

## 6. Admin consoles (optional)

Sign up with an address listed in `ADMIN_EMAILS`. That account gets `role=admin` and can
open `/admin/health` (dependencies, queue, pipeline errors). `/admin/traces` and
`/admin/vectors` show the execution traces and 3D vector space for your own contexts.
