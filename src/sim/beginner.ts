import type { LevelDef, Pt } from '../levels/types';
import { simulate } from './sim';
import { rng } from './solver';
import { traceStroke } from './stroke';

// A crude model of a first-time player, used to measure the difficulty curve. The beginner
// draws one rough ramp from just under the ball towards the flag, with a shaky hand, and wins
// or loses on that single attempt. Real players learn and use hints, so the absolute numbers
// are pessimistic, but the ordering between levels is what the level order and the CI check use.
//
// Seeded, so the same level always measures the same.

export interface Difficulty {
  id: string;
  /** Share of beginner attempts that won, 0..1. */
  winRate: number;
  tries: number;
}

function gauss(rand: () => number): number {
  const a = Math.max(1e-9, rand());
  const b = rand();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}

/** One beginner's attempt at a line: a ramp from the ball towards the nearest flag. */
export function beginnerPath(level: LevelDef, rand: () => number): Pt[] {
  const u = (a: number, b: number) => a + (b - a) * rand();
  const ball = level.balls[Math.floor(rand() * level.balls.length)];
  let hole = level.holes[0];
  for (const h of level.holes) if (Math.hypot(h.x - ball.x, h.y - ball.y) < Math.hypot(hole.x - ball.x, hole.y - ball.y)) hole = h;
  const dir = Math.sign(hole.x - ball.x) || 1;
  // Start a little behind and below the ball so it lands on the line, then head for the flag.
  const start: Pt = [ball.x - dir * u(0.1, 1.0), ball.y + u(0.5, 1.8)];
  const target: Pt = [hole.x - dir * u(0.2, 1.6), hole.y - u(0.3, 1.4)];
  const f = u(0.35, 1.0);
  const end: Pt = [start[0] + (target[0] - start[0]) * f + gauss(rand) * 0.3, start[1] + (target[1] - start[1]) * f + gauss(rand) * 0.3];
  if (rand() < 0.5) {
    // A wobbly hand draws a slight curve, not a ruler line.
    const k = u(0.3, 0.7);
    const mid: Pt = [start[0] + (end[0] - start[0]) * k + gauss(rand) * 0.3, start[1] + (end[1] - start[1]) * k + gauss(rand) * 0.3];
    return [start, mid, end];
  }
  return [start, end];
}

/** Levels below this beginner win rate count as very hard and are kept apart in the level order. */
export const HARD_BELOW = 0.03;
/** A world opens with at least this many easier levels before its first very hard one. */
const MIN_LEAD = 3;

/** Share of `tries` beginner attempts that win the level. */
export function beginnerWinRate(level: LevelDef, tries = 500, seed = 11): Difficulty {
  const rand = rng(seed);
  let wins = 0;
  for (let i = 0; i < tries; i++) {
    const { line } = traceStroke(level, beginnerPath(level, rand));
    if (line && simulate(level, line, 10).status === 'won') wins++;
  }
  return { id: level.id, winRate: wins / tries, tries };
}

/**
 * Orders a world's levels for a smooth curve: easiest first, and the hardest levels spread out
 * among the medium ones at the end instead of stacked back to back. `pinFirst` keeps that level
 * in the opening slot (the tutorial level). Ties keep their original order.
 */
export function smoothOrder<T extends { id: string }>(levels: T[], rate: (l: T) => number, hardBelow = HARD_BELOW, pinFirst?: string): T[] {
  const pinned = pinFirst ? levels.find((l) => l.id === pinFirst) : undefined;
  const rest = levels.filter((l) => l !== pinned);
  const sorted = rest.map((l, i) => ({ l, i })).sort((a, b) => rate(b.l) - rate(a.l) || a.i - b.i).map((x) => x.l);
  const easy = sorted.filter((l) => rate(l) >= hardBelow);
  const hard = sorted.filter((l) => rate(l) < hardBelow);
  const out: T[] = pinned ? [pinned] : [];
  // Easy ramp first (at least MIN_LEAD levels when the world has them); then alternate the
  // remaining easy levels with the hard ones so no two hard levels touch while that is possible.
  const lead = Math.min(easy.length, Math.max(MIN_LEAD, easy.length - hard.length));
  out.push(...easy.slice(0, lead));
  for (let i = 0; i < hard.length; i++) {
    if (lead + i < easy.length) out.push(easy[lead + i]);
    out.push(hard[i]);
  }
  return out;
}
