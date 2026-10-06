import { WORLD_W, starsFor, type LevelDef, type Pt, type WorldDef } from '../levels/types';
import { dist, polylineLength } from '../sim/geometry';
import { DT, Sim, type SimEvent } from '../sim/sim';
import { Stroke, traceStroke } from '../sim/stroke';
import type { Platform } from '../platform/platform';
import { drawIcon, drawStar, type IconName } from '../render/icons';
import { drawLogo } from '../render/logo';
import { drawBackground, drawBall, drawParticles, drawScene, drawStatic, fitView, roundRect, stepParticles, type Particle, type View } from '../render/scene';
import { FONT, STAR_OFF, STAR_ON, THEMES, UI_DARK, UI_GREEN, UI_GREEN_DARK, UI_LIGHT, type BallSkin, type InkSkin, type Theme } from '../render/theme';
import { Sfx } from './audio';
import { BALL_SKINS, INK_SKINS, currentBall, currentInk, isUnlocked, markSeen, newUnlocks, type Cosmetic } from './cosmetics';
import { currentStreak, dailyDone, dailyIndex, dayNumber, recordDaily } from './daily';
import { continueIndex, flatten, unlockedMask, type LevelRef } from './progress';
import { emptySave, isFresh, recordWin, serializeSave, totalStars, type SaveData } from './save';
import { T } from './strings';

type Screen = 'title' | 'select' | 'play' | 'looks';
type Phase = 'draw' | 'roll' | 'won' | 'failed';
type Mode = 'campaign' | 'daily';
type ButtonStyle = 'light' | 'primary' | 'gold';

interface Button {
  x: number;
  y: number;
  r: number;
  /** Set for pill buttons, which are hit-tested as rectangles. */
  w?: number;
  h?: number;
  action: () => void;
}

/** Where the play screen's HUD parts go; see Game.hudLayout(). */
interface HudLayout {
  size: number;
  hy: number;
  hl: number;
  hr: number;
  hint: boolean;
  skip: boolean;
  hintX: number;
  skipX: number;
  mid: number;
  mx: number;
  my: number;
  mw: number;
  mh: number;
}

const FAIL_RESET = 0.8;
const WIN_CARD_DELAY = 0.9;
/** Misses before the hint button appears: sooner on the first levels, where players give up fastest. */
const HINT_AFTER_FAILS_EARLY = 2;
const HINT_AFTER_FAILS = 3;
const EARLY_LEVELS = 15;
/** Misses before the skip button appears (the unlock rules already let a player skip 2 levels). */
const SKIP_AFTER_FAILS = 4;
/** Seconds the win card waits before moving on by itself; longer when it shows a new look. */
const AUTO_NEXT = 1.8;
const AUTO_NEXT_UNLOCK = 3.5;
/** A card ignores taps for this long after it appears, so a double tap can't skip it unseen. */
const CARD_TAP_DELAY = 0.5;
/** Ink within this much of the hint's length earns the gold-ink medal. */
const GOLD_SLACK = 0.05;
const MAX_STEPS_PER_FRAME = 12;
/** Canvas resolution steps, as a fraction of the device's pixel ratio (capped at 2). */
const QUALITY_STEPS = [1, 0.75, 0.625, 0.5];
/** Never render below this many canvas pixels per CSS pixel. */
const MIN_DPR = 1;
/** Frames per quality check, and the median frame time (ms) that triggers a step down. */
const QUALITY_WINDOW = 45;
const SLOW_FRAME_MS = 22;
const DEMO_TRACE = 1.8;
/** Positions kept for each ball's motion trail, and the speed (units/s) above which it shows. */
const TRAIL_LEN = 8;
const TRAIL_SPEED = 6;
/** Slow motion right after a ball drops in: how long (s) and how slow. Pacing only; the sim is unchanged. */
const SLOWMO = 0.4;
const SLOWMO_SCALE = 0.35;
/** Fade-in after changing screens or levels (s). */
const FADE = 0.25;
const GOLD = '#e0a800';
const GREEN = UI_GREEN;

export class Game {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly levels: LevelRef[];
  private readonly sfx = new Sfx();
  /** Index of the first level with more than one ball, which gets its own tip. */
  private readonly firstMultiBall: number;
  private save: SaveData = emptySave();
  private ready = false;
  private canPersist = true;
  private lastScore = 0;
  private hintInkCache = new Map<string, number>();

  private W = 0;
  private H = 0;
  private dpr = 1;
  private view: View = { ox: 0, oy: 0, s: 1 };
  private hudH = 60;
  /** Title screen: where the demo level is drawn, and where the logo and buttons go. */
  private titleView: View = { ox: 0, oy: 0, s: 1 };
  private titleUI = { cx: 0, logoY: 0, logo: 40, playY: 0 };

  private time = 0;
  private lastNow = 0;
  /** Index into QUALITY_STEPS. Only ever goes down (to a lower resolution) during a session. */
  private quality = 0;
  private frameTimes: number[] = [];
  /** Sky, hills and the current level's static layer, painted once per level and screen size. */
  private layer: HTMLCanvasElement | null = null;
  private layerKey = '';
  /** The layer plus the HUD's fixed parts: what every frame starts by copying to the screen. */
  private backdrop: HTMLCanvasElement | null = null;
  private backdropKey = '';
  private rafId = 0;
  private systemPaused = false;

  private screen: Screen = 'title';
  private buttons: Button[] = [];
  private selectWorld = 0;
  private fade = 0;

  // Play state.
  private mode: Mode = 'campaign';
  private cur = 0;
  /** Today's Daily Hole while mode is 'daily'. Its `world` is the theme to draw it with. */
  private dailyRef: LevelRef | null = null;
  private today = 0;
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
  private hintUsed = false;
  private result = { stars: 0, gold: false, starsFrom: 0, starsTo: 0, unlocks: [] as Cosmetic[] };
  private autoNext = false;
  /** Seconds the current win card waits before moving on (AUTO_NEXT or AUTO_NEXT_UNLOCK). */
  private autoNextAfter = AUTO_NEXT;
  /** Shown instead of the win card once a world's last level is done. */
  private worldDone: { world: number; t: number } | null = null;
  private paused = false;
  private particles: Particle[] = [];
  /** Confetti that falls in front of the win card. */
  private overlayParticles: Particle[] = [];
  private trails: Pt[][] = [];
  private squash: number[] = [];
  private slowmo = 0;

  private starsPopped = 0;
  private showered = false;

  // Title demo: a finger draws level 1's solution, then the ball rolls in. Loops.
  private demo: { sim: Sim | null; t: number; acc: number; done: number; line: Pt[] } | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly platform: Platform,
    private readonly worlds: WorldDef[],
    private readonly dailyLevels: LevelDef[] = [],
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D not available');
    this.ctx = ctx;
    this.levels = flatten(worlds);
    this.firstMultiBall = this.levels.findIndex((r) => r.level.balls.length > 1);
    this.setScreen('title');
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
    // First session: straight into level 1, where the ghost finger teaches the game. The title
    // screen, with the Daily Hole and the level grid, waits until there is something to come back to.
    if (isFresh(save) && this.levels.length) this.openLevel(0);
  }

  // ---------------------------------------------------------------- lifecycle

  private setScreen(s: Screen): void {
    if (this.screen !== s) this.fade = 1;
    this.screen = s;
    // Lets tests and tools see where the game is without reading pixels.
    this.canvas.dataset.screen = s;
  }

  private setPhase(p: Phase): void {
    this.phase = p;
    this.phaseTime = 0;
    this.canvas.dataset.phase = p;
  }

  private setSystemPaused(p: boolean): void {
    if (this.systemPaused === p) return;
    this.systemPaused = p;
    this.sfx.setPaused(p);
    if (p) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
      this.cancelStroke();
      this.platform.setGameplay(false);
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
    // Title: logo and buttons beside the demo on wide screens, above and below it on tall ones.
    const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
    if (W > H * 1.15) {
      this.titleView = fitView(W * 0.5, pad, W * 0.5 - pad * 2, H - pad * 2);
      this.titleUI = { cx: W * 0.26, logoY: H * 0.27, logo: clamp(W * 0.065, 34, 84), playY: H * 0.58 };
    } else {
      this.titleView = fitView(pad, H * 0.19, W - pad * 2, H * 0.55);
      this.titleUI = { cx: W / 2, logoY: H * 0.09, logo: clamp(W * 0.115, 32, 72), playY: H * 0.8 };
    }
    if (this.rafId === 0 && !this.systemPaused) this.render();
  }

  private frame(now: number): void {
    this.rafId = 0;
    if (this.systemPaused) return;
    const dt = Math.min(0.1, Math.max(0, (now - this.lastNow) / 1000));
    this.lastNow = now;
    this.trackFrameTime(dt * 1000);
    this.update(dt);
    this.platform.setGameplay(this.screen === 'play' && !this.paused && this.phase !== 'won' && !this.worldDone);
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
    return this.mode === 'daily' && this.dailyRef ? this.dailyRef : this.levels[this.cur];
  }

  private get level(): LevelDef {
    return this.ref.level;
  }

  private get theme(): Theme {
    return THEMES[this.ref.world % THEMES.length];
  }

  private get ballSkin(): BallSkin {
    return currentBall(this.save);
  }

  private get inkSkin(): InkSkin {
    return currentInk(this.save);
  }

  /** Ink the stored hint uses: the bar for the gold-ink medal. */
  private hintInk(level: LevelDef): number {
    let v = this.hintInkCache.get(level.id);
    if (v === undefined) {
      v = traceStroke(level, level.hint).ink;
      this.hintInkCache.set(level.id, v);
    }
    return v;
  }

  private hasGold(level: LevelDef): boolean {
    const best = this.save.ink[level.id];
    return best !== undefined && best <= this.hintInk(level) + GOLD_SLACK;
  }

  private openLevel(i: number): void {
    this.mode = 'campaign';
    this.cur = i;
    this.beginPlay();
    // The very first level teaches itself: a finger draws the solution until the player tries.
    this.hint = i === 0 && !this.save.stars[this.level.id] ? { path: this.level.hint, t: 0 } : null;
  }

  private openDaily(): void {
    this.today = dayNumber();
    const idx = dailyIndex(this.today, this.dailyLevels.length);
    if (idx < 0) return;
    const level = this.dailyLevels[idx];
    this.mode = 'daily';
    this.dailyRef = { world: level.theme ?? 0, index: idx, level, label: '' };
    this.beginPlay();
  }

  private beginPlay(): void {
    this.setScreen('play');
    this.canvas.dataset.level = this.level.id;
    this.fade = 1;
    this.paused = false;
    this.line = null;
    this.failCount = 0;
    this.hintUsed = false;
    this.particles = [];
    this.overlayParticles = [];
    this.worldDone = null;
    this.autoNext = false;
    this.resetAttempt();
    this.ghost = null;
    this.hint = null;
  }

  private resetAttempt(): void {
    if (this.line) this.ghost = this.line;
    this.setPhase('draw');
    this.sim = null;
    this.line = null;
    this.stroke = null;
    this.acc = 0;
    this.trails = [];
    this.squash = [];
    this.slowmo = 0;
  }

  private drop(line: Pt[] | null): void {
    this.line = line;
    this.inkUsed = line ? polylineLength(line) : 0;
    this.sim = new Sim(this.level, line);
    this.setPhase('roll');
    this.acc = 0;
    this.trails = this.level.balls.map(() => []);
    this.squash = this.level.balls.map(() => 0);
  }

  private onWin(): void {
    this.setPhase('won');
    const level = this.level;
    const stars = starsFor(level, this.inkUsed);
    const starsFrom = totalStars(this.save);
    let changed: boolean;
    if (this.mode === 'daily') {
      changed = recordDaily(this.save, this.today, stars);
      // Daily results also count towards the level id, so stars and gold show when the hole returns.
      changed = recordWin(this.save, level.id, stars, this.inkUsed) || changed;
    } else changed = recordWin(this.save, level.id, stars, this.inkUsed);
    const unlocks = newUnlocks(this.save);
    if (markSeen(this.save, unlocks)) changed = true;
    this.result = { stars, gold: this.inkUsed <= this.hintInk(level) + GOLD_SLACK, starsFrom, starsTo: totalStars(this.save), unlocks };
    this.starsPopped = 0;
    this.showered = false;
    if (changed) this.persist();
    if (stars === 3) this.platform.celebrate();
    this.sfx.win(stars);
    if (unlocks.length) this.sfx.unlockJingle();
    this.failCount = 0;
    // Move on by itself, a little later when there is a new look to see. After a world's last level
    // that leads to the world card, which then waits for a tap.
    const n = this.cur + 1;
    this.autoNext = this.mode === 'campaign' && (this.isLastOfWorld() || (n < this.levels.length && unlockedMask(this.levels, this.save)[n]));
    this.autoNextAfter = unlocks.length ? AUTO_NEXT_UNLOCK : AUTO_NEXT;
  }

  private onFail(): void {
    this.setPhase('failed');
    this.failCount++;
    this.sfx.fail();
    // Say what went wrong, just above the ball.
    const reason = this.sim?.failReason;
    if (!reason || !this.sim) return;
    const views = this.sim.ballViews();
    const b = views.find((v) => !v.sunk) ?? views[0];
    const x = Math.max(1.2, Math.min(WORLD_W - 1.2, b.x));
    const y = Math.max(1.5, Math.min(12.5, b.y - 0.8));
    this.particles.push({ x, y, vx: 0, vy: -1.2, life: 0.9, max: 0.9, size: 0.62, color: reason === 'water' ? '#bfe6ff' : UI_LIGHT, kind: 'text', text: T.fail[reason], rot: 0, vr: 0, gravity: 0 });
  }

  private isLastOfWorld(): boolean {
    return this.mode === 'campaign' && this.ref.index === this.worlds[this.ref.world].levels.length - 1;
  }

  private nextLevel(): void {
    this.autoNext = false;
    if (this.mode === 'daily') {
      this.goTitle();
      return;
    }
    if (this.isLastOfWorld()) {
      this.worldDone = { world: this.ref.world, t: 0 };
      return;
    }
    const n = this.cur + 1;
    const open = unlockedMask(this.levels, this.save);
    if (n < this.levels.length && open[n]) this.openLevel(n);
    else this.goSelect(this.ref.world);
  }

  /** From the world card: on to the next world's first level, or to the looks after the last world. */
  private leaveWorldDone(): void {
    const wd = this.worldDone;
    if (!wd) return;
    const next = wd.world + 1;
    if (next >= this.worlds.length) {
      this.goLooks();
      return;
    }
    const first = this.levels.findIndex((r) => r.world === next);
    if (unlockedMask(this.levels, this.save)[first]) this.openLevel(first);
    else this.goSelect(next);
  }

  /** Leaves a level the player is stuck on. The unlock rules already allow two unsolved levels. */
  private skipLevel(): void {
    const n = this.cur + 1;
    if (this.mode !== 'campaign' || n >= this.levels.length || !unlockedMask(this.levels, this.save)[n]) return;
    this.openLevel(n);
  }

  private canSkip(): boolean {
    const n = this.cur + 1;
    return this.mode === 'campaign' && this.failCount >= SKIP_AFTER_FAILS && n < this.levels.length && unlockedMask(this.levels, this.save)[n];
  }

  private hintAfter(): number {
    return this.mode === 'campaign' && this.cur < EARLY_LEVELS ? HINT_AFTER_FAILS_EARLY : HINT_AFTER_FAILS;
  }

  /** Shows the hint: a finger tracing a line that works. Starts a fresh attempt if the ball is rolling. */
  private showHint(): void {
    if (this.phase !== 'draw') this.resetAttempt();
    this.hint = { path: this.level.hint, t: 0 };
    this.hintUsed = true;
  }

  private goSelect(world?: number): void {
    this.setScreen('select');
    this.paused = false;
    this.worldDone = null;
    if (world !== undefined) this.selectWorld = world;
  }

  private goTitle(): void {
    this.setScreen('title');
    this.paused = false;
    this.worldDone = null;
    this.demo = null;
  }

  private goLooks(): void {
    this.setScreen('looks');
    this.paused = false;
  }

  private toggleSound(): void {
    this.save.sfx = !this.save.sfx;
    this.applyAudio();
    this.persist();
    this.sfx.unlock();
    this.sfx.click();
  }

  private chooseLook(c: Cosmetic): void {
    if (!isUnlocked(c, this.save)) return;
    if (c.kind === 'ball') this.save.look.ball = c.id;
    else this.save.look.ink = c.id;
    this.persist();
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
      if (b.w !== undefined && b.h !== undefined) {
        if (Math.abs(x - b.x) <= b.w / 2 + 6 && Math.abs(y - b.y) <= b.h / 2 + 6) return b;
      } else if (Math.hypot(x - b.x, y - b.y) <= b.r * 1.15) return b;
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
    if (this.worldDone) {
      // A tap on the world card (outside its buttons) goes on to the next world.
      if (this.worldDone.t > CARD_TAP_DELAY) this.leaveWorldDone();
      return;
    }
    if (this.phase === 'won') {
      // The ball is in. A tap during the celebration brings the card up now; a tap on the card
      // (outside its buttons) moves on. Retry has its own button.
      const t = this.phaseTime - WIN_CARD_DELAY;
      if (t < 0) this.phaseTime = WIN_CARD_DELAY;
      else if (t > CARD_TAP_DELAY) this.nextLevel();
      return;
    }
    // Starting over while the ball is still rolling is a miss the player saw coming.
    if (this.phase === 'roll' && this.phaseTime > 0.4) this.failCount++;
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
    const grew = this.stroke.length > before;
    if (this.lastFinger) {
      const dt = Math.max(0.016, this.time - this.lastFinger.t);
      this.sfx.drawMove(grew ? dist(this.lastFinger.p, p) / dt : 0);
    }
    if (grew) {
      // A few sparks trail the pen tip.
      const tip = this.stroke.points[this.stroke.points.length - 1];
      const a = Math.random() * Math.PI * 2;
      this.particles.push({ x: tip[0], y: tip[1], vx: Math.cos(a) * 0.8, vy: Math.sin(a) * 0.8, life: 0.3, max: 0.3, size: 0.05, color: 'rgba(255,255,255,0.95)', kind: 'dot', rot: 0, vr: 0, gravity: 2 });
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
      // Dev shortcuts: [ ] switch level, H shows the hint, W wins instantly, D opens today's Daily Hole.
      if (e.key === ']') this.openLevel(Math.min(this.levels.length - 1, this.cur + 1));
      if (e.key === '[') this.openLevel(Math.max(0, this.cur - 1));
      if (e.key === 'h') this.showHint();
      if (e.key === 'w') this.drop(traceStroke(this.level, this.level.hint).line);
      if (e.key === 'd') this.openDaily();
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
    this.fade = Math.max(0, this.fade - dt / FADE);
    stepParticles(this.particles, dt);
    stepParticles(this.overlayParticles, dt);
    this.sfx.musicTick();
    if (this.screen === 'title') this.updateDemo(dt);
    if (this.screen !== 'play' || this.paused) return;
    if (this.worldDone) {
      this.worldDone.t += dt;
      return;
    }
    this.phaseTime += dt;
    if (this.hint) {
      this.hint.t += dt / Math.max(1.6, polylineLength(this.hint.path) * 0.35);
      if (this.hint.t > 1.25) this.hint.t = 0;
    }
    for (let i = 0; i < this.squash.length; i++) this.squash[i] *= Math.exp(-dt * 14);
    if (this.sim && this.phase !== 'draw') {
      this.acc += dt * (this.slowmo > 0 ? SLOWMO_SCALE : 1);
      this.slowmo = Math.max(0, this.slowmo - dt);
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
      this.updateTrails();
    }
    if (this.phase === 'failed' && this.phaseTime > FAIL_RESET) this.resetAttempt();
    if (this.phase === 'won') {
      const t = this.phaseTime - WIN_CARD_DELAY;
      while (this.starsPopped < this.result.stars && t >= 0.35 + this.starsPopped * 0.22) this.sfx.starPop(this.starsPopped++);
      if (!this.showered && t >= 0.35 && this.result.stars === 3) {
        this.showered = true;
        this.confettiShower();
      }
      if (this.autoNext && t >= this.autoNextAfter) this.nextLevel();
    }
  }

  private updateTrails(): void {
    if (!this.sim) return;
    this.sim.ballViews().forEach((b, i) => {
      const trail = this.trails[i];
      if (!trail) return;
      if (!b.sunk && !b.lost && Math.hypot(b.vx, b.vy) > TRAIL_SPEED) {
        trail.push([b.x, b.y]);
        if (trail.length > TRAIL_LEN) trail.shift();
      } else if (trail.length) trail.shift();
    });
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
        if (ev.strength > 4) this.burst(ev.x, ev.y + 0.2, 5, 'rgba(255,255,255,0.85)', 1.4, 0.35);
        if (ev.strength > 3) this.squashNearest(ev.x, ev.y, Math.min(0.26, ev.strength * 0.022));
      } else if (ev.kind === 'bounce') {
        this.sfx.bounce();
        this.ring(ev.x, ev.y, '#ff5d8f');
        this.squashNearest(ev.x, ev.y, 0.22);
      } else if (ev.kind === 'sink') {
        this.sfx.sink();
        this.confetti(ev.x, ev.y);
        this.ring(ev.x, ev.y - 0.1, '#ffffff');
        this.slowmo = SLOWMO;
      } else if (ev.kind === 'splash') {
        this.sfx.splash();
        this.burst(ev.x, ev.y, 16, '#bfe6ff', 3.8, 0.7, -5);
      } else if (ev.kind === 'out') {
        this.ring(Math.max(0.3, Math.min(9.7, ev.x)), Math.min(13.7, ev.y), 'rgba(31,42,68,0.5)');
      }
    }
  }

  private squashNearest(x: number, y: number, amount: number): void {
    if (!this.sim) return;
    let best = -1;
    let bd = Infinity;
    this.sim.ballViews().forEach((b, i) => {
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0) this.squash[best] = Math.max(this.squash[best] ?? 0, amount);
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

  /** Confetti raining from the top of the screen, in front of the win card. */
  private confettiShower(): void {
    const colors = ['#ff4d4d', '#ffc531', '#2ecc71', '#3498db', '#9b59b6', '#ff8a3d'];
    const v = this.view;
    const left = -v.ox / v.s;
    const width = this.W / v.s;
    const top = -v.oy / v.s;
    for (let i = 0; i < 70; i++) {
      this.overlayParticles.push({
        x: left + Math.random() * width,
        y: top - Math.random() * 3,
        vx: (Math.random() - 0.5) * 2,
        vy: 2 + Math.random() * 3,
        life: 2.6 + Math.random(),
        max: 3.6,
        size: 0.09 + Math.random() * 0.06,
        color: colors[i % colors.length],
        kind: 'confetti',
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 10,
        gravity: 3,
      });
    }
  }

  // ---------------------------------------------------------------- render

  private render(): void {
    const ctx = this.ctx;
    this.buttons = [];
    const worldIdx = this.screen === 'play' ? this.ref.world : this.screen === 'select' ? this.selectWorld : 0;
    const level = this.screen === 'play' ? this.level : this.screen === 'title' ? this.levels[0]?.level : undefined;
    const hud = this.screen === 'play' ? this.hudLayout() : null;
    this.paintBackdrop(THEMES[worldIdx % THEMES.length], level, this.screen === 'title' ? this.titleView : this.view, hud);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.screen === 'title') this.renderTitle();
    else if (this.screen === 'select') this.renderSelect();
    else if (this.screen === 'looks') this.renderLooks();
    else this.renderPlay();
    if (this.fade > 0) {
      ctx.fillStyle = `rgba(31,42,68,${(0.5 * this.fade).toFixed(3)})`;
      ctx.fillRect(0, 0, this.W, this.H);
    }
  }

  /** Copies the cached backdrop (sky, level, fixed HUD parts) onto the canvas, repainting it if needed. */
  private paintBackdrop(theme: Theme, level: LevelDef | undefined, view: View, hud: HudLayout | null): void {
    const { canvas, ctx } = this;
    const layerKey = `${THEMES.indexOf(theme)}|${level?.id ?? '-'}|${this.W}x${this.H}|${canvas.width}x${canvas.height}|${view.ox},${view.oy},${view.s}`;
    const hudKey = hud ? `${this.mode === 'daily' ? `daily${this.today}` : this.cur}|${hud.hint}|${hud.skip}` : '';
    const key = `${layerKey}#${hudKey}`;
    if (key !== this.backdropKey || !this.backdrop) {
      if (!this.repaintBackdrop(theme, level, view, hud, layerKey)) {
        // No offscreen canvas available: draw everything directly every frame.
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        drawBackground(ctx, this.W, this.H, theme, 0);
        if (level) drawStatic(ctx, view, level, theme);
        if (hud) this.drawHudChrome(ctx, hud);
        return;
      }
      this.backdropKey = key;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.backdrop!, 0, 0);
  }

  /**
   * Rebuilds the backdrop: the level layer (only repainted when the level or size changes, since its
   * texture is slow to draw) with the HUD's fixed parts on top. Returns false without offscreen canvases.
   */
  private repaintBackdrop(theme: Theme, level: LevelDef | undefined, view: View, hud: HudLayout | null, layerKey: string): boolean {
    const sized = (c: HTMLCanvasElement | null) => {
      const out = c ?? document.createElement('canvas');
      if (out.width !== this.canvas.width) out.width = this.canvas.width;
      if (out.height !== this.canvas.height) out.height = this.canvas.height;
      return out;
    };
    const layer = sized(this.layer);
    const backdrop = sized(this.backdrop);
    const lc = layer.getContext('2d');
    const bc = backdrop.getContext('2d');
    if (!lc || !bc) return false;
    if (layer !== this.layer || layerKey !== this.layerKey) {
      lc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      drawBackground(lc, this.W, this.H, theme, 0);
      if (level) drawStatic(lc, view, level, theme);
      this.layer = layer;
      this.layerKey = layerKey;
    }
    bc.setTransform(1, 0, 0, 1, 0, 0);
    bc.drawImage(layer, 0, 0);
    if (hud) {
      bc.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      this.drawHudChrome(bc, hud);
    }
    this.backdrop = backdrop;
    return true;
  }

  private btnSize(): number {
    return Math.round(Math.max(40, Math.min(56, Math.min(this.W, this.H) * 0.11)));
  }

  /** Round icon button with a raised edge. */
  private button(x: number, y: number, size: number, icon: IconName, action: () => void, style: ButtonStyle = 'light'): void {
    this.paintButton(this.ctx, x, y, size, icon, style);
    this.buttons.push({ x, y, r: size / 2, action });
  }

  private paintButton(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, icon: IconName, style: ButtonStyle): void {
    const r = size / 2;
    const depth = Math.max(2, size * 0.07);
    const [face, edge, ink] = this.buttonColors(style);
    ctx.fillStyle = 'rgba(31,42,68,0.22)';
    ctx.beginPath();
    ctx.arc(x, y + depth + 2, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = edge;
    ctx.beginPath();
    ctx.arc(x, y + depth, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    drawIcon(ctx, icon, x, y, size * 0.5, ink);
  }

  /** Rounded pill button with a label and an optional icon. */
  private pill(cx: number, cy: number, w: number, h: number, label: string, icon: IconName | null, action: () => void, style: ButtonStyle = 'light'): void {
    const ctx = this.ctx;
    const depth = Math.max(3, h * 0.09);
    const [face, edge, ink] = this.buttonColors(style);
    ctx.fillStyle = 'rgba(31,42,68,0.22)';
    roundRect(ctx, cx - w / 2, cy - h / 2 + depth + 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = edge;
    roundRect(ctx, cx - w / 2, cy - h / 2 + depth, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = face;
    roundRect(ctx, cx - w / 2, cy - h / 2, w, h, h / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    roundRect(ctx, cx - w / 2 + h * 0.25, cy - h / 2 + h * 0.1, w - h * 0.5, h * 0.28, h * 0.14);
    ctx.fill();
    const fs = h * 0.44;
    ctx.font = `700 ${Math.round(fs)}px ${FONT}`;
    const tw = ctx.measureText(label).width;
    const iw = icon ? fs * 1.05 : 0;
    const gap = icon ? fs * 0.35 : 0;
    const x0 = cx - (tw + iw + gap) / 2;
    if (icon) drawIcon(ctx, icon, x0 + iw / 2, cy, fs * 1.05, ink);
    this.text(label, x0 + iw + gap, cy + fs * 0.05, fs, ink, 'left');
    this.buttons.push({ x: cx, y: cy, r: h / 2, w, h, action });
  }

  private buttonColors(style: ButtonStyle): [string, string, string] {
    if (style === 'primary') return [UI_GREEN, UI_GREEN_DARK, UI_LIGHT];
    if (style === 'gold') return ['#ffc531', '#d18f00', UI_DARK];
    return [UI_LIGHT, '#c3cee3', UI_DARK];
  }

  private text(str: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center', weight = 700): void {
    const ctx = this.ctx;
    ctx.font = `${weight} ${Math.round(size)}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  /** Chunky outlined text with a drop shadow, for headlines. */
  private textOutlined(str: string, x: number, y: number, size: number, fill: string): void {
    const ctx = this.ctx;
    ctx.font = `700 ${Math.round(size)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.2;
    ctx.strokeStyle = 'rgba(31,42,68,0.35)';
    ctx.strokeText(str, x, y + size * 0.09);
    ctx.fillStyle = 'rgba(31,42,68,0.35)';
    ctx.fillText(str, x, y + size * 0.09);
    ctx.strokeStyle = UI_DARK;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(str, x, y);
  }

  /** A small label under a button, readable over any background. */
  private caption(str: string, x: number, y: number, size: number): void {
    const ctx = this.ctx;
    ctx.font = `700 ${Math.round(size)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(3, size * 0.32);
    ctx.strokeStyle = UI_DARK;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = UI_LIGHT;
    ctx.fillText(str, x, y);
  }

  /** A small round badge on the corner of a button: a check for "done", a dot for "new today". */
  private badge(x: number, y: number, r: number, icon: IconName | null, color: string): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = UI_LIGHT;
    ctx.lineWidth = Math.max(1.5, r * 0.18);
    ctx.stroke();
    if (icon) drawIcon(ctx, icon, x, y, r * 1.3, UI_LIGHT);
  }

  /** A progress bar with a count: "7/12" holes in a world. */
  private progressBar(x: number, y: number, w: number, h: number, done: number, total: number, color = GREEN): void {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(31,42,68,0.18)';
    roundRect(ctx, x, y, w, h, h / 2);
    ctx.fill();
    if (done > 0) {
      ctx.fillStyle = color;
      roundRect(ctx, x, y, Math.max(h, (w * done) / Math.max(1, total)), h, h / 2);
      ctx.fill();
    }
    this.text(`${done}/${total}`, x + w + h * 0.6, y + h / 2, h * 1.25, UI_DARK, 'left');
  }

  private renderTitle(): void {
    const ctx = this.ctx;
    const first = this.levels[0]?.level;
    if (first && this.demo) {
      const d = this.demo;
      const hintT = Math.min(1, d.t / DEMO_TRACE) * 0.8;
      drawScene(ctx, this.titleView, {
        level: first,
        theme: THEMES[0],
        time: this.time,
        sim: d.sim,
        line: d.sim ? d.line : null,
        drawing: null,
        blocked: null,
        ghost: null,
        hint: d.sim ? null : { path: d.line, t: hintT },
        particles: [],
        dropCue: false,
        lowInk: false,
        staticDrawn: true,
        ballSkin: this.ballSkin,
        ink: this.inkSkin,
      });
    }

    const { cx, logoY, logo } = this.titleUI;
    drawLogo(ctx, cx, logoY, logo, this.inkSkin.color);
    if (!this.ready) return;

    const size = this.btnSize();
    const py = this.titleUI.playY;
    const pulse = 1 + Math.sin(this.time * 4) * 0.025;
    const pw = Math.min(this.W * 0.62, size * 4.6) * pulse;
    this.pill(cx, py, pw, size * 1.25 * pulse, T.play, 'play', () => this.playContinue(), 'primary');

    // Daily Hole first: the reason to come back tomorrow. Then the level grid and the looks.
    const ry = py + size * 1.6;
    const gap = size * 1.65;
    const bs = size * 0.95;
    const slots: { icon: IconName; label: string; action: () => void }[] = [];
    if (this.dailyLevels.length > 0) slots.push({ icon: 'calendar', label: T.daily, action: () => this.openDaily() });
    slots.push({ icon: 'grid', label: T.levels, action: () => this.goSelect() }, { icon: 'palette', label: T.looks, action: () => this.goLooks() });
    slots.forEach((slot, i) => {
      const x = cx + (i - (slots.length - 1) / 2) * gap;
      this.button(x, ry, bs, slot.icon, slot.action);
      this.caption(slot.label, x, ry + bs * 0.85, size * 0.27);
      if (slot.icon === 'calendar') {
        const today = dayNumber();
        if (dailyDone(this.save, today)) this.badge(x + bs * 0.38, ry - bs * 0.38, size * 0.17, 'check', GREEN);
        else this.badge(x + bs * 0.38, ry - bs * 0.38, size * 0.11, null, THEMES[0].accent);
        const streak = currentStreak(this.save, today);
        if (streak > 0) {
          // The day streak, on a little tag at the button's top left.
          const tw = size * 0.72;
          const th = size * 0.36;
          const tx = x - bs * 0.45 - tw / 2;
          const ty = ry - bs * 0.4;
          ctx.fillStyle = UI_LIGHT;
          roundRect(ctx, tx - tw / 2, ty - th / 2, tw, th, th / 2);
          ctx.fill();
          drawIcon(ctx, 'flame', tx - tw * 0.18, ty, th * 0.8, '#ff7a1f');
          this.text(`${streak}`, tx + tw * 0.05, ty + 1, th * 0.7, UI_DARK, 'left');
        }
      } else if (slot.icon === 'palette' && newUnlocks(this.save).length) {
        this.badge(x + bs * 0.38, ry - bs * 0.38, size * 0.11, null, THEMES[0].accent);
      }
    });

    // Stars collected (top left) and sound (top right).
    const total = totalStars(this.save);
    const tag = `${total}/${this.levels.length * 3}`;
    const th = size * 0.72;
    ctx.font = `700 ${Math.round(th * 0.5)}px ${FONT}`;
    const tw = ctx.measureText(tag).width + th * 1.5;
    const pad = Math.max(10, size * 0.3);
    ctx.fillStyle = 'rgba(31,42,68,0.55)';
    roundRect(ctx, pad, pad, tw, th, th / 2);
    ctx.fill();
    drawStar(ctx, pad + th * 0.5, pad + th / 2, th * 0.32, STAR_ON, '#c98f00');
    this.text(tag, pad + th * 0.95, pad + th / 2 + 1, th * 0.5, UI_LIGHT, 'left');
    this.button(this.W - pad - size * 0.42, pad + size * 0.42, size * 0.84, this.save.sfx ? 'soundOn' : 'soundOff', () => this.toggleSound());
  }

  private worldProgress(wi: number): { done: number; stars: number; total: number } {
    const world = this.worlds[wi];
    let done = 0;
    let stars = 0;
    for (const lv of world.levels) {
      const s = this.save.stars[lv.id] ?? 0;
      if (s) done++;
      stars += s;
    }
    return { done, stars, total: world.levels.length };
  }

  private renderSelect(): void {
    const ctx = this.ctx;
    const size = this.btnSize();
    const wi = this.selectWorld;
    const world = this.worlds[wi];
    const open = unlockedMask(this.levels, this.save);
    const current = continueIndex(this.levels, this.save);
    const firstIdx = this.levels.findIndex((r) => r.world === wi);
    const theme = THEMES[wi % THEMES.length];

    // Header: home, and the world's name between arrows.
    const hy = this.hudH / 2 + 4;
    const [hl] = this.hudSpan();
    this.button(hl + size * 0.75, hy, size * 0.85, 'home', () => this.goTitle());
    const cx = this.W / 2;
    const pw = Math.min(size * 4.4, this.W - size * 5.2);
    if (wi > 0) this.button(cx - pw / 2 - size * 0.62, hy, size * 0.8, 'left', () => (this.selectWorld = wi - 1));
    if (wi < this.worlds.length - 1) this.button(cx + pw / 2 + size * 0.62, hy, size * 0.8, 'right', () => (this.selectWorld = wi + 1));
    const ph = size * 0.92;
    ctx.fillStyle = theme.groundDark;
    roundRect(ctx, cx - pw / 2, hy - ph / 2 + 4, pw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = theme.ground;
    roundRect(ctx, cx - pw / 2, hy - ph / 2, pw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = theme.top;
    roundRect(ctx, cx - pw / 2, hy - ph / 2, pw, ph * 0.3, ph * 0.15);
    ctx.fill();
    this.text(`${wi + 1}. ${world.name.toUpperCase()}`, cx, hy + 2, Math.min(ph * 0.46, (pw / Math.max(6, world.name.length + 3)) * 1.5), UI_LIGHT);

    // Stars and holes done in this world: the next goal, always visible.
    const prog = this.worldProgress(wi);
    const sy = this.hudH + size * 0.32;
    drawStar(ctx, cx - size * 2.1, sy, size * 0.2, STAR_ON, '#c98f00');
    this.text(`${prog.stars}/${prog.total * 3}`, cx - size * 1.83, sy + 1, size * 0.34, UI_DARK, 'left');
    this.progressBar(cx - size * 0.3, sy - size * 0.11, Math.min(size * 2.2, this.W * 0.3), size * 0.22, prog.done, prog.total);

    // Grid of levels.
    const top = this.hudH + size * 0.8;
    const availW = Math.min(this.W - 32, 640);
    const availH = this.H - top - 20;
    const cols = availW > availH ? 4 : 3;
    const rows = Math.ceil(world.levels.length / cols);
    const cell = Math.min(availW / cols, availH / rows, 130);
    const gx = (this.W - cell * cols) / 2;
    const gy = top + (availH - cell * rows) / 2;
    world.levels.forEach((lv, i) => {
      const idx = firstIdx + i;
      const col = i % cols;
      const row = Math.floor(i / cols);
      const unlocked = open[idx];
      const isCurrent = idx === current;
      const stars = this.save.stars[lv.id] ?? 0;
      const pulse = isCurrent ? 1 + Math.sin(this.time * 4) * 0.035 : 1;
      const w = cell * 0.84 * pulse;
      const x = gx + col * cell + (cell - w) / 2;
      const y = gy + row * cell + (cell - w) / 2;
      const depth = w * 0.06;
      ctx.fillStyle = 'rgba(31,42,68,0.2)';
      roundRect(ctx, x, y + depth + 3, w, w, w * 0.2);
      ctx.fill();
      ctx.fillStyle = !unlocked ? 'rgba(31,42,68,0.12)' : isCurrent ? UI_GREEN_DARK : '#c3cee3';
      roundRect(ctx, x, y + depth, w, w, w * 0.2);
      ctx.fill();
      ctx.fillStyle = !unlocked ? 'rgba(255,255,255,0.5)' : isCurrent ? UI_GREEN : UI_LIGHT;
      roundRect(ctx, x, y, w, w, w * 0.2);
      ctx.fill();
      if (unlocked) {
        this.text(`${i + 1}`, x + w / 2, y + w * 0.4, w * 0.38, isCurrent ? UI_LIGHT : UI_DARK);
        for (let k = 0; k < 3; k++) {
          const on = k < stars;
          drawStar(ctx, x + w / 2 + (k - 1) * w * 0.24, y + w * 0.76, w * 0.1, on ? STAR_ON : isCurrent ? 'rgba(255,255,255,0.4)' : STAR_OFF, on ? '#c98f00' : undefined);
        }
        if (stars === 3 && this.hasGold(lv)) drawIcon(ctx, 'drop', x + w * 0.82, y + w * 0.2, w * 0.22, GOLD);
        this.buttons.push({ x: x + w / 2, y: y + w / 2, r: w / 2, action: () => this.openLevel(idx) });
      } else {
        drawIcon(ctx, 'lock', x + w / 2, y + w / 2, w * 0.34, 'rgba(31,42,68,0.4)');
      }
    });
  }

  private renderLooks(): void {
    const ctx = this.ctx;
    const size = this.btnSize();
    const hy = this.hudH / 2 + 4;
    const [hl] = this.hudSpan();
    this.button(hl + size * 0.75, hy, size * 0.85, 'home', () => this.goTitle());
    drawIcon(ctx, 'palette', this.W / 2 - size * 1.25, hy, size * 0.55, UI_DARK);
    this.text(T.looks, this.W / 2 - size * 0.85, hy + 2, size * 0.48, UI_DARK, 'left');
    const total = totalStars(this.save);
    drawStar(ctx, this.W / 2 + size * 1.3, hy, size * 0.22, STAR_ON, '#c98f00');
    this.text(`${total}`, this.W / 2 + size * 1.58, hy + 1, size * 0.34, UI_DARK, 'left');

    const availW = Math.min(this.W - 24, 520);
    const cols = availW > 360 ? 5 : 4;
    const cell = Math.min(availW / cols, 92);
    const gx = (this.W - cell * cols) / 2;
    let y = this.hudH + 14;
    const rowsFor = (n: number) => Math.ceil(n / cols);
    const sections: { items: Cosmetic[]; sample: (c: Cosmetic, x: number, cy: number, r: number) => void }[] = [
      {
        items: BALL_SKINS,
        sample: (c, x, cy, r) => drawBall(ctx, x, cy, r, this.time * 1.5, 0, c as BallSkin),
      },
      {
        items: INK_SKINS,
        sample: (c, x, cy, r) => {
          ctx.strokeStyle = (c as InkSkin).color;
          ctx.lineWidth = Math.max(3, r * 0.3);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(x - r * 1.1, cy + r * 0.5);
          ctx.quadraticCurveTo(x - r * 0.3, cy - r * 1.2, x + r * 0.1, cy);
          ctx.quadraticCurveTo(x + r * 0.5, cy + r, x + r * 1.1, cy - r * 0.5);
          ctx.stroke();
        },
      },
    ];
    for (const sec of sections) {
      const rows = rowsFor(sec.items.length);
      sec.items.forEach((c, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = gx + col * cell + cell * 0.08;
        const cy = y + row * cell * 1.12 + cell * 0.08;
        const w = cell * 0.84;
        const unlocked = isUnlocked(c, this.save);
        const chosen = c.kind === 'ball' ? this.ballSkin.id === c.id : this.inkSkin.id === c.id;
        ctx.fillStyle = 'rgba(31,42,68,0.2)';
        roundRect(ctx, x, cy + w * 0.06, w, w, w * 0.2);
        ctx.fill();
        ctx.fillStyle = unlocked ? UI_LIGHT : 'rgba(255,255,255,0.55)';
        roundRect(ctx, x, cy, w, w, w * 0.2);
        ctx.fill();
        if (chosen) {
          ctx.strokeStyle = GREEN;
          ctx.lineWidth = Math.max(2, w * 0.06);
          roundRect(ctx, x, cy, w, w, w * 0.2);
          ctx.stroke();
        }
        ctx.save();
        if (!unlocked) ctx.globalAlpha = 0.45;
        sec.sample(c, x + w / 2, cy + w / 2, w * 0.26);
        ctx.restore();
        if (unlocked) this.buttons.push({ x: x + w / 2, y: cy + w / 2, r: w / 2, action: () => this.chooseLook(c) });
        else {
          drawIcon(ctx, 'lock', x + w * 0.8, cy + w * 0.2, w * 0.2, 'rgba(31,42,68,0.55)');
          // What unlocks it: a star count or a day streak.
          const ly = cy + w * 1.12;
          if ('stars' in c.unlock) {
            drawStar(ctx, x + w * 0.32, ly, w * 0.1, STAR_ON, '#c98f00');
            this.text(`${c.unlock.stars}`, x + w * 0.46, ly + 1, w * 0.17, UI_DARK, 'left');
          } else {
            drawIcon(ctx, 'flame', x + w * 0.32, ly, w * 0.2, '#ff7a1f');
            this.text(`${c.unlock.streak}`, x + w * 0.46, ly + 1, w * 0.17, UI_DARK, 'left');
          }
        }
      });
      y += rows * cell * 1.12 + cell * 0.25;
    }
  }

  private renderPlay(): void {
    const ctx = this.ctx;
    const level = this.level;
    const stroke = this.stroke;
    let blocked: { from: Pt; to: Pt } | null = null;
    if (stroke && this.finger && stroke.points.length > 0) {
      const last = stroke.points[stroke.points.length - 1];
      if (dist(last, this.finger) > 0.25 && !stroke.empty && !stroke.isClear(last, this.finger)) blocked = { from: last, to: this.finger };
    }
    drawScene(ctx, this.view, {
      level,
      theme: this.theme,
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
      trails: this.trails,
      squash: this.squash,
      ballSkin: this.ballSkin,
      ink: this.inkSkin,
    });
    this.renderHud();
    if (this.phase === 'draw' && !stroke && !this.paused && !this.worldDone) this.renderTip();
    if (this.worldDone) this.renderWorldDone();
    else if (this.phase === 'won' && this.phaseTime > WIN_CARD_DELAY) this.renderWinCard();
    if (this.overlayParticles.length) drawParticles(ctx, this.view, this.overlayParticles);
    if (this.paused) this.renderPause();
  }

  /** Left and right edge of the HUD: the full width on phones, a column over the playfield on wide screens. */
  private hudSpan(): [number, number] {
    const colW = Math.min(this.W, Math.max(380, WORLD_W * this.view.s + 120));
    return [(this.W - colW) / 2, (this.W + colW) / 2];
  }

  /**
   * Where the HUD's parts go. Help buttons appear beside pause and retry once the player has missed a
   * few times, and keep their place from then on, so the layout (and the cached backdrop the fixed
   * parts are painted into) changes at most a couple of times per level.
   */
  private hudLayout(): HudLayout {
    const size = this.btnSize() * 0.85;
    const hy = this.hudH / 2 + 2;
    const [hl, hr] = this.hudSpan();
    const hint = this.failCount >= this.hintAfter();
    const skip = this.canSkip();
    let left = hl + size * 1.6;
    let right = hr - size * 1.6;
    const hintX = right - size * 0.65;
    if (hint) right -= size * 1.3;
    const skipX = left + size * 0.65;
    if (skip) left += size * 1.3;
    const mid = (left + right) / 2;
    const mw = Math.max(60, Math.min(right - left - size * 0.6, 300));
    const mh = Math.max(12, size * 0.3);
    return { size, hy, hl, hr, hint, skip, hintX, skipX, mid, mw, mh, mx: mid - mw / 2, my: hy + size * 0.1 };
  }

  /** HUD parts that only change with the layout: button bodies, the panel, the level name, the meter track. */
  private drawHudChrome(ctx: CanvasRenderingContext2D, h: HudLayout): void {
    this.paintButton(ctx, h.hl + h.size * 0.8, h.hy, h.size, 'pause', 'light');
    this.paintButton(ctx, h.hr - h.size * 0.8, h.hy, h.size, 'retry', 'light');
    if (h.skip) this.paintButton(ctx, h.skipX, h.hy, h.size, 'skip', 'light');
    ctx.fillStyle = 'rgba(255,255,255,0.78)';
    roundRect(ctx, h.mx - 12, h.hy - h.size * 0.66, h.mw + 24, h.size * 1.38, h.size * 0.36);
    ctx.fill();
    const ly = h.hy - h.size * 0.34;
    ctx.font = `700 ${Math.round(h.size * 0.4)}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = UI_DARK;
    if (this.mode === 'daily') {
      // Today's hole: a calendar leaf with the day of the month.
      drawIcon(ctx, 'calendar', h.mid - h.size * 0.3, ly, h.size * 0.45, UI_DARK);
      ctx.fillStyle = UI_DARK;
      ctx.textAlign = 'left';
      ctx.fillText(`${new Date().getDate()}`, h.mid + h.size * 0.02, ly + 1);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(this.ref.label, h.mid, ly);
    }
    ctx.fillStyle = 'rgba(31,42,68,0.2)';
    roundRect(ctx, h.mx, h.my, h.mw, h.mh, h.mh / 2);
    ctx.fill();
  }

  /** The HUD's moving parts (the fixed ones are in the backdrop), and its tap targets. */
  private renderHud(): void {
    const ctx = this.ctx;
    const level = this.level;
    const h = this.hudLayout();
    const tap = (x: number, action: () => void) => this.buttons.push({ x, y: h.hy, r: h.size / 2, action });
    // Under the win card or the world card the HUD can't be tapped.
    const live = !this.worldDone && !(this.phase === 'won' && this.phaseTime > WIN_CARD_DELAY);
    if (live) {
      tap(h.hl + h.size * 0.8, () => (this.paused = true));
      tap(h.hr - h.size * 0.8, () => this.resetAttempt());
      if (h.skip) tap(h.skipX, () => this.skipLevel());
    }
    if (h.hint) {
      const pulse = this.hintUsed ? 1 : 1 + Math.max(0, Math.sin(this.time * 5)) * 0.08;
      this.paintButton(ctx, h.hintX, h.hy, h.size * pulse, 'hint', 'gold');
      if (live) tap(h.hintX, () => this.showHint());
    }

    // Ink left, with the star thresholds marked.
    const { mx, my, mw, mh } = h;
    const used = this.stroke ? this.stroke.length : this.phase === 'draw' ? 0 : this.inkUsed;
    const frac = Math.max(0, 1 - used / level.ink);
    if (frac > 0) {
      ctx.fillStyle = frac > 0.35 ? '#3d7bff' : frac > 0.15 ? '#ff9f1c' : '#e74c3c';
      roundRect(ctx, mx, my, Math.max(mh, mw * frac), mh, mh / 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      roundRect(ctx, mx + mh * 0.3, my + mh * 0.15, Math.max(0, mw * frac - mh * 0.6), mh * 0.3, mh * 0.15);
      ctx.fill();
    }
    const stars = used <= level.stars[0] + 1e-9 ? 3 : used <= level.stars[1] + 1e-9 ? 2 : 1;
    for (const [k, thr] of [
      [3, level.stars[0]],
      [2, level.stars[1]],
    ] as const) {
      const tx = mx + mw * (1 - thr / level.ink);
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.fillRect(tx - 1.5, my, 3, mh);
      drawStar(ctx, tx, my + mh + mh * 0.5, mh * 0.5, stars >= k ? STAR_ON : STAR_OFF, stars >= k ? '#c98f00' : undefined);
    }
    drawStar(ctx, mx + mh * 0.5, my + mh + mh * 0.5, mh * 0.5, STAR_ON, '#c98f00');
    // Expert tier: once a level has 3 stars, show where the gold-ink line ends.
    if ((this.save.stars[level.id] ?? 0) === 3) {
      const gx = mx + mw * (1 - this.hintInk(level) / level.ink);
      ctx.fillStyle = GOLD;
      ctx.fillRect(gx - 1.5, my - 2, 3, mh + 4);
      drawIcon(ctx, 'drop', gx, my - mh * 0.55, mh * 0.8, used <= this.hintInk(level) + GOLD_SLACK ? GOLD : 'rgba(224,168,0,0.4)');
    }
  }

  /** One short line of help: how to get the hint, what's new in this level, or what the Daily Hole is. */
  private renderTip(): void {
    let tip = '';
    if (this.failCount >= this.hintAfter() && !this.hintUsed) tip = T.hintTip;
    else if (this.mode === 'daily') {
      if (!dailyDone(this.save, this.today)) tip = T.dailyTip;
    } else if (!this.save.stars[this.level.id]) {
      if (this.ref.index === 0) tip = T.worldTips[this.ref.world] ?? '';
      else if (this.ref.world === 0 && this.ref.index === 1) tip = T.starsTip;
      else if (this.cur === this.firstMultiBall) tip = T.twoBallsTip;
    }
    if (!tip) return;
    const ctx = this.ctx;
    const fs = Math.max(14, Math.min(22, this.btnSize() * 0.4));
    ctx.font = `600 ${Math.round(fs)}px ${FONT}`;
    const tw = Math.min(this.W - 24, ctx.measureText(tip).width + fs * 1.6);
    const th = fs * 2;
    // Below the playfield if there is room (tall screens), else above it, else just inside its top.
    const fieldBottom = this.view.oy + 14 * this.view.s;
    let y = this.view.oy + th / 2 + 6;
    if (this.H - fieldBottom >= th + 12) y = (fieldBottom + this.H) / 2;
    else if (this.view.oy - this.hudH >= th + 12) y = (this.hudH + this.view.oy) / 2;
    const a = Math.min(1, this.phaseTime / 0.3);
    ctx.globalAlpha = a;
    ctx.fillStyle = 'rgba(31,42,68,0.78)';
    roundRect(ctx, this.W / 2 - tw / 2, y - th / 2, tw, th, th / 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    this.text(tip, this.W / 2, y + 1, fs, `rgba(255,255,255,${a})`, 'center', 600);
  }

  /** The coloured top of a card, with a headline that pops in. */
  private cardHeader(cx: number, top: number, cw: number, size: number, color: string, headline: string, headFill: string, t: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    roundRect(ctx, cx - cw / 2, top, cw, size * 1.25, 30);
    ctx.fill();
    ctx.fillRect(cx - cw / 2, top + size * 0.9, cw, size * 0.35);
    const head = Math.min(1, Math.max(0, (t - 0.1) / 0.2));
    const hs = Math.min(size * 0.85, (cw - size * 0.6) / Math.max(4, headline.length * 0.62)) * (0.5 + 0.5 * head + Math.sin(head * Math.PI) * 0.2);
    if (head > 0) this.textOutlined(headline, cx, top + size * 0.62, hs, headFill);
  }

  private renderWinCard(): void {
    const ctx = this.ctx;
    const t = this.phaseTime - WIN_CARD_DELAY;
    const k = Math.min(1, t / 0.32);
    // Ease out with a little overshoot.
    const back = 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
    ctx.fillStyle = `rgba(31,42,68,${0.45 * Math.min(1, t / 0.25)})`;
    ctx.fillRect(0, 0, this.W, this.H);
    const size = this.btnSize();
    const res = this.result;
    const cw = Math.min(this.W * 0.88, 380);
    const ch = size * (res.unlocks.length ? 7.6 : 6.2);
    const cx = this.W / 2;
    const cy = this.H / 2 + size * 0.2;
    const top = cy - ch / 2;

    ctx.save();
    ctx.globalAlpha = Math.min(1, t / 0.15);
    ctx.translate(cx, cy);
    ctx.scale(0.6 + 0.4 * back, 0.6 + 0.4 * back);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = 'rgba(31,42,68,0.3)';
    roundRect(ctx, cx - cw / 2, top + 8, cw, ch, 30);
    ctx.fill();
    ctx.fillStyle = UI_LIGHT;
    roundRect(ctx, cx - cw / 2, top, cw, ch, 30);
    ctx.fill();
    this.cardHeader(cx, top, cw, size, this.theme.accent, T.win[res.stars] ?? '', res.stars === 3 ? STAR_ON : UI_LIGHT, t);

    // Level label, with the gold-ink medal when the line matched the par.
    const labelY = top + size * 1.62;
    if (this.mode === 'daily') drawIcon(ctx, 'calendar', cx, labelY, size * 0.42, 'rgba(31,42,68,0.5)');
    else this.text(this.ref.label, cx, labelY, size * 0.36, 'rgba(31,42,68,0.5)');
    if (res.gold) {
      const pulse = 1 + 0.08 * Math.sin(this.time * 6);
      drawIcon(ctx, 'drop', cx + size * 0.8, labelY, size * 0.42 * pulse, GOLD);
    }
    for (let i = 0; i < 3; i++) {
      const appear = Math.max(0, Math.min(1, (t - 0.35 - i * 0.22) / 0.2));
      const on = i < res.stars;
      const r = size * (i === 1 ? 0.62 : 0.5) * (on ? 0.6 + 0.4 * appear + Math.sin(appear * Math.PI) * 0.25 : 1);
      drawStar(ctx, cx + (i - 1) * size * 1.25, top + size * (i === 1 ? 2.5 : 2.62), r, on && appear > 0 ? STAR_ON : STAR_OFF, on && appear > 0 ? '#c98f00' : undefined);
    }
    // How much ink it took, and what 3 stars would need.
    this.text(T.inkUsed(this.inkUsed.toFixed(1)), cx, top + size * 3.4, size * 0.34, UI_DARK, 'center', 600);
    const sub = res.stars < 3 ? T.forThree(this.level.stars[0].toFixed(1)) : res.gold ? T.goldInk : T.allStars;
    this.text(sub, cx, top + size * 3.82, size * 0.29, res.stars < 3 ? '#e67e22' : 'rgba(31,42,68,0.55)', 'center', 600);

    // Progress row: holes in this world (or the day streak), and the star total counting up.
    const py = top + size * 4.45;
    if (this.mode === 'daily') {
      const streak = currentStreak(this.save, this.today);
      drawIcon(ctx, 'flame', cx - cw / 2 + size * 0.75, py, size * 0.5, '#ff7a1f');
      this.text(`${streak}`, cx - cw / 2 + size * 1.1, py + 1, size * 0.42, UI_DARK, 'left');
    } else {
      const prog = this.worldProgress(this.ref.world);
      this.progressBar(cx - cw / 2 + size * 0.5, py - size * 0.11, cw * 0.36, size * 0.22, prog.done, prog.total);
    }
    const count = Math.round(res.starsFrom + (res.starsTo - res.starsFrom) * Math.max(0, Math.min(1, (t - 0.8) / 0.6)));
    drawStar(ctx, cx + cw / 2 - size * 1.75, py, size * 0.26, STAR_ON, '#c98f00');
    this.text(`${count}`, cx + cw / 2 - size * 1.4, py + 1, size * 0.4, UI_DARK, 'left');

    // A new look, unlocked by this win.
    if (res.unlocks.length) {
      const uy = top + size * 5.4;
      const uw = Math.min(cw - size, size * 1.4 * res.unlocks.length + size * 0.6);
      ctx.fillStyle = 'rgba(46,194,126,0.15)';
      roundRect(ctx, cx - uw / 2, uy - size * 0.5, uw, size, size * 0.5);
      ctx.fill();
      res.unlocks.forEach((c, i) => {
        const ux = cx + (i - (res.unlocks.length - 1) / 2) * size * 1.4;
        this.drawCosmetic(c, ux, uy, size * 0.3);
        const sp = 0.8 + 0.2 * Math.sin(this.time * 8 + i);
        drawStar(ctx, ux + size * 0.38, uy - size * 0.36, size * 0.11 * sp, STAR_ON, '#c98f00');
      });
    }
    ctx.restore();

    if (t > 0.35) {
      const by = top + ch - size * 0.95;
      this.button(cx - cw / 2 + size * 0.95, by, size, 'retry', () => this.resetAttempt());
      const nw = Math.min(size * 3, cw - size * 3.3);
      const nx = cx + cw / 2 - size * 0.45 - nw / 2;
      const nh = size * 1.05;
      if (this.mode === 'daily') {
        this.button(cx - cw / 2 + size * 2.15, by, size, 'home', () => this.goTitle());
        this.pill(nx, by, nw, nh, T.play, 'play', () => this.playContinue(), 'primary');
      } else {
        this.button(cx - cw / 2 + size * 2.15, by, size, 'grid', () => this.goSelect(this.ref.world));
        this.pill(nx, by, nw, nh, T.next, 'next', () => this.nextLevel(), 'primary');
        if (this.autoNext) {
          // The button fills while the card waits to move on by itself.
          const f = Math.max(0, Math.min(1, t / this.autoNextAfter));
          ctx.save();
          roundRect(ctx, nx - nw / 2, by - nh / 2, nw, nh, nh / 2);
          ctx.clip();
          ctx.fillStyle = 'rgba(255,255,255,0.28)';
          ctx.fillRect(nx - nw / 2, by - nh / 2, nw * f, nh);
          ctx.restore();
        }
      }
    }
  }

  private drawCosmetic(c: Cosmetic, x: number, y: number, r: number): void {
    const ctx = this.ctx;
    if (c.kind === 'ball') drawBall(ctx, x, y, r, this.time * 1.5, 0, c);
    else {
      ctx.strokeStyle = c.color;
      ctx.lineWidth = Math.max(3, r * 0.3);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x - r * 1.1, y + r * 0.5);
      ctx.quadraticCurveTo(x - r * 0.3, y - r * 1.2, x + r * 0.1, y);
      ctx.quadraticCurveTo(x + r * 0.5, y + r, x + r * 1.1, y - r * 0.5);
      ctx.stroke();
    }
  }

  /** World finished: a look at the next world (or the trophy after the last one). */
  private renderWorldDone(): void {
    const ctx = this.ctx;
    const wd = this.worldDone!;
    const k = Math.min(1, wd.t / 0.3);
    const ease = 1 - (1 - k) * (1 - k);
    ctx.fillStyle = `rgba(31,42,68,${0.45 * ease})`;
    ctx.fillRect(0, 0, this.W, this.H);
    const size = this.btnSize();
    const cw = Math.min(this.W * 0.88, 380);
    const ch = size * 8.1;
    const cx = this.W / 2;
    const cy = this.H / 2 + (1 - ease) * 40;
    const y0 = cy - ch / 2;
    const next = wd.world + 1;
    ctx.globalAlpha = ease;
    ctx.fillStyle = 'rgba(31,42,68,0.3)';
    roundRect(ctx, cx - cw / 2, y0 + 8, cw, ch, 30);
    ctx.fill();
    ctx.fillStyle = UI_LIGHT;
    roundRect(ctx, cx - cw / 2, y0, cw, ch, 30);
    ctx.fill();
    const doneTheme = THEMES[wd.world % THEMES.length];
    this.cardHeader(cx, y0, cw, size, doneTheme.accent, next < this.worlds.length ? T.worldClear : T.allClear, STAR_ON, wd.t);

    // This world's badge with its stars.
    const prog = this.worldProgress(wd.world);
    const by0 = y0 + size * 1.75;
    ctx.fillStyle = doneTheme.top;
    ctx.beginPath();
    ctx.arc(cx - size * 1.45, by0, size * 0.4, 0, Math.PI * 2);
    ctx.fill();
    this.text(`${wd.world + 1}`, cx - size * 1.45, by0 + 2, size * 0.42, UI_DARK);
    drawIcon(ctx, 'check', cx - size * 0.7, by0, size * 0.5, GREEN);
    drawStar(ctx, cx - size * 0.05, by0, size * 0.26, STAR_ON, '#c98f00');
    this.text(`${prog.stars}/${prog.total * 3}`, cx + size * 0.27, by0 + 2, size * 0.38, UI_DARK, 'left');

    const pw = cw - size * 1.2;
    const ph = size * 3.6;
    const px = cx - pw / 2;
    const py = y0 + size * 2.45;
    if (next < this.worlds.length) {
      // Preview of the next world's first hole, in its own look.
      const level = this.worlds[next].levels[0];
      const theme = THEMES[next % THEMES.length];
      ctx.save();
      roundRect(ctx, px, py, pw, ph, 18);
      ctx.clip();
      ctx.translate(px, py);
      drawBackground(ctx, pw, ph, theme, this.time);
      const v = fitView(pw * 0.08, ph * 0.04, pw * 0.84, ph * 0.92);
      drawStatic(ctx, v, level, theme);
      drawScene(ctx, v, { level, theme, time: this.time, sim: null, line: null, drawing: null, blocked: null, ghost: null, hint: null, particles: [], dropCue: false, lowInk: false, staticDrawn: true, ballSkin: this.ballSkin, ink: this.inkSkin });
      ctx.restore();
      ctx.fillStyle = theme.top;
      ctx.beginPath();
      ctx.arc(px + size * 0.55, py + size * 0.55, size * 0.4, 0, Math.PI * 2);
      ctx.fill();
      this.text(`${next + 1}`, px + size * 0.55, py + size * 0.57, size * 0.42, UI_DARK);
      this.caption(this.worlds[next].name.toUpperCase(), px + pw / 2, py + ph - size * 0.4, size * 0.4);
      drawIcon(ctx, 'right', px + pw - size * 0.5, py + ph / 2, size * 0.6, UI_LIGHT);
    } else {
      // The last world: a trophy and the grand total.
      ctx.fillStyle = 'rgba(255,197,49,0.18)';
      roundRect(ctx, px, py, pw, ph, 18);
      ctx.fill();
      const bob = Math.sin(this.time * 3) * size * 0.05;
      drawIcon(ctx, 'trophy', cx, py + ph * 0.42 + bob, size * 1.6, GOLD);
      drawStar(ctx, cx - size * 0.55, py + ph * 0.84, size * 0.26, STAR_ON, '#c98f00');
      this.text(`${totalStars(this.save)}/${this.levels.length * 3}`, cx - size * 0.2, py + ph * 0.86, size * 0.4, UI_DARK, 'left');
    }
    ctx.globalAlpha = 1;
    const by = y0 + ch - size * 0.95;
    this.button(cx - cw / 2 + size * 0.95, by, size, 'home', () => this.goTitle());
    this.button(cx - cw / 2 + size * 2.15, by, size, 'grid', () => this.goSelect(next < this.worlds.length ? next : wd.world));
    const nw = Math.min(size * 3, cw - size * 3.3);
    const nx = cx + cw / 2 - size * 0.45 - nw / 2;
    if (next < this.worlds.length) this.pill(nx, by, nw, size * 1.05, T.next, 'next', () => this.leaveWorldDone(), 'primary');
    else this.pill(nx, by, nw, size * 1.05, T.looks, 'palette', () => this.goLooks(), 'primary');
  }

  private renderPause(): void {
    const ctx = this.ctx;
    this.buttons = [];
    ctx.fillStyle = 'rgba(31,42,68,0.6)';
    ctx.fillRect(0, 0, this.W, this.H);
    const size = this.btnSize();
    const cx = this.W / 2;
    const cy = this.H / 2;
    this.textOutlined(T.paused, cx, cy - size * 2.1, size * 0.9, UI_LIGHT);
    this.pill(cx, cy - size * 0.5, Math.min(this.W * 0.7, size * 4.4), size * 1.2, T.resume, 'play', () => (this.paused = false), 'primary');
    this.button(cx - size * 1.4, cy + size * 1.2, size, 'home', () => this.goTitle());
    this.button(cx, cy + size * 1.2, size, 'grid', () => this.goSelect(this.mode === 'campaign' ? this.ref.world : undefined));
    this.button(cx + size * 1.4, cy + size * 1.2, size, this.save.sfx ? 'soundOn' : 'soundOff', () => this.toggleSound());
  }
}
