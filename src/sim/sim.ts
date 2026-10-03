import { Box, Chain, Circle, Polygon, World, type Body, type Contact } from 'planck';
import {
  BALL_R,
  CUP_DEPTH,
  CUP_W,
  LINE_HALF,
  WORLD_H,
  WORLD_W,
  type BouncerItem,
  type LevelDef,
  type MoverItem,
  type Pt,
  type SpinnerItem,
  type WaterItem,
  type WindItem,
} from '../levels/types';
import { bouncerNormal, moverPose, spinnerAngle, staticSolids } from './shapes';

// Deterministic physics for one attempt. No DOM access, so tests and the par solver run it headless.
// The world is built when the ball is released and thrown away on retry; nothing moves while the
// player draws, so the same line always gives the same result.

export const DT = 1 / 120;
export const GRAVITY = 16;
export const MAX_TIME = 14;
const REST_SPEED = 0.07;
const REST_TIME = 0.6;

const CAT_WORLD = 0x1;
const CAT_LINE = 0x2;
const CAT_BALL = 0x4;
const CAT_BALL_SKIN = 0x8;

export type SimStatus = 'running' | 'won' | 'failed';
export type FailReason = 'out' | 'water' | 'stuck' | 'timeout';

export interface SimEvent {
  kind: 'hit' | 'bounce' | 'sink' | 'splash' | 'out';
  x: number;
  y: number;
  /** Impact speed for hits; 1 for the others. */
  strength: number;
}

export interface BallView {
  x: number;
  y: number;
  angle: number;
  vx: number;
  vy: number;
  sunk: boolean;
  /** Seconds since the ball sank (drives the drop-in animation). */
  sunkFor: number;
  lost: boolean;
}

interface Tag {
  kind: 'ground' | 'cup' | 'bouncer' | 'line' | 'mover' | 'spinner' | 'ball';
  index: number;
}

interface BallRec {
  body: Body;
  sunk: boolean;
  sunkAt: number;
  sinkX: number;
  sinkY: number;
  lost: boolean;
  lastHit: number;
}

export class Sim {
  readonly level: LevelDef;
  readonly world: World;
  time = 0;
  status: SimStatus = 'running';
  failReason: FailReason | null = null;
  /** Events produced by the last step(); the caller drains them. */
  events: SimEvent[] = [];

  private balls: BallRec[] = [];
  private movers: { body: Body; def: MoverItem }[] = [];
  private spinners: { body: Body; def: SpinnerItem }[] = [];
  private bouncers: BouncerItem[] = [];
  private waters: WaterItem[] = [];
  private winds: WindItem[] = [];
  private pendingBounces: { ball: number; bouncer: number }[] = [];
  private restTimer = 0;

  constructor(level: LevelDef, line: Pt[] | null) {
    this.level = level;
    const world = new World({ gravity: { x: 0, y: GRAVITY } });
    this.world = world;

    const ground = world.createBody({ type: 'static' });
    for (const s of staticSolids(level)) {
      const tag: Tag = { kind: s.kind, index: s.index };
      const isBouncer = s.kind === 'bouncer';
      ground.createFixture({
        shape: new Polygon(s.poly.map(([x, y]) => ({ x, y }))),
        friction: s.kind === 'cup' ? 1 : 0.6,
        restitution: isBouncer ? 0.5 : 0.1,
        filterCategoryBits: CAT_WORLD,
        filterMaskBits: CAT_BALL,
        userData: tag,
      });
    }

    level.items.forEach((it, index) => {
      if (it.t === 'bouncer') this.bouncers[index] = it;
      else if (it.t === 'water') this.waters.push(it);
      else if (it.t === 'wind') this.winds.push(it);
      else if (it.t === 'mover') {
        const p = moverPose(it, 0);
        const body = world.createBody({ type: 'kinematic', position: { x: p.x, y: p.y }, angle: p.a });
        body.createFixture({
          shape: new Box(it.w / 2, it.h / 2),
          friction: 0.9,
          restitution: 0.1,
          filterCategoryBits: CAT_WORLD,
          filterMaskBits: CAT_BALL,
          userData: { kind: 'mover', index } as Tag,
        });
        this.movers.push({ body, def: it });
      } else if (it.t === 'spinner') {
        const body = world.createBody({ type: 'kinematic', position: { x: it.x, y: it.y }, angle: spinnerAngle(it, 0) });
        body.createFixture({
          shape: new Box(it.w / 2, it.h / 2),
          friction: 0.7,
          restitution: 0.2,
          filterCategoryBits: CAT_WORLD,
          filterMaskBits: CAT_BALL,
          userData: { kind: 'spinner', index } as Tag,
        });
        body.setAngularVelocity(it.speed);
        this.spinners.push({ body, def: it });
      }
    });

    if (line && line.length >= 2) {
      const body = world.createBody({ type: 'static' });
      body.createFixture({
        shape: new Chain(line.map(([x, y]) => ({ x, y })), false),
        friction: 0.7,
        restitution: 0.1,
        filterCategoryBits: CAT_LINE,
        filterMaskBits: CAT_BALL_SKIN,
        userData: { kind: 'line', index: 0 } as Tag,
      });
    }

    level.balls.forEach((b, index) => {
      const body = world.createBody({
        type: 'dynamic',
        position: { x: b.x, y: b.y },
        linearVelocity: { x: b.vx ?? 0, y: b.vy ?? 0 },
        bullet: true,
        angularDamping: 1.6,
        linearDamping: 0.04,
      });
      const tag: Tag = { kind: 'ball', index };
      // Core collides with level geometry and other balls.
      body.createFixture({
        shape: new Circle(BALL_R),
        density: 1,
        friction: 0.6,
        restitution: 0.22,
        filterCategoryBits: CAT_BALL,
        filterMaskBits: CAT_WORLD | CAT_BALL,
        userData: tag,
      });
      // Massless skin collides only with drawn lines, which are zero-thickness chains in physics
      // but drawn LINE_HALF*2 thick on screen. The ball then rests on the visible edge of the line.
      body.createFixture({
        shape: new Circle(BALL_R + LINE_HALF),
        density: 0,
        friction: 0.6,
        restitution: 0.22,
        filterCategoryBits: CAT_BALL_SKIN,
        filterMaskBits: CAT_LINE,
        userData: tag,
      });
      this.balls.push({ body, sunk: false, sunkAt: 0, sinkX: 0, sinkY: 0, lost: false, lastHit: -1 });
    });

    world.on('begin-contact', (c: Contact) => this.onContact(c));
  }

  private onContact(c: Contact): void {
    const ta = c.getFixtureA().getUserData() as Tag | null;
    const tb = c.getFixtureB().getUserData() as Tag | null;
    if (!ta || !tb) return;
    let ball: Tag;
    let other: Tag;
    if (ta.kind === 'ball') {
      ball = ta;
      other = tb;
    } else if (tb.kind === 'ball') {
      ball = tb;
      other = ta;
    } else return;
    const rec = this.balls[ball.index];
    if (rec.sunk || rec.lost) return;
    if (other.kind === 'bouncer') {
      this.pendingBounces.push({ ball: ball.index, bouncer: other.index });
      return;
    }
    const v = rec.body.getLinearVelocity();
    const speed = Math.hypot(v.x, v.y);
    if (speed > 1.2 && this.time - rec.lastHit > 0.08) {
      rec.lastHit = this.time;
      const p = rec.body.getPosition();
      this.events.push({ kind: 'hit', x: p.x, y: p.y, strength: speed });
    }
  }

  step(): void {
    this.events.length = 0;
    const t1 = this.time + DT;

    for (const m of this.movers) {
      const target = moverPose(m.def, t1);
      const p = m.body.getPosition();
      m.body.setLinearVelocity({ x: (target.x - p.x) / DT, y: (target.y - p.y) / DT });
    }

    for (const rec of this.balls) {
      if (rec.sunk || rec.lost) continue;
      const p = rec.body.getPosition();
      const m = rec.body.getMass();
      // A gentle pull over the cup mouth: slow balls drop in, fast ones still skip across.
      for (const h of this.level.holes) {
        const dx = p.x - h.x;
        if (Math.abs(dx) < CUP_W / 2 + BALL_R * 0.3 && p.y > h.y - BALL_R * 1.6 && p.y < h.y + CUP_DEPTH) {
          rec.body.applyForceToCenter({ x: -dx * 30 * m, y: 22 * m }, true);
        }
      }
      for (const w of this.winds) {
        if (Math.abs(p.x - w.x) <= w.w / 2 && Math.abs(p.y - w.y) <= w.h / 2) {
          rec.body.applyForceToCenter({ x: w.fx * m, y: w.fy * m }, true);
        }
      }
    }

    this.world.step(DT, 8, 3);
    this.time = t1;

    for (const pb of this.pendingBounces) {
      const rec = this.balls[pb.ball];
      const b = this.bouncers[pb.bouncer];
      if (!b || rec.sunk || rec.lost) continue;
      const [nx, ny] = bouncerNormal(b);
      const p = rec.body.getPosition();
      if ((p.x - b.x) * nx + (p.y - b.y) * ny <= 0) continue; // hit from behind the pad
      const v = rec.body.getLinearVelocity();
      const vn = v.x * nx + v.y * ny;
      const power = b.power ?? 10;
      if (vn < power) rec.body.setLinearVelocity({ x: v.x + nx * (power - vn), y: v.y + ny * (power - vn) });
      this.events.push({ kind: 'bounce', x: p.x, y: p.y, strength: 1 });
    }
    this.pendingBounces.length = 0;

    if (this.status === 'failed') return;
    this.updateBalls();
  }

  private updateBalls(): void {
    let allSunk = true;
    let allResting = true;
    for (const rec of this.balls) {
      if (rec.sunk) continue;
      allSunk = false;
      const p = rec.body.getPosition();
      for (const h of this.level.holes) {
        if (Math.abs(p.x - h.x) < CUP_W / 2 && p.y > h.y + BALL_R * 0.9 && p.y < h.y + CUP_DEPTH + 0.2) {
          rec.sunk = true;
          rec.sunkAt = this.time;
          rec.sinkX = p.x;
          rec.sinkY = p.y;
          rec.body.setActive(false);
          this.events.push({ kind: 'sink', x: h.x, y: h.y, strength: 1 });
          break;
        }
      }
      if (rec.sunk) continue;
      if (this.status === 'won') continue;

      if (p.x < -1.5 || p.x > WORLD_W + 1.5 || p.y > WORLD_H + 1.5 || p.y < -8) {
        rec.lost = true;
        this.fail('out', p.x, p.y);
        return;
      }
      for (const w of this.waters) {
        if (Math.abs(p.x - w.x) <= w.w / 2 && p.y + BALL_R * 0.4 >= w.y - w.h / 2 && p.y <= w.y + w.h / 2 + BALL_R) {
          rec.lost = true;
          this.events.push({ kind: 'splash', x: p.x, y: w.y - w.h / 2, strength: 1 });
          this.fail('water', p.x, p.y);
          return;
        }
      }
      const v = rec.body.getLinearVelocity();
      const moving = rec.body.isAwake() && (Math.hypot(v.x, v.y) > REST_SPEED || Math.abs(rec.body.getAngularVelocity()) > 0.3);
      if (moving) allResting = false;
    }

    if (allSunk) {
      if (this.status === 'running') this.status = 'won';
      return;
    }
    if (this.status !== 'running') return;
    this.restTimer = allResting ? this.restTimer + DT : 0;
    if (this.restTimer >= REST_TIME) this.fail('stuck');
    else if (this.time >= MAX_TIME) this.fail('timeout');
  }

  private fail(reason: FailReason, x?: number, y?: number): void {
    if (this.status !== 'running') return;
    this.status = 'failed';
    this.failReason = reason;
    if (reason === 'out' && x !== undefined && y !== undefined) this.events.push({ kind: 'out', x, y, strength: 1 });
  }

  ballViews(): BallView[] {
    return this.balls.map((rec) => {
      if (rec.sunk) {
        return { x: rec.sinkX, y: rec.sinkY, angle: rec.body.getAngle(), vx: 0, vy: 0, sunk: true, sunkFor: this.time - rec.sunkAt, lost: false };
      }
      const p = rec.body.getPosition();
      const v = rec.body.getLinearVelocity();
      return { x: p.x, y: p.y, angle: rec.body.getAngle(), vx: v.x, vy: v.y, sunk: false, sunkFor: 0, lost: rec.lost };
    });
  }

  moverViews(): { x: number; y: number; a: number }[] {
    return this.movers.map((m) => {
      const p = m.body.getPosition();
      return { x: p.x, y: p.y, a: m.body.getAngle() };
    });
  }

  spinnerViews(): number[] {
    return this.spinners.map((s) => s.body.getAngle());
  }
}

export interface SimResult {
  status: SimStatus;
  failReason: FailReason | null;
  time: number;
}

/** Runs an attempt to completion. */
export function simulate(level: LevelDef, line: Pt[] | null, maxTime = MAX_TIME): SimResult {
  const sim = new Sim(level, line);
  while (sim.status === 'running' && sim.time < maxTime) sim.step();
  return { status: sim.status, failReason: sim.status === 'running' ? 'timeout' : sim.failReason, time: sim.time };
}
