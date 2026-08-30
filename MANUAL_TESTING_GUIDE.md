Manual testing guide
1. Start the required services (one time per session)

cd <repo-root>
docker compose up -d
This starts MongoDB, Qdrant, Redis, and the vision service. Confirm all four say healthy:


docker compose ps
2. Start the backend

cd backend
npm run dev
Leave this terminal open. You should see:


[CEREBRO] MongoDB Connected
[CEREBRO] Backend Online at http://localhost:5000
[CEREBRO] Ingest worker started (concurrency 2)
[CEREBRO] Context-delete worker started (concurrency 1)
[CEREBRO] Projection worker started (concurrency 1)
If it exits instead with [config] Missing required environment variables, something in .env got reverted — don't touch .env further, just tell me.

3. Start the frontend
Open a second terminal:


cd <repo-root>/frontend
npm run dev
Leave this open too. It prints Local: http://localhost:5173/.

4. Open the app
http://localhost:5173 — this is the only URL you open in the browser. (Port 5000 is the backend API, not a page to visit directly.)

What must stay running the whole time you're testing
Docker (docker compose ps all healthy) + the backend terminal + the frontend terminal. Closing either terminal stops that half of the app.

5. Core functionality tests
Sign up. Go to the signup page, create an account with your own email and a password (12+ characters — the app enforces this). You should land in the app logged in.

Refresh test. Refresh the page. You should stay logged in — this is the exact bug you reported ("auth breaks after refresh"), and it's server-backed sessions now, not browser storage, so it should hold.

Create a context, then upload a PDF into it. Watch it move through parsing/chunking/embedding to "ready" (the ingest worker you saw start in step 2 is what's doing this work).

Ask a question about the document's content in the chat. You should get a grounded answer citing the document. Try a nonsense/off-topic question too — it should refuse rather than hallucinate.

Forgot password. Request a reset. It will accept the request and show a masked email, but no email will actually arrive — I left SMTP unconfigured since I don't have credentials for it. If you want this to really send mail, give me an SMTP provider (or a Gmail app password) and I'll wire it in.

OAuth buttons (Google/GitHub) won't appear on the login page — same reason, no client credentials configured. They exist in the code now; they just need credentials to activate.

6. Two independent users (isolation test)
This is the important one, given what you saw before.

In your normal browser window, log out, then sign up as User A (e.g. usera@test.com). Create a context, upload a document, ask a question about it.
Open a second, separate browser session — either a private/incognito window, or a different browser entirely — and sign up as User B (e.g. userb@test.com).
As User B: you should see zero contexts and zero documents — not User A's. This is the exact "PDFs appeared in contexts I never added" bug; it should now be gone because contexts and documents are filtered by account server-side.
Upload a different document as User B, ask a question about it.
Switch back to User A's window and refresh — User A should still only see User A's own context and document, never User B's.
If at any point one user sees the other's data, that's a real bug to bring back to me — not a setup issue, since the environment is now correct.

7. Admin views (optional)
Since ADMIN_EMAILS is set, if you sign up using the address you put in ADMIN_EMAILS, that account gets admin role and can see the queue/error panels in the health inspector (/advanced route). Other test accounts won't have this.

I'm stopping here as asked — no further audit, no Phase 8. Let me know what you find.

