/// <reference types="node" />
// Difficulty curve tool. Measures how often a modelled beginner (one rough ramp towards the
// flag, see src/sim/beginner.ts) wins each level, and can reorder each world so it opens easy
// and never stacks two very hard levels together.
//
//   npm run difficulty                                 report every world
//   npm run difficulty -- src/levels/w2-springs.json   one world
//   npm run difficulty -- --reorder                    also print the smoothed order
//   npm run difficulty -- --reorder --write            write that order back into the world files
//   options: --tries N (default 500)
import { readFileSync, writeFileSync } from 'node:fs';
import type { WorldDef } from '../src/levels/types';
import { HARD_BELOW, beginnerWinRate, smoothOrder } from '../src/sim/beginner';
import { formatWorld } from './format';

const WORLD_FILES = ['src/levels/w1-meadow.json', 'src/levels/w2-springs.json', 'src/levels/w3-lagoon.json', 'src/levels/w4-workshop.json', 'src/levels/w5-gusts.json'];

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name: string, def: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const tries = opt('--tries', 500);
const reorder = args.includes('--reorder');
const write = args.includes('--write');
const files = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--tries');
const targets = files.length ? files : WORLD_FILES;

const pct = (r: number) => `${(r * 100).toFixed(1).padStart(5)}%`;

for (const file of targets) {
  const world = JSON.parse(readFileSync(file, 'utf8')) as WorldDef;
  const t0 = Date.now();
  const rates = new Map(world.levels.map((l) => [l.id, beginnerWinRate(l, tries).winRate]));
  console.log(`\n${world.name} (${file}, ${tries} tries per level, ${Date.now() - t0} ms)`);
  world.levels.forEach((l, i) => console.log(`  ${String(i + 1).padStart(2)}  ${l.id}  ${pct(rates.get(l.id)!)}${rates.get(l.id)! < HARD_BELOW ? '  hard' : ''}`));
  if (!reorder) continue;
  const ordered = smoothOrder(world.levels, (l) => rates.get(l.id)!, HARD_BELOW, file === WORLD_FILES[0] ? world.levels[0].id : undefined);
  console.log('  smoothed order:');
  ordered.forEach((l, i) => console.log(`  ${String(i + 1).padStart(2)}  ${l.id}  ${pct(rates.get(l.id)!)}`));
  if (write) {
    writeFileSync(file, formatWorld({ ...world, levels: ordered }));
    console.log(`  wrote ${file}`);
  }
}
