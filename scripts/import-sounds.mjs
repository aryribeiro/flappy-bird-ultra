// Importa os SFX do jogo a partir de pacotes PÚBLICOS (CC0) e os deixa LOCAIS em public/sounds/.
// Fontes:
//   - Kenney.nl (Kenney Vleugels) — Sci-Fi Sounds, Interface Sounds, Digital Audio, Impact Sounds — CC0 1.0
//   - "The Essential Retro Video Game Sound Effects Collection [512 sounds]" — Juhani Junkala (OpenGameArt) — CC0 1.0
// Requer ffmpeg/ffprobe no PATH. Uso: node scripts/import-sounds.mjs [dirCache]
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'sounds');
const CACHE = process.argv[2] ? resolve(process.argv[2]) : join(tmpdir(), 'fbu-sfx');
mkdirSync(OUT, { recursive: true });
mkdirSync(CACHE, { recursive: true });

const PACKS = {
  scifi: { url: 'https://kenney.nl/media/pages/assets/sci-fi-sounds/6b296f9ecf-1677589334/kenney_sci-fi-sounds.zip', zip: 'kenney_sci-fi-sounds.zip' },
  iface: { url: 'https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip', zip: 'kenney_interface-sounds.zip' },
  digital: { url: 'https://kenney.nl/media/pages/assets/digital-audio/216eac4753-1677590265/kenney_digital-audio.zip', zip: 'kenney_digital-audio.zip' },
  impact: { url: 'https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip', zip: 'kenney_impact-sounds.zip' },
  retro: {
    url: 'https://opengameart.org/sites/default/files/The%20Essential%20Retro%20Video%20Game%20Sound%20Effects%20Collection%20%5B512%20sounds%5D.zip',
    zip: 'The_Essential_Retro_Video_Game_Sound_Effects_Collection_512_sounds.zip',
  },
};

// nome no jogo -> [pacote, nome do arquivo dentro do pacote, duração máx (s)]
const MAP = {
  flap: ['retro', 'sfx_movement_jump1.wav', 0.2],
  shoot: ['retro', 'sfx_wpn_laser2.wav', 0.2],
  laser: ['scifi', 'laserLarge_000.ogg', 0.7],
  hit: ['retro', 'sfx_damage_hit5.wav', 0.2],
  kill: ['scifi', 'explosionCrunch_000.ogg', 0.8],
  coin: ['retro', 'sfx_coin_single3.wav', 0.3],
  buy: ['digital', 'powerUp5.ogg', 0.6],
  deny: ['retro', 'sfx_sounds_error3.wav', 0.3],
  die: ['scifi', 'lowFrequency_explosion_000.ogg', 1.2],
  pipe: ['iface', 'select_001.ogg', 0.1],
  combo: ['digital', 'phaserUp1.ogg', 0.5],
  shield: ['impact', 'impactGlass_light_000.ogg', 0.3],
  break: ['impact', 'impactWood_heavy_000.ogg', 0.5],
};

async function download(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 1000) return;
  console.log('baixando', url);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function extract(zip, dir) {
  if (existsSync(dir) && readdirSync(dir).length > 0) return;
  mkdirSync(dir, { recursive: true });
  const r = process.platform === 'win32'
    ? spawnSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`], { stdio: 'inherit' })
    : spawnSync('unzip', ['-qo', zip, '-d', dir], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error(`falha ao extrair ${zip}`);
}

function findFile(dir, name) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { const f = findFile(p, name); if (f) return f; }
    else if (e.name === name) return p;
  }
  return null;
}

function peakDb(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
  const m = /max_volume:\s*(-?[\d.]+) dB/.exec(r.stderr);
  return m ? Number(m[1]) : 0;
}

async function main() {
  const dirs = {};
  for (const [key, p] of Object.entries(PACKS)) {
    const zip = join(CACHE, p.zip);
    await download(p.url, zip);
    dirs[key] = join(CACHE, p.zip.replace(/\.zip$/, ''));
    extract(zip, dirs[key]);
  }
  let total = 0;
  for (const [name, [pack, file, maxDur]] of Object.entries(MAP)) {
    const src = findFile(dirs[pack], file);
    if (!src) throw new Error(`não achei ${file} em ${pack}`);
    const gain = -1.0 - peakDb(src); // normaliza o pico para -1 dBFS
    const out = join(OUT, `${name}.wav`);
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', src, '-t', String(maxDur),
      '-af', `silenceremove=start_periods=1:start_threshold=-50dB,volume=${gain.toFixed(2)}dB,afade=t=out:st=${Math.max(0, maxDur - 0.04)}:d=0.04`,
      '-ac', '1', '-ar', '22050', '-sample_fmt', 's16', out,
    ]);
    const kb = statSync(out).size / 1024;
    total += kb;
    console.log(`${name}.wav`.padEnd(12), `${kb.toFixed(1)} KB`.padStart(9), ` <- ${pack}/${file}`);
  }
  console.log(`total ${total.toFixed(1)} KB em ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
