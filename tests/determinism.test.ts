import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSim, step, hashState, IN_FLAP, IN_SHOOT, SCALE, SimState } from '../src/game/sim';
import { InputRecorder, simulateReplay, validateInputs } from '../src/game/replay';

// Piloto automático determinístico: mira o centro do próximo gap e atira sempre.
function autopilotMask(s: SimState, tick: number): number {
  let target = (436 / 2) * SCALE;
  for (const p of s.pipes) if (p.x + 64 * SCALE > 150 * SCALE) { target = p.gapY; break; }
  let mask = IN_SHOOT;
  if (s.y > target + 6 * SCALE && s.vy > -2 * SCALE) mask |= IN_FLAP;
  if (tick % 97 === 0) mask &= ~IN_SHOOT; // solta o gatilho de vez em quando (gera mudanças de máscara)
  return mask;
}

function runOnce(seed: number) {
  const s = createSim(seed);
  const rec = new InputRecorder();
  const hashes: number[] = [];
  while (s.status === 'playing' && s.tick < 60 * 120) {
    const next = s.tick + 1;
    const mask = autopilotMask(s, next);
    rec.record(next, mask);
    step(s, mask);
    if (s.tick % 100 === 0) hashes.push(hashState(s));
  }
  return { s, inputs: rec.data, hashes };
}

test('mesma semente + mesmos inputs => estados idênticos (duas execuções)', () => {
  for (const seed of [1, 42, 123456789, 0xdeadbeef]) {
    const a = runOnce(seed);
    const b = runOnce(seed);
    assert.deepEqual(a.hashes, b.hashes, `hashes divergem na seed ${seed}`);
    assert.equal(hashState(a.s), hashState(b.s));
    assert.equal(a.s.score, b.s.score);
  }
});

test('replay gravado no cliente re-simula no servidor com o mesmo score', () => {
  for (const seed of [7, 99, 2026]) {
    const a = runOnce(seed);
    assert.ok(validateInputs(a.inputs), 'inputs válidos');
    const r = simulateReplay(seed, a.inputs);
    assert.equal(r.ok, true, `replay ok (seed ${seed}): ${r.reason}`);
    assert.equal(r.score, a.s.score, 'score recomputado igual');
    assert.equal(r.ticks, a.s.tick, 'mesmo número de ticks');
    assert.equal(r.pipes, a.s.pipesPassed);
    assert.equal(r.kills, a.s.kills);
  }
});

test('o piloto automático de fato joga (passa canos, mata inimigos, morre)', () => {
  const a = runOnce(42);
  assert.equal(a.s.status, 'dead');
  assert.ok(a.s.pipesPassed >= 3, `passou ${a.s.pipesPassed} canos`);
  assert.ok(a.s.score > 30, `score ${a.s.score}`);
});

test('replay adulterado é rejeitado: score declarado diferente do recomputado', () => {
  const a = runOnce(42);
  const r = simulateReplay(42, a.inputs);
  assert.notEqual(r.score, a.s.score + 1000);
  // inputs após a morte
  const tampered = [...a.inputs, a.s.tick + 50, 1];
  assert.equal(simulateReplay(42, tampered).ok, false);
  // ticks fora de ordem
  assert.equal(validateInputs([10, 1, 5, 0]), false);
  // máscara inválida
  assert.equal(validateInputs([10, 9]), false);
});

test('seeds diferentes geram partidas diferentes', () => {
  const a = createSim(1), b = createSim(2);
  for (let i = 0; i < 300; i++) { step(a, 0); step(b, 0); }
  assert.notEqual(hashState(a), hashState(b));
});
