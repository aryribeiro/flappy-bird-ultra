// PRNG determinístico (mulberry32) operando só com inteiros de 32 bits.
// O estado vive dentro do SimState para que clonar/re-simular seja trivial.

export function rngNext(state: { rng: number }): number {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

// Inteiro uniforme em [0, n)
export function rngInt(state: { rng: number }, n: number): number {
  return rngNext(state) % n;
}

// Inteiro uniforme em [lo, hi] inclusive
export function rngRange(state: { rng: number }, lo: number, hi: number): number {
  return lo + rngInt(state, hi - lo + 1);
}
