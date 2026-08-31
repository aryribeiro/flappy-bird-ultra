// SFX de WAV locais (public/sounds/*, gerados por scripts/gen-sounds.mjs).
// Decodificados uma vez em AudioBuffers no gesto do usuário (warmUp).

export type SfxName =
  | 'flap' | 'shoot' | 'laser' | 'hit' | 'kill' | 'coin' | 'buy' | 'deny' | 'die' | 'pipe' | 'combo' | 'shield';

const SFX_FILES: Record<SfxName, string> = {
  flap: '/sounds/flap.wav',
  shoot: '/sounds/shoot.wav',
  laser: '/sounds/laser.wav',
  hit: '/sounds/hit.wav',
  kill: '/sounds/kill.wav',
  coin: '/sounds/coin.wav',
  buy: '/sounds/buy.wav',
  deny: '/sounds/deny.wav',
  die: '/sounds/die.wav',
  pipe: '/sounds/pipe.wav',
  combo: '/sounds/combo.wav',
  shield: '/sounds/shield.wav',
};

const MUTE_KEY = 'fbu_muted';

class SoundManager {
  private ctx: AudioContext | null = null;
  private muted = false;
  private buffers: Partial<Record<SfxName, AudioBuffer>> = {};
  private loadStarted = false;
  private lastPlay: Partial<Record<SfxName, number>> = {};

  constructor() {
    if (typeof window !== 'undefined') {
      try { this.muted = localStorage.getItem(MUTE_KEY) === 'true'; } catch { /* sem storage */ }
    }
  }

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Ctor) this.ctx = new Ctor();
    }
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private loadAll() {
    if (this.loadStarted || !this.ctx) return;
    this.loadStarted = true;
    (Object.keys(SFX_FILES) as SfxName[]).forEach(async (name) => {
      try {
        const res = await fetch(SFX_FILES[name]);
        const arr = await res.arrayBuffer();
        this.buffers[name] = await this.ctx!.decodeAudioData(arr);
      } catch { /* som só não toca */ }
    });
  }

  // No gesto do usuário (clique de iniciar): cria o contexto e decodifica ANTES do jogo.
  warmUp() { this.initCtx(); this.loadAll(); }

  // rate: playbackRate (1 = normal); volume 0..1; minGapMs: evita metralhar o mesmo som no mesmo frame
  play(name: SfxName, volume = 1, rate = 1, minGapMs = 0) {
    if (this.muted || !this.ctx) return;
    const buf = this.buffers[name];
    if (!buf) return;
    if (minGapMs > 0) {
      const now = this.ctx.currentTime * 1000;
      const last = this.lastPlay[name] ?? -1e9;
      if (now - last < minGapMs) return;
      this.lastPlay[name] = now;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    try { localStorage.setItem(MUTE_KEY, String(this.muted)); } catch { /* sem storage */ }
    return this.muted;
  }

  isMuted() { return this.muted; }
}

export const sound = new SoundManager();
