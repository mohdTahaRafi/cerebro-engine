#!/usr/bin/env node
// bench/v2/frontend.bench.js — task 8.2: Lighthouse on /login and /chat, and route
// chunk sizes from the build report (phase 8 §2.1).
//
// Two independent halves, reported separately, because they have different
// prerequisites:
//   1. Route chunk sizes — reads `frontend/dist`'s build output directly. Requires only
//      `cd frontend && npm run build`, already the deployment prerequisite (§4.4 step 3).
//   2. Lighthouse — needs `lighthouse` + `chrome-launcher` (devDependencies, install with
//      `npm install --save-dev lighthouse chrome-launcher` from backend/) AND a locally
//      launchable Chrome/Chromium. Both are optional at RUN time: if either is missing,
//      this script reports why and still exits 0 with the chunk-size half complete,
//      rather than failing the whole `npm run bench:v2` pipeline over a dev-machine
//      dependency that has nothing to do with the tenancy hard gate.
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, '../../../frontend');
const DIST_DIR = path.join(FRONTEND_DIR, 'dist');
const PREVIEW_PORT = Number(process.env.BENCH_FRONTEND_PORT ?? 4173);

// architecture §8's own bundle-size budget row — restated here so a FAIL prints the
// number it failed against, not just a bare byte count.
const ROUTE_CHUNK_BUDGET_BYTES = 250 * 1024;   // 250 KB per route chunk, gzip-equivalent estimate

function chunkSizesFromBuild() {
  if (!fs.existsSync(DIST_DIR)) {
    throw new Error(`${DIST_DIR} does not exist — run \`cd frontend && npm run build\` first.`);
  }
  const assetsDir = path.join(DIST_DIR, 'assets');
  const files = fs.readdirSync(assetsDir).filter((f) => f.endsWith('.js'));
  const sizes = files.map((f) => {
    const bytes = fs.statSync(path.join(assetsDir, f)).size;
    return { file: f, bytes };
  }).sort((a, b) => b.bytes - a.bytes);

  const totalBytes = sizes.reduce((sum, s) => sum + s.bytes, 0);
  const overBudget = sizes.filter((s) => s.bytes > ROUTE_CHUNK_BUDGET_BYTES);
  return { sizes, totalBytes, overBudget };
}

function startPreviewServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
      cwd: FRONTEND_DIR, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let resolved = false;
    proc.stdout.on('data', (chunk) => {
      if (!resolved && /Local:/.test(chunk.toString())) { resolved = true; resolve(proc); }
    });
    proc.on('error', reject);
    proc.on('exit', (code) => { if (!resolved) reject(new Error(`vite preview exited with code ${code}`)); });
    setTimeout(() => { if (!resolved) reject(new Error('vite preview did not start within 15s')); }, 15_000);
  });
}

async function runLighthouse(route) {
  // Dynamic imports, not static — a missing devDependency must not crash the module
  // graph before main() gets a chance to report the chunk-size half and exit cleanly.
  const { default: lighthouse } = await import('lighthouse');
  const chromeLauncher = await import('chrome-launcher');

  const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless=new', '--no-sandbox'] });
  try {
    const result = await lighthouse(`http://localhost:${PREVIEW_PORT}${route}`, {
      port: chrome.port, output: 'json', onlyCategories: ['performance', 'accessibility'],
    });
    const lhr = result.lhr;
    return {
      route,
      performanceScore: Math.round((lhr.categories.performance?.score ?? 0) * 100),
      accessibilityScore: Math.round((lhr.categories.accessibility?.score ?? 0) * 100),
      lcpMs: Math.round(lhr.audits['largest-contentful-paint']?.numericValue ?? 0),
      ttiMs: Math.round(lhr.audits['interactive']?.numericValue ?? 0),
      totalBlockingTimeMs: Math.round(lhr.audits['total-blocking-time']?.numericValue ?? 0),
    };
  } finally {
    await chrome.kill();
  }
}

async function main() {
  console.log('[frontend.bench] route chunk sizes from frontend/dist...');
  const chunkReport = chunkSizesFromBuild();
  console.log(`  total JS: ${(chunkReport.totalBytes / 1024).toFixed(1)} KB across ${chunkReport.sizes.length} files`);
  for (const s of chunkReport.sizes.slice(0, 10)) {
    console.log(`  ${(s.bytes / 1024).toFixed(1).padStart(8)} KB  ${s.file}`);
  }
  if (chunkReport.overBudget.length > 0) {
    console.error(`  OVER BUDGET (>${ROUTE_CHUNK_BUDGET_BYTES / 1024} KB): ${chunkReport.overBudget.map((s) => s.file).join(', ')}`);
  }

  let lighthouseResults = null;
  let lighthouseError = null;
  try {
    console.log('\n[frontend.bench] starting `vite preview` for Lighthouse...');
    const preview = await startPreviewServer();
    try {
      console.log('[frontend.bench] running Lighthouse on /login and /chat...');
      lighthouseResults = [await runLighthouse('/login'), await runLighthouse('/chat')];
      for (const r of lighthouseResults) console.log(`  ${JSON.stringify(r)}`);
    } finally {
      preview.kill();
    }
  } catch (err) {
    lighthouseError = err.message;
    console.error(`\n[frontend.bench] Lighthouse unavailable: ${err.message}`);
    console.error('  Install with: cd backend && npm install --save-dev lighthouse chrome-launcher');
    console.error('  Chunk-size measurement above is still valid; only the Lighthouse half was skipped.');
  }

  console.log(`\n${JSON.stringify({ chunkReport: { totalBytes: chunkReport.totalBytes, sizes: chunkReport.sizes, overBudget: chunkReport.overBudget.map((s) => s.file) }, lighthouseResults, lighthouseError }, null, 2)}`);
}

main().catch((err) => {
  console.error('[frontend.bench] FAILED:', err);
  process.exit(1);
});
