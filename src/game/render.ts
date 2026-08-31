// ============================================================================
// Renderizador + juice. Tudo aqui é NÃO-determinístico por definição (pode usar
// Math.random, tempo real) — nada daqui volta para a simulação.
//
// Orçamento de frame (lição do Cobra): o que é igual todo frame é cacheado em
// canvas offscreen; nada de fillText/shadowBlur no loop; partículas em buffer
// tipado sem alocação; shake por translate; flash por fillRect alfa.
// ============================================================================

import {
  SimState, SimEvent, SCALE, W, H, SKY_H, GROUND_H, BIRD_X, PIPE_W, WEAPONS, ENEMY_DEF, COMBO_MAX, CapsuleKind,
} from './sim';

const px = (v: number) => v / SCALE;

// ---------------------------------------------------------------------------
// Paleta
// ---------------------------------------------------------------------------
const PAL = {
  skyTop: '#5ec8f2', skyBot: '#bff0ff',
  hill: '#7fd58a', hillDark: '#5fbf6f',
  ground: '#d9b46a', groundLine: '#8bcf4a', groundDark: '#b8934c',
  pipe: '#62c452', pipeLight: '#9ae87a', pipeDark: '#3d8f33', pipeEdge: '#2b6a25',
  bird: '#ffd23f', birdDark: '#e0a800', beak: '#ff8a3d', eye: '#1b1b1b',
  coin: '#ffd54a', coinDark: '#d69a00',
  laser: '#ff4fd8', bullet: '#fff4b0',
  white: '#ffffff', red: '#ff5a5a', cyan: '#4ff0ff', gold: '#ffd54a', purple: '#c77dff', green: '#7dff9a',
};

const PARTICLE_COLORS = [PAL.white, PAL.gold, PAL.red, PAL.cyan, PAL.purple, PAL.green, '#ff9a3d', '#3a3a3a', PAL.coin, PAL.laser];
const C_WHITE = 0, C_GOLD = 1, C_RED = 2, C_CYAN = 3, C_PURPLE = 4, C_GREEN = 5, C_ORANGE = 6, C_SMOKE = 7, C_COIN = 8, C_LASER = 9;

// ---------------------------------------------------------------------------
// Sprites cacheados
// ---------------------------------------------------------------------------
function mk(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w); c.height = Math.ceil(h);
  return [c, c.getContext('2d')!];
}

const SPR = 2; // supersampling dos sprites (nítido em DPR 2)

function birdSprite(wing: 0 | 1 | 2): HTMLCanvasElement {
  const S = 56 * SPR, [c, g] = mk(S, S);
  g.scale(SPR, SPR);
  g.translate(28, 28);
  // corpo
  g.fillStyle = PAL.bird;
  g.beginPath(); g.ellipse(0, 0, 17, 14, 0, 0, Math.PI * 2); g.fill();
  // barriga
  g.fillStyle = '#fff1a8';
  g.beginPath(); g.ellipse(-2, 5, 10, 7, 0, 0, Math.PI * 2); g.fill();
  // asa (3 frames)
  g.fillStyle = PAL.birdDark;
  g.beginPath();
  const wy = wing === 0 ? -6 : wing === 1 ? 0 : 6;
  g.ellipse(-6, wy, 9, 5, wing === 0 ? -0.5 : wing === 2 ? 0.5 : 0, 0, Math.PI * 2);
  g.fill();
  // olho
  g.fillStyle = PAL.white; g.beginPath(); g.arc(8, -5, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = PAL.eye; g.beginPath(); g.arc(10, -5, 3, 0, Math.PI * 2); g.fill();
  g.fillStyle = PAL.white; g.beginPath(); g.arc(11, -6, 1.2, 0, Math.PI * 2); g.fill();
  // bico
  g.fillStyle = PAL.beak;
  g.beginPath(); g.moveTo(14, 0); g.lineTo(26, 3); g.lineTo(14, 7); g.closePath(); g.fill();
  g.fillStyle = '#e46f25';
  g.beginPath(); g.moveTo(14, 3); g.lineTo(26, 3); g.lineTo(14, 7); g.closePath(); g.fill();
  // contorno
  g.strokeStyle = '#7a5a00'; g.lineWidth = 1.5;
  g.beginPath(); g.ellipse(0, 0, 17, 14, 0, 0, Math.PI * 2); g.stroke();
  return c;
}

function pipeColumn(): { body: HTMLCanvasElement; cap: HTMLCanvasElement } {
  const w = px(PIPE_W);
  const [body, g] = mk(w * SPR, SKY_H * SPR);
  g.scale(SPR, SPR);
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, PAL.pipeDark); grad.addColorStop(0.25, PAL.pipeLight); grad.addColorStop(0.6, PAL.pipe); grad.addColorStop(1, PAL.pipeDark);
  g.fillStyle = grad; g.fillRect(0, 0, w, SKY_H);
  g.strokeStyle = PAL.pipeEdge; g.lineWidth = 2; g.strokeRect(1, -2, w - 2, SKY_H + 4);
  const cw = w + 8, ch = 26;
  const [cap, gc] = mk(cw * SPR, ch * SPR);
  gc.scale(SPR, SPR);
  const g2 = gc.createLinearGradient(0, 0, cw, 0);
  g2.addColorStop(0, PAL.pipeDark); g2.addColorStop(0.25, PAL.pipeLight); g2.addColorStop(0.6, PAL.pipe); g2.addColorStop(1, PAL.pipeDark);
  gc.fillStyle = g2; gc.fillRect(0, 0, cw, ch);
  gc.strokeStyle = PAL.pipeEdge; gc.lineWidth = 2; gc.strokeRect(1, 1, cw - 2, ch - 2);
  return { body, cap };
}

function enemySprite(kind: 0 | 1 | 2, frame: 0 | 1): HTMLCanvasElement {
  const r = px(ENEMY_DEF[kind].r) + 6;
  const S = (r * 2 + 8) * SPR, [c, g] = mk(S, S);
  g.scale(SPR, SPR); g.translate(r + 4, r + 4);
  if (kind === 0) {
    // drone: disco cinza com hélice
    g.fillStyle = '#5a6270'; g.beginPath(); g.ellipse(0, 0, r - 4, r - 8, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2d323a'; g.beginPath(); g.ellipse(0, 2, r - 9, r - 12, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = PAL.red; g.beginPath(); g.arc(-4, -1, 3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#c9d1dc'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(-r + 2, -r + 7); g.lineTo(r - 2, -r + 7); g.stroke();
    g.fillStyle = frame === 0 ? '#e8eef5' : '#9aa5b3';
    g.fillRect(-r + 4, -r + 4, (r - 4) * 2, 4);
  } else if (kind === 1) {
    // vespa: listrada, asas alternando
    g.fillStyle = frame === 0 ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.35)';
    g.beginPath(); g.ellipse(-2, -9, 10, 5, -0.4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(-2, 9, 10, 5, 0.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffcc33'; g.beginPath(); g.ellipse(0, 0, r - 3, r - 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a2a2a';
    for (let i = -1; i <= 1; i++) g.fillRect(i * 6 - 2, -(r - 8), 4, (r - 8) * 2);
    g.fillStyle = '#2a2a2a'; g.beginPath(); g.arc(-r + 6, 0, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = PAL.red; g.beginPath(); g.arc(-r + 5, -1, 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2a2a2a'; g.lineWidth = 2; g.beginPath(); g.moveTo(r - 4, 0); g.lineTo(r + 2, 0); g.stroke();
  } else {
    // tanque: blindado roxo com placas
    g.fillStyle = '#5b3a8c'; g.beginPath(); g.arc(0, 0, r - 4, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#7f57b8'; g.beginPath(); g.arc(-3, -3, r - 10, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2f1d4d'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, r - 4, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#2f1d4d';
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + (frame ? 0.3 : 0); g.beginPath(); g.arc(Math.cos(a) * (r - 8), Math.sin(a) * (r - 8), 3, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = PAL.red; g.beginPath(); g.arc(-6, 0, 5, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffb0b0'; g.beginPath(); g.arc(-7, -1, 2, 0, Math.PI * 2); g.fill();
  }
  return c;
}

function coinSprite(frame: number, frames: number): HTMLCanvasElement {
  const S = 24 * SPR, [c, g] = mk(S, S);
  g.scale(SPR, SPR); g.translate(12, 12);
  const t = Math.abs(Math.cos((frame / frames) * Math.PI));
  const rx = Math.max(2, 9 * t);
  g.fillStyle = PAL.coinDark; g.beginPath(); g.ellipse(0, 0, rx + 1.5, 10.5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = PAL.coin; g.beginPath(); g.ellipse(0, 0, rx, 9, 0, 0, Math.PI * 2); g.fill();
  if (rx > 5) { g.fillStyle = '#fff3b0'; g.beginPath(); g.ellipse(-rx * 0.3, -3, rx * 0.35, 3, 0, 0, Math.PI * 2); g.fill(); }
  return c;
}

function capsuleSprite(kind: CapsuleKind, tier: number): HTMLCanvasElement {
  const S = 48 * SPR, [c, g] = mk(S, S);
  g.scale(SPR, SPR); g.translate(24, 24);
  const col = kind === 'weapon' ? (tier === 4 ? PAL.laser : PAL.cyan) : kind === 'shield' ? PAL.green : PAL.purple;
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.beginPath(); g.arc(0, 0, 19, 0, Math.PI * 2); g.fill();
  g.fillStyle = col; g.beginPath(); g.arc(0, 0, 16, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#1b1b1b'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 19, 0, Math.PI * 2); g.stroke();
  g.fillStyle = '#1b1b1b';
  if (kind === 'weapon') {
    // ícone: N balas
    const n = tier === 2 ? 2 : tier === 3 ? 3 : 1;
    if (tier === 4) { g.fillRect(-11, -2, 22, 4); g.fillStyle = PAL.white; g.fillRect(-9, -1, 18, 2); }
    else for (let i = 0; i < n; i++) { const y = (i - (n - 1) / 2) * 7; g.beginPath(); g.ellipse(0, y, 8, 2.5, 0, 0, Math.PI * 2); g.fill(); }
  } else if (kind === 'shield') {
    g.beginPath(); g.moveTo(0, -11); g.lineTo(10, -6); g.lineTo(8, 5); g.lineTo(0, 11); g.lineTo(-8, 5); g.lineTo(-10, -6); g.closePath(); g.fill();
    g.fillStyle = PAL.green; g.beginPath(); g.moveTo(0, -7); g.lineTo(6, -4); g.lineTo(5, 3); g.lineTo(0, 7); g.lineTo(-5, 3); g.lineTo(-6, -4); g.closePath(); g.fill();
  } else {
    g.lineWidth = 5; g.strokeStyle = '#1b1b1b'; g.beginPath(); g.arc(0, 2, 8, Math.PI, 0); g.stroke();
    g.fillRect(-10.5, 2, 5, 7); g.fillRect(5.5, 2, 5, 7);
    g.fillStyle = PAL.red; g.fillRect(-10.5, 6, 5, 3); g.fillRect(5.5, 6, 5, 3);
  }
  return c;
}

function bulletSprite(tier: number): HTMLCanvasElement {
  const len = WEAPONS[tier as 1 | 2 | 3 | 4].len, h = tier === 4 ? 10 : 6;
  const [c, g] = mk((len + 6) * SPR, (h + 6) * SPR);
  g.scale(SPR, SPR); g.translate(3, 3 + h / 2);
  if (tier === 4) {
    g.fillStyle = PAL.laser; g.fillRect(0, -h / 2, len, h);
    g.fillStyle = PAL.white; g.fillRect(2, -h / 4, len - 4, h / 2);
  } else {
    g.fillStyle = tier === 3 ? PAL.cyan : PAL.bullet; g.beginPath(); g.ellipse(len / 2, 0, len / 2, h / 2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = PAL.white; g.beginPath(); g.ellipse(len / 2 + 2, -1, len / 4, h / 5, 0, 0, Math.PI * 2); g.fill();
  }
  return c;
}

function background(): { sky: HTMLCanvasElement; clouds: HTMLCanvasElement; hills: HTMLCanvasElement; ground: HTMLCanvasElement } {
  const [sky, gs] = mk(W, H);
  const grad = gs.createLinearGradient(0, 0, 0, SKY_H);
  grad.addColorStop(0, PAL.skyTop); grad.addColorStop(1, PAL.skyBot);
  gs.fillStyle = grad; gs.fillRect(0, 0, W, H);

  const [clouds, gc] = mk(W, SKY_H);
  gc.fillStyle = 'rgba(255,255,255,0.85)';
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 9; i++) {
    const x = rnd() * W, y = 30 + rnd() * 160, r = 14 + rnd() * 18;
    for (let k = 0; k < 4; k++) { gc.beginPath(); gc.arc(x + k * r * 0.9, y + (k % 2) * 4, r - k * 2, 0, Math.PI * 2); gc.fill(); }
  }

  const [hills, gh] = mk(W, 120);
  gh.fillStyle = PAL.hillDark;
  for (let i = 0; i < 7; i++) { gh.beginPath(); gh.arc(i * 120 + 40, 130, 80, Math.PI, 0); gh.fill(); }
  gh.fillStyle = PAL.hill;
  for (let i = 0; i < 6; i++) { gh.beginPath(); gh.arc(i * 130 + 100, 140, 70, Math.PI, 0); gh.fill(); }

  const [ground, gg] = mk(W + 64, GROUND_H);
  gg.fillStyle = PAL.ground; gg.fillRect(0, 0, W + 64, GROUND_H);
  gg.fillStyle = PAL.groundLine; gg.fillRect(0, 0, W + 64, 8);
  gg.fillStyle = PAL.groundDark;
  for (let x = 0; x < W + 64; x += 32) { gg.beginPath(); gg.moveTo(x, 8); gg.lineTo(x + 16, 8); gg.lineTo(x + 8, 18); gg.closePath(); gg.fill(); }
  gg.fillStyle = 'rgba(0,0,0,0.12)'; gg.fillRect(0, GROUND_H - 6, W + 64, 6);
  return { sky, clouds, hills, ground };
}

// Atlas de glifos: texto pré-rasterizado (nada de fillText no loop)
class GlyphAtlas {
  private glyphs = new Map<string, { c: HTMLCanvasElement; w: number }>();
  constructor(private size: number, private color: string) {}
  private glyph(ch: string) {
    let g = this.glyphs.get(ch);
    if (!g) {
      const font = `900 ${this.size}px "Segoe UI", system-ui, sans-serif`;
      const [mc, mg] = mk(4, 4);
      mg.font = font;
      const w = Math.ceil(mg.measureText(ch).width) + 8;
      const h = Math.ceil(this.size * 1.4);
      const [c, gc] = mk(w * SPR, h * SPR);
      gc.scale(SPR, SPR);
      gc.font = font; gc.textBaseline = 'middle';
      gc.lineJoin = 'round'; gc.lineWidth = Math.max(3, this.size / 6); gc.strokeStyle = '#1b1b1b';
      gc.strokeText(ch, 4, h / 2);
      gc.fillStyle = this.color; gc.fillText(ch, 4, h / 2);
      g = { c, w: w - 8 };
      this.glyphs.set(ch, g);
      void mc;
    }
    return g;
  }
  width(text: string) { let w = 0; for (const ch of text) w += this.glyph(ch).w; return w; }
  draw(g: CanvasRenderingContext2D, text: string, x: number, y: number, scale = 1, align: 'left' | 'center' = 'center') {
    const total = this.width(text) * scale;
    let cx = align === 'center' ? x - total / 2 : x;
    const h = Math.ceil(this.size * 1.4);
    for (const ch of text) {
      const gl = this.glyph(ch);
      g.drawImage(gl.c, cx - 4 * scale, y - (h / 2) * scale, (gl.w + 8) * scale, h * scale);
      cx += gl.w * scale;
    }
  }
}

// ---------------------------------------------------------------------------
// Partículas (buffer circular tipado — zero alocação por frame)
// ---------------------------------------------------------------------------
const P_N = 640, P_STRIDE = 8; // x y vx vy life max size color
class Particles {
  buf = new Float32Array(P_N * P_STRIDE);
  head = 0;
  spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, color: number) {
    const o = this.head * P_STRIDE;
    const b = this.buf;
    b[o] = x; b[o + 1] = y; b[o + 2] = vx; b[o + 3] = vy; b[o + 4] = life; b[o + 5] = life; b[o + 6] = size; b[o + 7] = color;
    this.head = (this.head + 1) % P_N;
  }
  burst(x: number, y: number, n: number, speed: number, life: number, size: number, color: number, spread = Math.PI * 2, dir = 0) {
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - 0.5) * spread;
      const sp = speed * (0.4 + Math.random() * 0.8);
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), color);
    }
  }
  update(dt: number, gravity = 0.0009, scrollPx = 0) {
    const b = this.buf;
    for (let i = 0; i < P_N; i++) {
      const o = i * P_STRIDE;
      if (b[o + 4] <= 0) continue;
      b[o + 4] -= dt;
      b[o] += b[o + 2] * dt - scrollPx;
      b[o + 1] += b[o + 3] * dt;
      b[o + 3] += gravity * dt;
      b[o + 2] *= 0.995;
    }
  }
  draw(g: CanvasRenderingContext2D) {
    const b = this.buf;
    let lastColor = -1;
    for (let i = 0; i < P_N; i++) {
      const o = i * P_STRIDE;
      const life = b[o + 4];
      if (life <= 0) continue;
      const t = life / b[o + 5];
      const c = b[o + 7];
      if (c !== lastColor) { g.fillStyle = PARTICLE_COLORS[c]; lastColor = c; }
      g.globalAlpha = t < 0.3 ? t / 0.3 : 1;
      const s = b[o + 6] * (0.5 + t * 0.5);
      g.fillRect(b[o] - s / 2, b[o + 1] - s / 2, s, s);
    }
    g.globalAlpha = 1;
  }
}

interface FloatText { text: string; x: number; y: number; vy: number; life: number; max: number; size: number; atlas: GlyphAtlas; pop: number; }

// ---------------------------------------------------------------------------
// Estado de juice (render-side)
// ---------------------------------------------------------------------------
export interface JuiceState {
  hitStopMs: number; // pausa do acumulador (consumida pelo loop)
  timeScale: number; // câmera lenta na morte
}

export class Renderer {
  private g: CanvasRenderingContext2D;
  private dpr = 1;
  private bird: HTMLCanvasElement[];
  private pipe: { body: HTMLCanvasElement; cap: HTMLCanvasElement };
  private enemies: HTMLCanvasElement[][];
  private coins: HTMLCanvasElement[];
  private capsules = new Map<string, HTMLCanvasElement>();
  private bullets: HTMLCanvasElement[];
  private bg: ReturnType<typeof background>;
  private atlasWhite = new GlyphAtlas(22, PAL.white);
  private atlasGold = new GlyphAtlas(26, PAL.gold);
  private atlasRed = new GlyphAtlas(22, PAL.red);
  private atlasCyan = new GlyphAtlas(24, PAL.cyan);
  private atlasSmall = new GlyphAtlas(15, PAL.white);
  private particles = new Particles();
  private texts: FloatText[] = [];
  private shake = 0;
  private flash = 0; private flashColor = '#ffffff';
  private scroll = 0; // px acumulados (parallax)
  private time = 0;
  private wingT = 0;
  private squash = 0; // ms restantes do squash de flap
  private visRot = 0; // rotação visual do pássaro (rad)
  private telegraphUntil = 0;
  private muzzle = 0;
  private deathT = -1; // ms desde a morte
  private comboPulse = 0;
  private coinPop = 0;
  private lastBuyText = '';

  constructor(private canvas: HTMLCanvasElement) {
    this.g = canvas.getContext('2d', { alpha: false })!;
    this.bird = [birdSprite(0), birdSprite(1), birdSprite(2)];
    this.pipe = pipeColumn();
    this.enemies = [[enemySprite(0, 0), enemySprite(0, 1)], [enemySprite(1, 0), enemySprite(1, 1)], [enemySprite(2, 0), enemySprite(2, 1)]];
    this.coins = Array.from({ length: 12 }, (_, i) => coinSprite(i, 12));
    this.bullets = [bulletSprite(1), bulletSprite(1), bulletSprite(2), bulletSprite(3), bulletSprite(4)];
    this.bg = background();
    // Pré-aquece tudo que seria rasterizado no meio da partida (nenhum custo novo durante o jogo)
    const chars = '0123456789+-x$!';
    for (const a of [this.atlasWhite, this.atlasGold, this.atlasRed, this.atlasCyan, this.atlasSmall]) a.width(chars);
    this.atlasRed.width('FALTAM ');
    this.atlasCyan.width('ESCUDO!IMÃ!' + Object.values(WEAPONS).map((w) => w.name).join(''));
    for (const kind of ['weapon', 'shield', 'magnet'] as const) {
      for (const tier of [1, 2, 3, 4]) this.capsules.set(`${kind}${tier}`, capsuleSprite(kind, tier));
    }
  }

  resize(cssW: number, cssH: number) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(W * this.dpr);
    this.canvas.height = Math.round(H * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  reset() {
    this.particles = new Particles();
    this.texts.length = 0;
    this.shake = 0; this.flash = 0; this.deathT = -1; this.visRot = 0; this.squash = 0; this.muzzle = 0; this.comboPulse = 0;
  }

  // Telegrafar: chamado no keydown, ANTES do tick — sensação de imediato
  telegraphFlap(now: number) {
    this.telegraphUntil = now + 90;
    this.squash = 140;
    this.wingT = 0;
  }

  private text(text: string, x: number, y: number, atlas: GlyphAtlas, size = 1, life = 900) {
    if (this.texts.length >= 18) this.texts.shift();
    this.texts.push({ text, x, y, vy: -0.05, life, max: life, size, atlas, pop: 1 });
  }

  // Converte eventos da simulação em juice
  consume(events: SimEvent[], s: SimState, juice: JuiceState) {
    for (const ev of events) {
      const x = px(ev.x), y = px(ev.y);
      switch (ev.type) {
        case 'flap':
          this.particles.burst(x - 10, y + 8, 5, 0.12, 320, 4, C_WHITE, 1.2, Math.PI * 0.75);
          break;
        case 'shoot':
          this.muzzle = 60;
          this.particles.burst(x + 10, y, ev.v === 4 ? 10 : 4, 0.2, 200, 3, ev.v === 4 ? C_LASER : C_GOLD, 0.8, 0);
          if (ev.v === 4) this.shake = Math.max(this.shake, 3);
          break;
        case 'hit':
          this.particles.burst(x, y, 6, 0.18, 260, 4, C_WHITE, Math.PI, Math.PI);
          juice.hitStopMs = Math.max(juice.hitStopMs, ev.v === 4 ? 30 : 18);
          break;
        case 'kill': {
          const big = ev.v >= 300;
          this.particles.burst(x, y, big ? 40 : 22, 0.3, 550, 6, C_ORANGE);
          this.particles.burst(x, y, 12, 0.12, 700, 8, C_SMOKE);
          this.particles.burst(x, y, 8, 0.4, 300, 3, C_WHITE);
          this.shake = Math.max(this.shake, big ? 12 : 7);
          juice.hitStopMs = Math.max(juice.hitStopMs, big ? 90 : 55);
          this.flash = Math.max(this.flash, 0.18); this.flashColor = '#ffffff';
          if (ev.v > 0) this.text(`+${ev.v}`, x, y - 10, s.combo >= 4 ? this.atlasGold : this.atlasWhite, big ? 1.5 : 1 + Math.min(s.combo, 8) * 0.06);
          break;
        }
        case 'pipe':
          this.text('+10', x + 6, y - 40, this.atlasSmall, 1, 600);
          break;
        case 'coin':
          this.particles.burst(x, y, 7, 0.16, 350, 4, C_COIN);
          this.coinPop = 200;
          break;
        case 'buy': {
          const label = ev.v === 10 ? 'ESCUDO!' : ev.v === 11 ? 'IMÃ!' : WEAPONS[ev.v as 1 | 2 | 3 | 4].name + '!';
          this.text(label, x, y - 26, this.atlasCyan, 1.3, 1300);
          this.particles.burst(x, y, 36, 0.28, 700, 5, ev.v === 10 ? C_GREEN : ev.v === 11 ? C_PURPLE : C_CYAN);
          this.shake = Math.max(this.shake, 6);
          this.flash = Math.max(this.flash, 0.25); this.flashColor = ev.v === 10 ? PAL.green : ev.v === 11 ? PAL.purple : PAL.cyan;
          juice.hitStopMs = Math.max(juice.hitStopMs, 70);
          this.lastBuyText = label;
          break;
        }
        case 'deny':
          this.text(`FALTAM ${ev.v}`, x, y - 26, this.atlasRed, 1, 1000);
          this.particles.burst(x, y, 8, 0.1, 300, 4, C_RED);
          this.shake = Math.max(this.shake, 3);
          break;
        case 'shield_pop':
          this.particles.burst(x, y, 30, 0.3, 600, 5, C_GREEN);
          this.flash = Math.max(this.flash, 0.3); this.flashColor = PAL.green;
          this.shake = Math.max(this.shake, 10);
          juice.hitStopMs = Math.max(juice.hitStopMs, 80);
          this.text('ESCUDO!', px(BIRD_X), y - 30, this.atlasCyan, 1.1, 900);
          break;
        case 'combo_up':
          this.comboPulse = 400;
          if (ev.v >= 3) this.text(`x${ev.v}`, px(BIRD_X) + 40, y - 34, this.atlasGold, 0.9 + ev.v * 0.08, 700);
          break;
        case 'combo_lost':
          break;
        case 'bullet_wall':
          this.particles.burst(x, y, 4, 0.1, 200, 3, C_WHITE, Math.PI, Math.PI);
          break;
        case 'pipe_break':
          // o laser corta o cano: chuva de estilhaços verdes + fumaça
          this.particles.burst(x, y, 34, 0.32, 650, 6, C_GREEN);
          this.particles.burst(x, y, 14, 0.18, 800, 8, C_SMOKE);
          this.particles.burst(x, y, 10, 0.4, 300, 3, C_LASER);
          this.shake = Math.max(this.shake, 11);
          juice.hitStopMs = Math.max(juice.hitStopMs, 70);
          this.flash = Math.max(this.flash, 0.15); this.flashColor = PAL.laser;
          this.text(`+${ev.v}`, x - 20, y, this.atlasCyan, 1.2);
          break;
        case 'die':
          this.deathT = 0;
          this.shake = 26;
          this.flash = 0.6; this.flashColor = PAL.red;
          this.particles.burst(x, y, 50, 0.35, 900, 6, C_GOLD);
          this.particles.burst(x, y, 20, 0.2, 1100, 9, C_SMOKE);
          juice.hitStopMs = Math.max(juice.hitStopMs, 120);
          juice.timeScale = 0.25;
          break;
      }
    }
  }

  // dtMs = tempo real do frame; alpha = fração do tick (0..1) para extrapolação
  frame(s: SimState, alpha: number, dtMs: number, now: number) {
    const g = this.g;
    this.time += dtMs;
    const speedPx = px(s.speed);
    const scrollPx = s.status === 'playing' ? speedPx * (dtMs / (1000 / 60)) : 0;
    if (s.status === 'playing') this.scroll += scrollPx;

    // updates de juice
    this.particles.update(dtMs, 0.0009, scrollPx);
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= dtMs; t.y += t.vy * dtMs; t.x -= scrollPx * 0.3;
      t.pop = Math.max(1, t.pop - dtMs * 0.004);
      if (t.life <= 0) this.texts.splice(i, 1);
    }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dtMs * 0.045);
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dtMs * 0.0025);
    if (this.squash > 0) this.squash -= dtMs;
    if (this.muzzle > 0) this.muzzle -= dtMs;
    if (this.comboPulse > 0) this.comboPulse -= dtMs;
    if (this.coinPop > 0) this.coinPop -= dtMs;
    if (this.deathT >= 0) this.deathT += dtMs;
    this.wingT += dtMs;

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    // shake por translate (custo zero)
    if (this.shake > 0.5) {
      g.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
    }

    // fundo + parallax
    g.drawImage(this.bg.sky, 0, 0);
    const cx = -(this.scroll * 0.15) % W;
    g.drawImage(this.bg.clouds, cx, 0); g.drawImage(this.bg.clouds, cx + W, 0);
    const hx = -(this.scroll * 0.4) % W;
    g.drawImage(this.bg.hills, hx, SKY_H - 120); g.drawImage(this.bg.hills, hx + W, SKY_H - 120);

    // canos (metade destruída pelo laser não é desenhada)
    const pw = px(PIPE_W);
    for (const p of s.pipes) {
      const x = px(p.x) - speedPx * alpha;
      const top = px(p.gapY - (p.gapH >> 1));
      const bot = px(p.gapY + (p.gapH >> 1));
      if (!p.topGone) {
        if (top > 0) g.drawImage(this.pipe.body, 0, 0, pw * SPR, top * SPR, x, 0, pw, top);
        g.drawImage(this.pipe.cap, x - 4, top - 26, pw + 8, 26);
      }
      if (!p.botGone) {
        const bh = SKY_H - bot;
        if (bh > 0) g.drawImage(this.pipe.body, 0, 0, pw * SPR, bh * SPR, x, bot, pw, bh);
        g.drawImage(this.pipe.cap, x - 4, bot, pw + 8, 26);
      }
    }

    // moedas
    for (const c of s.coins) {
      const x = px(c.x) - speedPx * alpha, y = px(c.y);
      const fr = Math.floor(((c.spin + this.time / 60) % 32) / 32 * 12) % 12;
      g.drawImage(this.coins[fr], x - 12, y - 12, 24, 24);
    }

    // cápsulas (com preço)
    for (const c of s.capsules) {
      const x = px(c.x) - speedPx * alpha, y = px(c.y);
      const key = `${c.kind}${c.tier}`;
      let spr = this.capsules.get(key);
      if (!spr) { spr = capsuleSprite(c.kind, c.tier); this.capsules.set(key, spr); }
      const bob = Math.sin(this.time / 180 + c.id) * 4;
      const sc = 1 + Math.sin(this.time / 120) * 0.06;
      g.drawImage(spr, x - 24 * sc, y + bob - 24 * sc, 48 * sc, 48 * sc);
      const afford = s.coins$ >= c.price;
      (afford ? this.atlasGold : this.atlasRed).draw(g, `$${c.price}`, x, y + bob - 30, 0.7);
    }

    // inimigos
    for (const e of s.enemies) {
      const x = px(e.x) + px(e.vx) * alpha, y = px(e.y);
      const fr = Math.floor(this.time / (e.kind === 1 ? 40 : 90)) % 2;
      const spr = this.enemies[e.kind][fr];
      const r = px(ENEMY_DEF[e.kind].r) + 6;
      const size = (r + 4) * 2;
      if (e.flash > 0) {
        g.drawImage(spr, x - size / 2, y - size / 2, size, size);
        g.globalCompositeOperation = 'source-atop';
        g.globalAlpha = 0.7; g.fillStyle = '#ffffff';
        g.fillRect(x - size / 2, y - size / 2, size, size);
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      } else {
        g.drawImage(spr, x - size / 2, y - size / 2, size, size);
      }
      if (e.kind === 2) {
        // barra de vida do tanque
        const w = 40, hp = e.hp / ENEMY_DEF[2].hp;
        g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x - w / 2, y - r - 10, w, 5);
        g.fillStyle = hp > 0.5 ? PAL.green : PAL.red; g.fillRect(x - w / 2, y - r - 10, w * hp, 5);
      }
    }

    // projéteis (com rastro)
    for (const b of s.bullets) {
      const x = px(b.x) + px(b.vx) * alpha, y = px(b.y) + px(b.vy) * alpha;
      const spr = this.bullets[b.tier];
      const len = px(b.len), h = b.tier === 4 ? 10 : 6;
      g.globalAlpha = 0.35;
      g.drawImage(spr, x - len - 12, y - h / 2 - 3, len + 6, h + 6);
      g.globalAlpha = 1;
      g.drawImage(spr, x - len, y - h / 2 - 3, len + 6, h + 6);
    }

    // pássaro
    {
      const by = px(s.y) + (s.status === 'playing' ? px(s.vy) * alpha : 0);
      const bx = px(BIRD_X);
      // rotação alvo: telegrafada no keydown (sobe já), senão pela velocidade
      let target = now < this.telegraphUntil ? -0.45 : Math.max(-0.45, Math.min(1.25, px(s.vy) * 0.16));
      if (this.deathT >= 0) target = 1.6;
      const k = target < this.visRot ? 0.35 : 0.12;
      this.visRot += (target - this.visRot) * Math.min(1, k * (dtMs / 16.7));
      const sq = this.squash > 0 ? this.squash / 140 : 0;
      const sx = 1 + sq * 0.18, sy = 1 - sq * 0.18;
      const wing = this.deathT >= 0 ? 1 : this.wingT < 70 ? 0 : this.wingT < 140 ? 1 : this.wingT < 210 ? 2 : (Math.floor(this.time / 110) % 3) as 0 | 1 | 2;
      g.save();
      g.translate(bx, by);
      g.rotate(this.visRot);
      g.scale(sx, sy);
      if (s.magnet > 0) {
        g.globalAlpha = 0.18 + Math.sin(this.time / 90) * 0.06;
        g.fillStyle = PAL.purple; g.beginPath(); g.arc(0, 0, 60, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      }
      if (s.shield) {
        g.globalAlpha = 0.55 + Math.sin(this.time / 120) * 0.15;
        g.strokeStyle = PAL.green; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 24, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
      }
      g.drawImage(this.bird[wing], -28, -28, 56, 56);
      if (this.muzzle > 0) {
        g.globalAlpha = this.muzzle / 60;
        g.fillStyle = s.weapon === 4 ? PAL.laser : PAL.gold;
        g.beginPath(); g.arc(28, 2, 6 + (60 - this.muzzle) * 0.15, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      }
      g.restore();
    }

    // partículas
    this.particles.draw(g);

    // chão (parallax 1:1)
    const gx = -(this.scroll % 32);
    g.drawImage(this.bg.ground, gx, SKY_H);

    // textos flutuantes
    for (const t of this.texts) {
      g.globalAlpha = t.life < 250 ? t.life / 250 : 1;
      t.atlas.draw(g, t.text, t.x, t.y, t.size * t.pop);
    }
    g.globalAlpha = 1;

    // vinheta de combo (cresce com o combo)
    if (s.combo >= 3 && s.status === 'playing') {
      const a = Math.min(0.35, (s.combo / COMBO_MAX) * 0.35) + (this.comboPulse > 0 ? this.comboPulse / 400 * 0.2 : 0);
      g.globalAlpha = a;
      g.strokeStyle = s.combo >= 6 ? PAL.gold : PAL.cyan; g.lineWidth = 14 + s.combo;
      g.strokeRect(0, 0, W, H);
      g.globalAlpha = 1;
    }

    // flash
    if (this.flash > 0) {
      g.globalAlpha = this.flash; g.fillStyle = this.flashColor; g.fillRect(-40, -40, W + 80, H + 80); g.globalAlpha = 1;
    }

    // morte: escurece progressivamente
    if (this.deathT > 300) {
      g.globalAlpha = Math.min(0.55, (this.deathT - 300) / 900);
      g.fillStyle = '#000'; g.fillRect(-40, -40, W + 80, H + 80); g.globalAlpha = 1;
    }
  }

  get coinPopScale() { return this.coinPop > 0 ? 1 + (this.coinPop / 200) * 0.5 : 1; }
}
