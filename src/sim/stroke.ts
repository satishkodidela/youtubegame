import { WORLD_H, WORLD_W, type LevelDef, type Pt } from '../levels/types';
import { dist, distPointSeg, polylineLength, segIntersectsPoly, simplify } from './geometry';
import { drawBlockers, type Blocker } from './shapes';

// Turns finger movement into a line. The line can't pass through solid things or the ball, and it
// stops growing when the ink runs out. A blocked line hugs the obstacle instead of jumping across.

export const MIN_STEP = 0.1;
/** Shorter strokes count as a tap: the ball drops with no line. */
export const MIN_LINE = 0.4;
const SIMPLIFY_EPS = 0.02;
const EDGE = 0.05;

export class Stroke {
  readonly budget: number;
  points: Pt[] = [];
  length = 0;
  private blockers: Blocker[];

  constructor(level: LevelDef) {
    this.budget = level.ink;
    this.blockers = drawBlockers(level);
  }

  get inkLeft(): number {
    return Math.max(0, this.budget - this.length);
  }

  get empty(): boolean {
    return this.inkLeft <= 1e-6;
  }

  isClear(a: Pt, b: Pt): boolean {
    for (const bl of this.blockers) {
      if (bl.type === 'poly') {
        if (segIntersectsPoly(a, b, bl.poly)) return false;
      } else if (distPointSeg(bl.c, a, b) < bl.r) return false;
    }
    return true;
  }

  /** Feed the current finger position (world units). */
  move(raw: Pt, minStep = MIN_STEP): void {
    const p: Pt = [clamp(raw[0], EDGE, WORLD_W - EDGE), clamp(raw[1], EDGE, WORLD_H - EDGE)];
    if (this.points.length === 0) {
      if (this.isClear(p, p)) this.points.push(p);
      return;
    }
    if (this.empty) return;
    const last = this.points[this.points.length - 1];
    const d = dist(last, p);
    if (d < minStep) return;

    // Cap by ink, then by obstacles (furthest clear point along the segment).
    let tMax = Math.min(1, this.inkLeft / d);
    let target: Pt = lerp(last, p, tMax);
    if (!this.isClear(last, target)) {
      let lo = 0;
      let hi = tMax;
      for (let i = 0; i < 14; i++) {
        const mid = (lo + hi) / 2;
        if (this.isClear(last, lerp(last, p, mid))) lo = mid;
        else hi = mid;
      }
      tMax = lo;
      target = lerp(last, p, tMax);
    }
    const step = d * tMax;
    if (step < minStep * 0.5) return;
    this.points.push(target);
    this.length += step;
  }

  /** Finger lifted at `p`. Returns the finished line, or null for a tap (the ball drops with no line). */
  end(p?: Pt): Pt[] | null {
    if (p) this.move(p, 0.03);
    return finishLine(this.points);
  }
}

export function finishLine(points: Pt[]): Pt[] | null {
  if (points.length < 2) return null;
  const s = simplify(points, SIMPLIFY_EPS);
  const out: Pt[] = [s[0]];
  for (let i = 1; i < s.length; i++) {
    if (dist(out[out.length - 1], s[i]) > 0.03) out.push(s[i]);
  }
  if (out.length < 2 || polylineLength(out) < MIN_LINE) return null;
  return out.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
}

/** Simulates a finger tracing `path`, applying all drawing rules. Used for hints, tests and the solver. */
export function traceStroke(level: LevelDef, path: Pt[]): { line: Pt[] | null; ink: number } {
  const s = new Stroke(level);
  if (path.length === 0) return { line: null, ink: 0 };
  s.move(path[0]);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const n = Math.max(1, Math.ceil(dist(a, b) / 0.04));
    for (let k = 1; k <= n; k++) s.move(lerp(a, b, k / n));
  }
  const line = s.end(path[path.length - 1]);
  return { line, ink: line ? polylineLength(line) : 0 };
}

function lerp(a: Pt, b: Pt, t: number): Pt {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
