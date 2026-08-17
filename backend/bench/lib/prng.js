// Deterministic PRNG (phase 6 §3.1) — every engine at a given corpus size must score the
// exact same query against the exact same dataset, or a "faster" result could just as
// easily be an "easier" dataset. Math.random() is not seedable, so results would differ
// run to run and engine to engine; mulberry32 is a tiny, dependency-free, seedable
// generator that is more than sufficient for synthetic benchmark vectors (not used for
// anything cryptographic).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomFloat32Array(length, rng) {
  const arr = new Float32Array(length);
  for (let i = 0; i < length; i += 1) arr[i] = rng() * 2 - 1;   // [-1, 1), matches
                                                                  // Cohere embed's unnormalized range better than [0,1)
  return arr;
}

// SEED is fixed (not time-based) so a benchmark run today and one next month generate
// byte-identical datasets at a given corpus size — reproducibility (task 6.6) requires the
// input to be constant, not just the measurement methodology.
export const SEED = 0xcb0b5eed;
