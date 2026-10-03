import { describe, expect, it } from 'vitest';
import type { LevelDef } from '../src/levels/types';
import { pointInPoly, polylineLength, rectPoly, segIntersectsPoly } from '../src/sim/geometry';
import { staticSolids } from '../src/sim/shapes';
import { MIN_LINE, Stroke, traceStroke } from '../src/sim/stroke';

const level: LevelDef = {
  id: 'test',
  balls: [{ x: 2, y: 2 }],
  holes: [{ x: 8, y: 12 }],
  ink: 5,
  stars: [2, 3],
  items: [{ t: 'box', x: 5, y: 6, w: 1, h: 4 }],
  hint: [],
};

describe('drawing rules', () => {
  it('a tap drops the ball with no line', () => {
    const s = new Stroke(level);
    s.move([6, 3]);
    expect(s.end([6.05, 3])).toBeNull();
    expect(traceStroke(level, [[6, 3], [6, 3 + MIN_LINE * 0.8]]).line).toBeNull();
  });

  it('stops when the ink runs out', () => {
    const { line, ink } = traceStroke(level, [[0.5, 12], [9.5, 12]]);
    expect(line).not.toBeNull();
    expect(ink).toBeLessThanOrEqual(5 + 1e-6);
    expect(ink).toBeGreaterThan(4.8);
  });

  it('never passes through solid blocks', () => {
    const { line } = traceStroke(level, [[3, 6], [7, 6], [7, 9]]);
    expect(line).not.toBeNull();
    // The line may end on the block's surface, but no part of it may be inside.
    const inner = rectPoly(5, 6, 1 - 0.02, 4 - 0.02);
    for (let i = 1; i < line!.length; i++) {
      for (let k = 0; k <= 20; k++) {
        const t = k / 20;
        const p: [number, number] = [line![i - 1][0] + (line![i][0] - line![i - 1][0]) * t, line![i - 1][1] + (line![i][1] - line![i - 1][1]) * t];
        expect(pointInPoly(p, inner)).toBe(false);
      }
    }
    expect(segIntersectsPoly([3, 6], [7, 6], staticSolids(level)[0].poly)).toBe(true);
  });

  it('keeps clear of the ball', () => {
    const { line } = traceStroke(level, [[0.5, 2], [4, 2]]);
    expect(line).not.toBeNull();
    for (const [x] of line!) expect(x).toBeLessThan(2 - 0.3);
  });

  it('simplifies straight strokes to their end points', () => {
    const { line, ink } = traceStroke(level, [[1, 10], [4, 10]]);
    expect(line).toEqual([[1, 10], [4, 10]]);
    expect(ink).toBeCloseTo(polylineLength(line!), 6);
  });
});
