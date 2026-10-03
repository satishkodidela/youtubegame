import {
  BALL_R,
  BOUNCER_H,
  CUP_DEPTH,
  CUP_W,
  GREEN_H,
  GREEN_W,
  LINE_HALF,
  type BouncerItem,
  type HoleDef,
  type LevelDef,
  type MoverItem,
  type Pt,
  type SpinnerItem,
} from '../levels/types';
import { DEG, convexHull, pingPong, rectPoly } from './geometry';

// Geometry derived from level data. Shared by physics, drawing rules and rendering so the three
// always agree on where things are.

export type SolidKind = 'ground' | 'cup' | 'bouncer';

export interface Solid {
  kind: SolidKind;
  poly: Pt[];
  /** Index into level.items (or level.holes for cup parts). */
  index: number;
}

export function holeParts(h: HoleDef): { left: Pt[]; right: Pt[]; bottom: Pt[] } {
  const gw = h.w ?? GREEN_W;
  const l = h.x - gw / 2;
  const r = h.x + gw / 2;
  const cl = h.x - CUP_W / 2;
  const cr = h.x + CUP_W / 2;
  const top = h.y;
  const bot = h.y + GREEN_H;
  return {
    left: [
      [l, top],
      [cl, top],
      [cl, bot],
      [l, bot],
    ],
    right: [
      [cr, top],
      [r, top],
      [r, bot],
      [cr, bot],
    ],
    bottom: [
      [cl, top + CUP_DEPTH],
      [cr, top + CUP_DEPTH],
      [cr, bot],
      [cl, bot],
    ],
  };
}

export function bouncerPoly(b: BouncerItem): Pt[] {
  return rectPoly(b.x, b.y, b.w, BOUNCER_H, b.a ?? 0);
}

/** Unit normal of a bouncer's launch face (its top face before rotation). */
export function bouncerNormal(b: BouncerItem): Pt {
  const a = (b.a ?? 0) * DEG;
  return [Math.sin(a), -Math.cos(a)];
}

export function staticSolids(level: LevelDef): Solid[] {
  const out: Solid[] = [];
  level.items.forEach((it, index) => {
    if (it.t === 'box') out.push({ kind: 'ground', poly: rectPoly(it.x, it.y, it.w, it.h, it.a ?? 0), index });
    else if (it.t === 'poly') out.push({ kind: 'ground', poly: it.pts.map((p) => [p[0], p[1]] as Pt), index });
    else if (it.t === 'bouncer') out.push({ kind: 'bouncer', poly: bouncerPoly(it), index });
  });
  level.holes.forEach((h, index) => {
    const p = holeParts(h);
    out.push({ kind: 'cup', poly: p.left, index }, { kind: 'cup', poly: p.right, index }, { kind: 'cup', poly: p.bottom, index });
  });
  return out;
}

export function moverPose(m: MoverItem, t: number): { x: number; y: number; a: number } {
  const s = pingPong(t / m.period + (m.phase ?? 0));
  return { x: m.x + m.dx * s, y: m.y + m.dy * s, a: (m.a ?? 0) * DEG };
}

export function spinnerAngle(s: SpinnerItem, t: number): number {
  return (s.a ?? 0) * DEG + s.speed * t;
}

export function spinnerRadius(s: SpinnerItem): number {
  return Math.hypot(s.w / 2, s.h / 2);
}

export interface BlockPoly {
  type: 'poly';
  poly: Pt[];
}
export interface BlockCircle {
  type: 'circle';
  c: Pt;
  r: number;
}
export type Blocker = BlockPoly | BlockCircle;

/** Everything a drawn line may not pass through. */
export function drawBlockers(level: LevelDef): Blocker[] {
  const out: Blocker[] = staticSolids(level).map((s) => ({ type: 'poly', poly: s.poly }) as Blocker);
  for (const it of level.items) {
    if (it.t === 'mover') {
      const a = rectPoly(it.x, it.y, it.w, it.h, it.a ?? 0);
      const b = rectPoly(it.x + it.dx, it.y + it.dy, it.w, it.h, it.a ?? 0);
      out.push({ type: 'poly', poly: convexHull(a.concat(b)) });
    } else if (it.t === 'spinner') {
      out.push({ type: 'circle', c: [it.x, it.y], r: spinnerRadius(it) + 0.05 });
    }
  }
  for (const b of level.balls) out.push({ type: 'circle', c: [b.x, b.y], r: BALL_R + LINE_HALF + 0.08 });
  return out;
}
