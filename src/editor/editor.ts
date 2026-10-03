// Dev-only level editor (editor.html, served by `npm run dev`; not part of any build).
// Move things by dragging, edit the selected object's JSON, draw a test line, auto-tune with the
// solver, then copy the level JSON into src/levels/*.json.
import { WORLDS } from '../levels';
import { GREEN_W, WORLD_H, WORLD_W, type Item, type LevelDef, type Pt } from '../levels/types';
import { drawBackground, drawScene, fitView, type View } from '../render/scene';
import { THEMES } from '../render/theme';
import { pointInPoly, rectPoly } from '../sim/geometry';
import { bouncerPoly } from '../sim/shapes';
import { DT, Sim } from '../sim/sim';
import { solve, tuneFromPar } from '../sim/solver';
import { Stroke, traceStroke } from '../sim/stroke';

type Sel = { kind: 'ball' | 'hole' | 'item'; index: number } | null;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('c');
const ctx = canvas.getContext('2d')!;
const SCALE = 40;
const W = WORLD_W * SCALE;
const H = WORLD_H * SCALE;
canvas.width = W * 2;
canvas.height = H * 2;
canvas.style.width = `${W}px`;
canvas.style.height = `${H}px`;
const view: View = fitView(0, 0, W, H);

let level: LevelDef = blank();
let themeIdx = 0;
let sel: Sel = null;
let tool: 'select' | 'draw' = 'select';
let drag: { start: Pt; orig: string } | null = null;
let stroke: Stroke | null = null;
let line: Pt[] | null = null;
let sim: Sim | null = null;
let acc = 0;
let last = performance.now();

function blank(): LevelDef {
  return {
    id: 'new01',
    balls: [{ x: 2, y: 2.5 }],
    holes: [{ x: 7.6, y: 10 }],
    ink: 8,
    stars: [3, 5],
    items: [{ t: 'box', x: 2.5, y: 12, w: 5, h: 4 }],
    hint: [],
  };
}

// ---------------------------------------------------------------- level picker

const pick = $<HTMLSelectElement>('pick');
WORLDS.forEach((w, wi) =>
  w.levels.forEach((lv, li) => {
    const o = document.createElement('option');
    o.value = `${wi}:${li}`;
    o.textContent = `${wi + 1}-${li + 1}  ${lv.id}`;
    pick.appendChild(o);
  }),
);
pick.onchange = () => {
  const [wi, li] = pick.value.split(':').map(Number);
  load(structuredClone(WORLDS[wi].levels[li]), wi);
};
$('new').onclick = () => load(blank(), 0);

function load(l: LevelDef, world: number): void {
  level = l;
  themeIdx = world;
  sel = null;
  resetRun();
  syncFields();
  refresh();
}

function syncFields(): void {
  $<HTMLInputElement>('lid').value = level.id;
  $<HTMLInputElement>('ink').value = String(level.ink);
  $<HTMLInputElement>('s3').value = String(level.stars[0]);
  $<HTMLInputElement>('s2').value = String(level.stars[1]);
}

for (const id of ['lid', 'ink', 's3', 's2']) {
  $<HTMLInputElement>(id).onchange = () => {
    level.id = $<HTMLInputElement>('lid').value.trim() || level.id;
    level.ink = Number($<HTMLInputElement>('ink').value) || level.ink;
    level.stars = [Number($<HTMLInputElement>('s3').value), Number($<HTMLInputElement>('s2').value)];
    refresh();
  };
}

// ---------------------------------------------------------------- tools

document.querySelectorAll<HTMLButtonElement>('#tools button').forEach((b) => {
  b.onclick = () => {
    tool = b.dataset.tool as 'select' | 'draw';
    document.querySelectorAll('#tools button').forEach((x) => x.classList.toggle('on', x === b));
    resetRun();
  };
});

const templates: Record<string, () => Item | 'ball' | 'hole'> = {
  box: () => ({ t: 'box', x: 5, y: 7, w: 2, h: 0.6 }),
  ramp: () => ({ t: 'poly', pts: [[4, 8], [6, 9], [6, 10], [4, 10]] }),
  bouncer: () => ({ t: 'bouncer', x: 5, y: 9, w: 1.6, power: 12 }),
  water: () => ({ t: 'water', x: 5, y: 13, w: 4, h: 2 }),
  mover: () => ({ t: 'mover', x: 4, y: 8, w: 1.6, h: 0.36, dx: 2, dy: 0, period: 3 }),
  spinner: () => ({ t: 'spinner', x: 5, y: 7, w: 3, h: 0.3, speed: 1.5 }),
  wind: () => ({ t: 'wind', x: 5, y: 6, w: 2, h: 6, fx: 0, fy: -26 }),
  ball: () => 'ball',
  hole: () => 'hole',
};
document.querySelectorAll<HTMLButtonElement>('#adds button').forEach((b) => {
  b.onclick = () => {
    const t = templates[b.dataset.add!]();
    if (t === 'ball') {
      level.balls.push({ x: 5, y: 2 });
      sel = { kind: 'ball', index: level.balls.length - 1 };
    } else if (t === 'hole') {
      level.holes.push({ x: 5, y: 10 });
      sel = { kind: 'hole', index: level.holes.length - 1 };
    } else {
      level.items.push(t);
      sel = { kind: 'item', index: level.items.length - 1 };
    }
    resetRun();
    refresh();
  };
});

$('del').onclick = () => {
  if (!sel) return;
  if (sel.kind === 'ball' && level.balls.length > 1) level.balls.splice(sel.index, 1);
  if (sel.kind === 'hole' && level.holes.length > 1) level.holes.splice(sel.index, 1);
  if (sel.kind === 'item') level.items.splice(sel.index, 1);
  sel = null;
  resetRun();
  refresh();
};

$('apply').onclick = () => {
  if (!sel) return;
  try {
    const v = JSON.parse($<HTMLTextAreaElement>('sel').value);
    if (sel.kind === 'ball') level.balls[sel.index] = v;
    else if (sel.kind === 'hole') level.holes[sel.index] = v;
    else level.items[sel.index] = v;
    status('Applied.');
  } catch (e) {
    status(`Bad JSON: ${(e as Error).message}`);
  }
  resetRun();
  refresh();
};

$('hint').onclick = () => {
  resetRun();
  const t = traceStroke(level, level.hint);
  line = t.line;
  sim = new Sim(level, line);
  status(`Hint: ${t.ink.toFixed(2)} ink`);
};

$('solve').onclick = () => {
  status('Solving… (the page freezes for a few seconds)');
  setTimeout(() => {
    const t0 = performance.now();
    const res = solve(level, { samples: 1500 });
    if (!res.robust) {
      status(`No forgiving solution found${res.best ? ` (shortest ${res.best.ink.toFixed(2)})` : ''}. ${res.noLineWins ? 'Wins with NO line!' : ''}`);
      return;
    }
    const t = tuneFromPar(res.robust.ink);
    level.ink = t.ink;
    level.stars = t.stars;
    level.hint = res.robust.line.map(([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]);
    syncFields();
    refresh();
    status(`par ${res.robust.ink.toFixed(2)} (shortest ${res.best!.ink.toFixed(2)}), ${res.evals} sims, ${Math.round(performance.now() - t0)} ms${res.noLineWins ? ' — WINS WITH NO LINE' : ''}`);
  }, 30);
};

$('copy').onclick = () => {
  void navigator.clipboard?.writeText($<HTMLTextAreaElement>('out').value).then(
    () => status('Copied.'),
    () => status('Copy failed: select the text and copy it by hand.'),
  );
};
$('import').onclick = () => {
  try {
    load(JSON.parse($<HTMLTextAreaElement>('out').value) as LevelDef, themeIdx);
    status('Loaded.');
  } catch (e) {
    status(`Bad JSON: ${(e as Error).message}`);
  }
};

function status(s: string): void {
  $('status').textContent = s;
}

function refresh(): void {
  const items = level.items.map((it) => `    ${JSON.stringify(it)}`).join(',\n');
  $<HTMLTextAreaElement>('out').value =
    `{\n  "id": ${JSON.stringify(level.id)},\n  "balls": ${JSON.stringify(level.balls)},\n  "holes": ${JSON.stringify(level.holes)},\n` +
    `  "ink": ${level.ink},\n  "stars": ${JSON.stringify(level.stars)},\n  "items": [\n${items}\n  ],\n  "hint": ${JSON.stringify(level.hint)}\n}`;
  const obj = !sel ? null : sel.kind === 'ball' ? level.balls[sel.index] : sel.kind === 'hole' ? level.holes[sel.index] : level.items[sel.index];
  $<HTMLTextAreaElement>('sel').value = obj ? JSON.stringify(obj, null, 1) : '';
}

function resetRun(): void {
  sim = null;
  line = null;
  stroke = null;
  acc = 0;
}

// ---------------------------------------------------------------- hit testing & dragging

function itemPoly(it: Item): Pt[] | null {
  switch (it.t) {
    case 'box':
    case 'mover':
    case 'spinner':
      return rectPoly(it.x, it.y, it.w, it.h, it.a ?? 0);
    case 'poly':
      return it.pts;
    case 'bouncer':
      return bouncerPoly(it);
    case 'water':
    case 'wind':
      return rectPoly(it.x, it.y, it.w, it.h);
  }
}

function hit(p: Pt): Sel {
  for (let i = level.balls.length - 1; i >= 0; i--) if (Math.hypot(p[0] - level.balls[i].x, p[1] - level.balls[i].y) < 0.5) return { kind: 'ball', index: i };
  for (let i = level.holes.length - 1; i >= 0; i--) {
    const h = level.holes[i];
    if (Math.abs(p[0] - h.x) < (h.w ?? GREEN_W) / 2 && p[1] > h.y - 1.8 && p[1] < h.y + 1) return { kind: 'hole', index: i };
  }
  for (let i = level.items.length - 1; i >= 0; i--) {
    const poly = itemPoly(level.items[i]);
    if (poly && pointInPoly(p, poly)) return { kind: 'item', index: i };
  }
  return null;
}

function toWorld(e: PointerEvent): Pt {
  const r = canvas.getBoundingClientRect();
  return [(e.clientX - r.left - view.ox) / view.s, (e.clientY - r.top - view.oy) / view.s];
}

const snap = (v: number) => Math.round(v * 10) / 10;

canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  const p = toWorld(e);
  if (tool === 'draw') {
    resetRun();
    stroke = new Stroke(level);
    stroke.move(p);
    return;
  }
  sel = hit(p);
  if (sel) {
    const obj = sel.kind === 'ball' ? level.balls[sel.index] : sel.kind === 'hole' ? level.holes[sel.index] : level.items[sel.index];
    drag = { start: p, orig: JSON.stringify(obj) };
  }
  resetRun();
  refresh();
});

canvas.addEventListener('pointermove', (e) => {
  const p = toWorld(e);
  if (stroke) {
    stroke.move(p);
    return;
  }
  if (!drag || !sel) return;
  const dx = snap(p[0] - drag.start[0]);
  const dy = snap(p[1] - drag.start[1]);
  const o = JSON.parse(drag.orig);
  if (o.pts) o.pts = o.pts.map(([x, y]: Pt) => [snap(x + dx), snap(y + dy)]);
  else {
    o.x = snap(o.x + dx);
    o.y = snap(o.y + dy);
  }
  if (sel.kind === 'ball') level.balls[sel.index] = o;
  else if (sel.kind === 'hole') level.holes[sel.index] = o;
  else level.items[sel.index] = o;
  refresh();
});

canvas.addEventListener('pointerup', (e) => {
  if (stroke) {
    line = stroke.end(toWorld(e));
    const ink = line ? stroke.length : 0;
    sim = new Sim(level, line);
    status(`Test line: ${ink.toFixed(2)} ink`);
    stroke = null;
  }
  drag = null;
});

// ---------------------------------------------------------------- render loop

function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (sim && sim.status === 'running') {
    acc += dt;
    while (acc >= DT) {
      sim.step();
      acc -= DT;
    }
    if (sim.status !== 'running') status(`${$('status').textContent} → ${sim.status}${sim.failReason ? ` (${sim.failReason})` : ''}`);
  }
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  const theme = THEMES[themeIdx % THEMES.length];
  drawBackground(ctx, W, H, theme, now / 1000);
  drawScene(ctx, view, {
    level,
    theme,
    time: now / 1000,
    sim,
    line,
    drawing: stroke ? stroke.points : null,
    blocked: null,
    ghost: null,
    hint: null,
    particles: [],
    dropCue: !sim,
    lowInk: false,
  });
  if (!sim && level.hint.length > 1) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(20,120,255,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    level.hint.forEach(([x, y], i) => (i ? ctx.lineTo(view.ox + x * view.s, view.oy + y * view.s) : ctx.moveTo(view.ox + x * view.s, view.oy + y * view.s)));
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (sel) {
    const obj = sel.kind === 'item' ? level.items[sel.index] : null;
    const poly = obj ? itemPoly(obj) : null;
    ctx.strokeStyle = '#ff2d55';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 3]);
    ctx.beginPath();
    if (poly) poly.forEach(([x, y], i) => (i ? ctx.lineTo(view.ox + x * view.s, view.oy + y * view.s) : ctx.moveTo(view.ox + x * view.s, view.oy + y * view.s)));
    else {
      const b = sel.kind === 'ball' ? level.balls[sel.index] : level.holes[sel.index];
      ctx.arc(view.ox + b.x * view.s, view.oy + b.y * view.s, 0.6 * view.s, 0, Math.PI * 2);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.setLineDash([]);
  }
  requestAnimationFrame(frame);
}

pick.dispatchEvent(new Event('change'));
requestAnimationFrame(frame);
