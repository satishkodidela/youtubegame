// Level data format. Levels live in src/levels/*.json and are written by hand or exported
// from the dev editor (editor.html). World units: the playfield is WORLD_W x WORLD_H,
// x grows right, y grows DOWN (same as the screen). Angles are in degrees, clockwise.

export const WORLD_W = 10;
export const WORLD_H = 14;

export type Pt = [number, number];

export interface BallDef {
  x: number;
  y: number;
  /** Optional launch velocity when the ball is released. */
  vx?: number;
  vy?: number;
}

export interface HoleDef {
  /** Centre of the cup mouth, on the surface of the green. */
  x: number;
  y: number;
  /** Width of the green block the cup is cut into (default 2.4). */
  w?: number;
}

/** Solid block. x/y is the centre. */
export interface BoxItem {
  t: 'box';
  x: number;
  y: number;
  w: number;
  h: number;
  a?: number;
}

/** Solid convex polygon (up to 8 points), e.g. a ramp. */
export interface PolyItem {
  t: 'poly';
  pts: Pt[];
}

/** Springy pad: launches the ball along its top-face normal. */
export interface BouncerItem {
  t: 'bouncer';
  x: number;
  y: number;
  w: number;
  a?: number;
  /** Launch speed along the pad normal (default 10). */
  power?: number;
}

/** Ball touching water is lost. Lines may be drawn over it. */
export interface WaterItem {
  t: 'water';
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Platform that slides back and forth by (dx, dy) once per `period` seconds. */
export interface MoverItem {
  t: 'mover';
  x: number;
  y: number;
  w: number;
  h: number;
  a?: number;
  dx: number;
  dy: number;
  period: number;
  /** 0..1 offset into the cycle at t = 0. */
  phase?: number;
}

/** Bar that rotates about its centre at `speed` rad/s (positive = clockwise). */
export interface SpinnerItem {
  t: 'spinner';
  x: number;
  y: number;
  w: number;
  h: number;
  a?: number;
  speed: number;
}

/** Zone that pushes the ball with acceleration (fx, fy). Lines may be drawn through it. */
export interface WindItem {
  t: 'wind';
  x: number;
  y: number;
  w: number;
  h: number;
  fx: number;
  fy: number;
}

export type Item = BoxItem | PolyItem | BouncerItem | WaterItem | MoverItem | SpinnerItem | WindItem;

export interface LevelDef {
  /** Stable id used as the save key. Never reuse or rename once shipped. */
  id: string;
  balls: BallDef[];
  holes: HoleDef[];
  /** Maximum ink (line length in world units). */
  ink: number;
  /** Ink used at or below stars[0] earns 3 stars, at or below stars[1] earns 2, else 1. */
  stars: [number, number];
  items: Item[];
  /** A known solution. Used by tests, the tutorial finger and the hint. */
  hint: Pt[];
  /** Look to draw the level with (index into THEMES). Campaign levels use their world's; Daily Holes set their own. */
  theme?: number;
}

export interface WorldDef {
  id: string;
  name: string;
  levels: LevelDef[];
}

export const BALL_R = 0.3;
export const LINE_HALF = 0.08;
export const CUP_W = 0.96;
export const CUP_DEPTH = 0.72;
export const GREEN_W = 2.6;
export const GREEN_H = 1.0;
export const BOUNCER_H = 0.34;

export function starsFor(level: LevelDef, inkUsed: number): 1 | 2 | 3 {
  if (inkUsed <= level.stars[0] + 1e-9) return 3;
  if (inkUsed <= level.stars[1] + 1e-9) return 2;
  return 1;
}
