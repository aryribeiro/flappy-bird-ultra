'use server';

import { headers } from 'next/headers';
import {
  getTopLeaderboard, saveScore, isDbConfigured, LeaderboardEntry, validateScore,
  sanitizeName, sanitizeEmoji, consumeGameSession, countRecentSubmissions, logSubmission,
} from '../lib/db';
import { issueGameToken, verifyGameToken, hashIp } from '../lib/anticheat';
import { simulateReplay, MAX_REPLAY_ENTRIES } from '../game/replay';
import { SIM_VERSION, TICK_MS } from '../game/sim';

const SUBMITS_PER_HOUR_PER_IP = 10;
const REPLAY_TIME_SLACK_MS = 4000;

export interface LeaderboardResponse { online: boolean; data: LeaderboardEntry[]; }
export interface SubmitScoreResponse extends LeaderboardResponse { accepted: boolean; }

export interface SubmitScorePayload {
  name: string;
  emoji: string;
  token: string;
  score: number;
  inputs: number[];
}

export async function fetchLeaderboardAction(): Promise<LeaderboardResponse> {
  if (!isDbConfigured) return { online: false, data: [] };
  return { online: true, data: await getTopLeaderboard() };
}

// Emitido no início de cada partida: traz a SEMENTE assinada. Obrigatório para submeter.
export async function startGameSessionAction(): Promise<{ token: string | null; seed: number | null }> {
  if (!isDbConfigured) return { token: null, seed: null };
  const { token, seed } = issueGameToken();
  return { token, seed };
}

export async function submitScoreAction(payload: SubmitScorePayload): Promise<SubmitScoreResponse> {
  if (!isDbConfigured) return { online: false, accepted: false, data: [] };

  // Fail-closed sem oráculo: toda rejeição responde igual
  const reject = async (reason: string): Promise<SubmitScoreResponse> => {
    console.warn(`[anticheat] submissão rejeitada: ${reason}`);
    return { online: true, accepted: false, data: await getTopLeaderboard() };
  };

  if (!payload || typeof payload !== 'object') return reject('payload inválido');
  const { name, emoji, token, score, inputs } = payload;

  const claimed = validateScore(score);
  if (claimed === null) return reject('score fora dos limites');

  const session = typeof token === 'string' ? verifyGameToken(token) : null;
  if (!session) return reject('token ausente/inválido');

  if (!Array.isArray(inputs) || inputs.length > MAX_REPLAY_ENTRIES * 2) return reject('replay grande demais');

  // Re-simulação: o servidor recomputa o score a partir da semente assinada + inputs
  const sim = simulateReplay(session.seed, inputs);
  if (!sim.ok) return reject(`replay inválido: ${sim.reason}`);
  if (sim.score !== claimed) return reject(`score divergente (cliente ${claimed}, servidor ${sim.score})`);

  // A partida não pode ter durado mais ticks do que o tempo real desde a emissão do token
  const elapsedMs = Date.now() - session.startedAt;
  if (sim.ticks * TICK_MS > elapsedMs + REPLAY_TIME_SLACK_MS) return reject('replay mais longo que o tempo real');

  const h = await headers();
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
  const ipHash = hashIp(ip);
  if ((await countRecentSubmissions(ipHash)) >= SUBMITS_PER_HOUR_PER_IP) return reject('rate limit por IP');

  if (!(await consumeGameSession(session.sid))) return reject('sessão já utilizada');

  await logSubmission(ipHash);
  const data = await saveScore({
    name: sanitizeName(name),
    emoji: sanitizeEmoji(emoji),
    score: sim.score,
    pipes: sim.pipes,
    kills: sim.kills,
    ticks: sim.ticks,
    simVersion: SIM_VERSION,
    seed: session.seed,
    replay: JSON.stringify(inputs),
  });
  return { online: true, accepted: true, data };
}
