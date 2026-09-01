<img width="1150" height="901" alt="print" src="https://github.com/user-attachments/assets/219ef2a5-3e2a-44de-a6cf-6ae61ee30ac0" />

# Flappy Bird Ultra

Flappy Bird com tiro: voe pelos canos, atire nos inimigos com **ESPAÇO**, compre armas no meio do voo (sem pausa) e entre no ranking **Top 10**.

## Controles

| Ação | PC | Celular |
|---|---|---|
| Voar | clique · **W** · **↑** | toque na metade **esquerda** |
| Atirar | **ESPAÇO** (segurar = automático) · botão direito | toque na metade **direita** (segurar) |
| Som | **M** | botão 🔊 |

## Como funciona

- **Canos são quase indestrutíveis** — a exceção: o **LASER** destrói o cano que atingir (+30 pts). O resto do tiro age numa segunda camada de ameaça: drones, vespas e tanques que entram pelas frestas e obrigam a escolher entre subir e atirar.
- **Economia sob pressão.** Moedas aparecem no voo; a cada 4 canos surge uma cápsula no centro do gap. Encostou com saldo, comprou — sem loja, sem pausa. Sem saldo, ela passa.
- **Progressão de arma:** PIPOCO → DUPLO ($6) → LEQUE ($14) → LASER ($24, atravessa 3 inimigos e **destrói canos**). Depois do LASER, as cápsulas trazem ESCUDO ($8, absorve 1 inimigo) e IMÃ ($6, atrai moedas por 10 s).
- **Pontuação:** cano = 10 · abate = 25/40/90 × combo (até x8; o combo cai após 3 s sem abater). Moedas não pontuam — são recurso.
- **3 vidas (❤️ x3 no topo).** Bater num cano, inimigo ou no chão gasta uma vida: o pássaro volta ao meio da tela piscando, invencível por 3 s, e **o tiro volta ao PIPOCO** — as moedas ficam, mas as armas precisam ser compradas de novo. A cada 5 minutos de partida aparece **um coração** que recupera uma vida (máx. 3). O **ESCUDO** absorve uma colisão — com inimigo *ou* com cano.

## Arquitetura (o que importa)

- `src/game/sim.ts` — simulação **determinística** em ponto fixo (só inteiros, PRNG semeado, sem tempo real, sem trigonometria). Mesma semente + mesmos inputs ⇒ mesmo resultado, no navegador e no servidor.
- `src/game/replay.ts` — replay = semente + mudanças de input por tick. O servidor **re-simula a partida** e grava o score que ele próprio calculou; o cliente nunca é fonte de verdade.
- `src/game/render.ts` — desenho e *juice* (partículas em buffer tipado, sprites/glifos cacheados, shake, hit-stop, flash). Nada disso toca a simulação.
- `src/app/actions.ts` — server actions: token HMAC de uso único com semente assinada, rate-limit por IP hasheado, re-simulação, rejeição fail-closed.

## Rodar

```bash
npm install
cp .env.example .env.local   # preencha DB_URL, DB_AUTH_TOKEN, SCORE_SECRET
npm run dev
```

Sem banco configurado o jogo roda em modo offline (sem ranking).

```bash
npm test          # determinismo + replay
npm run typecheck
npm run sounds    # reimporta os SFX (CC0) a partir das fontes públicas — requer ffmpeg
```

## Sons

Todos os efeitos são **CC0** (Kenney.nl e Juhani Junkala/OpenGameArt), convertidos e hospedados localmente em `public/sounds/`. Créditos em `public/sounds/CREDITS.txt`.

## Autor

Ary Ribeiro · [linkedin.com/in/aryribeiro](https://linkedin.com/in/aryribeiro)
