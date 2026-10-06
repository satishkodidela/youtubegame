// Dev-only page (promo.html) that renders store covers and preview-video frames with the game's own
// renderer and physics. Driven by scripts/promo.mjs; never part of a game build.
import { WORLDS } from '../levels';
import { BALL_R, type LevelDef, type Pt } from '../levels/types';
import { drawStar } from '../render/icons';
import { drawBackground, drawBall, drawFinger, drawScene, stepParticles, type Particle, type View } from '../render/scene';
import { loadFonts } from '../render/fonts';
import { drawLogo } from '../render/logo';
import { STAR_ON, THEMES } from '../render/theme';
import { DT, Sim } from '../sim/sim';
import { traceStroke } from '../sim/stroke';

type Layout = 'landscape' | 'portrait' | 'square';

// CrazyGames covers: 16:9 1920x1080, 2:3 800x1200, 1:1 800x800. Videos use the same aspect ratios.
const COVER_SIZES: Record<Layout, [number, number]> = {
  landscape: [1920, 1080],
  portrait: [800, 1200],
  square: [800, 800],
};
const VIDEO_SIZES: Record<Layout, [number, number]> = {
  landscape: [1920, 1080],
  portrait: [1080, 1620],
  square: [800, 800],
};

// Preview video clips, in order. Each: draw the level's hint, release, roll in, celebrate.
const CLIPS = ['m01', 'w01', 's12', 'k11', 'g10'];
const FPS = 30;
const PLAY_SPEED = 1.15;
const CELEBRATE = 0.55;

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

/** A level and its world index, by level id (ids are stable; positions change when levels are reordered). */
function find(id: string): { level: LevelDef; world: number } {
  for (const [world, w] of WORLDS.entries()) {
    const level = w.levels.find((l) => l.id === id);
    if (level) return { level, world };
  }
  throw new Error(`no level ${id}`);
}

function setSize(size: [number, number]): [number, number] {
  const [w, h] = size;
  canvas.width = w;
  canvas.height = h;
  return [w, h];
}

/** Where the logo and the playfield go in each format. */
function frame(layout: Layout, w: number, h: number): { view: View; logo: { x: number; y: number; size: number } } {
  if (layout === 'landscape') {
    const s = (h * 0.94) / 14;
    return { view: { s, ox: w * 0.73 - 5 * s, oy: h * 0.03 }, logo: { x: w * 0.28, y: h * 0.42, size: h * 0.15 } };
  }
  if (layout === 'portrait') {
    const s = Math.min((w * 0.92) / 10, (h * 0.8) / 14);
    return { view: { s, ox: (w - 10 * s) / 2, oy: h - 14 * s - h * 0.015 }, logo: { x: w / 2, y: h * 0.095, size: w * 0.12 } };
  }
  // Square: zoom into the lower part of the playfield, where the action is.
  const s = (w * 1.0) / 10;
  return { view: { s, ox: 0, oy: h - 13.6 * s }, logo: { x: w / 2, y: h * 0.13, size: w * 0.11 } };
}

function partial(line: Pt[], k: number): Pt[] {
  let total = 0;
  for (let i = 1; i < line.length; i++) total += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
  let left = total * Math.max(0, Math.min(1, k));
  const out: Pt[] = [line[0]];
  for (let i = 1; i < line.length && left > 0; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const d = Math.hypot(bx - ax, by - ay);
    if (d <= left) {
      out.push(line[i]);
      left -= d;
    } else {
      out.push([ax + ((bx - ax) * left) / d, ay + ((by - ay) * left) / d]);
      left = 0;
    }
  }
  return out;
}

function confetti(ps: Particle[], x: number, y: number, seed: number): void {
  const colors = ['#ff4d4d', '#ffc531', '#2ecc71', '#3498db', '#9b59b6', '#ff8a3d'];
  let r = seed;
  const rand = () => ((r = (r * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 50; i++) {
    const a = -Math.PI / 2 + (rand() - 0.5) * 1.7;
    const v = 4 + rand() * 6;
    ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1.6 + rand() * 0.6, max: 2.2, size: 0.09 + rand() * 0.05, color: colors[i % colors.length], kind: 'confetti', rot: rand() * 6, vr: (rand() - 0.5) * 14, gravity: 7 });
  }
}

// ---------------------------------------------------------------- covers

interface Cover {
  /** Level id. */
  level: string;
  /** Seconds after release to freeze the ball. */
  at: number;
  /** World rectangle to show, and the canvas rectangle (fractions of width/height) to fit it in. */
  window: [number, number, number, number];
  region: [number, number, number, number];
  /** Logo centre and size, as fractions of the canvas width (x, size) and height (y). */
  logo: [number, number, number];
}

const COVERS: Record<Layout, Cover> = {
  landscape: { level: 'w12', at: 2.15, window: [0, 0, 10, 14], region: [0.5, 0.03, 0.98, 0.97], logo: [0.27, 0.45, 0.083] },
  portrait: { level: 'g10', at: 1.9, window: [0, 0, 10, 14], region: [0.03, 0.235, 0.97, 0.99], logo: [0.5, 0.1, 0.115] },
  square: { level: 'w12', at: 2.15, window: [0, 2.6, 10, 12.6], region: [0, 0, 1, 1], logo: [0.7, 0.14, 0.082] },
};

function fitWindow(c: Cover, w: number, h: number): View {
  const [x0, y0, x1, y1] = c.window;
  const [rx0, ry0, rx1, ry1] = c.region;
  const rw = (rx1 - rx0) * w;
  const rh = (ry1 - ry0) * h;
  const s = Math.min(rw / (x1 - x0), rh / (y1 - y0));
  return { s, ox: rx0 * w + (rw - (x1 - x0) * s) / 2 - x0 * s, oy: ry0 * h + (rh - (y1 - y0) * s) / 2 - y0 * s };
}

function distToLine(line: Pt[], x: number, y: number): number {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [ax, ay] = line[i - 1];
    const [bx, by] = line[i];
    const vx = bx - ax;
    const vy = by - ay;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / (vx * vx + vy * vy || 1)));
    best = Math.min(best, Math.hypot(x - (ax + vx * t), y - (ay + vy * t)));
  }
  return best;
}

function renderCover(layout: Layout): string {
  const [w, h] = setSize(COVER_SIZES[layout]);
  const cover = COVERS[layout];
  const { level, world } = find(cover.level);
  const theme = THEMES[world % THEMES.length];
  const view = fitWindow(cover, w, h);
  const line = traceStroke(level, level.hint).line!;

  // The ball's whole flight, from leaving the line to the cup, drawn as dots.
  // Starts once the ball has left the line, with a dot every 0.3 units so slow rolling doesn't bunch up.
  const full = new Sim(level, line);
  const paths: Pt[][] = level.balls.map(() => []);
  const touched = level.balls.map(() => false);
  while (full.status === 'running' && full.time < 14) {
    full.step();
    full.ballViews().forEach((b, i) => {
      if (b.sunk) return;
      const d = distToLine(line, b.x, b.y);
      if (d <= BALL_R + 0.15) touched[i] = true;
      if (!touched[i] || d <= BALL_R + 0.25) return;
      const last = paths[i][paths[i].length - 1];
      if (!last || Math.hypot(b.x - last[0], b.y - last[1]) >= 0.3) paths[i].push([b.x, b.y]);
    });
  }

  const sim = new Sim(level, line);
  while (sim.time < cover.at && sim.status === 'running') sim.step();
  drawBackground(ctx, w, h, theme, 0);
  drawScene(ctx, view, { level, theme, time: 0.6, sim, line, drawing: null, blocked: null, ghost: null, hint: null, particles: [], dropCue: false, lowInk: false });
  for (const path of paths) {
    for (const [x, y] of path) {
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.strokeStyle = 'rgba(31,42,68,0.35)';
      ctx.lineWidth = view.s * 0.025;
      ctx.beginPath();
      ctx.arc(view.ox + x * view.s, view.oy + y * view.s, view.s * 0.07, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  sim.ballViews().forEach((b, i) => {
    if (!b.sunk) drawBall(ctx, view.ox + b.x * view.s, view.oy + b.y * view.s, BALL_R * view.s, b.angle, i);
  });
  drawLogo(ctx, cover.logo[0] * w, cover.logo[1] * h, cover.logo[2] * w);
  return canvas.toDataURL('image/png');
}

// ---------------------------------------------------------------- video

interface Clip {
  level: LevelDef;
  world: number;
  line: Pt[];
  draw: number;
  roll: number;
}

let video: { layout: Layout; clips: Clip[]; starts: number[]; total: number } | null = null;
let state: { clip: number; sim: Sim | null; acc: number; particles: Particle[]; frame: number; sunkAt: number } | null = null;

function setupVideo(layout: Layout): number {
  const clips: Clip[] = CLIPS.map((code) => {
    const { level, world } = find(code);
    const line = traceStroke(level, level.hint).line!;
    const sim = new Sim(level, line);
    while (sim.status === 'running' && sim.time < 14) sim.step();
    const ink = line.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - line[i - 1][0], p[1] - line[i - 1][1]) : 0), 0);
    return { level, world, line, draw: Math.min(1.1, Math.max(0.55, 0.45 + ink * 0.09)), roll: sim.time / PLAY_SPEED };
  });
  const starts: number[] = [];
  let t = 0;
  for (const c of clips) {
    starts.push(t);
    t += c.draw + 0.15 + c.roll + CELEBRATE;
  }
  video = { layout, clips, starts, total: t };
  state = null;
  setSize(VIDEO_SIZES[layout]);
  return Math.ceil(t * FPS);
}

function renderFrame(i: number): string {
  if (!video) throw new Error('setupVideo first');
  const t = i / FPS;
  let ci = video.starts.length - 1;
  while (ci > 0 && t < video.starts[ci]) ci--;
  const clip = video.clips[ci];
  const local = t - video.starts[ci];
  if (!state || state.clip !== ci) state = { clip: ci, sim: null, acc: 0, particles: [], frame: i, sunkAt: -1 };
  const [w, h] = VIDEO_SIZES[video.layout];
  const { view, logo } = frame(video.layout, w, h);
  const theme = THEMES[clip.world % THEMES.length];
  const release = clip.draw + 0.15;

  let drawing: Pt[] | null = null;
  let finger: { p: Pt; a: number } | null = null;
  if (local < clip.draw) {
    const k = local / clip.draw;
    const eased = k * k * (3 - 2 * k);
    drawing = partial(clip.line, eased);
    finger = { p: drawing[drawing.length - 1], a: Math.min(1, local / 0.12) };
  } else if (local < release) {
    drawing = clip.line;
    finger = { p: clip.line[clip.line.length - 1], a: 1 - (local - clip.draw) / 0.15 };
  } else {
    if (!state.sim) state.sim = new Sim(clip.level, clip.line);
    state.acc += (1 / FPS) * PLAY_SPEED;
    while (state.acc >= DT) {
      state.sim.step();
      for (const e of state.sim.events) {
        if (e.kind === 'sink') {
          confetti(state.particles, e.x, e.y, 13 + ci);
          if (state.sunkAt < 0 || state.sim.status === 'won') state.sunkAt = local;
        }
      }
      state.acc -= DT;
    }
    stepParticles(state.particles, (1 / FPS) * PLAY_SPEED);
  }

  drawBackground(ctx, w, h, theme, t);
  drawScene(ctx, view, {
    level: clip.level,
    theme,
    time: t,
    sim: state.sim,
    line: state.sim ? clip.line : null,
    drawing,
    blocked: null,
    ghost: null,
    hint: null,
    particles: state.particles,
    dropCue: false,
    lowInk: false,
  });
  if (finger && finger.a > 0) drawFinger(ctx, view.ox + finger.p[0] * view.s, view.oy + finger.p[1] * view.s, view.s, finger.a);

  // Three stars pop in once every ball is down.
  if (state.sim && state.sim.status === 'won') {
    const since = local - state.sunkAt;
    for (let k = 0; k < 3; k++) {
      const p = Math.max(0, Math.min(1, (since - k * 0.08) / 0.18));
      if (p <= 0) continue;
      const r = view.s * (k === 1 ? 0.75 : 0.6) * (0.6 + 0.4 * p + Math.sin(p * Math.PI) * 0.3);
      drawStar(ctx, view.ox + (5 + (k - 1) * 1.6) * view.s, view.oy + (k === 1 ? 1.5 : 1.8) * view.s, r, STAR_ON, '#c98f00');
    }
  }
  drawLogo(ctx, logo.x, logo.y, logo.size * (video.layout === 'landscape' ? 1 : 0.9));
  return canvas.toDataURL('image/jpeg', 0.92);
}

Object.assign(window, { promo: { renderCover, setupVideo, renderFrame, FPS } });
// The store art uses the game's font; wait for it before saying the page is ready.
void loadFonts(5000).then(() => (document.title = 'ready'));
