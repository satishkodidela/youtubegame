/// <reference types="node" />
// Daily Hole generator. Builds levels from a few templates with a seeded random generator, then
// keeps only the ones that pass the same checks as hand-made levels: not won without a line, a
// robust solution found by the par solver (which also sets ink, stars and the hint), and a
// beginner win rate that is neither a wall nor a giveaway. The result is src/levels/daily.json,
// which the game serves one level per calendar day (see src/game/daily.ts).
//
//   npm run daily-gen                       120 levels from seeds 0..599, 4 parallel processes
//   npm run daily-gen -- --count 60 --seeds 300 --jobs 2
//
// Seeds are processed in order and the first `count` accepted levels are kept, so the output is
// the same however many processes run. Each week (7 days) is sorted easy to hard.
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { BALL_R, BOUNCER_H, GREEN_H, WORLD_H, WORLD_W, type Item, type LevelDef, type Pt } from '../src/levels/types';
import { beginnerWinRate } from '../src/sim/beginner';
import { distPointSeg, pointInPoly, rectPoly } from '../src/sim/geometry';
import { staticSolids } from '../src/sim/shapes';
import { simulate } from '../src/sim/sim';
import { evaluate, rng, solve, tuneFromPar } from '../src/sim/solver';
import { formatWorld } from './format';

const OUT = 'src/levels/daily.json';
const SAMPLES = 1500;
const RATE_TRIES = 300;
/** Accepted beginner win rate: harder than a giveaway, easier than a wall. */
const RATE_MIN = 0.02;
const RATE_MAX = 0.75;
const GREEN_W = 2.6;
/** Rounding slack for the bounds check: sizes are stored to 0.01. */
const EPS = 0.02;

interface Accepted {
  seed: number;
  rate: number;
  level: LevelDef;
}

const args = process.argv.slice(2).filter((a) => a !== '--');
const opt = (name: string, def: number) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const count = opt('--count', 120);
const seeds = opt('--seeds', 600);
const jobs = opt('--jobs', 4);
const child = args.includes('--child');

// ------------------------------------------------------------------ templates

type Template = 'ledge' | 'spring' | 'pond' | 'lift' | 'gust' | 'spinner';
const TEMPLATES: Template[] = ['ledge', 'ledge', 'spring', 'pond', 'lift', 'gust', 'spinner'];
const THEME: Record<Template, number> = { ledge: 0, spring: 1, pond: 2, lift: 3, gust: 4, spinner: 3 };

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Builds one candidate level for a seed, or null when its geometry is invalid. */
export function candidate(seed: number): LevelDef | null {
  const rand = rng(seed * 7919 + 17);
  const u = (a: number, b: number) => r2(a + (b - a) * rand());
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const chance = (p: number) => rand() < p;
  const template = TEMPLATES[seed % TEMPLATES.length];
  const items: Item[] = [];
  const ball = { x: u(1.0, 3.1), y: u(1.6, 4.4) };
  let hole = { x: 8, y: 9, w: GREEN_W };

  const pillar = (hx: number, hy: number) => {
    const top = hy + GREEN_H;
    if (WORLD_H - top > 0.05) items.push({ t: 'box', x: hx, y: r2((top + WORLD_H) / 2), w: GREEN_W, h: r2(WORLD_H - top) });
  };
  const wall = (hx: number, hy: number) => {
    const x = hx + GREEN_W / 2 + 0.25;
    if (x + 0.25 <= WORLD_W) items.push({ t: 'box', x: r2(x), y: r2(hy - 1.0), w: 0.5, h: 2.2 });
  };
  const ground = (x0: number, x1: number) => {
    if (x1 - x0 >= 1.2) items.push({ t: 'box', x: r2((x0 + x1) / 2), y: 13.4, w: r2(x1 - x0), h: 1.2 });
  };
  const floaters = (n: number, yMin: number, yMax: number, hx: number, hy: number) => {
    for (let k = 0; k < n; k++) {
      const w = u(0.8, 2.6);
      const h = u(0.3, 0.7);
      const x = u(0.8, WORLD_W - 0.8);
      const y = u(yMin, yMax);
      if (Math.hypot(x - ball.x, y - ball.y) < 1.6) continue; // leave room under the ball
      if (Math.abs(x - hx) < GREEN_W / 2 + w / 2 + 0.3 && y > hy - 2.6) continue; // keep the green approach open
      items.push({ t: 'box', x, y, w, h, a: pick([0, 0, 0, 12, -12, 25, -25]) });
    }
  };

  switch (template) {
    case 'ledge': {
      hole = { x: u(5.8, 8.6), y: u(6.5, 11.6), w: GREEN_W };
      pillar(hole.x, hole.y);
      wall(hole.x, hole.y);
      if (chance(0.6)) ground(0, Math.min(5.2, hole.x - GREEN_W / 2 - 0.3));
      floaters(Math.floor(u(0, 3.99)), ball.y + 1.5, 12.4, hole.x, hole.y);
      break;
    }
    case 'spring': {
      hole = { x: u(7.0, 8.6), y: u(6.0, 9.6), w: GREEN_W };
      items.push({ t: 'box', x: 5, y: 13.5, w: 10, h: 1 });
      items.push({ t: 'bouncer', x: u(2.8, 6.0), y: r2(13 - BOUNCER_H / 2), w: u(1.6, 2.4), a: pick([0, 0, 8, 15]), power: u(12, 15) });
      pillar(hole.x, hole.y);
      wall(hole.x, hole.y);
      if (chance(0.5)) floaters(1, 6, 10.5, hole.x, hole.y);
      break;
    }
    case 'pond': {
      const xw0 = u(2.2, 3.5);
      const xw1 = u(6.2, 7.3);
      hole = { x: u(xw1 + GREEN_W / 2 + 0.1, 8.7), y: u(8.5, 12.4), w: GREEN_W };
      items.push({ t: 'water', x: r2((xw0 + xw1) / 2), y: 13.2, w: r2(xw1 - xw0), h: 1.6 });
      ground(0, xw0);
      ground(xw1, WORLD_W);
      pillar(hole.x, hole.y);
      wall(hole.x, hole.y);
      floaters(Math.floor(u(0, 2.99)), 7.5, 11.6, hole.x, hole.y);
      break;
    }
    case 'lift': {
      hole = { x: u(7.2, 8.6), y: u(5.5, 9.5), w: GREEN_W };
      const horizontal = chance(0.5);
      items.push({
        t: 'mover',
        x: u(3.4, 5.4),
        y: u(6.5, 9.5),
        w: u(1.6, 2.2),
        h: 0.4,
        dx: horizontal ? u(1.5, 2.8) : 0,
        dy: horizontal ? 0 : -u(1.5, 3),
        period: u(2.4, 4),
        phase: u(0, 1),
      });
      pillar(hole.x, hole.y);
      wall(hole.x, hole.y);
      if (chance(0.5)) ground(0, 3.2);
      break;
    }
    case 'gust': {
      hole = { x: u(7.2, 8.6), y: u(5.0, 10), w: GREEN_W };
      if (chance(0.5)) items.push({ t: 'wind', x: 5, y: u(6, 9), w: u(3, 4.5), h: u(4, 6), fx: u(7, 11), fy: 0 });
      else items.push({ t: 'wind', x: u(4, 6), y: u(7, 10), w: u(1.6, 2.4), h: u(5, 7), fx: 0, fy: -u(22, 28) });
      pillar(hole.x, hole.y);
      wall(hole.x, hole.y);
      if (chance(0.5)) floaters(1, 5, 11, hole.x, hole.y);
      break;
    }
    case 'spinner': {
      hole = { x: u(6.8, 8.6), y: u(9.0, 11.8), w: GREEN_W };
      items.push({ t: 'spinner', x: u(4, 6), y: u(6, 8.5), w: u(2, 2.8), h: 0.3, speed: pick([-3, -2.2, 2.2, 3]) });
      pillar(hole.x, hole.y);
      wall(hole.x, hole.y);
      ground(0, 3);
      break;
    }
  }

  const level: LevelDef = { id: `d${String(seed).padStart(3, '0')}`, balls: [ball], holes: [hole], ink: 10, stars: [3, 6], items, hint: [], theme: THEME[template] };
  const flipped = chance(0.5) ? mirror(level) : level;
  if (process.env.DAILY_DEBUG && !valid(flipped)) console.log(`geometry ${seed} ${template}: ${whyInvalid(flipped)}`);
  return valid(flipped) ? level : null;
}

function whyInvalid(level: LevelDef): string {
  const inside = (x: number, y: number) => x >= -EPS && x <= WORLD_W + EPS && y >= -EPS && y <= WORLD_H + EPS;
  for (const it of level.items) {
    if (it.t === 'poly') continue;
    const h = it.t === 'bouncer' ? BOUNCER_H : it.h;
    const a = 'a' in it ? (it.a ?? 0) : 0;
    if (!rectPoly(it.x, it.y, it.w, h, a).every(([x, y]) => inside(x, y))) return `item out of bounds ${JSON.stringify(it)}`;
  }
  for (const h of level.holes) if (h.x - GREEN_W / 2 < 0 || h.x + GREEN_W / 2 > WORLD_W || h.y < 2 || h.y + GREEN_H > WORLD_H) return `hole ${JSON.stringify(h)}`;
  const solids = staticSolids(level);
  for (const b of level.balls) for (const s of solids) {
    if (pointInPoly([b.x, b.y], s.poly)) return `ball inside ${s.kind} ${s.index}`;
    for (let i = 0; i < s.poly.length; i++) if (distPointSeg([b.x, b.y], s.poly[i], s.poly[(i + 1) % s.poly.length]) < BALL_R + 0.1) return `ball touches ${s.kind} ${s.index} ${JSON.stringify(level.items[s.index])}`;
  }
  return 'unknown';
}

/** Flips a level left to right so templates come in both directions. Returns the same object, changed. */
function mirror(level: LevelDef): LevelDef {
  const fx = (x: number) => r2(WORLD_W - x);
  for (const b of level.balls) {
    b.x = fx(b.x);
    if (b.vx) b.vx = -b.vx;
  }
  for (const h of level.holes) h.x = fx(h.x);
  level.items = level.items.map((it): Item => {
    switch (it.t) {
      case 'box':
        return { ...it, x: fx(it.x), a: it.a ? -it.a : undefined };
      case 'poly':
        return { ...it, pts: it.pts.map(([x, y]) => [fx(x), y] as Pt).reverse() };
      case 'bouncer':
        return { ...it, x: fx(it.x), a: it.a ? -it.a : undefined };
      case 'water':
        return { ...it, x: fx(it.x) };
      case 'mover':
        return { ...it, x: fx(it.x), dx: -it.dx, a: it.a ? -it.a : undefined };
      case 'spinner':
        return { ...it, x: fx(it.x), speed: -it.speed, a: it.a ? -it.a : undefined };
      case 'wind':
        return { ...it, x: fx(it.x), fx: -it.fx };
    }
  });
  for (const it of level.items) if ('a' in it && it.a === undefined) delete it.a;
  return level;
}

/** Same shape rules as tests/levels.test.ts, plus everything inside the playfield. */
function valid(level: LevelDef): boolean {
  const inside = (x: number, y: number) => x >= -EPS && x <= WORLD_W + EPS && y >= -EPS && y <= WORLD_H + EPS;
  for (const it of level.items) {
    if (it.t === 'poly') {
      if (!it.pts.every(([x, y]) => inside(x, y))) return false;
    } else {
      const h = it.t === 'bouncer' ? BOUNCER_H : it.h;
      const a = 'a' in it ? (it.a ?? 0) : 0;
      if (!rectPoly(it.x, it.y, it.w, h, a).every(([x, y]) => inside(x, y))) return false;
    }
  }
  for (const h of level.holes) {
    if (h.x - GREEN_W / 2 < 0 || h.x + GREEN_W / 2 > WORLD_W || h.y < 2 || h.y + GREEN_H > WORLD_H) return false;
  }
  const solids = staticSolids(level);
  for (const b of level.balls) {
    if (!inside(b.x, b.y)) return false;
    for (const s of solids) {
      if (pointInPoly([b.x, b.y], s.poly)) return false;
      for (let i = 0; i < s.poly.length; i++) {
        if (distPointSeg([b.x, b.y], s.poly[i], s.poly[(i + 1) % s.poly.length]) < BALL_R + 0.1) return false;
      }
    }
  }
  return true;
}

// ------------------------------------------------------------------ checks

/** An accepted level, or the reason the seed was rejected. */
function check(seed: number): Accepted | string {
  const level = candidate(seed);
  if (!level) return 'geometry';
  if (simulate(level, null, 12).status === 'won') return 'wins with no line';
  // Cheap probe before the expensive solve: a level no beginner ever wins is a wall.
  if (beginnerWinRate(level, 100).winRate === 0) return 'wall (probe)';
  const res = solve(level, { samples: SAMPLES, seed: 1 + seed });
  if (!res.robust || res.noLineWins) return `no robust solution (shortest ${res.best ? res.best.ink.toFixed(2) : '-'})`;
  if (res.robust.ink < 1.2 || res.robust.ink > 9) return `par ${res.robust.ink.toFixed(2)} out of range`;
  const t = tuneFromPar(res.robust.ink);
  const hint = res.robust.line.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as Pt);
  const tuned: LevelDef = { ...level, ink: t.ink, stars: t.stars, hint };
  const confirm = evaluate(tuned, hint);
  if (!confirm || confirm.ink > t.stars[0]) return 'hint fails after rounding';
  const rate = beginnerWinRate(tuned, RATE_TRIES).winRate;
  if (rate < RATE_MIN || rate > RATE_MAX) return `beginner rate ${(rate * 100).toFixed(1)}%`;
  return { seed, rate, level: tuned };
}

function runChild(from: number, to: number): Promise<Accepted[]> {
  return new Promise((resolve, reject) => {
    const p = spawn('npx', ['tsx', 'scripts/daily-gen.ts', '--', '--child', '--from', String(from), '--to', String(to)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', reject);
    p.on('close', () => {
      const found = out
        .split('\n')
        .filter((l) => l.startsWith('LEVEL '))
        .map((l) => JSON.parse(l.slice(6)) as Accepted);
      resolve(found);
    });
  });
}

async function main(): Promise<void> {
  if (child) {
    const from = opt('--from', 0);
    const to = opt('--to', 0);
    for (let s = from; s < to; s++) {
      const a = check(s);
      if (typeof a === 'string') console.log(`skip ${s} (${TEMPLATES[s % TEMPLATES.length]}): ${a}`);
      else console.log(`LEVEL ${JSON.stringify(a)}`);
    }
    return;
  }
  const chunk = 10;
  const queue: [number, number][] = [];
  for (let s = 0; s < seeds; s += chunk) queue.push([s, Math.min(seeds, s + chunk)]);
  const all: Accepted[] = [];
  const t0 = Date.now();
  const workers = Array.from({ length: Math.max(1, jobs) }, async () => {
    while (queue.length) {
      const [from, to] = queue.shift()!;
      const found = jobs > 1 ? await runChild(from, to) : [from, to].length ? rangeSync(from, to) : [];
      all.push(...found);
      console.log(`seeds ${from}-${to - 1}: ${found.length} accepted (${all.length} so far, ${Math.round((Date.now() - t0) / 1000)} s)`);
    }
  });
  await Promise.all(workers);
  all.sort((a, b) => a.seed - b.seed);
  const kept = all.slice(0, count);
  if (kept.length < count) console.warn(`only ${kept.length} of ${count} levels accepted; raise --seeds`);
  // Each week ramps from easy to hard.
  const ordered: LevelDef[] = [];
  for (let w = 0; w < kept.length; w += 7) {
    const week = kept.slice(w, w + 7).sort((a, b) => b.rate - a.rate);
    ordered.push(...week.map((a) => a.level));
  }
  writeFileSync(OUT, formatWorld({ id: 'daily', name: 'Daily', levels: ordered }));
  const rates = kept.map((a) => a.rate);
  console.log(`wrote ${OUT}: ${ordered.length} levels, beginner win rate ${(Math.min(...rates) * 100).toFixed(1)}% to ${(Math.max(...rates) * 100).toFixed(1)}%`);
  const byTemplate = new Map<number, number>();
  for (const a of kept) byTemplate.set(a.level.theme ?? 0, (byTemplate.get(a.level.theme ?? 0) ?? 0) + 1);
  console.log('levels per theme:', Object.fromEntries(byTemplate));
}

function rangeSync(from: number, to: number): Accepted[] {
  const out: Accepted[] = [];
  for (let s = from; s < to; s++) {
    const a = check(s);
    if (typeof a !== 'string') out.push(a);
  }
  return out;
}

// Only run when executed directly, so tools can import candidate() without starting a generation.
if (process.argv[1] && /daily-gen/.test(process.argv[1])) void main();
