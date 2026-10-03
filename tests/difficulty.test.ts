import { describe, expect, it } from 'vitest';
import { flatten } from '../src/game/progress';
import { WORLDS } from '../src/levels';
import { HARD_BELOW, beginnerWinRate, smoothOrder } from '../src/sim/beginner';

// Guards the difficulty curve where CrazyGames measures it: the first 20 levels, about the first
// 10 minutes of play. A modelled beginner (one rough ramp towards the flag) must find the opening
// gentle, and no two near-impossible levels may sit back to back. `npm run difficulty` prints the
// full curve; `npm run difficulty -- --reorder --write` repairs it.

const TRIES = 300;
const FIRST = 20;

describe('difficulty curve', () => {
  const levels = flatten(WORLDS).slice(0, FIRST);
  const rates = levels.map((r) => beginnerWinRate(r.level, TRIES).winRate);

  it('opens gently', () => {
    expect(rates[0]).toBeGreaterThan(0.5);
    expect(rates[1]).toBeGreaterThan(0.3);
  });

  it('starts every world with an easy introduction to its mechanic', () => {
    for (const w of WORLDS) expect(beginnerWinRate(w.levels[0], TRIES).winRate, `${w.name} opener ${w.levels[0].id}`).toBeGreaterThan(0.2);
  });

  it(`never puts two very hard levels back to back in the first ${FIRST}`, () => {
    for (let i = 1; i < rates.length; i++) {
      const pair = `${levels[i - 1].label} ${levels[i - 1].level.id} ${(rates[i - 1] * 100).toFixed(1)}% then ${levels[i].label} ${levels[i].level.id} ${(rates[i] * 100).toFixed(1)}%`;
      expect(rates[i - 1] < HARD_BELOW && rates[i] < HARD_BELOW, pair).toBe(false);
    }
  });

  it('smooths an order: easy first, hard levels kept apart, pinned opener kept', () => {
    const lv = (id: string, r: number) => ({ id, r });
    const input = [lv('a', 0.5), lv('b', 0.0), lv('c', 0.01), lv('d', 0.9), lv('e', 0.4), lv('f', 0.02), lv('g', 0.7), lv('h', 0.6), lv('i', 0.3), lv('j', 0.35)];
    const out = smoothOrder(input, (l) => l.r, 0.03, 'a').map((l) => l.id);
    expect(out[0]).toBe('a');
    expect(out).toHaveLength(10);
    expect(new Set(out).size).toBe(10);
    const hard = new Set(['b', 'c', 'f']);
    for (let i = 1; i < out.length; i++) expect(hard.has(out[i - 1]) && hard.has(out[i])).toBe(false);
    // At least three easier levels open the world before the first hard one.
    expect(out.slice(1, 4)).toEqual(['d', 'g', 'h']);
    // Hard levels are also ordered hardest last.
    expect(out).toEqual(['a', 'd', 'g', 'h', 'e', 'f', 'j', 'c', 'i', 'b']);
  });
});
