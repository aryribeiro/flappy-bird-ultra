import { createHash, createHmac, randomInt, randomUUID, timingSafeEqual } from 'crypto';

// Segredo de assinatura (server-only; nunca chega ao client).
const secret =
  process.env.SCORE_SECRET ||
  createHash('sha256').update('fbu-hmac-v1:' + (process.env.DB_AUTH_TOKEN || 'dev-secret')).digest('hex');

const TOKEN_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const TOKEN_CLOCK_SKEW_MS = 2 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(sid: string, ts: number, seed: number): string {
  return createHmac('sha256', secret).update(`${sid}.${ts}.${seed}`).digest('hex');
}

// Token opaco emitido no início da partida: sid.timestamp.seed.assinatura
// A SEMENTE vem do servidor e está assinada: o cliente não escolhe a partida que joga.
export function issueGameToken(): { token: string; seed: number } {
  const sid = randomUUID();
  const ts = Date.now();
  const seed = randomInt(0, 0x100000000);
  return { token: `${sid}.${ts}.${seed}.${sign(sid, ts, seed)}`, seed };
}

export interface GameTokenInfo { sid: string; startedAt: number; seed: number; }

export function verifyGameToken(token: string): GameTokenInfo | null {
  if (typeof token !== 'string' || token.length > 200) return null;
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const [sid, tsRaw, seedRaw, sig] = parts;
  if (!UUID_RE.test(sid)) return null;
  const ts = Number(tsRaw);
  const seed = Number(seedRaw);
  if (!Number.isInteger(ts) || ts <= 0) return null;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) return null;

  const expected = sign(sid, ts, seed);
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  const age = Date.now() - ts;
  if (age < -TOKEN_CLOCK_SKEW_MS || age > TOKEN_MAX_AGE_MS) return null;
  return { sid, startedAt: ts, seed };
}

// Hash de IP com o segredo (pseudonimizado — o IP bruto nunca é persistido)
export function hashIp(ip: string): string {
  return createHash('sha256').update(`${secret}|ip|${ip}`).digest('hex').slice(0, 32);
}
