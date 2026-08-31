// Replay = semente + linha do tempo de inputs (só as MUDANÇAS de máscara).
// Formato plano: [tick0, mask0, tick1, mask1, ...] com ticks estritamente crescentes.
// O servidor re-simula e recomputa o score: o cliente nunca é fonte de verdade.

import { createSim, step, SimState, TICK_RATE } from './sim';

export const MAX_REPLAY_TICKS = TICK_RATE * 60 * 10; // 10 min de partida
export const MAX_REPLAY_ENTRIES = 12000; // pares (tick, mask)
export const MASK_MAX = 3;

export class InputRecorder {
  readonly data: number[] = [];
  private last = 0;
  record(tick: number, mask: number) {
    if (mask === this.last) return;
    this.data.push(tick, mask);
    this.last = mask;
  }
}

export interface ReplayResult {
  ok: boolean;
  reason: string;
  score: number;
  ticks: number;
  pipes: number;
  kills: number;
  dead: boolean;
  state: SimState | null;
}

export function validateInputs(inputs: unknown): inputs is number[] {
  if (!Array.isArray(inputs)) return false;
  if (inputs.length % 2 !== 0 || inputs.length > MAX_REPLAY_ENTRIES * 2) return false;
  let prevTick = 0;
  for (let i = 0; i < inputs.length; i += 2) {
    const t = inputs[i], m = inputs[i + 1];
    if (!Number.isInteger(t) || !Number.isInteger(m)) return false;
    if (t < 1 || t > MAX_REPLAY_TICKS) return false;
    if (i > 0 && t <= prevTick) return false;
    if (m < 0 || m > MASK_MAX) return false;
    prevTick = t;
  }
  return true;
}

// Executa a partida inteira. A máscara registrada em `tick` vale a partir do tick de número `tick`
// (o cliente grava ANTES de chamar step(), com s.tick+1 como número do tick que vai rodar).
export function simulateReplay(seed: number, inputs: number[], maxTicks = MAX_REPLAY_TICKS): ReplayResult {
  const fail = (reason: string): ReplayResult => ({ ok: false, reason, score: 0, ticks: 0, pipes: 0, kills: 0, dead: false, state: null });
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return fail('seed inválida');
  if (!validateInputs(inputs)) return fail('inputs inválidos');

  const s = createSim(seed);
  let mask = 0;
  let idx = 0;
  while (s.status === 'playing' && s.tick < maxTicks) {
    const next = s.tick + 1;
    while (idx < inputs.length && inputs[idx] === next) { mask = inputs[idx + 1]; idx += 2; }
    step(s, mask);
  }
  if (idx < inputs.length) return fail('inputs após a morte');
  return {
    ok: s.status === 'dead', reason: s.status === 'dead' ? '' : 'partida não terminou',
    score: s.score, ticks: s.tick, pipes: s.pipesPassed, kills: s.kills, dead: s.status === 'dead', state: s,
  };
}
