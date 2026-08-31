@AGENTS.md

# Flappy Bird Ultra — regras do projeto

- Stack: Next.js 16 + React 19 + TypeScript + Canvas 2D + Tailwind v4. Deploy MANUAL (`npx vercel --prod`); `git push` sozinho não deploya. Sempre `gh release` após push.
- Nunca imprimir valores de `.env` / `.env.local` no chat. Nunca citar o fornecedor do banco no código, docs ou UI (env: `DB_URL`, `DB_AUTH_TOKEN`, `SCORE_SECRET`).
- `src/game/sim.ts` é DETERMINÍSTICO: só inteiros (ponto fixo `SCALE`), sem `Date.now`/`Math.random`/trigonometria. Qualquer mudança de balanceamento exige bump de `SIM_VERSION` e `npm test` verde.
- Ranking: o servidor RE-SIMULA o replay (`src/game/replay.ts`) e grava o score que ele próprio computou. Token HMAC de uso único traz a semente assinada. Nunca confiar em número vindo do cliente.
- Juice fica em `src/game/render.ts` (pode ser não-determinístico). Nada de `fillText`/`shadowBlur` no loop; sprites e glifos são cacheados; partículas em buffer tipado.
- Controles: voar = clique/W/↑/toque à esquerda; atirar = ESPAÇO/botão direito/toque à direita. ESPAÇO NÃO voa.
- Sons: WAV locais em `public/sounds/`, gerados por `npm run sounds` (não editar os .wav à mão).
- Testes: `npm test` (determinismo + replay). Typecheck: `npm run typecheck`.
