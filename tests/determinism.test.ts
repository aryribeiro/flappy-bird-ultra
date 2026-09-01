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

test('LASER destrói a metade do cano que atinge; as outras armas não', () => {
  const run = (weapon: 1 | 4, ticks: number) => {
    const s = createSim(42);
    while (s.pipes.length === 0 && s.tick < 600) step(s, 0);
    const p = s.pipes[0];
    s.weapon = weapon;
    const wallY = p.gapY - (p.gapH >> 1) - 20 * SCALE; // altura da parede de CIMA
    let broke = false;
    const before = s.score;
    for (let i = 0; i < ticks && s.status === 'playing'; i++) {
      s.y = wallY; s.vy = 0; // teste segura o pássaro na altura da parede
      step(s, IN_SHOOT);
      if (s.events.some((e) => e.type === 'pipe_break')) { broke = true; break; }
    }
    return { s, broke, gained: s.score - before };
  };
  const laser = run(4, 300);
  assert.equal(laser.broke, true, 'laser quebra o cano');
  assert.ok(laser.s.pipes.some((p) => p.topGone), 'metade de cima marcada como destruída');
  assert.ok(laser.gained >= 30, 'pontuou pela quebra');

  const single = run(1, 200);
  assert.equal(single.broke, false, 'PIPOCO não quebra cano');
  assert.ok(!single.s.pipes.some((p) => p.topGone || p.botGone));
});

test('vidas: colisão gasta 1 vida, teleporta ao meio com invencibilidade; escudo absorve cano; 3 batidas = morte', () => {
  const CENTER = (436 / 2) * SCALE;
  // Segura o pássaro na parede de cima do próximo cano até acontecer uma colisão
  const crash = (s: SimState) => {
    const p = s.pipes.find((pp) => pp.x + 64 * SCALE > 150 * SCALE)!;
    const wallY = p.gapY - (p.gapH >> 1) - 20 * SCALE;
    for (let i = 0; i < 400 && s.status === 'playing'; i++) {
      s.y = wallY; s.vy = 0;
      step(s, 0);
      if (s.events.some((e) => e.type === 'life_lost' || e.type === 'shield_pop' || e.type === 'die')) return s.events[s.events.length - 1].type;
    }
    return 'nada';
  };
  const waitInv = (s: SimState) => { while (s.inv > 0 && s.status === 'playing') { s.y = CENTER; s.vy = 0; step(s, 0); } };

  const s = createSim(42);
  while (s.pipes.length === 0) step(s, 0);
  assert.equal(s.lives, 3);

  // 1) escudo absorve o cano: sem perder vida, com invencibilidade curta
  s.shield = true;
  assert.equal(crash(s), 'shield_pop');
  assert.equal(s.shield, false);
  assert.equal(s.lives, 3);
  assert.ok(s.inv > 0 && s.inv <= 90);
  waitInv(s);

  // 2) sem escudo: perde vida, volta ao centro piscando, TIRO volta ao PIPOCO (moedas ficam)
  s.weapon = 4; s.coins$ = 17;
  s.capsules.push({ id: 9999, kind: 'weapon', x: 500 * SCALE, y: CENTER, price: 24, denied: true, tier: 4 });
  assert.equal(crash(s), 'life_lost');
  assert.equal(s.lives, 2);
  assert.equal(s.y, CENTER);
  assert.equal(s.inv, 180);
  assert.equal(s.status, 'playing');
  assert.equal(s.weapon, 1, 'arma resetada para PIPOCO');
  assert.equal(s.coins$, 17, 'moedas preservadas');
  const cap = s.capsules.find((c) => c.id === 9999)!;
  assert.equal(cap.tier, 2); assert.equal(cap.price, 6); assert.equal(cap.denied, false);
  waitInv(s);

  // 3) e 4) mais duas batidas: morre na terceira vida
  assert.equal(crash(s), 'life_lost');
  assert.equal(s.lives, 1);
  waitInv(s);
  assert.equal(crash(s), 'die');
  assert.equal(s.status, 'dead');
  assert.equal(s.lives, 0);
});

test('coração nasce a cada 15 canos (1º no 8º) e é COMPRADO por $30 (sem saldo, nega; vida cheia, não cobra)', () => {
  // Nos dois auxiliares, moedas e cápsulas do campo são apagadas a cada tick: o teste controla o saldo.
  const spawnHeart = (s: SimState) => {
    for (let t = 0; t < 7200 && s.hearts.length === 0; t++) { s.inv = 10; s.y = (436 / 2) * SCALE; s.vy = 0; s.coins.length = 0; s.capsules.length = 0; step(s, 0); }
    assert.equal(s.hearts.length, 1, 'coração nasceu');
    assert.equal(s.pipesSpawned, 8, 'nasce junto do 8º cano');
    assert.ok(s.tick < 1200, `cedo na partida (tick ${s.tick})`);
    // nunca em cima de uma cápsula: fica no meio do trecho entre canos
    const h = s.hearts[0];
    assert.ok(s.pipes.every((p) => Math.abs(p.x + 32 * SCALE - h.x) > 100 * SCALE), 'longe do centro de qualquer cano');
    return h;
  };
  const touch = (s: SimState, h: { y: number }) => {
    for (let i = 0; i < 600 && s.hearts.length > 0 && !s.events.some((e) => e.type === 'deny' || e.type === 'heart'); i++) {
      s.y = h.y; s.vy = 0; s.inv = 10; s.coins.length = 0; s.capsules.length = 0; step(s, 0);
    }
  };
  // (o saldo é fixado DEPOIS do spawn: até lá o pássaro parado no centro pega moedas das trilhas)
  // com saldo e vida faltando: compra
  const a = createSim(7); a.lives = 1;
  const ha = spawnHeart(a); a.coins$ = 35;
  touch(a, ha);
  assert.equal(a.hearts.length, 0, 'coração comprado some');
  assert.equal(a.lives, 2); assert.equal(a.coins$, 5);
  // sem saldo: nega e o coração continua
  const b = createSim(7); b.lives = 1;
  const hb = spawnHeart(b); b.coins$ = 10;
  touch(b, hb);
  assert.ok(b.events.some((e) => e.type === 'deny'), 'negou por falta de moedas');
  assert.equal(b.lives, 1); assert.equal(b.coins$, 10); assert.equal(b.hearts.length, 1);
  // vida cheia: não cobra
  const c = createSim(7); c.lives = 3;
  const hc = spawnHeart(c); c.coins$ = 50;
  touch(c, hc);
  assert.equal(c.lives, 3); assert.equal(c.coins$, 50);
});

test('seeds diferentes geram partidas diferentes', () => {
  const a = createSim(1), b = createSim(2);
  for (let i = 0; i < 300; i++) { step(a, 0); step(b, 0); }
  assert.notEqual(hashState(a), hashState(b));
});
