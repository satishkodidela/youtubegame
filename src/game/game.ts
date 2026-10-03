import { WORLD_W, starsFor, type LevelDef, type Pt, type WorldDef } from '../levels/types';
import { dist, polylineLength } from '../sim/geometry';
import { DT, Sim, type SimEvent } from '../sim/sim';
import { Stroke, traceStroke } from '../sim/stroke';
import type { Platform } from '../platform/platform';
import { drawIcon, drawStar, type IconName } from '../render/icons';
import { drawBackground, drawScene, drawStatic, fitView, roundRect, stepParticles, type Particle, type View } from '../render/scene';
import { FONT, STAR_OFF, STAR_ON, THEMES, UI_DARK, UI_LIGHT } from '../render/theme';
import { Sfx } from './audio';
import { continueIndex, flatten, unlockedMask, type LevelRef } from './progress';
import { emptySave, recordWin, serializeSave, totalStars, type SaveData } from './save';

type Screen = 'title' | 'select' | 'play';
type Phase = 'draw' | 'roll' | 'won' | 'failed';

interface Button {
  x: number;
  y: number;
  r: number;
  action: () => void;
}

const FAIL_RESET = 0.7;
const WIN_CARD_DELAY = 0.9;
const HINT_AFTER_FAILS = 3;
const MAX_STEPS_PER_FRAME = 12;
/** Canvas resolution steps, as a fraction of the device's pixel ratio (capped at 2). */
const QUALITY_STEPS = [1, 0.75, 0.625, 0.5];
/** Never render below this many canvas pixels per CSS pixel. */
const MIN_DPR = 1;
/** Frames per quality check, and the median frame time (ms) that triggers a step down. */
const QUALITY_WINDOW = 45;
const SLOW_FRAME_MS = 22;
const DEMO_TRACE = 1.8;

export class Game {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly levels: LevelRef[];
  private readonly sfx = new Sfx();
  private save: SaveData = emptySave();
  private ready = false;
  private canPersist = true;
  private lastScore = 0;

  private W = 0;
  private H = 0;
  private dpr = 1;
  private view: View = { ox: 0, oy: 0, s: 1 };
  private hudH = 60;

  private time = 0;
  private lastNow = 0;
  /** Index into QUALITY_STEPS. Only ever goes down (to a lower resolution) during a session. */
  private quality = 0;
  private frameTimes: number[] = [];
  /** Sky, hills and the current level's static layer, painted once and copied every frame. */
  private backdrop: HTMLCanvasElement | null = null;
  private backdropKey = '';
  private rafId = 0;
  private systemPaused = false;

  private screen: Screen = 'title';
  private buttons: Button[] = [];
  private selectWorld = 0;

  // Play state.
  private cur = 0;
  private phase: Phase = 'draw';
  private phaseTime = 0;
  private stroke: Stroke | null = null;
  private pointerId: number | null = null;
  private finger: Pt | null = null;
  private lastFinger: { p: Pt; t: number } | null = null;
  private line: Pt[] | null = null;
  private ghost: Pt[] | null = null;
  private sim: Sim | null = null;
  private acc = 0;
  private inkUsed = 0;
  private failCount = 0;
  private hint: { path: Pt[]; t: number } | null = null;
  private result = { stars: 0 };
  private paused = false;
  private particles: Particle[] = [];

  private starsPopped = 0;

  // Title demo: a finger draws level 1's solution, then the ball rolls in. Loops.
  private demo: { sim: Sim | null; t: number; acc: number; done: number; line: Pt[] } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly platform: Platform,
    private readonly worlds: WorldDef[],
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not available');
    this.ctx = ctx;
    this.levels = flatten(worlds);
  }

  start(): void {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e, false));
    c.addEventListener('pointercancel', (e) => this.onUp(e, true));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));

    this.platform.onPause(() => this.setSystemPaused(true));
    this.platform.onResume(() => this.setSystemPaused(false));
    this.platform.onAudioChange(() => this.applyAudio());
    this.applyAudio();

    this.resize();
    this.lastNow = performance.now();
    this.frame(this.lastNow);
  }

  /** Called once saved progress has loaded (or failed to load). */
  setSave(save: SaveData, canPersist: boolean): void {
    this.save = save;
    this.canPersist = canPersist;
    this.lastScore = totalStars(save);
    this.ready = true;
    this.applyAudio();
    const ci = continueIndex(this.levels, save);
    this.selectWorld = ci >= 0 ? this.levels[ci].world : this.worlds.length - 1;
  }

  // ---------------------------------------------------------------- lifecycle

  private setSystemPaused(p: boolean): void {
    if (this.systemPaused === p) return;
    this.systemPaused = p;
    this.sfx.setPaused(p);
    if (p) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      this.cancelStroke();
    } else {
      this.lastNow = performance.now();
      if (!this.rafId) this.rafId = requestAnimationFrame((t) => this.frame(t));
    }
  }

  private applyAudio(): void {
    let enabled = this.save.sfx;
    try {
      enabled = enabled && this.platform.audioEnabled();
    } catch {
      /* keep the in-game setting */
    }
    this.sfx.setEnabled(enabled);
  }

  private resize(): void {
    const base = Math.min(2, window.devicePixelRatio || 1);
    const dpr = Math.max(Math.min(base, MIN_DPR), base * QUALITY_STEPS[this.quality]);
    // The body fills the frame (minus any safe-area padding the host adds); fall back to the window.
    const W = Math.max(1, document.body.clientWidth || window.innerWidth);
    const H = Math.max(1, document.body.clientHeight || window.innerHeight);
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    this.canvas.width = Math.round(W * dpr);
    this.canvas.height = Math.round(H * dpr);
    this.canvas.style.width = `${W}px`;
    this.canvas.style.height = `${H}px`;
    this.hudH = Math.round(Math.max(56, Math.min(80, H * 0.085)));
    const pad = Math.max(6, Math.min(W, H) * 0.015);
    this.view = fitView(pad, this.hudH + pad * 0.5, W - pad * 2, H - this.hudH - pad * 1.5);
    if (this.rafId === 0 && !this.systemPaused) this.render();
  }

  private frame(now: number): void {
    this.rafId = 0;
    if (this.systemPaused) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    this.trackFrameTime(dt * 1000);
    this.update(dt);
    this.render();
    this.rafId = requestAnimationFrame((t) => this.frame(t));
  }

  /**
   * Adaptive resolution: if the median frame over the last QUALITY_WINDOW frames is slow, render at
   * the next lower resolution. Fill rate is what limits low-end phones, and it scales with pixels.
   * A device that caps frames at 30 fps (battery saver) looks the same as a slow one, so it also
   * steps down; that costs some sharpness, not smoothness.
   */
  private trackFrameTime(ms: number): void {
    if (ms <= 0 || ms > 250) return; // first frame, or a stall (tab switch, GC), not a trend
    this.frameTimes.push(ms);
    if (this.frameTimes.length < QUALITY_WINDOW) return;
    const sorted = this.frameTimes.sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    this.frameTimes = [];
    if (median <= SLOW_FRAME_MS || this.quality >= QUALITY_STEPS.length - 1) return;
    const base = Math.min(2, window.devicePixelRatio || 1);
    if (base * QUALITY_STEPS[this.quality] <= MIN_DPR) return;
    this.quality++;
    this.resize();
  }

  // ---------------------------------------------------------------- persistence

  private persist(): void {
    if (!this.canPersist) return;
    void this.platform.save(serializeSave(this.save));
    const total = totalStars(this.save);
    if (total > this.lastScore) {
      this.lastScore = total;
      try {
        this.platform.sendScore(total);
      } catch {
        this.platform.logWarning();
      }
    }
  }

  // ---------------------------------------------------------------- flow

  private get ref(): LevelRef {
    return this.levels[this.cur];
  }

  private get level(): LevelDef {
    return this.ref.level;
  }

  private openLevel(i: number): void {
    this.cur = i;
    this.screen = 'play';
    this.paused = false;
    this.line = null;
    this.failCount = 0;
    this.particles = [];
    this.resetAttempt();
    this.ghost = null;
    // The very first level teaches itself: a finger draws the solution until the player tries.
    this.hint = i === 0 && !this.save.stars[this.level.id] ? { path: this.level.hint, t: 0 } : null;
  }

  private resetAttempt(): void {
    if (this.line) this.ghost = this.line;
    this.phase = 'draw';
    this.phaseTime = 0;
    this.sim = null;
    this.line = null;
    this.stroke = null;
    this.acc = 0;
  }

  private drop(line: Pt[] | null): void {
    this.line = line;
    this.inkUsed = line ? polylineLength(line) : 0;
    this.sim = new Sim(this.level, line);
    this.phase = 'roll';
    this.phaseTime = 0;
    this.acc = 0;
  }

  private onWin(): void {
    this.phase = 'won';
    this.phaseTime = 0;
    const stars = starsFor(this.level, this.inkUsed);
    const changed = recordWin(this.save, this.level.id, stars, this.inkUsed);
    this.result = { stars };
    this.starsPopped = 0;
    if (changed) this.persist();
    this.sfx.win(stars);
    this.failCount = 0;
  }

  private onFail(): void {
    this.phase = 'failed';
    this.phaseTime = 0;
    this.failCount++;
    this.sfx.fail();
  }

  private nextLevel(): void {
    const n = this.cur + 1;
    const open = unlockedMask(this.levels, this.save);
    if (n < this.levels.length && open[n]) this.openLevel(n);
    else this.goSelect(this.ref.world);
  }

  private goSelect(world?: number): void {
    this.screen = 'select';
    this.paused = false;
    if (world !== undefined) this.selectWorld = world;
  }

  private goTitle(): void {
    this.screen = 'title';
    this.paused = false;
    this.demo = null;
  }

  private toggleSound(): void {
    this.save.sfx = !this.save.sfx;
    this.applyAudio();
    this.persist();
    this.sfx.unlock();
    this.sfx.click();
  }

  // ---------------------------------------------------------------- input

  private toWorld(e: PointerEvent): Pt {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    return [(x - this.view.ox) / this.view.s, (y - this.view.oy) / this.view.s];
  }

  private hitButton(e: PointerEvent): Button | null {
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    for (let i = this.buttons.length - 1; i >= 0; i--) {
      const b = this.buttons[i];
      if (Math.hypot(x - b.x, y - b.y) <= b.r * 1.15) return b;
    }
    return null;
  }

  private onDown(e: PointerEvent): void {
    if (this.systemPaused || !this.ready) return;
    this.sfx.unlock();
    const btn = this.hitButton(e);
    if (btn) {
      e.preventDefault();
      this.sfx.click();
      btn.action();
      return;
    }
    if (this.screen === 'title') {
      this.playContinue();
      return;
    }
    if (this.screen !== 'play' || this.paused || this.pointerId !== null) return;
    if (this.phase === 'won') return;
    if (this.phase === 'roll' || this.phase === 'failed') this.resetAttempt();
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* not supported */
    }
    this.pointerId = e.pointerId;
    this.hint = null;
    this.stroke = new Stroke(this.level);
    const p = this.toWorld(e);
    this.stroke.move(p);
    this.finger = p;
    this.lastFinger = { p, t: this.time };
    this.sfx.drawStart();
  }

  private onMove(e: PointerEvent): void {
    if (e.pointerId !== this.pointerId || !this.stroke) return;
    const p = this.toWorld(e);
    const before = this.stroke.length;
    this.stroke.move(p);
    this.finger = p;
    if (this.lastFinger) {
      const dt = Math.max(0.016, this.time - this.lastFinger.t);
      const grew = this.stroke.length > before;
      this.sfx.drawMove(grew ? dist(this.lastFinger.p, p) / dt : 0);
    }
    this.lastFinger = { p, t: this.time };
  }

  private onUp(e: PointerEvent, cancelled: boolean): void {
    if (e.pointerId !== this.pointerId) return;
    this.pointerId = null;
    this.sfx.drawEnd();
    const stroke = this.stroke;
    this.stroke = null;
    this.finger = null;
    if (!stroke || this.screen !== 'play' || this.paused) return;
    if (cancelled) return;
    this.drop(stroke.end(this.toWorld(e)));
  }

  private cancelStroke(): void {
    this.pointerId = null;
    this.stroke = null;
    this.finger = null;
    this.sfx.drawEnd();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.systemPaused) return;
    if (e.key === 'Escape' && this.screen === 'play') this.paused = !this.paused;
    if ((e.key === 'r' || e.key === 'R') && this.screen === 'play' && !this.paused) this.resetAttempt();
    if (__DEV_TOOLS__ && this.screen === 'play') {
      // Dev shortcuts: [ ] switch level, H shows the hint, W wins instantly.
      if (e.key === ']') this.openLevel(Math.min(this.levels.length - 1, this.cur + 1));
      if (e.key === '[') this.openLevel(Math.max(0, this.cur - 1));
      if (e.key === 'h') this.hint = { path: this.level.hint, t: 0 };
      if (e.key === 'w') this.drop(traceStroke(this.level, this.level.hint).line);
    }
  }

  private playContinue(): void {
    const ci = continueIndex(this.levels, this.save);
    if (ci >= 0) this.openLevel(ci);
    else this.goSelect();
  }

  // ---------------------------------------------------------------- update

  private update(dt: number): void {
    this.time += dt;
    stepParticles(this.particles, dt);
    if (this.screen === 'title') this.updateDemo(dt);
    if (this.screen !== 'play' || this.paused) return;
    this.phaseTime += dt;
    if (this.hint) {
      this.hint.t += dt / Math.max(1.6, polylineLength(this.hint.path) * 0.35);
      if (this.hint.t > 1.25) this.hint.t = 0;
    }
    if (this.sim && this.phase !== 'draw') {
      this.acc += dt;
      let steps = 0;
      const settle = this.phase === 'won' && this.phaseTime > 2.5;
      while (this.acc >= DT && steps < MAX_STEPS_PER_FRAME && !settle) {
        this.sim.step();
        this.handleEvents(this.sim.events);
        steps++;
        this.acc -= DT;
        if (this.phase === 'roll' && this.sim.status === 'won') this.onWin();
        else if (this.phase === 'roll' && this.sim.status === 'failed') this.onFail();
      }
      if (steps >= MAX_STEPS_PER_FRAME) this.acc = 0;
    }
    if (this.phase === 'failed' && this.phaseTime > FAIL_RESET) this.resetAttempt();
    if (this.phase === 'won') {
      const t = this.phaseTime - WIN_CARD_DELAY;
      while (this.starsPopped < this.result.stars && t >= 0.2 + this.starsPopped * 0.22) this.sfx.starPop(this.starsPopped++);
    }
  }

  private updateDemo(dt: number): void {
    const first = this.levels[0]?.level;
    if (!first) return;
    if (!this.demo) this.demo = { sim: null, t: 0, acc: 0, done: 0, line: traceStroke(first, first.hint).line ?? [] };
    const d = this.demo;
    d.t += dt;
    if (d.t < DEMO_TRACE + 0.3) return;
    if (!d.sim) d.sim = new Sim(first, d.line);
    d.acc += dt;
    for (let n = 0; d.acc >= DT && n < MAX_STEPS_PER_FRAME; n++) {
      d.sim.step();
      d.acc -= DT;
    }
    if (d.sim.status !== 'running' || d.sim.time > 8) {
      d.done += dt;
      if (d.done > 1.6) this.demo = null;
    }
  }

  private handleEvents(events: SimEvent[]): void {
    for (const ev of events) {
      if (ev.kind === 'hit') {
        this.sfx.hit(ev.strength);
        if (ev.strength > 4) this.burst(ev.x, ev.y + 0.2, 4, 'rgba(255,255,255,0.8)', 1.2, 0.35);
      } else if (ev.kind === 'bounce') {
        this.sfx.bounce();
        this.ring(ev.x, ev.y, '#ff5d8f');
      } else if (ev.kind === 'sink') {
        this.sfx.sink();
        this.confetti(ev.x, ev.y);
      } else if (ev.kind === 'splash') {
        this.sfx.splash();
        this.burst(ev.x, ev.y, 14, '#bfe6ff', 3.5, 0.7, -5);
      } else if (ev.kind === 'out') {
        this.ring(Math.max(0.3, Math.min(9.7, ev.x)), Math.min(13.7, ev.y), 'rgba(31,42,68,0.5)');
      }
    }
  }

  private burst(x: number, y: number, n: number, color: string, speed: number, life: number, up = 0): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.6);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v + up, life, max: life, size: 0.07 + Math.random() * 0.06, color, kind: 'dot', rot: 0, vr: 0, gravity: 9 });
    }
  }

  private ring(x: number, y: number, color: string): void {
    this.particles.push({ x, y, vx: 0, vy: 0, life: 0.45, max: 0.45, size: 0.8, color, kind: 'ring', rot: 0, vr: 0, gravity: 0 });
  }

  private confetti(x: number, y: number): void {
    const colors = ['#ff4d4d', '#ffc531', '#2ecc71', '#3498db', '#9b59b6', '#ff8a3d'];
    for (let i = 0; i < 40; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6;
      const v = 4 + Math.random() * 5;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        life: 1.4 + Math.random() * 0.6,
        max: 2,
        size: 0.08 + Math.random() * 0.05,
        color: colors[i % colors.length],
        kind: 'confetti',
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 14,
        gravity: 7,
      });
    }
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    const ctx = this.ctx;
    this.buttons = [];
    const worldIdx = this.screen === 'play' ? this.ref.world : this.screen === 'select' ? this.selectWorld : 0;
    const level = this.screen === 'play' ? this.level : this.screen === 'title' ? this.levels[0]?.level : undefined;
    this.paintBackdrop(THEMES[worldIdx % THEMES.length], level);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.screen === 'title') this.renderTitle();
    else if (this.screen === 'select') this.renderSelect();
    else this.renderPlay();
  }

  /** Copies the cached sky, hills and static level layer onto the canvas, repainting the cache if needed. */
  private paintBackdrop(theme: (typeof THEMES)[number], level: LevelDef | undefined): void {
    const { canvas, ctx } = this;
    const key = `${THEMES.indexOf(theme)}|${level?.id ?? '-'}|${this.W}x${this.H}|${canvas.width}x${canvas.height}`;
    if (!this.backdrop || key !== this.backdropKey) {
      const c = this.backdrop ?? document.createElement('canvas');
      c.width = canvas.width;
      c.height = canvas.height;
      const b = c.getContext('2d');
      if (!b) {
        // No second canvas available: draw everything directly every frame.
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        drawBackground(ctx, this.W, this.H, theme, 0);
        if (level) drawStatic(ctx, this.view, level, theme);
        return;
      }
      b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      drawBackground(b, this.W, this.H, theme, 0);
      if (level) drawStatic(b, this.view, level, theme);
      this.backdrop = c;
      this.backdropKey = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.backdrop, 0, 0);
  }

  private btnSize(): number {
    return Math.round(Math.max(40, Math.min(56, Math.min(this.W, this.H) * 0.11)));
  }

  private button(x: number, y: number, size: number, icon: IconName, action: () => void, style: 'light' | 'primary' | 'ghost' = 'light'): void {
    const ctx = this.ctx;
    const r = size / 2;
    if (style !== 'ghost') {
      ctx.fillStyle = 'rgba(31,42,68,0.22)';
      ctx.beginPath();
      ctx.arc(x, y + size * 0.06, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = style === 'primary' ? '#2ec27e' : UI_LIGHT;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    drawIcon(ctx, icon, x, y, size * 0.5, style === 'primary' ? UI_LIGHT : UI_DARK);
    this.buttons.push({ x, y, r, action });
  }

  private text(str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 800): void {
    const ctx = this.ctx;
    ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  private renderTitle(): void {
    const ctx = this.ctx;
    const first = this.levels[0]?.level;
    if (first && this.demo) {
      const d = this.demo;
      const hintT = Math.min(1, d.t / DEMO_TRACE) * 0.8;
      drawScene(ctx, this.view, {
        level: first,
        theme: THEMES[0],
        time: this.time,
        sim: d.sim,
        line: d.sim ? d.line : null,
        drawing: null,
        blocked: null,
        ghost: null,
        hint: d.sim ? null : { path: d.line, t: hintT },
        particles: this.particles,
        dropCue: false,
        lowInk: false,
        staticDrawn: true,
      });
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, 0, this.W, this.H);

    const cx = this.W / 2;
    const unit = Math.min(this.W, this.H * 0.75);
    const titleSize = Math.max(34, Math.min(76, unit * 0.13));
    const ty = this.H * 0.24;
    ctx.save();
    ctx.translate(cx, ty);
    ctx.rotate(-0.04);
    this.textOutlined('DRAW', 0, -titleSize * 0.55, titleSize, '#ffffff');
    this.textOutlined('TO HOLE', 0, titleSize * 0.5, titleSize, '#ffc531');
    ctx.restore();
    // underline drawn like ink
    ctx.strokeStyle = '#26315c';
    ctx.lineWidth = Math.max(5, titleSize * 0.12);
    ctx.lineCap = 'round';
    ctx.beginPath();
    const uw = titleSize * 2.6;
    ctx.moveTo(cx - uw / 2, ty + titleSize * 1.15);
    ctx.quadraticCurveTo(cx, ty + titleSize * 1.45, cx + uw / 2, ty + titleSize * 1.05);
    ctx.stroke();

    const size = this.btnSize();
    const by = this.H * 0.62;
    this.button(cx, by, size * 1.9, 'play', () => this.playContinue(), 'primary');
    this.button(cx, by + size * 1.75, size, 'grid', () => this.goSelect());
    this.button(this.W - size * 0.8, this.H - size * 0.8, size * 0.85, this.save.sfx ? 'soundOn' : 'soundOff', () => this.toggleSound());

    if (this.ready) {
      const total = totalStars(this.save);
      const max = this.levels.length * 3;
      const sy = by + size * 3;
      drawStar(ctx, cx - size * 0.9, sy, size * 0.3, STAR_ON, '#c98f00');
      this.text(`${total}/${max}`, cx - size * 0.5, sy, size * 0.42, UI_DARK, 'left');
    }
  }

  private textOutlined(str: string, x: number, y: number, size: number, fill: string): void {
    const ctx = this.ctx;
    ctx.font = `900 ${Math.round(size)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.18;
    ctx.strokeStyle = UI_DARK;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(str, x, y);
  }

  private renderSelect(): void {
    const ctx = this.ctx;
    const size = this.btnSize();
    const wi = this.selectWorld;
    const world = this.worlds[wi];
    const open = unlockedMask(this.levels, this.save);
    const firstIdx = this.levels.findIndex((r) => r.world === wi);

    // Header: home, world switcher (world number badge + stars), arrows.
    const hy = this.hudH / 2 + 4;
    const [hl] = this.hudSpan();
    this.button(hl + size * 0.75, hy, size * 0.85, 'home', () => this.goTitle());
    const cx = this.W / 2;
    if (wi > 0) this.button(cx - size * 2.05, hy, size * 0.8, 'left', () => (this.selectWorld = wi - 1), 'light');
    if (wi < this.worlds.length - 1) this.button(cx + size * 2.05, hy, size * 0.8, 'right', () => (this.selectWorld = wi + 1), 'light');
    const theme = THEMES[wi % THEMES.length];
    ctx.fillStyle = theme.ground;
    roundRect(ctx, cx - size * 1.4, hy - size * 0.5, size * 2.8, size, size * 0.5);
    ctx.fill();
    ctx.fillStyle = theme.top;
    ctx.beginPath();
    ctx.arc(cx - size * 0.95, hy, size * 0.36, 0, Math.PI * 2);
    ctx.fill();
    this.text(`${wi + 1}`, cx - size * 0.95, hy + 1, size * 0.42, UI_DARK);
    let got = 0;
    for (const lv of world.levels) got += this.save.stars[lv.id] ?? 0;
    drawStar(ctx, cx - size * 0.3, hy, size * 0.22, STAR_ON);
    this.text(`${got}/${world.levels.length * 3}`, cx - size * 0.02, hy + 1, size * 0.34, UI_LIGHT, 'left');

    // Grid of levels.
    const top = this.hudH + 16;
    const availW = this.W - 32;
    const availH = this.H - top - 24;
    const cols = availW > availH ? 4 : 3;
    const rows = Math.ceil(world.levels.length / cols);
    const cell = Math.min(availW / cols, availH / rows, 130);
    const gx = (this.W - cell * cols) / 2;
    const gy = top + (availH - cell * rows) / 2;
    world.levels.forEach((lv, i) => {
      const idx = firstIdx + i;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = gx + col * cell + cell * 0.08;
      const y = gy + row * cell + cell * 0.08;
      const w = cell * 0.84;
      const unlocked = open[idx];
      const stars = this.save.stars[lv.id] ?? 0;
      ctx.fillStyle = 'rgba(31,42,68,0.2)';
      roundRect(ctx, x, y + w * 0.05, w, w, w * 0.2);
      ctx.fill();
      ctx.fillStyle = unlocked ? UI_LIGHT : 'rgba(255,255,255,0.55)';
      roundRect(ctx, x, y, w, w, w * 0.2);
      ctx.fill();
      if (unlocked) {
        this.text(`${i + 1}`, x + w / 2, y + w * 0.42, w * 0.36, UI_DARK);
        for (let k = 0; k < 3; k++) drawStar(ctx, x + w / 2 + (k - 1) * w * 0.24, y + w * 0.76, w * 0.1, k < stars ? STAR_ON : STAR_OFF);
        this.buttons.push({ x: x + w / 2, y: y + w / 2, r: w / 2, action: () => this.openLevel(idx) });
      } else {
        drawIcon(ctx, 'lock', x + w / 2, y + w / 2, w * 0.36, 'rgba(31,42,68,0.45)');
      }
    });
  }

  private renderPlay(): void {
    const ctx = this.ctx;
    const level = this.level;
    const theme = THEMES[this.ref.world % THEMES.length];
    const stroke = this.stroke;
    let blocked: { from: Pt; to: Pt } | null = null;
    if (stroke && this.finger && stroke.points.length > 0) {
      const last = stroke.points[stroke.points.length - 1];
      if (dist(last, this.finger) > 0.25 && !stroke.empty && !stroke.isClear(last, this.finger)) blocked = { from: last, to: this.finger };
    }
    drawScene(ctx, this.view, {
      level,
      theme,
      time: this.time,
      sim: this.sim,
      line: this.line,
      drawing: stroke ? stroke.points : null,
      blocked,
      ghost: this.phase === 'draw' ? this.ghost : null,
      hint: this.hint && this.phase === 'draw' && !stroke ? this.hint : null,
      particles: this.particles,
      dropCue: this.phase === 'draw' && !stroke,
      lowInk: !!stroke && stroke.inkLeft < level.ink * 0.15,
      staticDrawn: true,
    });
    this.renderHud();
    if (this.phase === 'won' && this.phaseTime > WIN_CARD_DELAY) this.renderWinCard();
    if (this.paused) this.renderPause();
  }

  /** Left and right edge of the HUD: the full width on phones, a column over the playfield on wide screens. */
  private hudSpan(): [number, number] {
    const colW = Math.min(this.W, Math.max(380, WORLD_W * this.view.s + 120));
    return [(this.W - colW) / 2, (this.W + colW) / 2];
  }

  private renderHud(): void {
    const ctx = this.ctx;
    const level = this.level;
    const size = this.btnSize() * 0.85;
    const hy = this.hudH / 2 + 2;
    const [hl, hr] = this.hudSpan();
    this.button(hl + size * 0.8, hy, size, 'pause', () => (this.paused = true));
    this.button(hr - size * 0.8, hy, size, 'retry', () => this.resetAttempt());
    if (this.failCount >= HINT_AFTER_FAILS && this.phase === 'draw' && !this.hint) {
      this.button(hr - size * 0.8, hy + size * 1.25, size * 0.85, 'hint', () => (this.hint = { path: level.hint, t: 0 }));
    }

    // Ink meter with star thresholds.
    const used = this.stroke ? this.stroke.length : this.phase === 'draw' ? 0 : this.inkUsed;
    const frac = Math.max(0, 1 - used / level.ink);
    const mw = Math.min(hr - hl - size * 3.6, 300);
    const mh = Math.max(12, size * 0.32);
    const mx = this.W / 2 - mw / 2;
    const my = hy + size * 0.12;
    this.text(this.ref.label, this.W / 2, hy - size * 0.36, size * 0.36, UI_DARK);
    ctx.fillStyle = 'rgba(31,42,68,0.25)';
    roundRect(ctx, mx, my, mw, mh, mh / 2);
    ctx.fill();
    ctx.fillStyle = frac > 0.35 ? '#3d7bff' : frac > 0.15 ? '#ff9f1c' : '#e74c3c';
    if (frac > 0) {
      roundRect(ctx, mx, my, Math.max(mh, mw * frac), mh, mh / 2);
      ctx.fill();
    }
    const stars = used <= level.stars[0] + 1e-9 ? 3 : used <= level.stars[1] + 1e-9 ? 2 : 1;
    for (const [k, thr] of [
      [3, level.stars[0]],
      [2, level.stars[1]],
    ] as const) {
      const tx = mx + mw * (1 - thr / level.ink);
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(tx - 1.5, my, 3, mh);
      drawStar(ctx, tx, my + mh + mh * 0.55, mh * 0.5, stars >= k ? STAR_ON : STAR_OFF);
    }
    drawStar(ctx, mx + mh * 0.5, my + mh + mh * 0.55, mh * 0.5, STAR_ON);
  }

  private renderWinCard(): void {
    const ctx = this.ctx;
    const t = this.phaseTime - WIN_CARD_DELAY;
    const k = Math.min(1, t / 0.25);
    const ease = 1 - (1 - k) * (1 - k);
    ctx.fillStyle = `rgba(31,42,68,${0.35 * ease})`;
    ctx.fillRect(0, 0, this.W, this.H);
    const size = this.btnSize();
    const cw = Math.min(this.W * 0.86, 360);
    const ch = size * 4.6;
    const cx = this.W / 2;
    const cy = this.H / 2 + (1 - ease) * 40;
    ctx.globalAlpha = ease;
    ctx.fillStyle = 'rgba(31,42,68,0.25)';
    roundRect(ctx, cx - cw / 2, cy - ch / 2 + 6, cw, ch, 28);
    ctx.fill();
    ctx.fillStyle = UI_LIGHT;
    roundRect(ctx, cx - cw / 2, cy - ch / 2, cw, ch, 28);
    ctx.fill();
    this.text(this.ref.label, cx, cy - ch / 2 + size * 0.6, size * 0.45, 'rgba(31,42,68,0.6)');
    for (let i = 0; i < 3; i++) {
      const appear = Math.max(0, Math.min(1, (t - 0.2 - i * 0.22) / 0.2));
      const on = i < this.result.stars;
      const r = size * (i === 1 ? 0.62 : 0.5) * (on ? 0.6 + 0.4 * appear + Math.sin(appear * Math.PI) * 0.25 : 1);
      drawStar(ctx, cx + (i - 1) * size * 1.25, cy - size * (i === 1 ? 0.55 : 0.4), r, on && appear > 0 ? STAR_ON : STAR_OFF, on && appear > 0 ? '#c98f00' : undefined);
    }
    ctx.globalAlpha = 1;
    if (t > 0.3) {
      const by = cy + ch / 2 - size * 1.05;
      this.button(cx - size * 1.35, by, size, 'retry', () => this.resetAttempt());
      this.button(cx, by, size, 'grid', () => this.goSelect(this.ref.world));
      this.button(cx + size * 1.45, by, size * 1.25, 'next', () => this.nextLevel(), 'primary');
    }
  }

  private renderPause(): void {
    const ctx = this.ctx;
    this.buttons = [];
    ctx.fillStyle = 'rgba(31,42,68,0.5)';
    ctx.fillRect(0, 0, this.W, this.H);
    const size = this.btnSize();
    const cx = this.W / 2;
    const cy = this.H / 2;
    this.button(cx, cy - size * 0.8, size * 1.8, 'play', () => (this.paused = false), 'primary');
    this.button(cx - size * 1.4, cy + size * 1.2, size, 'home', () => this.goTitle());
    this.button(cx, cy + size * 1.2, size, 'grid', () => this.goSelect(this.ref.world));
    this.button(cx + size * 1.4, cy + size * 1.2, size, this.save.sfx ? 'soundOn' : 'soundOff', () => this.toggleSound());
  }
}
