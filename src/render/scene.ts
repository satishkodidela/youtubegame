import { BALL_R, CUP_DEPTH, CUP_W, LINE_HALF, WORLD_H, WORLD_W, type LevelDef, type Pt } from '../levels/types';
import { DEG, rectPoly } from '../sim/geometry';
import { bouncerNormal, bouncerPoly, moverPose, spinnerAngle, staticSolids } from '../sim/shapes';
import { GRAVITY, type BallView, type Sim } from '../sim/sim';
import { INK, INK_GHOST, type Theme } from './theme';

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
  kind: 'dot' | 'confetti' | 'ring';
  rot: number;
  vr: number;
  gravity: number;
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
}

const WATER = '#2f9be0';
/** Depth below the water's rest line that the animated wave band covers. */
const WAVE = 0.05;

export function drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number, theme: Theme, time: number): void {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, theme.skyTop);
  g.addColorStop(1, theme.skyBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);

  // Soft clouds drifting slowly.
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  const unit = Math.max(w, h) / 12;
  for (let i = 0; i < 4; i++) {
    const speed = 4 + i * 2.5;
    const span = w + unit * 6;
    const x = ((i * 0.31 * span + time * speed) % span) - unit * 3;
    const y = h * (0.1 + 0.13 * i);
    cloud(ctx, x, y, unit * (0.8 + (i % 2) * 0.35));
  }

  // Rolling hills at the bottom.
  ctx.fillStyle = theme.hills;
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w + 20; x += 20) {
    const y = h * 0.82 - Math.sin(x / (unit * 2.2)) * unit * 0.45 - Math.sin(x / (unit * 0.9) + 1.3) * unit * 0.15;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fill();
}

function cloud(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
  ctx.arc(x + r * 0.55, y - r * 0.2, r * 0.6, 0, Math.PI * 2);
  ctx.arc(x + r * 1.15, y, r * 0.48, 0, Math.PI * 2);
  ctx.rect(x, y - r * 0.05, r * 1.15, r * 0.5);
  ctx.fill();
}

function pathPoly(ctx: CanvasRenderingContext2D, v: View, poly: Pt[]): void {
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(v.ox + x * v.s, v.oy + y * v.s) : ctx.moveTo(v.ox + x * v.s, v.oy + y * v.s)));
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
    if (ny < -0.55) out.push([a, b]);
  }
  return out;
}

/**
 * Everything in a level that never moves: mover tracks, cups, flag poles, ground and greens.
 * The game paints this once per level into a cached image; see drawScene's `staticDrawn`.
 */
export function drawStatic(ctx: CanvasRenderingContext2D, v: View, level: LevelDef, theme: Theme): void {
  const s = v.s;
  const X = (x: number) => v.ox + x * s;
  const Y = (y: number) => v.oy + y * s;

  // Wind zone panels (their moving streaks are drawn per frame).
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  for (const it of level.items) {
    if (it.t !== 'wind') continue;
    roundRect(ctx, X(it.x - it.w / 2), Y(it.y - it.h / 2), it.w * s, it.h * s, 0.25 * s);
    ctx.fill();
  }

  // Still water below the waves (the wavy surface band is drawn per frame).
  ctx.fillStyle = WATER;
  for (const it of level.items) {
    if (it.t !== 'water') continue;
    const top = it.y - it.h / 2 + WAVE;
    ctx.fillRect(X(it.x - it.w / 2), Y(top), it.w * s, (it.h - WAVE) * s);
  }

  // Mover tracks.
  ctx.setLineDash([0.12 * s, 0.14 * s]);
  ctx.strokeStyle = 'rgba(31,42,68,0.28)';
  ctx.lineWidth = 0.07 * s;
  for (const it of level.items) {
    if (it.t !== 'mover') continue;
    ctx.beginPath();
    ctx.moveTo(X(it.x), Y(it.y));
    ctx.lineTo(X(it.x + it.dx), Y(it.y + it.dy));
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const it of level.items) {
    if (it.t !== 'mover') continue;
    ctx.fillStyle = 'rgba(31,42,68,0.28)';
    for (const [px, py] of [
      [it.x, it.y],
      [it.x + it.dx, it.y + it.dy],
    ]) {
      ctx.beginPath();
      ctx.arc(X(px), Y(py), 0.08 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Cups and flag poles.
  for (const h of level.holes) {
    ctx.fillStyle = '#24170d';
    ctx.fillRect(X(h.x - CUP_W / 2), Y(h.y), CUP_W * s, CUP_DEPTH * s);
    ctx.strokeStyle = '#f4f4f4';
    ctx.lineWidth = 0.07 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(X(h.x), Y(h.y + CUP_DEPTH - 0.05));
    ctx.lineTo(X(h.x), Y(h.y - 1.75));
    ctx.stroke();
  }

  // Ground and greens.
  const solids = staticSolids(level);
  for (const sol of solids) {
    if (sol.kind === 'bouncer') continue;
    pathPoly(ctx, v, sol.poly);
    ctx.fillStyle = theme.ground;
    ctx.fill();
    ctx.strokeStyle = theme.groundDark;
    ctx.lineWidth = 0.05 * s;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
  ctx.lineCap = 'round';
  for (const sol of solids) {
    if (sol.kind === 'bouncer') continue;
    const isCupBottom = sol.kind === 'cup' && sol.poly[0][1] > level.holes[sol.index].y + 0.01;
    if (isCupBottom) continue;
    ctx.strokeStyle = sol.kind === 'cup' ? '#7ddc5c' : theme.top;
    ctx.lineWidth = 0.17 * s;
    for (const [a, b] of topEdges(sol.poly)) {
      ctx.beginPath();
      ctx.moveTo(X(a[0]), Y(a[1]));
      ctx.lineTo(X(b[0]), Y(b[1]));
      ctx.stroke();
    }
  }
}

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
    ctx.fillStyle = WATER;
    ctx.beginPath();
    ctx.moveTo(X(x0), Y(top + WAVE + 0.02));
    for (let x = x0; x <= x1 + 1e-6; x += 0.1) ctx.lineTo(X(x), wave(x));
    ctx.lineTo(X(x1), wave(x1));
    ctx.lineTo(X(x1), Y(top + WAVE + 0.02));
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 0.05 * s;
    ctx.beginPath();
    ctx.moveTo(X(x0), wave(x0));
    for (let x = x0 + 0.1; x <= x1 + 1e-6; x += 0.1) ctx.lineTo(X(x), wave(x));
    ctx.stroke();
  }

  // Flags (the poles are part of the static layer).
  for (const h of level.holes) {
    const poleTop = h.y - 1.75;
    const wave = Math.sin(time * 4 + h.x) * 0.07;
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.moveTo(X(h.x + 0.03), Y(poleTop));
    ctx.quadraticCurveTo(X(h.x + 0.45), Y(poleTop + 0.1 + wave), X(h.x + 0.85), Y(poleTop + 0.26 + wave));
    ctx.quadraticCurveTo(X(h.x + 0.45), Y(poleTop + 0.42 - wave), X(h.x + 0.03), Y(poleTop + 0.52));
    ctx.closePath();
    ctx.fill();
  }

  // Bouncers.
  for (const it of level.items) {
    if (it.t !== 'bouncer') continue;
    const poly = bouncerPoly(it);
    pathPoly(ctx, v, poly);
    ctx.fillStyle = '#ff5d8f';
    ctx.fill();
    ctx.strokeStyle = '#c23866';
    ctx.lineWidth = 0.05 * s;
    ctx.stroke();
    const [nx, ny] = bouncerNormal(it);
    const tx = -ny;
    const ty = nx;
    const pulse = 0.04 * Math.sin(time * 6);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 0.06 * s;
    const count = Math.max(1, Math.round(it.w / 0.7));
    for (let i = 0; i < count; i++) {
      const u = (i + 0.5) / count - 0.5;
      const cx = it.x + tx * u * it.w * 0.9 + nx * (0.02 + pulse);
      const cy = it.y + ty * u * it.w * 0.9 + ny * (0.02 + pulse);
      ctx.beginPath();
      ctx.moveTo(X(cx - tx * 0.13 - nx * 0.06), Y(cy - ty * 0.13 - ny * 0.06));
      ctx.lineTo(X(cx + nx * 0.07), Y(cy + ny * 0.07));
      ctx.lineTo(X(cx + tx * 0.13 - nx * 0.06), Y(cy + ty * 0.13 - ny * 0.06));
      ctx.stroke();
    }
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
      const poly = rectPoly(p.x, p.y, it.w, it.h, p.a / DEG);
      pathPoly(ctx, v, poly);
      ctx.fillStyle = '#eaa43c';
      ctx.fill();
      ctx.strokeStyle = '#a8681a';
      ctx.lineWidth = 0.05 * s;
      ctx.stroke();
      for (const [a, b] of topEdges(poly)) {
        ctx.strokeStyle = '#ffd27a';
        ctx.lineWidth = 0.08 * s;
        ctx.beginPath();
        ctx.moveTo(X(a[0]), Y(a[1]));
        ctx.lineTo(X(b[0]), Y(b[1]));
        ctx.stroke();
      }
    } else if (it.t === 'spinner') {
      const a = spinViews ? spinViews[si] : spinnerAngle(it, 0);
      si++;
      const poly = rectPoly(it.x, it.y, it.w, it.h, a / DEG);
      pathPoly(ctx, v, poly);
      ctx.fillStyle = '#f26b3a';
      ctx.fill();
      ctx.strokeStyle = '#b8461c';
      ctx.lineWidth = 0.05 * s;
      ctx.stroke();
      ctx.fillStyle = '#ffe2c4';
      ctx.beginPath();
      ctx.arc(X(it.x), Y(it.y), 0.1 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Lines.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (st.ghost && !st.line) {
    pathLine(ctx, v, st.ghost);
    ctx.strokeStyle = INK_GHOST;
    ctx.lineWidth = LINE_HALF * 2 * s;
    ctx.stroke();
  }
  if (st.hint) drawHint(ctx, v, st.hint.path, st.hint.t);
  const line = st.drawing ?? st.line;
  if (line && line.length > 1) {
    pathLine(ctx, v, line);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = LINE_HALF * 2 * s;
    ctx.save();
    ctx.translate(0, 0.05 * s);
    ctx.stroke();
    ctx.restore();
    ctx.strokeStyle = st.lowInk && st.drawing ? '#c0392b' : INK;
    ctx.stroke();
  } else if (line && line.length === 1) {
    ctx.fillStyle = INK;
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

  // Balls.
  const balls: BallView[] = sim
    ? sim.ballViews()
    : level.balls.map((b) => ({ x: b.x, y: b.y, angle: 0, vx: 0, vy: 0, sunk: false, sunkFor: 0, lost: false }));
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
    drawBall(ctx, X(x), Y(y), BALL_R * s, b.angle, i);
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

const BALL_TINTS = ['#ffffff', '#fff3c4'];

export function drawBall(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number, index = 0): void {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.7, BALL_TINTS[index % BALL_TINTS.length]);
  g.addColorStop(1, '#cfd8e8');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(31,42,68,0.35)';
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.stroke();
  // Dimples rotate with the ball so rolling reads at a glance.
  ctx.fillStyle = 'rgba(120,135,165,0.45)';
  for (let k = 0; k < 3; k++) {
    const a = angle + (k * Math.PI * 2) / 3;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * r * 0.5, y + Math.sin(a) * r * 0.5, r * 0.13, 0, Math.PI * 2);
    ctx.fill();
  }
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

function drawParticles(ctx: CanvasRenderingContext2D, v: View, ps: Particle[]): void {
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
