// ============================================================================
// Flappy Bird Ultra — núcleo de simulação DETERMINÍSTICO.
//
// Regras de ouro (o ranking depende delas):
//   1. Só inteiros. Posições/velocidades em ponto fixo (SCALE unidades = 1 px).
//   2. Nada de Date.now, performance.now, Math.random, Math.sin/cos/pow aqui.
//   3. Toda aleatoriedade vem de rngNext(state) (mulberry32 semeado).
//   4. Mesmo (seed, inputs) => mesmo estado, no browser e no servidor.
//   5. Qualquer mudança de balanceamento => bump em SIM_VERSION.
// ============================================================================

import { rngInt, rngRange } from './prng';

export const SIM_VERSION = 'fbu-5';

export const TICK_RATE = 60;
export const TICK_MS = 1000 / TICK_RATE;

// Mundo lógico (px)
export const W = 720;
export const H = 480;
export const GROUND_H = 44;
export const SKY_H = H - GROUND_H;

// Ponto fixo
export const SCALE = 1024;
const F = (px: number) => Math.round(px * SCALE);

// Pássaro
export const BIRD_X = F(150);
export const BIRD_R = F(12); // hitbox (sprite é maior — "justo" a favor do jogador)
// Física "planadora" (fbu-4): gravidade e velocidade terminal ~30% menores que o
// original fbu-1..3 (0.32/-6.2/9), que caía como pedra e matava no início.
const GRAVITY = F(0.22);
const FLAP_VY = F(-5.4);
const MAX_VY = F(6.5);
const MIN_VY = F(-7);

// Canos
export const PIPE_W = F(64);
const PIPE_SPACING = F(262);
const GAP_START = 176;
const GAP_MIN = 118;
const GAP_MARGIN = 54; // distância mínima do gap ao teto/chão (px)
const SPEED_START = F(2.4);
const SPEED_MAX = F(4.1);
const SPEED_PER_PIPE = F(0.055);

// Economia / power-ups
export const CAPSULE_EVERY = 4; // a cada N canos aparece uma cápsula (ritmo fixo)
export const CAPSULE_R = F(17);
const COIN_R = F(9);
const COIN_PICK_R = F(26);
const MAGNET_R = F(110);
const MAGNET_TICKS = 600;
const COIN_VALUE = 1;

// Vidas (fbu-5): 3 vidas; colisão gasta uma, teleporta ao centro e dá 3 s de invencibilidade piscando.
// Escudo absorve UMA colisão (inimigo ou cano) — no cano, 1,5 s de invencibilidade para sair da parede.
// A cada 5 min de partida aparece UM coração que recupera uma vida (máx. 3).
export const LIVES_START = 3;
export const LIVES_MAX = 3;
export const INV_HIT_TICKS = 180;
export const INV_SHIELD_TICKS = 90;
export const HEART_EVERY_TICKS = 5 * 60 * TICK_RATE;
export const HEART_R = F(14);

// Pontuação
export const PTS_PIPE = 10;
export const PTS_PIPE_BREAK = 30; // metade de cano destruída pelo LASER (sem multiplicador de combo)
export const COMBO_MAX = 8;
const COMBO_TICKS = 180;

// Input (bitmask por tick)
export const IN_FLAP = 1; // "bata as asas NESTE tick" (cliente envia 1 tick por pressionamento)
export const IN_SHOOT = 2; // segurado = fogo automático respeitando cooldown

export type WeaponTier = 1 | 2 | 3 | 4;
export interface WeaponDef {
  tier: WeaponTier;
  name: string;
  price: number; // custo em moedas para COMPRAR este tier
  cooldown: number; // ticks
  dmg: number;
  speed: number; // px/tick
  pierce: number; // quantos inimigos atravessa (0 = some no 1º)
  shots: ReadonlyArray<{ vy: number; oy: number }>; // vy em px/tick, oy offset vertical px
  len: number; // comprimento visual do projétil (px)
}

export const WEAPONS: Readonly<Record<WeaponTier, WeaponDef>> = {
  1: { tier: 1, name: 'PIPOCO', price: 0, cooldown: 14, dmg: 1, speed: 9, pierce: 0, shots: [{ vy: 0, oy: 0 }], len: 14 },
  2: { tier: 2, name: 'DUPLO', price: 6, cooldown: 12, dmg: 1, speed: 9.5, pierce: 0, shots: [{ vy: 0, oy: -7 }, { vy: 0, oy: 7 }], len: 14 },
  3: { tier: 3, name: 'LEQUE', price: 14, cooldown: 13, dmg: 1, speed: 9, pierce: 0, shots: [{ vy: -2.2, oy: -4 }, { vy: 0, oy: 0 }, { vy: 2.2, oy: 4 }], len: 14 },
  4: { tier: 4, name: 'LASER', price: 24, cooldown: 22, dmg: 3, speed: 15, pierce: 3, shots: [{ vy: 0, oy: 0 }], len: 44 },
};

export type CapsuleKind = 'weapon' | 'shield' | 'magnet';
export const CAPSULE_PRICE: Record<Exclude<CapsuleKind, 'weapon'>, number> = { shield: 8, magnet: 6 };

export type EnemyKind = 0 | 1 | 2; // 0 drone, 1 vespa, 2 tanque
export const ENEMY_DEF = [
  { name: 'drone', hp: 1, r: F(13), pts: 25, speedBonus: F(1.3) },
  { name: 'vespa', hp: 2, r: F(14), pts: 40, speedBonus: F(0.9) },
  { name: 'tanque', hp: 5, r: F(22), pts: 90, speedBonus: F(0.25) },
] as const;

// Tabela de seno inteira (x1000), 32 passos — sem Math.sin no núcleo.
const SIN32 = [
  0, 195, 383, 556, 707, 831, 924, 981, 1000, 981, 924, 831, 707, 556, 383, 195,
  0, -195, -383, -556, -707, -831, -924, -981, -1000, -981, -924, -831, -707, -556, -383, -195,
] as const;

// ---------------------------------------------------------------------------
// Entidades (todas em ponto fixo)
// ---------------------------------------------------------------------------
// topGone/botGone: metade destruída pelo LASER (única arma que corta cano)
export interface Pipe { id: number; x: number; gapY: number; gapH: number; passed: boolean; topGone: boolean; botGone: boolean; }
export interface Enemy { id: number; kind: EnemyKind; x: number; y: number; vx: number; baseY: number; hp: number; phase: number; amp: number; flash: number; }
export interface Bullet { id: number; x: number; y: number; vx: number; vy: number; dmg: number; pierce: number; len: number; tier: WeaponTier; hit: number[]; }
export interface Coin { id: number; x: number; y: number; spin: number; }
export interface Capsule { id: number; kind: CapsuleKind; x: number; y: number; price: number; denied: boolean; tier: WeaponTier; }
export interface Heart { id: number; x: number; y: number; }

export type SimEventType =
  | 'flap' | 'shoot' | 'hit' | 'kill' | 'pipe' | 'coin' | 'buy' | 'deny'
  | 'shield_pop' | 'die' | 'combo_up' | 'combo_lost' | 'bullet_wall' | 'pipe_break' | 'life_lost' | 'heart';

export interface SimEvent { type: SimEventType; x: number; y: number; v: number; }

export interface SimState {
  rng: number;
  tick: number;
  status: 'playing' | 'dead';
  // pássaro
  y: number; vy: number;
  // mundo
  speed: number;
  pipes: Pipe[]; enemies: Enemy[]; bullets: Bullet[]; coins: Coin[]; capsules: Capsule[]; hearts: Heart[];
  lives: number; inv: number; // inv = ticks restantes de invencibilidade (pisca)
  nextPipeX: number; pipesSpawned: number; pipesPassed: number; lastGapY: number;
  enemyTimer: number; nextId: number;
  // jogador
  weapon: WeaponTier; cooldown: number; coins$: number; shield: boolean; magnet: number;
  score: number; combo: number; comboTimer: number; kills: number; coinsTotal: number;
  deathTick: number; deathCause: 'pipe' | 'ground' | 'sky' | 'enemy' | '';
  events: SimEvent[];
}

export function createSim(seed: number): SimState {
  return {
    rng: seed >>> 0, tick: 0, status: 'playing',
    y: F(SKY_H / 2), vy: 0,
    speed: SPEED_START,
    pipes: [], enemies: [], bullets: [], coins: [], capsules: [], hearts: [],
    lives: LIVES_START, inv: 0,
    nextPipeX: F(W + 120), pipesSpawned: 0, pipesPassed: 0, lastGapY: F(SKY_H / 2),
    enemyTimer: 200, nextId: 1,
    weapon: 1, cooldown: 0, coins$: 0, shield: false, magnet: 0,
    score: 0, combo: 1, comboTimer: 0, kills: 0, coinsTotal: 0,
    deathTick: -1, deathCause: '',
    events: [],
  };
}

function emit(s: SimState, type: SimEventType, x: number, y: number, v = 0) {
  s.events.push({ type, x, y, v });
}

function gapForPipe(n: number): number {
  const g = GAP_START - n * 2;
  return F(g < GAP_MIN ? GAP_MIN : g);
}

// Deslocamento do arco de moedas (px), por índice i em count moedas — tabela inteira.
function arcBump(i: number, count: number): number {
  // triângulo: 0 nas pontas, 34 no meio (inteiros; sem float)
  const half = count - 1;
  const d = Math.abs(2 * i - half); // 0 no meio .. half nas pontas
  return Math.trunc((34 * (half - d)) / (half === 0 ? 1 : half));
}

function spawnPipe(s: SimState) {
  const n = s.pipesSpawned;
  const gapH = gapForPipe(n);
  const lo = F(GAP_MARGIN) + (gapH >> 1);
  const hi = F(SKY_H - GAP_MARGIN) - (gapH >> 1);
  const gapY = rngRange(s, lo, hi);
  const x = s.nextPipeX;
  s.pipes.push({ id: s.nextId++, x, gapY, gapH, passed: false, topGone: false, botGone: false });
  s.pipesSpawned = n + 1;
  s.nextPipeX = x + PIPE_SPACING;

  // Moedas: trilha no trecho ANTES deste cano, interpolando do gap anterior para este gap.
  // As moedas guiam o caminho para dentro da fresta (nunca atraem para fora do gap).
  const count = 3 + rngInt(s, 3); // 3..5
  const arc = rngInt(s, 3); // 0 reta, 1 arco p/ cima, 2 arco p/ baixo
  const prevGapY = s.lastGapY;
  const startX = x - F(200);
  for (let i = 0; i < count; i++) {
    const t = count > 1 ? Math.trunc((i * 1000) / (count - 1)) : 500; // 0..1000 (inteiro)
    const baseY = prevGapY + Math.trunc(((gapY - prevGapY) * t) / 1000);
    const bump = arc === 0 ? 0 : arcBump(i, count) * (arc === 1 ? -1 : 1);
    s.coins.push({ id: s.nextId++, x: startX + F(i * 30), y: baseY + F(bump), spin: (i * 5) & 31 });
  }
  s.lastGapY = gapY;

  // Cápsula em ritmo fixo, no centro do gap: escolha sob pressão, previsível
  if (n > 0 && n % CAPSULE_EVERY === 0) {
    let kind: CapsuleKind;
    let tier: WeaponTier = s.weapon;
    if (s.weapon < 4) {
      kind = 'weapon';
      tier = (s.weapon + 1) as WeaponTier;
    } else {
      kind = s.shield ? 'magnet' : rngInt(s, 3) === 0 ? 'magnet' : 'shield';
    }
    const price = kind === 'weapon' ? WEAPONS[tier].price : CAPSULE_PRICE[kind];
    s.capsules.push({ id: s.nextId++, kind, x: x + (PIPE_W >> 1), y: gapY, price, denied: false, tier });
  }
}

function spawnEnemy(s: SimState) {
  const n = s.pipesPassed;
  // distribuição por progresso: tanques só depois do 6º cano
  let kind: EnemyKind = 0;
  const roll = rngInt(s, 100);
  if (n >= 6 && roll < 15 + Math.min(n, 30)) kind = 2;
  else if (n >= 2 && roll < 55) kind = 1;
  const def = ENEMY_DEF[kind];
  // alvo vertical: dentro do gap do cano mais próximo à direita (força a escolha subir x atirar)
  let ty = F(SKY_H / 2);
  for (const p of s.pipes) {
    if (p.x > BIRD_X) { ty = p.gapY + rngRange(s, -(p.gapH >> 2), p.gapH >> 2); break; }
  }
  const amp = kind === 1 ? F(28 + rngInt(s, 22)) : 0;
  s.enemies.push({
    id: s.nextId++, kind, x: F(W + 40), y: ty, baseY: ty,
    vx: -(s.speed + def.speedBonus), hp: def.hp, phase: rngInt(s, 32), amp, flash: 0,
  });
}

function circleRect(cx: number, cy: number, r: number, rx: number, ry: number, rw: number, rh: number): boolean {
  const nx = cx < rx ? rx : cx > rx + rw ? rx + rw : cx;
  const ny = cy < ry ? ry : cy > ry + rh ? ry + rh : cy;
  const dx = cx - nx, dy = cy - ny;
  // |dx|,|dy| < 2^20 -> produtos exatos em double (< 2^53)
  return dx * dx + dy * dy < r * r;
}

function circles(ax: number, ay: number, ar: number, bx: number, by: number, br: number): boolean {
  const dx = ax - bx, dy = ay - by, r = ar + br;
  return dx * dx + dy * dy < r * r;
}

function fire(s: SimState) {
  const w = WEAPONS[s.weapon];
  const bx = BIRD_X + F(14);
  for (const sh of w.shots) {
    s.bullets.push({
      id: s.nextId++, x: bx, y: s.y + F(sh.oy), vx: F(w.speed), vy: F(sh.vy),
      dmg: w.dmg, pierce: w.pierce, len: F(w.len), tier: w.tier, hit: [],
    });
  }
  s.cooldown = w.cooldown;
  emit(s, 'shoot', bx, s.y, w.tier);
}

function addKillScore(s: SimState, e: Enemy) {
  const def = ENEMY_DEF[e.kind];
  const pts = def.pts * s.combo;
  s.score += pts;
  s.kills++;
  if (s.combo < COMBO_MAX) {
    s.combo++;
    emit(s, 'combo_up', BIRD_X, s.y, s.combo);
  }
  s.comboTimer = COMBO_TICKS;
  emit(s, 'kill', e.x, e.y, pts);
}

function die(s: SimState, cause: SimState['deathCause']) {
  if (s.status === 'dead') return;
  s.status = 'dead';
  s.deathTick = s.tick;
  s.deathCause = cause;
  emit(s, 'die', BIRD_X, s.y);
}

// Colisão com cano/chão (inimigo trata o escudo por conta própria). Retorna true se morreu.
function takeHit(s: SimState, cause: SimState['deathCause'], hx: number, hy: number, allowShield: boolean): boolean {
  if (allowShield && s.shield) {
    s.shield = false;
    s.inv = INV_SHIELD_TICKS;
    emit(s, 'shield_pop', hx, hy);
    return false;
  }
  s.lives--;
  if (s.lives <= 0) { die(s, cause); return true; }
  // perde a vida: volta ao meio da tela, piscando e invencível por 3 s; combo zera
  s.y = F(SKY_H / 2);
  s.vy = 0;
  s.inv = INV_HIT_TICKS;
  s.combo = 1;
  s.comboTimer = 0;
  emit(s, 'life_lost', hx, hy, s.lives);
  return false;
}

// ---------------------------------------------------------------------------
// Um tick. Muta o estado; eventos do tick ficam em s.events (limpo no início).
// ---------------------------------------------------------------------------
export function step(s: SimState, input: number): void {
  s.events.length = 0;
  if (s.status === 'dead') return;
  s.tick++;

  // --- input
  if (input & IN_FLAP) {
    s.vy = FLAP_VY;
    emit(s, 'flap', BIRD_X, s.y);
  }
  if (s.cooldown > 0) s.cooldown--;
  if ((input & IN_SHOOT) && s.cooldown === 0) fire(s);

  // --- pássaro
  s.vy += GRAVITY;
  if (s.vy > MAX_VY) s.vy = MAX_VY;
  if (s.vy < MIN_VY) s.vy = MIN_VY;
  s.y += s.vy;
  if (s.y < BIRD_R) { s.y = BIRD_R; s.vy = 0; }
  if (s.y + BIRD_R >= F(SKY_H)) {
    s.y = F(SKY_H) - BIRD_R;
    if (s.inv > 0) s.vy = 0; // invencível: só apoia no chão
    else if (takeHit(s, 'ground', BIRD_X, s.y, true)) return;
  }

  // --- efeitos temporários
  if (s.inv > 0) s.inv--;
  if (s.magnet > 0) s.magnet--;
  if (s.comboTimer > 0) {
    s.comboTimer--;
    if (s.comboTimer === 0 && s.combo > 1) { s.combo = 1; emit(s, 'combo_lost', BIRD_X, s.y); }
  }

  // --- mundo rola
  const sp = s.speed;
  s.nextPipeX -= sp;
  while (s.nextPipeX <= F(W + 80)) spawnPipe(s);

  for (let i = s.pipes.length - 1; i >= 0; i--) {
    const p = s.pipes[i];
    p.x -= sp;
    if (!p.passed && p.x + PIPE_W < BIRD_X) {
      p.passed = true;
      s.pipesPassed++;
      s.score += PTS_PIPE;
      s.speed = Math.min(SPEED_MAX, SPEED_START + s.pipesPassed * SPEED_PER_PIPE);
      emit(s, 'pipe', p.x + PIPE_W, p.gapY, PTS_PIPE);
    }
    if (p.x + PIPE_W < F(-10)) s.pipes.splice(i, 1);
  }

  // --- colisão pássaro x cano (metade destruída não colide; invencível atravessa)
  if (s.inv === 0) {
    for (const p of s.pipes) {
      if (p.x > BIRD_X + BIRD_R || p.x + PIPE_W < BIRD_X - BIRD_R) continue;
      const top = p.gapY - (p.gapH >> 1);
      const bot = p.gapY + (p.gapH >> 1);
      if ((!p.topGone && circleRect(BIRD_X, s.y, BIRD_R, p.x, 0, PIPE_W, top)) ||
          (!p.botGone && circleRect(BIRD_X, s.y, BIRD_R, p.x, bot, PIPE_W, F(SKY_H) - bot))) {
        if (takeHit(s, 'pipe', BIRD_X, s.y, true)) return;
        break;
      }
    }
  }

  // --- corações de cura: um a cada 5 min, no meio do trecho entre canos, na altura do último gap
  if (s.tick % HEART_EVERY_TICKS === 0) {
    s.hearts.push({ id: s.nextId++, x: s.nextPipeX - (PIPE_SPACING >> 1), y: s.lastGapY });
  }
  for (let i = s.hearts.length - 1; i >= 0; i--) {
    const h = s.hearts[i];
    h.x -= sp;
    if (circles(BIRD_X, s.y, BIRD_R + F(10), h.x, h.y, HEART_R)) {
      if (s.lives < LIVES_MAX) s.lives++;
      emit(s, 'heart', h.x, h.y, s.lives);
      s.hearts.splice(i, 1);
      continue;
    }
    if (h.x < F(-30)) s.hearts.splice(i, 1);
  }

  // --- moedas
  for (let i = s.coins.length - 1; i >= 0; i--) {
    const c = s.coins[i];
    c.x -= sp;
    c.spin = (c.spin + 1) & 31;
    if (s.magnet > 0 && circles(BIRD_X, s.y, MAGNET_R, c.x, c.y, 0)) {
      // atração: 1/6 da distância por tick (inteiro)
      c.x += Math.trunc((BIRD_X - c.x) / 6);
      c.y += Math.trunc((s.y - c.y) / 6);
    }
    if (circles(BIRD_X, s.y, COIN_PICK_R, c.x, c.y, COIN_R)) {
      s.coins$ += COIN_VALUE;
      s.coinsTotal += COIN_VALUE;
      emit(s, 'coin', c.x, c.y, s.coins$);
      s.coins.splice(i, 1);
      continue;
    }
    if (c.x < F(-20)) s.coins.splice(i, 1);
  }

  // --- cápsulas (compra ao encostar, sem pausa)
  for (let i = s.capsules.length - 1; i >= 0; i--) {
    const c = s.capsules[i];
    c.x -= sp;
    if (circles(BIRD_X, s.y, BIRD_R + F(10), c.x, c.y, CAPSULE_R)) {
      if (s.coins$ >= c.price) {
        s.coins$ -= c.price;
        if (c.kind === 'weapon') s.weapon = c.tier;
        else if (c.kind === 'shield') s.shield = true;
        else s.magnet = MAGNET_TICKS;
        emit(s, 'buy', c.x, c.y, c.kind === 'weapon' ? c.tier : c.kind === 'shield' ? 10 : 11);
        s.capsules.splice(i, 1);
        continue;
      } else if (!c.denied) {
        c.denied = true;
        emit(s, 'deny', c.x, c.y, c.price - s.coins$);
      }
    }
    if (c.x < F(-30)) s.capsules.splice(i, 1);
  }

  // --- inimigos
  if (s.pipesPassed >= 1) {
    s.enemyTimer--;
    if (s.enemyTimer <= 0) {
      spawnEnemy(s);
      const base = 150 - s.pipesPassed * 3;
      s.enemyTimer = (base < 62 ? 62 : base) + rngInt(s, 40);
    }
  }
  for (let i = s.enemies.length - 1; i >= 0; i--) {
    const e = s.enemies[i];
    e.x += e.vx;
    if (e.flash > 0) e.flash--;
    if (e.kind === 1) {
      e.phase = (e.phase + 1) & 31;
      e.y = e.baseY + Math.trunc((e.amp * SIN32[e.phase]) / 1000);
    }
    if (e.x < F(-50)) { s.enemies.splice(i, 1); continue; }
    if (s.inv === 0 && circles(BIRD_X, s.y, BIRD_R, e.x, e.y, ENEMY_DEF[e.kind].r)) {
      if (s.shield) {
        s.shield = false;
        emit(s, 'shield_pop', e.x, e.y);
        emit(s, 'kill', e.x, e.y, 0);
        s.enemies.splice(i, 1);
        continue;
      }
      const ex = e.x, ey = e.y;
      s.enemies.splice(i, 1); // o inimigo que acertou some
      if (takeHit(s, 'enemy', ex, ey, false)) return;
      continue;
    }
  }

  // --- projéteis
  for (let i = s.bullets.length - 1; i >= 0; i--) {
    const b = s.bullets[i];
    b.x += b.vx;
    b.y += b.vy;
    if (b.x > F(W + 60) || b.y < F(-20) || b.y > F(SKY_H + 20)) { s.bullets.splice(i, 1); continue; }
    // cano: indestrutível para todo tiro, EXCETO o LASER, que destrói a metade atingida
    let wall = false;
    for (const p of s.pipes) {
      if (b.x < p.x || b.x > p.x + PIPE_W) continue;
      const top = p.gapY - (p.gapH >> 1);
      const bot = p.gapY + (p.gapH >> 1);
      const hitTop = b.y < top && !p.topGone;
      const hitBot = b.y > bot && !p.botGone;
      if (!hitTop && !hitBot) continue;
      if (b.tier === 4) {
        if (hitTop) p.topGone = true; else p.botGone = true;
        s.score += PTS_PIPE_BREAK;
        emit(s, 'pipe_break', b.x, b.y, PTS_PIPE_BREAK);
      } else {
        emit(s, 'bullet_wall', b.x, b.y);
      }
      wall = true; // o projétil é consumido nos dois casos (o laser gasta o corte)
      break;
    }
    if (wall) { s.bullets.splice(i, 1); continue; }

    let dead = false;
    for (let j = s.enemies.length - 1; j >= 0; j--) {
      const e = s.enemies[j];
      if (b.hit.includes(e.id)) continue;
      if (!circles(b.x, b.y, F(6), e.x, e.y, ENEMY_DEF[e.kind].r)) continue;
      e.hp -= b.dmg;
      e.flash = 6;
      b.hit.push(e.id);
      emit(s, 'hit', b.x, b.y, b.tier);
      if (e.hp <= 0) { addKillScore(s, e); s.enemies.splice(j, 1); }
      if (b.pierce > 0) b.pierce--; else { dead = true; break; }
    }
    if (dead) s.bullets.splice(i, 1);
  }
}

// Hash rápido do estado (FNV-1a sobre campos relevantes) — para teste de determinismo.
export function hashState(s: SimState): number {
  let h = 0x811c9dc5;
  const mix = (v: number) => {
    h ^= v & 0xffffffff; h = Math.imul(h, 0x01000193) >>> 0;
    h ^= v >>> 16; h = Math.imul(h, 0x01000193) >>> 0;
  };
  mix(s.tick); mix(s.y); mix(s.vy); mix(s.rng); mix(s.score); mix(s.coins$); mix(s.weapon); mix(s.combo); mix(s.lives); mix(s.inv);
  for (const p of s.pipes) { mix(p.x); mix(p.gapY); mix((p.topGone ? 1 : 0) + (p.botGone ? 2 : 0)); }
  for (const e of s.enemies) { mix(e.x); mix(e.y); mix(e.hp); }
  for (const b of s.bullets) { mix(b.x); mix(b.y); }
  for (const c of s.coins) { mix(c.x); mix(c.y); }
  return h >>> 0;
}
