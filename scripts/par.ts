/// <reference types="node" />
// Level tuning tool. Finds the least ink that wins each level (for a normal, slightly shaky hand),
// suggests star thresholds and an ink budget, and stores that line as the level's hint.
//
//   npm run par -- src/levels/w1-meadow.json            report only
//   npm run par -- src/levels/w1-meadow.json m03 m04    only these levels
//   npm run par -- src/levels/w1-meadow.json --write    store ink, stars and hint in the JSON
//   options: --samples N (default 2500), --jobs N (parallel processes, default 4)
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import type { LevelDef, Pt, WorldDef } from '../src/levels/types';
import { evaluate, solve, tuneFromPar } from '../src/sim/solver';
import { formatWorld } from './format';

interface Result {
  id: string;
  ok: boolean;
  line: string;
  ink?: number;
  stars?: [number, number];
  hint?: Pt[];
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name: string, def: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const write = args.includes('--write');
const child = args.includes('--child');
const samples = opt('--samples', 2500);
const jobs = opt('--jobs', 4);
const positional = args.filter((a, i) => !a.startsWith('--') && !['--samples', '--jobs'].includes(args[i - 1]));
const file = positional[0];
const only = new Set(positional.slice(1));
if (!file) {
  console.error('usage: npm run par -- <world.json> [levelId...] [--write] [--samples N] [--jobs N]');
  process.exit(1);
}

function tune(level: LevelDef): Result {
  const t0 = Date.now();
  const res = solve(level, { samples });
  const ms = Date.now() - t0;
  if (!res.best || !res.robust) {
    const best = res.best ? res.best.ink.toFixed(2) : '-';
    return {
      id: level.id,
      ok: false,
      line: `${level.id}: NO ${res.best ? 'ROBUST ' : ''}SOLUTION (shortest ${best}, ${res.evals} evals, ${ms} ms)${res.noLineWins ? ' — WINS WITH NO LINE' : ''}`,
    };
  }
  const t = tuneFromPar(res.robust.ink);
  // Store the hint rounded, and make sure the rounded copy still wins.
  const hint = res.robust.line.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as Pt);
  const check = evaluate(level, hint);
  if (!check || check.ink > t.stars[0]) {
    return { id: level.id, ok: false, line: `${level.id}: hint fails after rounding (par ${res.robust.ink.toFixed(2)})` };
  }
  const report = {
    par: +res.robust.ink.toFixed(2),
    robust: +res.robustScore.toFixed(2),
    shortest: +res.best.ink.toFixed(2),
    wins: `${res.winners.length}/${res.evals}`,
    noLine: res.noLineWins ? 'WINS' : 'fails',
    ink: t.ink,
    stars: t.stars,
    ms,
  };
  return {
    id: level.id,
    ok: true,
    line: `${level.id}: ${JSON.stringify(report)}`,
    ink: t.ink,
    stars: t.stars,
    hint,
  };
}

function runChild(id: string): Promise<Result> {
  return new Promise((resolve, reject) => {
    const p = spawn('npx', ['vite-node', 'scripts/par.ts', '--', file, id, '--child', '--samples', String(samples)], {
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', () => {
      const m = out.split('\n').find((l) => l.startsWith('RESULT '));
      if (m) resolve(JSON.parse(m.slice(7)) as Result);
      else reject(new Error(`no result for ${id}: ${out}`));
    });
  });
}

async function main(): Promise<void> {
  const world = JSON.parse(readFileSync(file, 'utf8')) as WorldDef;
  const levels = world.levels.filter((l) => !only.size || only.has(l.id));
  if (child) {
    for (const l of levels) console.log(`RESULT ${JSON.stringify(tune(l))}`);
    return;
  }
  const results: Result[] = [];
  const queue = levels.slice();
  const workers = Array.from({ length: Math.max(1, Math.min(jobs, queue.length)) }, async () => {
    while (queue.length) {
      const l = queue.shift()!;
      const r = jobs > 1 ? await runChild(l.id) : tune(l);
      console.log(r.line);
      results.push(r);
    }
  });
  await Promise.all(workers);
  if (!write) return;
  const fresh = JSON.parse(readFileSync(file, 'utf8')) as WorldDef;
  for (const r of results) {
    const l = fresh.levels.find((x) => x.id === r.id);
    if (!l || !r.ok) continue;
    l.ink = r.ink!;
    l.stars = r.stars!;
    l.hint = r.hint!;
  }
  writeFileSync(file, formatWorld(fresh));
}

void main();
