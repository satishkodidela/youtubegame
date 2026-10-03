import { describe, expect, it } from 'vitest';
import { WORLDS } from '../src/levels';
import { BALL_R, WORLD_H, WORLD_W, type LevelDef } from '../src/levels/types';
import { distPointSeg, pointInPoly } from '../src/sim/geometry';
import { staticSolids } from '../src/sim/shapes';
import { simulate } from '../src/sim/sim';
import { traceStroke } from '../src/sim/stroke';

const all: { label: string; level: LevelDef }[] = [];
WORLDS.forEach((w, wi) => w.levels.forEach((level, li) => all.push({ label: `${wi + 1}-${li + 1} ${level.id}`, level })));

describe('level data', () => {
  it('has 5 worlds of 12 levels', () => {
    expect(WORLDS.length).toBe(5);
    for (const w of WORLDS) expect(w.levels.length).toBe(12);
  });

  it('uses unique, stable ids', () => {
    const ids = all.map((a) => a.level.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(all)('$label', ({ level }) => {
  it('is well formed', () => {
    expect(level.balls.length).toBeGreaterThan(0);
    expect(level.holes.length).toBeGreaterThan(0);
    expect(level.stars[0]).toBeLessThan(level.stars[1]);
    expect(level.stars[1]).toBeLessThanOrEqual(level.ink);
    for (const b of level.balls) {
      expect(b.x).toBeGreaterThan(0);
      expect(b.x).toBeLessThan(WORLD_W);
      expect(b.y).toBeGreaterThan(0);
      expect(b.y).toBeLessThan(WORLD_H);
      // Balls must not start inside anything solid.
      for (const s of staticSolids(level)) {
        expect(pointInPoly([b.x, b.y], s.poly)).toBe(false);
        for (let i = 0; i < s.poly.length; i++) {
          const d = distPointSeg([b.x, b.y], s.poly[i], s.poly[(i + 1) % s.poly.length]);
          expect(d).toBeGreaterThan(BALL_R - 0.02);
        }
      }
    }
  });

  it('is not won without a line', () => {
    expect(simulate(level, null).status).not.toBe('won');
  });

  it('is won by its hint, drawn under the normal drawing rules, for 3 stars', () => {
    const { line, ink } = traceStroke(level, level.hint);
    expect(line).not.toBeNull();
    expect(ink).toBeLessThanOrEqual(level.stars[0] + 1e-9);
    expect(simulate(level, line).status).toBe('won');
  });
});
