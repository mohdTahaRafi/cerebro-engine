// Phase 6: mock/fixtures/contexts.ts (the localStorage-backed Context CRUD adapter) is
// deleted — Contexts now has a real backend model (backend/src/models/Context.js) and
// endpoints/contexts.ts hits it directly. traces.ts and admin.ts, below, are unrelated
// dev-only demo data for Phase 7's not-yet-built trace/admin panels — they need SOME
// context id/title pair to hang illustrative rows off, but that data was never meant to
// reflect a real user's actual contexts (it is disconnected fixture data either way, per
// each file's own header comment: "Real from Phase 7"). A small fixed, synthetic list
// replaces the previous "read the real app's context list" seeding.
export interface DemoContext { id: string; title: string; }

export const DEMO_CONTEXTS: DemoContext[] = [
  { id: 'demo-ctx-product', title: 'Product Research' },
  { id: 'demo-ctx-finance', title: 'Finance Q3' },
];
