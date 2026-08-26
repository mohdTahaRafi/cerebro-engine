// Phase 6: every vectorStore write/read is now tenant-scoped (§2). This fixture corpus
// (setup-corpus.js) is shared, deterministic, and single-tenant by construction — one
// fixed synthetic tenant for the whole eval suite, kept in its own side-effect-free module
// so setup-corpus.js, regression.test.js, floor.test.js, and scoping.test.js import the
// exact same value rather than each hardcoding their own copy that could drift out of
// sync. NOT re-exported from setup-corpus.js itself: that file runs its whole ingestion as
// an unconditional top-level `await main()` — importing it anywhere but as a script would
// re-run live Cohere/LlamaParse calls as a side effect of the import.
export const FIXTURE_TENANT = { userId: 'fixture-user', contextId: 'fixture-context' };
