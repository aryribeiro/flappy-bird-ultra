'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createSim, step, SimState, TICK_MS, W, H, WEAPONS, IN_FLAP, IN_SHOOT, SimEvent } from '../game/sim';
import { InputRecorder } from '../game/replay';
import { Renderer, JuiceState } from '../game/render';
import { sound } from '../game/audio';
import { fetchLeaderboardAction, startGameSessionAction, submitScoreAction } from '../app/actions';
import type { LeaderboardEntry } from '../lib/db';
import { AVATAR_EMOJIS } from '../lib/avatars';
import { useLocalValue, lsGet, lsSet } from '../lib/useLocalValue';
import Leaderboard from './Leaderboard';

type Status = 'menu' | 'playing' | 'dead';

interface Session { token: string | null; seed: number; online: boolean; }
interface RunResult { score: number; pipes: number; kills: number; ticks: number; weapon: number; cause: string; inputs: number[]; session: Session; }

const MAX_FRAME_DELTA = 100;
const RESTART_GUARD_MS = 650;
const LS = { best: 'fbu_best', name: 'fbu_name', emoji: 'fbu_emoji', muted: 'fbu_muted' };

function vibrate(p: number | number[]) { try { navigator.vibrate?.(p); } catch { /* sem suporte */ } }

export default function FlappyGame() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const simRef = useRef<SimState>(createSim(1));
  const recRef = useRef<InputRecorder>(new InputRecorder());
  const juiceRef = useRef<JuiceState>({ hitStopMs: 0, timeScale: 1 });
  const inputRef = useRef({ flapPending: false, shootHeld: false, shootTouches: new Set<number>() });
  const statusRef = useRef<Status>('menu');
  const sessionRef = useRef<Session | null>(null); // sessão da partida em curso
  const nextSessionRef = useRef<Promise<Session> | null>(null); // pré-buscada
  const deathAtRef = useRef(0);
  const hudRef = useRef<{ score: HTMLElement | null; coins: HTMLElement | null; weapon: HTMLElement | null; combo: HTMLElement | null; fx: HTMLElement | null }>({ score: null, coins: null, weapon: null, combo: null, fx: null });
  const lastHudRef = useRef({ score: -1, coins: -1, weapon: -1, combo: -1, fx: '' });

  const [status, setStatus] = useState<Status>('menu');
  const [result, setResult] = useState<RunResult | null>(null);
  const [board, setBoard] = useState<{ online: boolean; data: LeaderboardEntry[] }>({ online: false, data: [] });
  const [bestStr, setBestStr] = useLocalValue(LS.best, '0');
  const best = Number(bestStr) || 0;
  const [name, setName] = useLocalValue(LS.name, '');
  const [emojiRaw, setEmoji] = useLocalValue(LS.emoji, AVATAR_EMOJIS[0].emoji);
  const emoji = AVATAR_EMOJIS.some((a) => a.emoji === emojiRaw) ? emojiRaw : AVATAR_EMOJIS[0].emoji;
  const [mutedStr] = useLocalValue(LS.muted, 'false');
  const muted = mutedStr === 'true';
  const [submitState, setSubmitState] = useState<'idle' | 'sending' | 'accepted' | 'rejected' | 'rate_limited'>('idle');
  const [showBoard, setShowBoard] = useState(false);

  // ---------------------------------------------------------------- sessão
  const prefetchSession = useCallback(() => {
    nextSessionRef.current = startGameSessionAction()
      .then((r) => (r.token && r.seed !== null ? { token: r.token, seed: r.seed, online: true } : { token: null, seed: (Math.random() * 0x100000000) >>> 0, online: false }))
      .catch(() => ({ token: null, seed: (Math.random() * 0x100000000) >>> 0, online: false }));
  }, []);

  const refreshBoard = useCallback(() => {
    fetchLeaderboardAction().then(setBoard).catch(() => { /* offline */ });
  }, []);

  useEffect(() => {
    prefetchSession();
    refreshBoard();
    // Gancho de depuração (somente leitura; o ranking é re-simulado no servidor): ?debug
    if (window.location.search.includes('debug')) {
      (window as unknown as { __sim?: () => SimState }).__sim = () => simRef.current;
    }
  }, [prefetchSession, refreshBoard]);

  // ---------------------------------------------------------------- partida
  const startRun = useCallback(async () => {
    if (statusRef.current === 'playing') return;
    sound.warmUp();
    const session = await (nextSessionRef.current ?? Promise.resolve<Session>({ token: null, seed: (Math.random() * 0x100000000) >>> 0, online: false }));
    prefetchSession();
    sessionRef.current = session;
    simRef.current = createSim(session.seed);
    recRef.current = new InputRecorder();
    juiceRef.current = { hitStopMs: 0, timeScale: 1 };
    inputRef.current.flapPending = true; // primeiro impulso junto do início
    inputRef.current.shootHeld = false;
    inputRef.current.shootTouches.clear();
    rendererRef.current?.reset();
    rendererRef.current?.telegraphFlap(performance.now());
    setSubmitState('idle');
    setResult(null);
    setShowBoard(false);
    statusRef.current = 'playing';
    setStatus('playing');
  }, [prefetchSession]);

  const finishRun = useCallback((s: SimState) => {
    const session = sessionRef.current!;
    const r: RunResult = {
      score: s.score, pipes: s.pipesPassed, kills: s.kills, ticks: s.tick, weapon: s.weapon, cause: s.deathCause,
      inputs: recRef.current.data, session,
    };
    setResult(r);
    if (s.score > (Number(lsGet(LS.best)) || 0)) setBestStr(String(s.score));
    statusRef.current = 'dead';
    setStatus('dead');
    refreshBoard();
  }, [refreshBoard, setBestStr]);

  const toggleMute = useCallback(() => {
    const m = sound.toggleMute();
    lsSet(LS.muted, String(m));
  }, []);

  // ---------------------------------------------------------------- input
  const doFlap = useCallback(() => {
    const st = statusRef.current;
    if (st === 'menu') { void startRun(); return; }
    if (st === 'dead') { if (performance.now() - deathAtRef.current > RESTART_GUARD_MS) void startRun(); return; }
    inputRef.current.flapPending = true;
    rendererRef.current?.telegraphFlap(performance.now()); // gira/agacha JÁ, antes do tick
    sound.play('flap', 0.7, 0.95 + Math.random() * 0.1);
    vibrate(8);
  }, [startRun]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        if (e.repeat) return;
        const st = statusRef.current;
        if (st === 'menu') { void startRun(); return; }
        if (st === 'dead') { if (performance.now() - deathAtRef.current > RESTART_GUARD_MS) void startRun(); return; }
        inputRef.current.shootHeld = true;
        return;
      }
      if (e.code === 'ArrowUp' || e.code === 'KeyW' || e.code === 'KeyX') {
        e.preventDefault();
        if (e.repeat) return;
        doFlap();
        return;
      }
      if (e.code === 'KeyM') toggleMute();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') inputRef.current.shootHeld = false;
    };
    const onBlur = () => { inputRef.current.shootHeld = false; inputRef.current.shootTouches.clear(); };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [doFlap, startRun, toggleMute]);

  // Toque: metade esquerda voa, metade direita atira (segurar = automático). Mouse: esquerdo voa, direito atira.
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    if (e.pointerType === 'touch' || e.pointerType === 'pen') {
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const left = e.clientX - rect.left < rect.width / 2;
      if (left || statusRef.current !== 'playing') doFlap();
      else { inputRef.current.shootTouches.add(e.pointerId); vibrate(5); }
      return;
    }
    if (e.button === 2) { if (statusRef.current === 'playing') inputRef.current.shootHeld = true; return; }
    doFlap();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    inputRef.current.shootTouches.delete(e.pointerId);
    if (e.pointerType === 'mouse' && e.button === 2) inputRef.current.shootHeld = false;
  };

  // ---------------------------------------------------------------- loop
  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new Renderer(canvas);
    rendererRef.current = renderer;

    const fit = () => {
      const wrap = wrapRef.current; if (!wrap) return;
      const maxW = wrap.clientWidth;
      const maxH = Math.max(240, window.innerHeight - 150);
      const scale = Math.min(maxW / W, maxH / H);
      renderer.resize(Math.floor(W * scale), Math.floor(H * scale));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (wrapRef.current) ro.observe(wrapRef.current);
    window.addEventListener('resize', fit);

    let raf = 0;
    let last = performance.now();
    let acc = 0;
    let hudAcc = 0;

    const playSfx = (events: SimEvent[], s: SimState) => {
      for (const ev of events) {
        switch (ev.type) {
          case 'shoot': sound.play(ev.v === 4 ? 'laser' : 'shoot', ev.v === 4 ? 0.55 : 0.4, 0.92 + Math.random() * 0.16, 25); break;
          case 'hit': sound.play('hit', 0.5, 0.9 + Math.random() * 0.2, 30); break;
          case 'kill': sound.play('kill', ev.v >= 300 ? 0.9 : 0.6, ev.v >= 300 ? 0.8 : 1 + Math.random() * 0.15, 20); vibrate(ev.v >= 300 ? 30 : 15); break;
          case 'pipe': sound.play('pipe', 0.45, 1 + Math.min(0.6, s.pipesPassed * 0.01)); break;
          case 'coin': sound.play('coin', 0.5, 1 + Math.min(0.5, s.combo * 0.04), 35); break;
          case 'buy': sound.play('buy', 0.8); vibrate([20, 30, 40]); break;
          case 'deny': sound.play('deny', 0.6); vibrate(40); break;
          case 'shield_pop': sound.play('shield', 0.8); vibrate(60); break;
          case 'pipe_break': sound.play('break', 0.85, 0.92 + Math.random() * 0.16, 40); vibrate(25); break;
          case 'combo_up': if (ev.v >= 3) sound.play('combo', 0.5, 1 + (ev.v - 3) * 0.12); break;
          case 'die': sound.play('die', 0.9); vibrate([60, 40, 120]); break;
        }
      }
    };

    const updateHud = (s: SimState) => {
      const h = hudRef.current, l = lastHudRef.current;
      if (h.score && l.score !== s.score) { h.score.textContent = s.score.toLocaleString('pt-BR'); l.score = s.score; }
      if (h.coins && l.coins !== s.coins$) { h.coins.textContent = String(s.coins$); l.coins = s.coins$; h.coins.classList.remove('hud-pop'); void h.coins.offsetWidth; h.coins.classList.add('hud-pop'); }
      if (h.weapon && l.weapon !== s.weapon) { h.weapon.textContent = `${WEAPONS[s.weapon].name} ${'▮'.repeat(s.weapon)}${'▯'.repeat(4 - s.weapon)}`; l.weapon = s.weapon; }
      if (h.combo && l.combo !== s.combo) { h.combo.textContent = s.combo > 1 ? `COMBO x${s.combo}` : ''; h.combo.dataset.hot = s.combo >= 5 ? '1' : '0'; l.combo = s.combo; }
      const fx = `${s.shield ? '🛡️ ' : ''}${s.magnet > 0 ? '🧲 ' : ''}`;
      if (h.fx && l.fx !== fx) { h.fx.textContent = fx; l.fx = fx; }
    };

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      let dt = Math.min(now - last, MAX_FRAME_DELTA);
      last = now;
      const s = simRef.current;
      const juice = juiceRef.current;
      const st = statusRef.current;

      if (st === 'playing') {
        // hit-stop: congela a SIMULAÇÃO (acumulador), não o desenho
        if (juice.hitStopMs > 0) { juice.hitStopMs -= dt; dt = 0; }
        acc += dt;
        const inp = inputRef.current;
        while (acc >= TICK_MS && s.status === 'playing') {
          const mask = (inp.flapPending ? IN_FLAP : 0) | (inp.shootHeld || inp.shootTouches.size > 0 ? IN_SHOOT : 0);
          inp.flapPending = false;
          recRef.current.record(s.tick + 1, mask);
          step(s, mask);
          renderer.consume(s.events, s, juice);
          playSfx(s.events, s);
          acc -= TICK_MS;
        }
        if (s.status === 'dead' && deathAtRef.current === 0) {
          deathAtRef.current = now;
          acc = 0;
          window.setTimeout(() => finishRun(s), 900);
        }
        hudAcc += dt;
        if (hudAcc > 80) { hudAcc = 0; updateHud(s); }
      } else if (st === 'menu') {
        acc = 0;
        deathAtRef.current = 0;
      }
      if (st === 'playing' && s.status === 'playing') deathAtRef.current = 0;

      const alpha = s.status === 'playing' ? Math.min(1, acc / TICK_MS) : 0;
      renderer.frame(s, alpha, Math.min(now - (last - dt), MAX_FRAME_DELTA) || 16, now);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [finishRun]);

  // Menu: garante HUD zerado
  useEffect(() => {
    if (status === 'menu' || status === 'playing') {
      lastHudRef.current = { score: -1, coins: -1, weapon: -1, combo: -1, fx: '' };
    }
  }, [status]);

  // ---------------------------------------------------------------- ranking
  const rankIfSubmitted = (score: number) => {
    const above = board.data.filter((e) => e.score >= score).length;
    return above + 1;
  };
  const qualifies = (score: number) => score > 0 && (board.data.length < 10 || rankIfSubmitted(score) <= 10);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!result || !result.session.token || submitState === 'sending') return;
    setSubmitState('sending');
    try {
      const res = await submitScoreAction({ name, emoji, token: result.session.token, score: result.score, inputs: result.inputs });
      setBoard({ online: res.online, data: res.data });
      setSubmitState(res.accepted ? 'accepted' : res.reason === 'rate_limit' ? 'rate_limited' : 'rejected');
      if (res.accepted) setShowBoard(true);
    } catch {
      setSubmitState('rejected');
    }
  };

  return (
    <div className="w-full min-h-screen flex flex-col items-center px-2 pt-2 pb-3 select-none text-white">
      {/* HUD */}
      <div className="w-full max-w-[720px] flex items-center justify-between gap-2 mb-2 px-1 font-mono text-sm">
        <div className="flex items-baseline gap-3">
          <span ref={(el) => { hudRef.current.score = el; }} className="text-3xl font-black tabular-nums tracking-tight drop-shadow-[0_2px_0_#000]">0</span>
          <span ref={(el) => { hudRef.current.combo = el; }} className="hud-combo text-amber-300 font-black text-base" data-hot="0"></span>
        </div>
        <div className="flex items-center gap-3">
          <span ref={(el) => { hudRef.current.fx = el; }} className="text-base"></span>
          <span className="text-cyan-300 font-bold text-xs tracking-widest" ref={(el) => { hudRef.current.weapon = el; }}>PIPOCO ▮▯▯▯</span>
          <span className="inline-flex items-center gap-1 bg-amber-400 text-black font-black rounded-full px-2.5 py-0.5">
            <span>$</span><span ref={(el) => { hudRef.current.coins = el; }} className="tabular-nums">0</span>
          </span>
          <button onClick={toggleMute} className="text-lg opacity-80 hover:opacity-100" title="Som (M)">{muted ? '🔇' : '🔊'}</button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={wrapRef} className="w-full max-w-[720px] relative">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onContextMenu={(e) => e.preventDefault()}
          className="block mx-auto rounded-xl shadow-[0_10px_40px_rgba(0,0,0,0.6)] touch-none cursor-pointer"
          style={{ imageRendering: 'auto' }}
        />

        {status === 'menu' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/35 rounded-xl pointer-events-none">
            <h1 className="text-4xl sm:text-6xl font-black tracking-tight text-center leading-none drop-shadow-[0_4px_0_#000]">
              <span className="text-amber-300">FLAPPY BIRD</span>
              <span className="block text-cyan-300 text-2xl sm:text-4xl mt-1">ULTRA</span>
            </h1>
            <p className="mt-3 text-sm sm:text-base font-semibold text-center max-w-[420px] drop-shadow-[0_2px_0_#000] px-4">
              Voe pelos canos, atire nos inimigos e compre armas no meio do voo — sem pausa.
            </p>
            <div className="mt-5 px-6 py-3 rounded-full bg-amber-400 text-black font-black text-lg shadow-lg animate-pulse">
              ESPAÇO / TOQUE PARA JOGAR
            </div>
            <div className="mt-4 flex gap-4 text-xs sm:text-sm font-black drop-shadow-[0_2px_0_#000]">
              <span className="bg-black/50 rounded-lg px-3 py-1.5"><span className="text-cyan-300">VOAR</span> clique · W · ↑</span>
              <span className="bg-black/50 rounded-lg px-3 py-1.5"><span className="text-amber-300">ATIRAR</span> ESPAÇO</span>
            </div>
            {best > 0 && <p className="mt-3 text-xs font-mono opacity-90">seu recorde: {best.toLocaleString('pt-BR')}</p>}
          </div>
        )}

        {status === 'dead' && result && (
          <div className="absolute inset-0 flex items-center justify-center rounded-xl overflow-y-auto">
            <div className="w-[94%] max-w-[560px] bg-zinc-950/92 border border-zinc-800 rounded-2xl p-4 sm:p-5 shadow-2xl backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-mono uppercase tracking-widest text-zinc-400">
                    {result.cause === 'pipe' ? 'bateu no cano' : result.cause === 'ground' ? 'caiu no chão' : 'atingido por inimigo'}
                  </div>
                  <div className="text-4xl sm:text-5xl font-black tabular-nums text-amber-300 leading-none mt-1">
                    {result.score.toLocaleString('pt-BR')}
                  </div>
                  <div className="text-[11px] font-mono text-zinc-400 mt-1">
                    {result.pipes} canos · {result.kills} abates · {WEAPONS[result.weapon as 1 | 2 | 3 | 4].name} · {Math.round(result.ticks / 60)}s
                    {result.score >= best && result.score > 0 && <span className="text-cyan-300 font-bold"> · NOVO RECORDE</span>}
                  </div>
                </div>
                <button
                  onClick={() => void startRun()}
                  className="shrink-0 px-4 py-3 rounded-xl bg-amber-400 hover:bg-amber-300 text-black font-black text-sm sm:text-base shadow-lg"
                >
                  DE NOVO<span className="hidden sm:inline"> (ESPAÇO)</span>
                </button>
              </div>

              {/* Ranking */}
              <div className="mt-4">
                {!result.session.online ? (
                  <p className="text-xs font-mono text-zinc-500">Ranking indisponível nesta partida (modo offline).</p>
                ) : submitState === 'accepted' ? (
                  <p className="text-sm font-bold text-emerald-300">Salvo no Top 10! 🏆</p>
                ) : submitState === 'rate_limited' ? (
                  <p className="text-xs font-mono text-amber-300">Muitas partidas salvas em pouco tempo — jogue mais uma e tente salvar de novo em alguns minutos.</p>
                ) : submitState === 'rejected' ? (
                  <p className="text-xs font-mono text-red-400">Não foi possível salvar esta partida.</p>
                ) : qualifies(result.score) ? (
                  <form onSubmit={submit} className="space-y-2">
                    <p className="text-sm font-bold text-cyan-300">Você entra no Top 10 em #{rankIfSubmitted(result.score)}!</p>
                    <div className="flex gap-2">
                      <input
                        type="text" maxLength={12} value={name} onChange={(e) => setName(e.target.value)}
                        placeholder="Seu nome (máx. 12)"
                        className="flex-1 bg-zinc-900 border border-zinc-700 focus:border-cyan-400 rounded-lg px-3 py-2 text-sm font-mono outline-none"
                        onKeyDown={(e) => e.stopPropagation()}
                      />
                      <button type="submit" disabled={submitState === 'sending'} className="px-4 py-2 rounded-lg bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 text-black font-black text-sm">
                        {submitState === 'sending' ? '...' : 'SALVAR'}
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {AVATAR_EMOJIS.map((a) => (
                        <button type="button" key={a.emoji} onClick={() => setEmoji(a.emoji)} title={a.name}
                          className={`w-8 h-8 rounded-md text-lg leading-none ${emoji === a.emoji ? 'bg-cyan-900 ring-2 ring-cyan-400' : 'bg-zinc-900 hover:bg-zinc-800'}`}>
                          {a.emoji}
                        </button>
                      ))}
                    </div>
                  </form>
                ) : result.score === 0 ? (
                  <p className="text-xs font-mono text-zinc-400">Passe um cano ou abata um inimigo para pontuar.</p>
                ) : (
                  <p className="text-xs font-mono text-zinc-400">
                    Fora do Top 10 — faltam {((board.data[9]?.score ?? 0) - result.score + 1).toLocaleString('pt-BR')} pts.
                  </p>
                )}
              </div>

              <button onClick={() => setShowBoard((v) => !v)} className="mt-3 text-xs font-mono text-zinc-400 hover:text-white underline underline-offset-4">
                {showBoard ? 'esconder ranking' : 'ver ranking Top 10'}
              </button>
              {showBoard && <div className="mt-2"><Leaderboard entries={board.data} online={board.online} highlightScore={submitState === 'accepted' ? result.score : undefined} /></div>}
            </div>
          </div>
        )}
      </div>

      {/* Rodapé */}
      <div className="w-full max-w-[720px] mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] font-mono text-zinc-400 px-1">
        <div className="flex items-center gap-3">
          <span><b className="text-zinc-200">Voar:</b> clique · W · ↑ · toque à esquerda</span>
          <span><b className="text-zinc-200">Atirar:</b> ESPAÇO · botão direito · toque à direita</span>
        </div>
        {status === 'menu' && (
          <button onClick={() => setShowBoard((v) => !v)} className="underline underline-offset-4 hover:text-white">Top 10</button>
        )}
      </div>
      {status === 'menu' && showBoard && (
        <div className="w-full max-w-[720px] mt-2"><Leaderboard entries={board.data} online={board.online} /></div>
      )}
      <footer className="mt-4 text-[11px] text-zinc-500 font-mono">
        Ary Ribeiro · <a className="underline hover:text-zinc-300" href="https://linkedin.com/in/aryribeiro" target="_blank" rel="noopener noreferrer">linkedin.com/in/aryribeiro</a>
      </footer>
    </div>
  );
}
