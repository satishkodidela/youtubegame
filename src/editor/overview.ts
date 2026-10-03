// Dev-only page (levels.html): every level with its hint line and the path the ball takes.
// Open /levels.html?world=1 under `npm run dev`.
import { WORLDS } from '../levels';
import { WORLD_H, WORLD_W, type LevelDef, type Pt } from '../levels/types';
import { drawBackground, drawScene, fitView } from '../render/scene';
import { THEMES } from '../render/theme';
import { Sim } from '../sim/sim';
import { traceStroke } from '../sim/stroke';

const params = new URLSearchParams(location.search);
const worldFilter = params.get('world');
const tile = Number(params.get('size') ?? 240);
const root = document.getElementById('root')!;

WORLDS.forEach((world, wi) => {
  if (worldFilter && Number(worldFilter) !== wi + 1) return;
  world.levels.forEach((level, li) => root.appendChild(renderLevel(level, wi, `${wi + 1}-${li + 1} ${level.id}`)));
});

function renderLevel(level: LevelDef, wi: number, label: string): HTMLElement {
  const fig = document.createElement('figure');
  const canvas = document.createElement('canvas');
  const w = tile;
  const h = Math.round((tile * WORLD_H) / WORLD_W);
  canvas.width = w * 2;
  canvas.height = h * 2;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(2, 2);
  const theme = THEMES[wi % THEMES.length];
  drawBackground(ctx, w, h, theme, 0);
  const view = fitView(0, 0, w, h);
  const { line, ink } = traceStroke(level, level.hint);
  const noLine = runPath(level, null);
  const withHint = runPath(level, line);
  drawScene(ctx, view, {
    level, theme, time: 0, sim: null, line, drawing: null, blocked: null, ghost: null, hint: null,
    particles: [], dropCue: false, lowInk: false,
  });
  dots(ctx, view, noLine.path, 'rgba(200,40,40,0.55)');
  dots(ctx, view, withHint.path, 'rgba(20,120,255,0.8)');
  fig.appendChild(canvas);
  const cap = document.createElement('figcaption');
  const ok = withHint.status === 'won' && noLine.status !== 'won' && ink <= level.stars[0] + 1e-9;
  cap.innerHTML = `<b>${label}</b> ink ${level.ink} ★ ${level.stars.join(' / ')}<br>hint ${ink.toFixed(2)} → ${withHint.status} · no line → ${noLine.status} ${ok ? '' : '<span class="bad">CHECK</span>'}`;
  fig.appendChild(cap);
  return fig;
}

function runPath(level: LevelDef, line: Pt[] | null): { status: string; path: Pt[][] } {
  const sim = new Sim(level, line);
  const path: Pt[][] = level.balls.map(() => []);
  let n = 0;
  while (sim.status === 'running' && sim.time < 14) {
    sim.step();
    if (n++ % 4 === 0) sim.ballViews().forEach((b, i) => !b.sunk && path[i].push([b.x, b.y]));
  }
  return { status: sim.status, path };
}

function dots(ctx: CanvasRenderingContext2D, v: { ox: number; oy: number; s: number }, paths: Pt[][], color: string): void {
  ctx.fillStyle = color;
  for (const p of paths) for (const [x, y] of p) {
    ctx.beginPath();
    ctx.arc(v.ox + x * v.s, v.oy + y * v.s, 1.6, 0, Math.PI * 2);
    ctx.fill();
  }
}
