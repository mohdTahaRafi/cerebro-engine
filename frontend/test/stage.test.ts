// phase_2 task 2.10 — deriveStage band boundaries. Run directly with `node test/stage.test.ts`
// (Node 22's built-in type stripping), matching this repo's existing test/*.test.mjs
// convention (node:assert, no framework) rather than introducing a new test runner —
// see AGENTS.md: "frontend has npm run build, but no configured unit-test... script."
import assert from 'node:assert/strict';
import { deriveStage, stageDetail } from '../src/app/components/documents/stage.ts';

type Case = {
  name: string;
  doc: { status: string; progress: number; visualPageCount: number };
  wantStage: string;
  wantDetail: string | null;
};

const cases: Case[] = [
  { name: 'queued status → queued stage', doc: { status: 'queued', progress: 0, visualPageCount: 0 }, wantStage: 'queued', wantDetail: null },
  { name: 'ready status → ready stage', doc: { status: 'ready', progress: 100, visualPageCount: 0 }, wantStage: 'ready', wantDetail: null },
  { name: 'failed status → failed stage', doc: { status: 'failed', progress: 40, visualPageCount: 0 }, wantStage: 'failed', wantDetail: null },
  { name: 'duplicate status → ready stage (resolved against original)', doc: { status: 'duplicate', progress: 0, visualPageCount: 0 }, wantStage: 'ready', wantDetail: null },
  // §5.2's task 2.10 cases, verbatim:
  { name: 'processing, progress 60, 8 visual pages → parsing + "8 scanned pages"', doc: { status: 'processing', progress: 60, visualPageCount: 8 }, wantStage: 'parsing', wantDetail: '8 scanned pages' },
  { name: 'processing, progress 80 → chunking, no detail', doc: { status: 'processing', progress: 80, visualPageCount: 8 }, wantStage: 'chunking', wantDetail: null },
  { name: 'processing, progress 95 → embedding', doc: { status: 'processing', progress: 95, visualPageCount: 8 }, wantStage: 'embedding', wantDetail: null },
  // Band boundaries (§5.2's non-monotonic fix: 45–75 is presented as parsing, not embedding).
  { name: 'processing, progress 5 (job dequeued) → parsing', doc: { status: 'processing', progress: 5, visualPageCount: 0 }, wantStage: 'parsing', wantDetail: null },
  { name: 'processing, progress 74 → still parsing', doc: { status: 'processing', progress: 74, visualPageCount: 3 }, wantStage: 'parsing', wantDetail: '3 scanned pages' },
  { name: 'processing, progress 75 → chunking (band edge)', doc: { status: 'processing', progress: 75, visualPageCount: 3 }, wantStage: 'chunking', wantDetail: null },
  { name: 'processing, progress 84 → still chunking', doc: { status: 'processing', progress: 84, visualPageCount: 3 }, wantStage: 'chunking', wantDetail: null },
  { name: 'processing, progress 85 → embedding (band edge)', doc: { status: 'processing', progress: 85, visualPageCount: 3 }, wantStage: 'embedding', wantDetail: null },
  { name: 'processing, progress 99 → still embedding', doc: { status: 'processing', progress: 99, visualPageCount: 3 }, wantStage: 'embedding', wantDetail: null },
  // stageDetail: parsing band only surfaces the sub-label once progress has reached 45
  // (per-page classification is done; visualPageCount is meaningful) AND the doc actually
  // has visual pages — a pure-text PDF (visualPageCount 0) gets no detail line at all.
  { name: 'parsing at progress 30 (before classification) → no detail yet', doc: { status: 'processing', progress: 30, visualPageCount: 0 }, wantStage: 'parsing', wantDetail: null },
  { name: 'parsing, progress 50, 0 visual pages (text-only doc) → no detail', doc: { status: 'processing', progress: 50, visualPageCount: 0 }, wantStage: 'parsing', wantDetail: null },
  { name: 'parsing, progress 50, 1 visual page → singular "1 scanned page"', doc: { status: 'processing', progress: 50, visualPageCount: 1 }, wantStage: 'parsing', wantDetail: '1 scanned page' },
];

let failures = 0;
for (const c of cases) {
  try {
    const gotStage = deriveStage(c.doc as any);
    assert.equal(gotStage, c.wantStage, `deriveStage: ${c.name}`);
    const gotDetail = stageDetail({ ...c.doc, status: c.doc.status } as any);
    assert.equal(gotDetail, c.wantDetail, `stageDetail: ${c.name}`);
    console.log(`ok - ${c.name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL - ${c.name}`);
    console.error(err);
  }
}

if (failures > 0) {
  console.error(`\n${failures}/${cases.length} case(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${cases.length} cases passed.`);
