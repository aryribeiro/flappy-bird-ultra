'use client';

import React from 'react';
import type { LeaderboardEntry } from '../lib/db';

interface Props { entries: LeaderboardEntry[]; online: boolean; highlightScore?: number; }

export default function Leaderboard({ entries, online, highlightScore }: Props) {
  let highlighted = false;
  return (
    <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl overflow-hidden text-xs font-mono">
      <div className="grid grid-cols-12 gap-2 px-3 py-2 uppercase text-zinc-500 border-b border-zinc-800 text-[10px] tracking-widest">
        <div className="col-span-2 text-center">#</div>
        <div className="col-span-5">piloto</div>
        <div className="col-span-2 text-right">canos</div>
        <div className="col-span-3 text-right">pontos</div>
      </div>
      {!online ? (
        <div className="p-4 text-center text-zinc-500">Ranking indisponível no momento.</div>
      ) : entries.length === 0 ? (
        <div className="p-4 text-center text-zinc-500">Ninguém no Top 10 ainda. Seja o primeiro! 🐤</div>
      ) : (
        entries.slice(0, 10).map((e, i) => {
          const rank = i + 1;
          const isMe = highlightScore !== undefined && !highlighted && e.score === highlightScore;
          if (isMe) highlighted = true;
          const tone = rank === 1 ? 'text-amber-300' : rank === 2 ? 'text-slate-200' : rank === 3 ? 'text-orange-300' : 'text-zinc-300';
          return (
            <div key={e.id ?? i} className={`grid grid-cols-12 gap-2 px-3 py-1.5 items-center border-b border-zinc-800/50 ${tone} ${isMe ? 'bg-cyan-950/60' : ''}`}>
              <div className="col-span-2 text-center font-black">{rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}º`}</div>
              <div className="col-span-5 flex items-center gap-2 truncate"><span className="text-base leading-none">{e.emoji}</span><span className="truncate font-semibold">{e.name}</span></div>
              <div className="col-span-2 text-right text-zinc-500">{e.pipes}</div>
              <div className="col-span-3 text-right font-black text-cyan-300 tabular-nums">{e.score.toLocaleString('pt-BR')}</div>
            </div>
          );
        })
      )}
    </div>
  );
}
