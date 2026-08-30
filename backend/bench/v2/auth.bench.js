#!/usr/bin/env node
// bench/v2/auth.bench.js — task 8.2: session probe, login end-to-end, argon2 hash time,
// and the existing-vs-unknown-email timing gap (phase 8 §2.1, §8.11's enumeration
// control). Runs against a LIVE backend on BENCH_BASE_URL (default
// http://localhost:5000) — real HTTP, real argon2, real Redis-backed rate limits.
//
// Sample-size note (amended live): §2.1 asks for 50 runs each for the enumeration gap,
// and §3.4's security test asks for the same 50-vs-50. auth/limits.js's
// LIMITS.loginPerIp caps ALL login attempts — real or fake — from one IP at 50 per 900s
// (15 min), enforced inside the login route itself, independently of the global 300/min
// backstop. 50 existing-email attempts plus 50 unknown-email attempts is 100 requests
// from the SAME source IP (this bench always runs from one host), which exhausts that
// cap after request #50 regardless of which batch it's in — every request past it comes
// back 429, corrupting the "byte-identical bodies" comparison with 429 bodies instead of
// the intended 401s. AUTH_BENCH_SAMPLES therefore defaults to 20 (40 total, safely under
// the 50 cap in one window) rather than weakening loginPerIp, which is a deliberate
// security control (phase_5 §8), not a benchmark inconvenience to relax. Pass
// `AUTH_BENCH_SAMPLES=50` to run the literal spec figure — doing so requires the two
// batches to span two separate 900s windows (run existing-email, wait 15 minutes, run
// unknown-email) or the second batch will 429; this script does NOT wait automatically.
import 'dotenv/config';
import argon2 from 'argon2';
import { hashPassword } from '../../src/auth/password.js';
import { summarizeLatencies } from './lib/percentile.js';

const BASE_URL = process.env.BENCH_BASE_URL ?? 'http://localhost:5000';
const SAMPLES = Number(process.env.AUTH_BENCH_SAMPLES ?? 20);
const BENCH_EMAIL = `bench-auth-${Date.now()}@example.com`;
const BENCH_PASSWORD = 'BenchmarkHorseBatteryStaple9!';

async function time(fn) {
  const t0 = performance.now();
  const result = await fn();
  return { ms: performance.now() - t0, result };
}

async function argon2HashBench() {
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    const { ms } = await time(() => hashPassword(`sample-password-${i}`));
    samples.push(ms);
  }
  return summarizeLatencies(samples);
}

async function sessionProbeBench() {
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    const { ms } = await time(() => fetch(`${BASE_URL}/api/auth/session`));
    samples.push(ms);
  }
  return summarizeLatencies(samples);
}

async function signupBenchUser() {
  const res = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: BENCH_EMAIL, password: BENCH_PASSWORD, name: 'Bench Auth' }),
  });
  if (res.status !== 202) throw new Error(`signup failed: ${res.status} ${await res.text()}`);
}

async function loginEndToEndBench() {
  const samples = [];
  const n = Math.min(SAMPLES, 10);   // login success also counts against loginPerIp; keep it small
  for (let i = 0; i < n; i++) {
    const { ms, result } = await time(() => fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: BENCH_EMAIL, password: BENCH_PASSWORD }),
    }));
    if (result.status !== 200) console.error(`[auth.bench] unexpected login status ${result.status}`);
    samples.push(ms);
  }
  return summarizeLatencies(samples);
}

// The enumeration timing gap (§2.1, §8.11) — this consumes the loginPerIp budget, so it
// runs LAST, after every other section, and stays within SAMPLES to leave headroom.
async function enumerationGapBench() {
  const existingSamples = [];
  const unknownSamples = [];
  let bodiesIdentical = true;
  let firstExistingBody = null;
  let firstUnknownBody = null;

  for (let i = 0; i < SAMPLES; i++) {
    const { ms, result } = await time(() => fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: BENCH_EMAIL, password: 'definitely-the-wrong-password' }),
    }));
    const body = await result.text();
    if (i === 0) firstExistingBody = body;
    existingSamples.push(ms);
  }
  for (let i = 0; i < SAMPLES; i++) {
    const { ms, result } = await time(() => fetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `bench-unknown-${i}-${Date.now()}@example.com`, password: 'whatever-password-123' }),
    }));
    const body = await result.text();
    if (i === 0) firstUnknownBody = body;
    unknownSamples.push(ms);
  }
  bodiesIdentical = firstExistingBody === firstUnknownBody;

  const existing = summarizeLatencies(existingSamples);
  const unknown = summarizeLatencies(unknownSamples);
  const gapPct = Math.abs(existing.p50Ms - unknown.p50Ms) / Math.max(existing.p50Ms, unknown.p50Ms) * 100;
  return { existing, unknown, gapPct: Math.round(gapPct * 10) / 10, bodiesIdentical };
}

async function main() {
  console.log(`[auth.bench] base URL ${BASE_URL}, ${SAMPLES} samples per section`);

  console.log('[auth.bench] argon2 hash time...');
  const argon2Hash = await argon2HashBench();
  console.log(`  ${JSON.stringify(argon2Hash)}`);

  console.log('[auth.bench] session probe (GET /api/auth/session, anonymous)...');
  const sessionProbe = await sessionProbeBench();
  console.log(`  ${JSON.stringify(sessionProbe)}`);

  console.log('[auth.bench] signing up bench user...');
  await signupBenchUser();

  console.log('[auth.bench] login end-to-end (POST /api/auth/login, real credentials)...');
  const loginEndToEnd = await loginEndToEndBench();
  console.log(`  ${JSON.stringify(loginEndToEnd)}`);

  console.log(`[auth.bench] enumeration gap (${SAMPLES} existing-email + ${SAMPLES} unknown-email, wrong password)...`);
  const enumeration = await enumerationGapBench();
  console.log(`  ${JSON.stringify(enumeration)}`);
  console.log(`  bodies identical: ${enumeration.bodiesIdentical}, gap: ${enumeration.gapPct}% (threshold 15%)`);

  const report = { argon2Hash, sessionProbe, loginEndToEnd, enumeration, samples: SAMPLES };
  console.log(`\n${JSON.stringify(report, null, 2)}`);

  if (!enumeration.bodiesIdentical) {
    console.error('[auth.bench] FAIL: enumeration bodies are not byte-identical');
    process.exitCode = 1;
  }
  if (enumeration.gapPct > 15) {
    console.error(`[auth.bench] FAIL: enumeration timing gap ${enumeration.gapPct}% exceeds 15%`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('[auth.bench] FAILED:', err);
  process.exit(1);
});
