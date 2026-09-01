import { createClient } from '@libsql/client';
import { AVATAR_EMOJIS, LEGACY_EMOJIS } from './avatars';

export interface LeaderboardEntry {
  id?: number;
  name: string;
  emoji: string;
  score: number;
  pipes: number;
  kills: number;
  created_at?: string;
}

const url = process.env.DB_URL || '';
const authToken = process.env.DB_AUTH_TOKEN || '';

export const isDbConfigured = Boolean(url && authToken);
export const dbClient = isDbConfigured ? createClient({ url, authToken }) : null;

export const MAX_SCORE_LIMIT = 2_000_000;
export const NAME_MAX = 12;
export const DEFAULT_NAME = 'Piloto';
export const DEFAULT_EMOJI = '🐤';

let schemaReady: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!dbClient) return Promise.resolve();
  if (!schemaReady) {
    const client = dbClient;
    schemaReady = (async () => {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS leaderboard (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          emoji TEXT NOT NULL,
          score INTEGER NOT NULL CHECK (score >= 0 AND score <= ${MAX_SCORE_LIMIT}),
          pipes INTEGER NOT NULL DEFAULT 0,
          kills INTEGER NOT NULL DEFAULT 0,
          ticks INTEGER NOT NULL DEFAULT 0,
          sim_version TEXT NOT NULL DEFAULT '',
          seed INTEGER NOT NULL DEFAULT 0,
          replay TEXT NOT NULL DEFAULT '',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );`);
      await client.execute(`CREATE INDEX IF NOT EXISTS idx_leaderboard_score ON leaderboard (score DESC, id DESC);`);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS score_sessions (
          sid TEXT PRIMARY KEY,
          used_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );`);
      await client.execute(`
        CREATE TABLE IF NOT EXISTS submit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ip_hash TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );`);
      await client.execute(`CREATE INDEX IF NOT EXISTS idx_submit_log_ip ON submit_log (ip_hash, created_at);`);
    })().catch((err) => { schemaReady = null; throw err; });
  }
  return schemaReady;
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const msg = String((err as Error)?.message || err).toLowerCase();
      const transient = ['timeout', 'network', 'econn', 'fetch', 'stream', '503', '502'].some((k) => msg.includes(k));
      if (!transient || i === attempts - 1) throw err;
      await new Promise((r) => setTimeout(r, 120 * 2 ** i + Math.random() * 100));
    }
  }
  throw lastErr;
}

const VALID_EMOJIS = new Set([...AVATAR_EMOJIS.map((a) => a.emoji), ...LEGACY_EMOJIS]);

export function sanitizeName(name: unknown): string {
  if (typeof name !== 'string') return DEFAULT_NAME;
  const clean = name
    .replace(/<[^>]*>?/gm, '')
    .replace(/[^\p{L}\p{N} _.\-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX);
  return clean || DEFAULT_NAME;
}

export function sanitizeEmoji(emoji: unknown): string {
  return typeof emoji === 'string' && VALID_EMOJIS.has(emoji) ? emoji : DEFAULT_EMOJI;
}

export function validateScore(score: unknown): number | null {
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const n = Math.floor(score);
  return n < 0 || n > MAX_SCORE_LIMIT ? null : n;
}

const LEADERBOARD_TTL_MS = 5000;
let leaderboardCache: { data: LeaderboardEntry[]; at: number } | null = null;
export function invalidateLeaderboardCache() { leaderboardCache = null; }

export async function getTopLeaderboard(): Promise<LeaderboardEntry[]> {
  if (!dbClient) return [];
  const now = Date.now();
  if (leaderboardCache && now - leaderboardCache.at < LEADERBOARD_TTL_MS) return leaderboardCache.data;
  try {
    await ensureSchema();
    const result = await withRetry(() =>
      dbClient.execute({
        sql: `SELECT id, name, emoji, score, pipes, kills, created_at FROM leaderboard
              WHERE score >= 0 AND score <= ? ORDER BY score DESC, id DESC LIMIT 10;`,
        args: [MAX_SCORE_LIMIT],
      })
    );
    const data: LeaderboardEntry[] = result.rows.map((row) => ({
      id: Number(row.id),
      name: sanitizeName(String(row.name)),
      emoji: sanitizeEmoji(String(row.emoji)),
      score: validateScore(Number(row.score)) ?? 0,
      pipes: Number(row.pipes) || 0,
      kills: Number(row.kills) || 0,
      created_at: String(row.created_at || ''),
    }));
    leaderboardCache = { data, at: now };
    return data;
  } catch (err) {
    console.error('Erro ao buscar Top 10:', err);
    return leaderboardCache ? leaderboardCache.data : [];
  }
}

// Uso único da sessão (PK duplicada = replay do token)
export async function consumeGameSession(sid: string): Promise<boolean> {
  if (!dbClient) return true;
  try {
    await ensureSchema();
    await dbClient.execute({ sql: `DELETE FROM score_sessions WHERE used_at < datetime('now', '-1 day');`, args: [] });
    await dbClient.execute({ sql: `INSERT INTO score_sessions (sid) VALUES (?);`, args: [sid] });
    return true;
  } catch {
    return false;
  }
}

export async function countRecentSubmissions(ipHash: string): Promise<number> {
  if (!dbClient) return 0;
  try {
    await ensureSchema();
    const r = await dbClient.execute({
      sql: `SELECT COUNT(*) AS c FROM submit_log WHERE ip_hash = ? AND created_at >= datetime('now', '-1 hour');`,
      args: [ipHash],
    });
    return Number(r.rows[0]?.c ?? 0);
  } catch {
    return Number.MAX_SAFE_INTEGER; // fail-closed
  }
}

export async function logSubmission(ipHash: string): Promise<void> {
  if (!dbClient) return;
  try {
    await ensureSchema();
    await dbClient.execute({ sql: `DELETE FROM submit_log WHERE created_at < datetime('now', '-1 day');`, args: [] });
    await dbClient.execute({ sql: `INSERT INTO submit_log (ip_hash) VALUES (?);`, args: [ipHash] });
  } catch (err) {
    console.error('Erro ao registrar submissão:', err);
  }
}

export interface SaveScoreInput {
  name: string; emoji: string; score: number; pipes: number; kills: number; ticks: number;
  simVersion: string; seed: number; replay: string;
}

export async function saveScore(e: SaveScoreInput): Promise<LeaderboardEntry[]> {
  if (!dbClient) return [];
  try {
    await ensureSchema();
    const validScore = validateScore(e.score);
    if (validScore === null) return await getTopLeaderboard();
    await withRetry(() =>
      dbClient.execute({
        sql: `INSERT INTO leaderboard (name, emoji, score, pipes, kills, ticks, sim_version, seed, replay)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?);`,
        args: [sanitizeName(e.name), sanitizeEmoji(e.emoji), validScore, e.pipes, e.kills, e.ticks, e.simVersion, e.seed, e.replay],
      })
    );
    invalidateLeaderboardCache();
    return await getTopLeaderboard();
  } catch (err) {
    console.error('Erro ao salvar pontuação:', err);
    return [];
  }
}
