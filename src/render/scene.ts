import { BALL_R, BOUNCER_H, CUP_DEPTH, CUP_W, LINE_HALF, WORLD_H, WORLD_W, type LevelDef, type Pt } from '../levels/types';
import { DEG, pointInPoly } from '../sim/geometry';
import { moverPose, spinnerAngle, staticSolids } from '../sim/shapes';
import { GRAVITY, type BallView, type Sim } from '../sim/sim';
import { FONT, INK, INK_GHOST, UI_DARK, type BallSkin, type InkSkin, type Theme } from './theme';

// Draws a level in world space. The view maps world units to canvas pixels.

export interface View {
  ox: number;
  oy: number;
  s: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  kind: 'dot' | 'confetti' | 'ring' | 'text';
  rot: number;
  vr: number;
  gravity: number;
  /** For kind 'text'. */
  text?: string;
}

export interface SceneState {
  level: LevelDef;
  theme: Theme;
  /** Wall-clock seconds, for ambient animation only. */
  time: number;
  sim: Sim | null;
  line: Pt[] | null;
  drawing: Pt[] | null;
  /** Finger position when the line is blocked by something. */
  blocked: { from: Pt; to: Pt } | null;
  ghost: Pt[] | null;
  hint: { path: Pt[]; t: number } | null;
  particles: Particle[];
  dropCue: boolean;
  lowInk: boolean;
  /** The static layer (drawStatic) is already on the canvas, e.g. from a cached image. */
  staticDrawn?: boolean;
  /** Recent positions of each ball, oldest first, for the motion trail. */
  trails?: Pt[][];
  /** Squash of each ball after a hard landing, 0 (round) to about 0.3. */
  squash?: number[];
  /** Cosmetics. Defaults to the classic ball and navy ink. */
  ballSkin?: BallSkin;
  ink?: InkSkin;
}

const WATER_TOP = '#4cb6f2';
const WATER_DEEP = '#1c6bb8';
/** Depth below the water's rest line that the animated wave band covers. */
const WAVE = 0.05;
/** How far below the playfield ground that reaches the bottom edge is drawn, so it never floats. */
const GROUND_SKIRT = 40;

/** Small seeded generator, so decoration is the same every time a level is painted. */
function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- background

/** Sky, sun, clouds, far and near hills with the world's scenery, and a soft vignette. */
export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme, time: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, theme.skyTop);
  g.addColorStop(1, theme.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  const unit = Math.max(w, h) / 12;
  const rand = seeded(hash(theme.scenery));

  // Sun with a soft glow.
  const sx = w * 0.84;
  const sy = Math.min(h * 0.17, unit * 1.7);
  const glow = ctx.createRadialGradient(sx, sy, unit * 0.3, sx, sy, unit * 2.4);
  glow.addColorStop(0, theme.sun);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(sx - unit * 2.4, sy - unit * 2.4, unit * 4.8, unit * 4.8);
  ctx.fillStyle = theme.sun;
  ctx.beginPath();
  ctx.arc(sx, sy, unit * 0.55, 0, Math.PI * 2);
  ctx.fill();

  // Clouds drifting slowly, each with a faint shadow underneath.
  for (let i = 0; i < 4; i++) {
    const speed = 4 + i * 2.5;
    const span = w + unit * 6;
    const x = ((i * 0.31 * span + time * speed) % span) - unit * 3;
    const y = h * (0.1 + 0.13 * i);
    const r = unit * (0.8 + (i % 2) * 0.35);
    ctx.fillStyle = 'rgba(90,120,170,0.10)';
    cloud(ctx, x + r * 0.08, y + r * 0.16, r);
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    cloud(ctx, x, y, r);
  }

  // Far layer.
  const farY = h * 0.72;
  ctx.fillStyle = theme.far;
  ctx.beginPath();
  ctx.moveTo(0, h);
  if (theme.scenery === 'windmills') {
    // Snowy mountains.
    const peaks: Pt[] = [];
    let x = -unit * rand();
    while (x < w + unit * 2) {
      const pw = unit * (1.6 + rand() * 1.6);
      peaks.push([x + pw / 2, farY - unit * (0.9 + rand() * 1.3)], [x + pw, farY - unit * (0.1 + rand() * 0.3)]);
      x += pw;
    }
    ctx.lineTo(-unit, farY);
    for (const p of peaks) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(w + unit, h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < peaks.length - 2; i += 2) {
      const [px, py] = peaks[i];
      const [bx, by] = peaks[i + 1];
      const prev = i > 0 ? peaks[i - 1] : ([px - (bx - px), by] as Pt);
      const k = 0.3;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + (bx - px) * k, py + (by - py) * k);
      ctx.lineTo(px + (bx - px) * k * 0.5, py + (by - py) * k * 0.75);
      ctx.lineTo(px, py + (by - py) * k * 0.55);
      ctx.lineTo(px + (prev[0] - px) * k * 0.5, py + (prev[1] - py) * k * 0.75);
      ctx.lineTo(px + (prev[0] - px) * k, py + (prev[1] - py) * k);
      ctx.closePath();
      ctx.fill();
    }
  } else if (theme.scenery === 'palms') {
    // The sea, with a few glints.
    ctx.rect(0, farY + unit * 0.2, w, h);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = Math.max(1.5, unit * 0.04);
    ctx.lineCap = 'round';
    for (let i = 0; i < 14; i++) {
      const gx = rand() * w;
      const gy = farY + unit * (0.4 + rand() * 1.2);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + unit * (0.2 + rand() * 0.3), gy);
      ctx.stroke();
    }
  } else {
    for (let x = 0; x <= w + 24; x += 24) ctx.lineTo(x, farY - Math.sin(x / (unit * 1.7) + 2) * unit * 0.5 - Math.sin(x / (unit * 0.7)) * unit * 0.12);
    ctx.lineTo(w + 24, h);
    ctx.closePath();
    ctx.fill();
  }

  // Near hills, with scenery standing on them.
  const hillY = (x: number) => h * 0.84 - Math.sin(x / (unit * 2.2)) * unit * 0.45 - Math.sin(x / (unit * 0.9) + 1.3) * unit * 0.15;
  const spots: number[] = [];
  for (let x = unit * (0.3 + rand()); x < w; x += unit * (1.1 + rand() * 1.4)) spots.push(x);
  ctx.fillStyle = theme.props;
  for (const x of spots) drawProp(ctx, theme.scenery, x, hillY(x) + unit * 0.12, unit * (0.75 + rand() * 0.5), rand);
  ctx.fillStyle = theme.hills;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w + 20; x += 20) ctx.lineTo(x, hillY(x));
  ctx.lineTo(w + 20, h);
  ctx.closePath();
  ctx.fill();

  // Vignette pulls the eye to the middle.
  const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.45, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  vg.addColorStop(0, 'rgba(10,20,50,0)');
  vg.addColorStop(1, 'rgba(10,20,50,0.16)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, w, h);
}

/** One piece of world scenery standing at (x, base), about `size` pixels tall, in the current fill colour. */
function drawProp(ctx: CanvasRenderingContext2D, kind: Theme['scenery'], x: number, base: number, size: number, rand: () => number): void {
  const z = size;
  ctx.beginPath();
  switch (kind) {
    case 'trees':
      if (rand() < 0.35) {
        // bush
        circles(ctx, [
          [x - z * 0.22, base - z * 0.12, z * 0.2],
          [x + z * 0.05, base - z * 0.2, z * 0.25],
          [x + z * 0.3, base - z * 0.1, z * 0.18],
        ]);
      } else {
        ctx.rect(x - z * 0.06, base - z * 0.55, z * 0.12, z * 0.55);
        circles(ctx, [
          [x, base - z * 0.8, z * 0.34],
          [x - z * 0.22, base - z * 0.58, z * 0.26],
          [x + z * 0.22, base - z * 0.58, z * 0.26],
        ]);
      }
      ctx.fill();
      break;
    case 'mushrooms': {
      const tall = 0.45 + rand() * 0.35;
      ctx.rect(x - z * 0.08, base - z * tall, z * 0.16, z * tall);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, base - z * tall, z * 0.36, z * 0.26, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      const fill = ctx.fillStyle;
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (const [dx, dy, r] of [
        [-0.17, -0.1, 0.05],
        [0.05, -0.18, 0.06],
        [0.2, -0.07, 0.04],
      ]) {
        ctx.beginPath();
        ctx.arc(x + dx * z, base - z * tall + dy * z, r * z, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = fill;
      break;
    }
    case 'palms': {
      const lean = (rand() - 0.5) * 0.6;
      const tx = x + z * lean;
      const ty = base - z * 1.05;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineCap = 'round';
      ctx.lineWidth = z * 0.09;
      ctx.moveTo(x, base);
      ctx.quadraticCurveTo(x + z * lean * 0.1, base - z * 0.6, tx, ty);
      ctx.stroke();
      ctx.lineWidth = z * 0.08;
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.05 + i * 0.225);
        const ex = tx - Math.cos(a) * z * 0.5;
        const ey = ty + Math.sin(a) * z * 0.12 + z * 0.12;
        ctx.beginPath();
        ctx.moveTo(tx, ty);
        ctx.quadraticCurveTo((tx + ex) / 2, ty - z * 0.22, ex, ey);
        ctx.stroke();
      }
      break;
    }
    case 'factory': {
      const bw = z * (0.7 + rand() * 0.5);
      const bh = z * (0.45 + rand() * 0.35);
      ctx.rect(x - bw / 2, base - bh, bw, bh);
      // saw-tooth roof
      const teeth = 3;
      for (let i = 0; i < teeth; i++) {
        const x0 = x - bw / 2 + (bw / teeth) * i;
        ctx.moveTo(x0, base - bh);
        ctx.lineTo(x0 + bw / teeth, base - bh - z * 0.18);
        ctx.lineTo(x0 + bw / teeth, base - bh);
      }
      ctx.rect(x + bw * 0.2, base - bh - z * 0.55, z * 0.1, z * 0.55);
      ctx.fill();
      const fill = ctx.fillStyle;
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(x + bw * 0.25 + i * z * 0.12, base - bh - z * (0.68 + i * 0.16), z * (0.07 + i * 0.03), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = fill;
      break;
    }
    case 'windmills': {
      const th = z * 0.95;
      ctx.moveTo(x - z * 0.14, base);
      ctx.lineTo(x - z * 0.07, base - th);
      ctx.lineTo(x + z * 0.07, base - th);
      ctx.lineTo(x + z * 0.14, base);
      ctx.closePath();
      ctx.fill();
      const hub: Pt = [x, base - th];
      const turn = rand() * Math.PI;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.lineCap = 'round';
      ctx.lineWidth = z * 0.06;
      for (let i = 0; i < 3; i++) {
        const a = turn + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.moveTo(hub[0], hub[1]);
        ctx.lineTo(hub[0] + Math.cos(a) * z * 0.5, hub[1] + Math.sin(a) * z * 0.5);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(hub[0], hub[1], z * 0.06, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
  }
}

/** Adds circles [x, y, r] to the current path as separate shapes, with no joining lines. */
function circles(ctx: CanvasRenderingContext2D, list: [number, number, number][]): void {
  for (const [x, y, r] of list) {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
  ctx.arc(x + r * 0.55, y - r * 0.2, r * 0.6, 0, Math.PI * 2);
  ctx.arc(x + r * 1.15, y, r * 0.48, 0, Math.PI * 2);
  ctx.rect(x, y - r * 0.05, r * 1.15, r * 0.5);
  ctx.fill();
}

// ---------------------------------------------------------------- level geometry helpers

function pathPoly(ctx: CanvasRenderingContext2D, v: View, poly: Pt[], dx = 0, dy = 0, fresh = true): void {
  if (fresh) ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + (x + dx) * v.s, v.oy + (y + dy) * v.s) : ctx.moveTo(v.ox + (x + dx) * v.s, v.oy + (y + dy) * v.s)));
  ctx.closePath();
}

function pathLine(ctx: CanvasRenderingContext2D, v: View, pts: Pt[]): void {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.s, v.oy + y * v.s) : ctx.moveTo(v.ox + x * v.s, v.oy + y * v.s)));
}

/** Edges of a polygon whose outward normal points up: these get the grass strip. */
function topEdges(poly: Pt[]): [Pt, Pt][] {
  let cx = 0;
  let cy = 0;
  for (const [x, y] of poly) {
    cx += x;
    cy += y;
  }
  cx /= poly.length;
  cy /= poly.length;
  const out: [Pt, Pt][] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    let nx = b[1] - a[1];
    let ny = -(b[0] - a[0]);
    const len = Math.hypot(nx, ny) || 1;
    nx /= len;
    ny /= len;
    const mx = (a[0] + b[0]) / 2 - cx;
    const my = (a[1] + b[1]) / 2 - cy;
    if (nx * mx + ny * my < 0) {
      nx = -nx;
      ny = -ny;
    }
    if (ny < -0.55) out.push(a[0] <= b[0] ? [a, b] : [b, a]);
  }
  return out;
}

/** Ground that reaches the bottom of the playfield carries on down past the screen edge. */
function extendDown(poly: Pt[]): Pt[] {
  return poly.map(([x, y]) => [x, y >= WORLD_H - 0.05 ? WORLD_H + GROUND_SKIRT : y] as Pt);
}

/** Same polygon, counter-clockwise on screen, so several can be unioned in one path. */
function oriented(poly: Pt[]): Pt[] {
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) area += (poly[j][0] - poly[i][0]) * (poly[j][1] + poly[i][1]);
  return area < 0 ? poly.slice().reverse() : poly;
}

/** Parts of a top edge (as 0..1 ranges) that are open to the sky, not covered by other ground. */
function exposedRuns(a: Pt, b: Pt, polys: Pt[][]): [number, number][] {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(2, Math.ceil(len / 0.05));
  const runs: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p: Pt = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - 0.04];
    const open = !polys.some((poly) => pointInPoly(p, poly));
    if (open && start < 0) start = t;
    if ((!open || i === n) && start >= 0) {
      const end = open ? t : (i - 1) / n;
      if (end - start > 1e-6) runs.push([start, end]);
      start = -1;
    }
  }
  return runs;
}

// ---------------------------------------------------------------- static layer

/**
 * Everything in a level that never moves: mover tracks, water, cups, flag poles, ground and greens.
 * The game paints this once per level into a cached image; see drawScene's `staticDrawn`.
 */
export function drawStatic(ctx: CanvasRenderingContext2D, v: View, level: LevelDef, theme: Theme): void {
  const s = v.s;
  const X = (x: number) => v.ox + x * s;
  const Y = (y: number) => v.oy + y * s;
  const rand = seeded(hash(level.id));

  // Wind zone panels (their moving streaks are drawn per frame).
  for (const it of level.items) {
    if (it.t !== 'wind') continue;
    roundRect(ctx, X(it.x - it.w / 2), Y(it.y - it.h / 2), it.w * s, it.h * s, 0.25 * s);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    ctx.fill();
    ctx.setLineDash([0.18 * s, 0.14 * s]);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 0.04 * s;
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Still water below the waves (the wavy surface band is drawn per frame).
  for (const it of level.items) {
    if (it.t !== 'water') continue;
    const top = it.y - it.h / 2 + WAVE;
    const bottom = it.y + it.h / 2;
    const g = ctx.createLinearGradient(0, Y(top), 0, Y(bottom));
    g.addColorStop(0, WATER_TOP);
    g.addColorStop(1, WATER_DEEP);
    ctx.fillStyle = g;
    ctx.fillRect(X(it.x - it.w / 2), Y(top), it.w * s, (bottom - top) * s);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 0.04 * s;
    ctx.lineCap = 'round';
    const glints = Math.round(it.w * it.h * 1.2);
    for (let i = 0; i < glints; i++) {
      const gx = it.x - it.w / 2 + 0.2 + rand() * (it.w - 0.6);
      const gy = top + 0.2 + rand() * Math.max(0.01, it.h - 0.4);
      ctx.beginPath();
      ctx.moveTo(X(gx), Y(gy));
      ctx.lineTo(X(gx + 0.2 + rand() * 0.2), Y(gy));
      ctx.stroke();
    }
  }

  // Mover tracks: a rail with a stop at each end.
  ctx.lineCap = 'round';
  for (const it of level.items) {
    if (it.t !== 'mover') continue;
    ctx.strokeStyle = 'rgba(31,42,68,0.22)';
    ctx.lineWidth = 0.1 * s;
    ctx.beginPath();
    ctx.moveTo(X(it.x), Y(it.y));
    ctx.lineTo(X(it.x + it.dx), Y(it.y + it.dy));
    ctx.stroke();
    ctx.fillStyle = 'rgba(31,42,68,0.32)';
    for (const [px, py] of [
      [it.x, it.y],
      [it.x + it.dx, it.y + it.dy],
    ]) {
      ctx.beginPath();
      ctx.arc(X(px), Y(py), 0.1 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const solids = staticSolids(level).filter((sol) => sol.kind !== 'bouncer');
  const polys = solids.map((sol) => oriented(extendDown(sol.poly)));

  // Drop shadow, cast down and to the right.
  ctx.fillStyle = 'rgba(25,35,60,0.16)';
  ctx.beginPath();
  for (const p of polys) pathPoly(ctx, v, p, 0.1, 0.16, false);
  ctx.fill();

  // Cups: a dark hole with a little depth.
  for (const h of level.holes) {
    const g = ctx.createLinearGradient(0, Y(h.y), 0, Y(h.y + CUP_DEPTH));
    g.addColorStop(0, '#3d2614');
    g.addColorStop(1, '#120a04');
    ctx.fillStyle = g;
    ctx.fillRect(X(h.x - CUP_W / 2), Y(h.y), CUP_W * s, (CUP_DEPTH + 0.05) * s);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(X(h.x - CUP_W / 2), Y(h.y), 0.14 * s, (CUP_DEPTH + 0.05) * s);
  }

  // Outline, then fill: all the outlines go first so the fills cover the seams between pieces.
  ctx.lineJoin = 'round';
  ctx.strokeStyle = theme.groundDark;
  ctx.lineWidth = 0.14 * s;
  ctx.beginPath();
  for (const p of polys) pathPoly(ctx, v, p, 0, 0, false);
  ctx.stroke();
  ctx.fillStyle = theme.ground;
  ctx.fill();

  // Texture, grass and greens, clipped to the ground.
  ctx.save();
  ctx.clip();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  for (const p of polys) {
    for (const [x, y] of p) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
    }
  }
  const maxY = WORLD_H + 6;
  // Strata: soft darker bands.
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  for (let y = minY + 0.75; y < maxY; y += 1.15) {
    const ph = rand() * 6;
    ctx.beginPath();
    ctx.moveTo(X(minX - 1), Y(y));
    for (let x = minX - 1; x <= maxX + 1; x += 0.25) ctx.lineTo(X(x), Y(y + Math.sin(x * 1.3 + ph) * 0.08));
    for (let x = maxX + 1; x >= minX - 1; x -= 0.25) ctx.lineTo(X(x), Y(y + 0.32 + Math.sin(x * 1.1 + ph + 1) * 0.08));
    ctx.closePath();
    ctx.fill();
  }
  // Pebbles.
  const count = Math.round((maxX - minX) * (maxY - minY) * 1.6);
  for (let i = 0; i < count; i++) {
    const px = minX + rand() * (maxX - minX);
    const py = minY + 0.3 + rand() * (maxY - minY);
    const r = 0.035 + rand() * 0.055;
    ctx.fillStyle = rand() < 0.65 ? theme.groundSpeck : 'rgba(0,0,0,0.13)';
    ctx.beginPath();
    ctx.ellipse(X(px), Y(py), r * 1.3 * s, r * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // Grass (or sand, metal, snow) on every top edge that is open to the sky.
  const style = theme.scenery === 'factory' ? 'metal' : theme.scenery === 'windmills' ? 'snow' : 'grass';
  solids.forEach((sol, i) => {
    const green = sol.kind === 'cup';
    if (green && sol.poly[0][1] > level.holes[sol.index].y + 0.01) return; // cup bottom
    for (const [a, b] of topEdges(polys[i])) {
      for (const [t0, t1] of exposedRuns(a, b, polys)) {
        const pa: Pt = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0];
        const pb: Pt = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1];
        drawTopStrip(ctx, v, pa, pb, green ? 'green' : style, theme);
      }
    }
  });
  ctx.restore();

  // Flag poles (the flags wave, so they are drawn per frame).
  ctx.lineCap = 'round';
  for (const h of level.holes) {
    const x = X(h.x);
    ctx.strokeStyle = 'rgba(31,42,68,0.75)';
    ctx.lineWidth = 0.11 * s;
    ctx.beginPath();
    ctx.moveTo(x, Y(h.y + CUP_DEPTH - 0.05));
    ctx.lineTo(x, Y(h.y - 1.75));
    ctx.stroke();
    ctx.strokeStyle = '#f7f7f7';
    ctx.lineWidth = 0.055 * s;
    ctx.stroke();
    ctx.fillStyle = '#ffd34d';
    ctx.strokeStyle = 'rgba(31,42,68,0.75)';
    ctx.lineWidth = 0.03 * s;
    ctx.beginPath();
    ctx.arc(x, Y(h.y - 1.78), 0.075 * s, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

type StripStyle = 'grass' | 'green' | 'metal' | 'snow';

/** The surface strip along a top edge from pa to pb (pa left of pb). Drawn inside the ground clip. */
function drawTopStrip(ctx: CanvasRenderingContext2D, v: View, pa: Pt, pb: Pt, style: StripStyle, theme: Theme): void {
  const s = v.s;
  const X = (x: number) => v.ox + x * s;
  const Y = (y: number) => v.oy + y * s;
  const top = style === 'green' ? '#7ddc5c' : theme.top;
  const dark = style === 'green' ? '#4fae3c' : theme.topDark;
  const deep = style === 'snow' ? 0.3 : 0.27;
  const band = (d: number) => {
    ctx.beginPath();
    ctx.moveTo(X(pa[0]), Y(pa[1] - 0.1));
    ctx.lineTo(X(pb[0]), Y(pb[1] - 0.1));
    ctx.lineTo(X(pb[0]), Y(pb[1] + d));
    ctx.lineTo(X(pa[0]), Y(pa[1] + d));
    ctx.closePath();
  };
  const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  const scallops = (d: number, r: number, offset: number) => {
    const n = Math.max(1, Math.round(len / (r * 2.3)));
    ctx.beginPath();
    for (let k = 0; k <= n; k++) {
      const t = Math.min(1, (k + offset) / n);
      const x = pa[0] + (pb[0] - pa[0]) * t;
      const y = pa[1] + (pb[1] - pa[1]) * t + d;
      ctx.moveTo(X(x) + r * s, Y(y));
      ctx.arc(X(x), Y(y), r * s, 0, Math.PI * 2);
    }
    ctx.fill();
  };

  if (style === 'metal') {
    band(0.22);
    ctx.fillStyle = dark;
    ctx.fill();
    band(0.15);
    ctx.fillStyle = top;
    ctx.fill();
    ctx.fillStyle = 'rgba(31,42,68,0.45)';
    const n = Math.max(1, Math.floor(len / 0.6));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      ctx.beginPath();
      ctx.arc(X(pa[0] + (pb[0] - pa[0]) * t), Y(pa[1] + (pb[1] - pa[1]) * t + 0.08), 0.035 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = dark;
    band(deep - 0.06);
    ctx.fill();
    scallops(deep - 0.06, style === 'snow' ? 0.09 : 0.07, 0);
    ctx.fillStyle = top;
    band(deep - 0.12);
    ctx.fill();
    scallops(deep - 0.12, style === 'snow' ? 0.085 : 0.065, 0.5);
    if (style === 'green') {
      // Mowing stripes.
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      const n = Math.max(1, Math.round(len / 0.32));
      for (let k = 0; k < n; k += 2) {
        const t0 = k / n;
        const t1 = Math.min(1, (k + 1) / n);
        ctx.beginPath();
        ctx.moveTo(X(pa[0] + (pb[0] - pa[0]) * t0), Y(pa[1] + (pb[1] - pa[1]) * t0 - 0.1));
        ctx.lineTo(X(pa[0] + (pb[0] - pa[0]) * t1), Y(pa[1] + (pb[1] - pa[1]) * t1 - 0.1));
        ctx.lineTo(X(pa[0] + (pb[0] - pa[0]) * t1), Y(pa[1] + (pb[1] - pa[1]) * t1 + deep - 0.12));
        ctx.lineTo(X(pa[0] + (pb[0] - pa[0]) * t0), Y(pa[1] + (pb[1] - pa[1]) * t0 + deep - 0.12));
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  // Highlight along the very top.
  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 0.035 * s;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(X(pa[0] + 0.04), Y(pa[1] + 0.04));
  ctx.lineTo(X(pb[0] - 0.04), Y(pb[1] + 0.04));
  ctx.stroke();
}

// ---------------------------------------------------------------- per frame

export function drawScene(ctx: CanvasRenderingContext2D, v: View, st: SceneState): void {
  const { level, theme, time, sim } = st;
  const s = v.s;
  const X = (x: number) => v.ox + x * s;
  const Y = (y: number) => v.oy + y * s;

  if (!st.staticDrawn) drawStatic(ctx, v, level, theme);

  // Wind streaks (the zone panels are in the static layer). Each streak is trimmed to the zone
  // along the wind direction instead of clipping, which is costly on large zones.
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 0.06 * s;
  ctx.lineCap = 'round';
  for (const it of level.items) {
    if (it.t !== 'wind') continue;
    const mag = Math.hypot(it.fx, it.fy) || 1;
    const dx = it.fx / mag;
    const dy = it.fy / mag;
    const along = Math.abs(dx) * it.w + Math.abs(dy) * it.h;
    const across = Math.abs(dy) * it.w + Math.abs(dx) * it.h;
    const n = Math.max(3, Math.round(across * 2.2));
    const half = along / 2 - 0.12;
    const span = along + 1;
    for (let i = 0; i < n; i++) {
      const off = ((i + 0.5) / n - 0.5) * across;
      const phase = (i * 0.618) % 1;
      const u = ((phase * span + time * (1.5 + mag * 0.1)) % span) - span / 2;
      const tail = Math.max(-half, u - 0.45);
      if (u > half || u - tail < 0.05) continue; // outside the zone, or too short to read
      const px = (t: number) => X(it.x + dx * t - dy * off);
      const py = (t: number) => Y(it.y + dy * t + dx * off);
      ctx.beginPath();
      ctx.moveTo(px(tail), py(tail));
      ctx.lineTo(px(u), py(u));
      // arrow head
      const hx = it.x + dx * u - dy * off;
      const hy = it.y + dy * u + dx * off;
      ctx.moveTo(X(hx - dx * 0.16 - dy * 0.1), Y(hy - dy * 0.16 + dx * 0.1));
      ctx.lineTo(X(hx), Y(hy));
      ctx.lineTo(X(hx - dx * 0.16 + dy * 0.1), Y(hy - dy * 0.16 - dx * 0.1));
      ctx.stroke();
    }
  }

  // Water surface: a thin wavy band on top of the still water in the static layer.
  for (const it of level.items) {
    if (it.t !== 'water') continue;
    const top = it.y - it.h / 2;
    const x0 = it.x - it.w / 2;
    const x1 = it.x + it.w / 2;
    const wave = (x: number) => Y(top + Math.sin(x * 3 + time * 2.4) * 0.04);
    ctx.fillStyle = WATER_TOP;
    ctx.beginPath();
    ctx.moveTo(X(x0), Y(top + WAVE + 0.02));
    for (let x = x0; x <= x1 + 1e-6; x += 0.1) ctx.lineTo(X(x), wave(x));
    ctx.lineTo(X(x1), wave(x1));
    ctx.lineTo(X(x1), Y(top + WAVE + 0.02));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 0.05 * s;
    ctx.beginPath();
    ctx.moveTo(X(x0), wave(x0));
    for (let x = x0 + 0.1; x <= x1 + 1e-6; x += 0.1) ctx.lineTo(X(x), wave(x));
    ctx.stroke();
  }

  // Flags (the poles are part of the static layer).
  ctx.lineJoin = 'round';
  for (const h of level.holes) {
    const poleTop = h.y - 1.72;
    const wave = Math.sin(time * 4 + h.x) * 0.07;
    ctx.beginPath();
    ctx.moveTo(X(h.x + 0.03), Y(poleTop));
    ctx.quadraticCurveTo(X(h.x + 0.45), Y(poleTop + 0.1 + wave), X(h.x + 0.9), Y(poleTop + 0.27 + wave));
    ctx.quadraticCurveTo(X(h.x + 0.45), Y(poleTop + 0.44 - wave), X(h.x + 0.03), Y(poleTop + 0.56));
    ctx.closePath();
    ctx.fillStyle = theme.accent;
    ctx.fill();
    ctx.strokeStyle = 'rgba(31,42,68,0.6)';
    ctx.lineWidth = 0.035 * s;
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.beginPath();
    ctx.moveTo(X(h.x + 0.03), Y(poleTop + 0.3));
    ctx.quadraticCurveTo(X(h.x + 0.45), Y(poleTop + 0.44 - wave), X(h.x + 0.03), Y(poleTop + 0.56));
    ctx.closePath();
    ctx.fill();
  }

  // Bouncers: a dark base with a springy pad on top.
  for (const it of level.items) {
    if (it.t !== 'bouncer') continue;
    ctx.save();
    ctx.translate(X(it.x), Y(it.y));
    ctx.rotate((it.a ?? 0) * DEG);
    const w = it.w * s;
    const hh = BOUNCER_H * s;
    const pulse = Math.max(0, Math.sin(time * 6)) * 0.03 * s;
    roundRect(ctx, -w / 2, -hh / 2, w, hh, 0.06 * s);
    ctx.fillStyle = '#4a3a5c';
    ctx.fill();
    ctx.strokeStyle = '#231a2e';
    ctx.lineWidth = 0.05 * s;
    ctx.stroke();
    roundRect(ctx, -w / 2 + 0.03 * s, -hh / 2 - pulse, w - 0.06 * s, hh * 0.55, 0.05 * s);
    ctx.fillStyle = '#ff5d8f';
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-w / 2 + 0.08 * s, -hh / 2 - pulse + 0.03 * s, w - 0.16 * s, 0.035 * s);
    // Chevrons pointing along the launch direction.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.05 * s;
    ctx.lineCap = 'round';
    const count = Math.max(1, Math.round(it.w / 0.7));
    for (let i = 0; i < count; i++) {
      const cx = ((i + 0.5) / count - 0.5) * w * 0.9;
      const cy = -hh * 0.2 - pulse;
      ctx.beginPath();
      ctx.moveTo(cx - 0.11 * s, cy + 0.035 * s);
      ctx.lineTo(cx, cy - 0.05 * s);
      ctx.lineTo(cx + 0.11 * s, cy + 0.035 * s);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Movers and spinners.
  const moverViews = sim ? sim.moverViews() : null;
  const spinViews = sim ? sim.spinnerViews() : null;
  let mi = 0;
  let si = 0;
  for (const it of level.items) {
    if (it.t === 'mover') {
      const p = moverViews ? moverViews[mi] : moverPose(it, 0);
      mi++;
      ctx.save();
      ctx.translate(X(p.x), Y(p.y));
      ctx.rotate(p.a);
      const w = it.w * s;
      const h = it.h * s;
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(0.08 * s, h / 2));
      ctx.fillStyle = '#f2b13c';
      ctx.fill();
      ctx.fillStyle = 'rgba(120,60,0,0.18)';
      ctx.fillRect(-w / 2 + 0.03 * s, h * 0.1, w - 0.06 * s, h * 0.38);
      ctx.fillStyle = '#ffd987';
      ctx.fillRect(-w / 2 + 0.06 * s, -h / 2 + 0.03 * s, w - 0.12 * s, Math.min(0.06 * s, h * 0.25));
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(0.08 * s, h / 2));
      ctx.strokeStyle = '#8a5413';
      ctx.lineWidth = 0.05 * s;
      ctx.stroke();
      ctx.fillStyle = '#8a5413';
      for (const bx of [-w / 2 + 0.14 * s, w / 2 - 0.14 * s]) {
        ctx.beginPath();
        ctx.arc(bx, 0.02 * s, Math.min(0.045 * s, h * 0.2), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (it.t === 'spinner') {
      const a = spinViews ? spinViews[si] : spinnerAngle(it, 0);
      si++;
      ctx.save();
      ctx.translate(X(it.x), Y(it.y));
      ctx.rotate(a);
      const w = it.w * s;
      const h = it.h * s;
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(0.07 * s, h / 2));
      ctx.fillStyle = '#f26b3a';
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(-w / 2 + 0.06 * s, -h / 2 + 0.03 * s, w - 0.12 * s, Math.min(0.05 * s, h * 0.25));
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(0.07 * s, h / 2));
      ctx.strokeStyle = '#9c3a14';
      ctx.lineWidth = 0.05 * s;
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = '#fff0e0';
      ctx.strokeStyle = '#9c3a14';
      ctx.lineWidth = 0.04 * s;
      ctx.beginPath();
      ctx.arc(X(it.x), Y(it.y), 0.13 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#9c3a14';
      ctx.beginPath();
      ctx.arc(X(it.x), Y(it.y), 0.045 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Lines.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const inkColor = st.ink?.color ?? INK;
  if (st.ghost && !st.line) {
    pathLine(ctx, v, st.ghost);
    ctx.strokeStyle = st.ink?.ghost ?? INK_GHOST;
    ctx.lineWidth = LINE_HALF * 2 * s;
    ctx.stroke();
  }
  if (st.hint) drawHint(ctx, v, st.hint.path, st.hint.t);
  const line = st.drawing ?? st.line;
  if (line && line.length > 1) {
    pathLine(ctx, v, line);
    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = LINE_HALF * 2 * s;
    ctx.save();
    ctx.translate(0.02 * s, 0.07 * s);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = st.lowInk && st.drawing ? '#c0392b' : inkColor;
    ctx.stroke();
    // A thin highlight makes the line read as a solid rod, not a scribble.
    ctx.save();
    ctx.translate(0, -0.03 * s);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 0.04 * s;
    ctx.stroke();
    ctx.restore();
  } else if (line && line.length === 1) {
    ctx.fillStyle = inkColor;
    ctx.beginPath();
    ctx.arc(X(line[0][0]), Y(line[0][1]), LINE_HALF * s, 0, Math.PI * 2);
    ctx.fill();
  }
  if (st.blocked) {
    ctx.strokeStyle = 'rgba(214,48,49,0.55)';
    ctx.lineWidth = 0.05 * s;
    ctx.setLineDash([0.08 * s, 0.08 * s]);
    ctx.beginPath();
    ctx.moveTo(X(st.blocked.from[0]), Y(st.blocked.from[1]));
    ctx.lineTo(X(st.blocked.to[0]), Y(st.blocked.to[1]));
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Balls, with a fading trail while they move fast.
  const balls: BallView[] = sim
    ? sim.ballViews()
    : level.balls.map((b) => ({ x: b.x, y: b.y, angle: 0, vx: 0, vy: 0, sunk: false, sunkFor: 0, lost: false }));
  if (st.trails) {
    for (const trail of st.trails) {
      const n = trail.length;
      for (let k = 0; k < n - 1; k++) {
        const f = (k + 1) / n;
        ctx.fillStyle = `rgba(255,255,255,${(0.35 * f).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(X(trail[k][0]), Y(trail[k][1]), BALL_R * s * (0.3 + 0.6 * f), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  balls.forEach((b, i) => {
    if (b.lost) return;
    let x = b.x;
    let y = b.y;
    if (b.sunk) {
      const h = nearestHole(level, b.x, b.y);
      const k = Math.min(1, b.sunkFor / 0.18);
      x = b.x + (h.x - b.x) * k;
      y = b.y + (h.y + CUP_DEPTH - BALL_R - b.y) * k;
    }
    drawBall(ctx, X(x), Y(y), BALL_R * s, b.angle, i, st.ballSkin, st.squash?.[i] ?? 0);
  });

  if (st.dropCue) {
    // Chevrons run along the start of the ball's real path: straight down for a plain drop,
    // along the launch arc when the level fires the ball.
    for (const b of level.balls) {
      const launched = Math.hypot(b.vx ?? 0, b.vy ?? 0) > 0.01;
      const path = launchPath(b.x, b.y, b.vx ?? 0, b.vy ?? 0, launched ? 2.4 : 1.4);
      const count = launched ? 4 : 3;
      const span = launched ? 1.8 : 0.8;
      for (let k = 0; k < count; k++) {
        const ph = (time * 1.4 + k / count) % 1;
        const at = pathAt(path, BALL_R + 0.25 + ph * span);
        if (!at) continue;
        const [px, py, dx, dy] = at;
        const nx = -dy;
        const ny = dx;
        ctx.strokeStyle = `rgba(31,42,68,${(launched ? 0.6 : 0.45) * (1 - ph)})`;
        ctx.lineWidth = 0.06 * s;
        ctx.beginPath();
        ctx.moveTo(X(px - dx * 0.1 + nx * 0.13), Y(py - dy * 0.1 + ny * 0.13));
        ctx.lineTo(X(px), Y(py));
        ctx.lineTo(X(px - dx * 0.1 - nx * 0.13), Y(py - dy * 0.1 - ny * 0.13));
        ctx.stroke();
      }
    }
  }

  // Tint over a ball that has reached the water, so it looks submerged. Only where needed:
  // painting every pond twice per frame is costly on low-end phones.
  for (const it of level.items) {
    if (it.t !== 'water') continue;
    const top = it.y - it.h / 2;
    if (!balls.some((b) => !b.sunk && Math.abs(b.x - it.x) < it.w / 2 + BALL_R && b.y > top - BALL_R)) continue;
    ctx.fillStyle = 'rgba(47,155,224,0.45)';
    ctx.fillRect(X(it.x - it.w / 2), Y(top + 0.06), it.w * s, (it.h - 0.06) * s);
  }

  drawParticles(ctx, v, st.particles);
}

/** Points along a ball's free flight from (x, y) with velocity (vx, vy): [x, y, distance travelled]. */
function launchPath(x: number, y: number, vx: number, vy: number, maxLen: number): [number, number, number][] {
  const out: [number, number, number][] = [[x, y, 0]];
  const dt = 1 / 240;
  let d = 0;
  for (let i = 0; i < 2400 && d < maxLen; i++) {
    vy += GRAVITY * dt;
    const nx = x + vx * dt;
    const ny = y + vy * dt;
    d += Math.hypot(nx - x, ny - y);
    x = nx;
    y = ny;
    out.push([x, y, d]);
  }
  return out;
}

/** Position and unit direction at distance `dist` along a launchPath, or null past its end. */
function pathAt(path: [number, number, number][], dist: number): [number, number, number, number] | null {
  for (let i = 1; i < path.length; i++) {
    if (path[i][2] < dist) continue;
    const [ax, ay, ad] = path[i - 1];
    const [bx, by, bd] = path[i];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    const t = bd > ad ? (dist - ad) / (bd - ad) : 0;
    return [ax + (bx - ax) * t, ay + (by - ay) * t, (bx - ax) / len, (by - ay) / len];
  }
  return null;
}

function nearestHole(level: LevelDef, x: number, y: number) {
  let best = level.holes[0];
  let bd = Infinity;
  for (const h of level.holes) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d < bd) {
      bd = d;
      best = h;
    }
  }
  return best;
}

const BALL_TINTS = ['#ffffff', '#fff1b8'];

/**
 * A ball centred on (x, y). `skin` sets its look (the classic white ball by default), and `squash`
 * flattens it for a moment after a hard landing.
 */
export function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number, index = 0, skin?: BallSkin, squash = 0): void {
  const style = skin?.style ?? 'classic';
  const base = skin?.base ?? '#ffffff';
  const light = skin?.light ?? '#ffffff';
  const mark = skin?.mark ?? 'rgba(110,125,160,0.45)';
  ctx.save();
  // Squash about the bottom of the ball, as if it landed on something.
  ctx.translate(x, y + r * squash);
  ctx.scale(1 + squash, 1 - squash);
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.clip();
  if (style === 'beach') {
    // Six wedges that turn with the ball.
    const cols = [base, light, mark];
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = cols[k % 3];
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, r, angle + (k * Math.PI) / 3, angle + ((k + 1) * Math.PI) / 3);
      ctx.closePath();
      ctx.fill();
    }
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.5, 'rgba(255,255,255,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
  } else {
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    if (style === 'classic') {
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.65, BALL_TINTS[index % BALL_TINTS.length]);
      g.addColorStop(1, '#bfcbe0');
    } else if (style === 'flame') {
      g.addColorStop(0, light);
      g.addColorStop(0.55, base);
      g.addColorStop(1, mark);
    } else {
      g.addColorStop(0, light);
      g.addColorStop(0.65, base);
      g.addColorStop(1, shade(base));
    }
    ctx.fillStyle = g;
    ctx.fillRect(-r, -r, r * 2, r * 2);
  }
  // Markings turn with the ball so rolling reads at a glance.
  if (style === 'classic' || style === 'solid' || style === 'flame') {
    ctx.fillStyle = mark;
    for (let k = 0; k < 3; k++) {
      const a = angle + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, r * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (style === 'eight') {
    const cx = Math.cos(angle) * r * 0.3;
    const cy = Math.sin(angle) * r * 0.3;
    ctx.fillStyle = mark;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = base;
    ctx.beginPath();
    ctx.arc(cx, cy - r * 0.1, r * 0.11, 0, Math.PI * 2);
    ctx.arc(cx, cy + r * 0.13, r * 0.14, 0, Math.PI * 2);
    ctx.fill();
  } else if (style === 'tennis') {
    ctx.strokeStyle = mark;
    ctx.lineWidth = Math.max(1, r * 0.14);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(Math.cos(angle) * r * 1.15 * side, Math.sin(angle) * r * 1.15 * side, r * 0.95, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else if (style === 'gold') {
    const a = angle * 0.5;
    const sx = Math.cos(a) * r * 0.3;
    const sy = Math.sin(a) * r * 0.3;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    for (let k = 0; k < 8; k++) {
      const rr = k % 2 === 0 ? r * 0.32 : r * 0.1;
      const t = angle + (k * Math.PI) / 4;
      if (k === 0) ctx.moveTo(sx + Math.cos(t) * rr, sy + Math.sin(t) * rr);
      else ctx.lineTo(sx + Math.cos(t) * rr, sy + Math.sin(t) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
  // A crisp outline and a shine, to match the outlined art.
  ctx.strokeStyle = style === 'eight' ? 'rgba(0,0,0,0.6)' : 'rgba(31,42,68,0.7)';
  ctx.lineWidth = Math.max(1, r * 0.11);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.35, -r * 0.42, r * 0.2, r * 0.12, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A darker copy of a hex colour, for the shaded rim of a ball. */
function shade(hex: string): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => Math.round(parseInt(h, 16) * 0.72));
  return `rgb(${r},${g},${b})`;
}

function drawHint(ctx: CanvasRenderingContext2D, v: View, path: Pt[], t: number): void {
  // A fingertip traces the solution, leaving ink behind it. t runs 0..1 over one pass (plus a pause).
  const total = path.reduce((acc, p, i) => (i ? acc + Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : 0), 0);
  const k = Math.min(1, t / 0.8);
  let remaining = total * k;
  const drawn: Pt[] = [path[0]];
  let tip: Pt = path[0];
  for (let i = 1; i < path.length && remaining > 0; i++) {
    const a = path[i - 1];
    const b = path[i];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (d <= remaining) {
      drawn.push(b);
      tip = b;
      remaining -= d;
    } else {
      tip = [a[0] + ((b[0] - a[0]) * remaining) / d, a[1] + ((b[1] - a[1]) * remaining) / d];
      drawn.push(tip);
      remaining = 0;
    }
  }
  const s = v.s;
  ctx.setLineDash([0.02 * s, 0.22 * s]);
  ctx.strokeStyle = 'rgba(255,255,255,0.95)';
  ctx.lineWidth = 0.12 * s;
  pathLine(ctx, v, path);
  ctx.stroke();
  ctx.setLineDash([]);
  if (drawn.length > 1) {
    pathLine(ctx, v, drawn);
    ctx.strokeStyle = 'rgba(38,49,92,0.55)';
    ctx.lineWidth = LINE_HALF * 2 * s;
    ctx.stroke();
  }
  const fade = t > 0.9 ? Math.max(0, 1 - (t - 0.9) / 0.1) : Math.min(1, t / 0.05 + 0.3);
  drawFinger(ctx, v.ox + tip[0] * s, v.oy + tip[1] * s, s, fade);
}

export function drawFinger(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, alpha: number): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  // Pointing hand: fingertip at (0,0), hand below-right.
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#1f2a44';
  ctx.lineWidth = 0.05 * s;
  ctx.beginPath();
  ctx.moveTo(-0.1 * s, 0);
  ctx.arc(0, 0, 0.1 * s, Math.PI, 0);
  ctx.lineTo(0.1 * s, 0.45 * s);
  ctx.quadraticCurveTo(0.5 * s, 0.38 * s, 0.55 * s, 0.6 * s);
  ctx.lineTo(0.5 * s, 1.0 * s);
  ctx.quadraticCurveTo(0.2 * s, 1.15 * s, -0.12 * s, 0.95 * s);
  ctx.lineTo(-0.3 * s, 0.62 * s);
  ctx.quadraticCurveTo(-0.32 * s, 0.48 * s, -0.1 * s, 0.55 * s);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawParticles(ctx: CanvasRenderingContext2D, v: View, ps: Particle[]): void {
  for (const p of ps) {
    const a = Math.max(0, p.life / p.max);
    const x = v.ox + p.x * v.s;
    const y = v.oy + p.y * v.s;
    ctx.globalAlpha = Math.min(1, a * 1.5);
    if (p.kind === 'confetti') {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size * v.s, -p.size * v.s * 0.5, p.size * 2 * v.s, p.size * v.s);
      ctx.restore();
    } else if (p.kind === 'ring') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 0.06 * v.s;
      ctx.beginPath();
      ctx.arc(x, y, p.size * (1 - a) * v.s + 0.05 * v.s, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.kind === 'text' && p.text) {
      // Pops in, floats up, fades.
      const age = p.max - p.life;
      const pop = age < 0.15 ? 0.6 + (age / 0.15) * 0.55 : age < 0.25 ? 1.15 - ((age - 0.15) / 0.1) * 0.15 : 1;
      const size = Math.round(p.size * v.s * pop);
      ctx.font = `700 ${size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = size * 0.22;
      ctx.strokeStyle = UI_DARK;
      ctx.strokeText(p.text, x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, x, y);
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, p.size * v.s * (0.4 + 0.6 * a), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

export function stepParticles(ps: Particle[], dt: number): void {
  for (let i = ps.length - 1; i >= 0; i--) {
    const p = ps[i];
    p.life -= dt;
    if (p.life <= 0) {
      ps.splice(i, 1);
      continue;
    }
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
  }
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** Fit the playfield into a rectangle (CSS pixels). */
export function fitView(x: number, y: number, w: number, h: number): View {
  const s = Math.min(w / WORLD_W, h / WORLD_H);
  return { s, ox: x + (w - WORLD_W * s) / 2, oy: y + (h - WORLD_H * s) / 2 };
}
