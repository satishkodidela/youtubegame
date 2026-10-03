import { WORLD_H, WORLD_W, type LevelDef, type Pt } from '../levels/types';
import { simulate } from './sim';
import { MIN_LINE, traceStroke } from './stroke';

// Brute-force "par" finder used by level design tools (scripts/par.ts and the dev editor).
// It searches for the shortest winning line with random sampling plus hill climbing, then picks
// a forgiving solution as the hint. Seeded, so results are reproducible.

export interface Candidate {
  path: Pt[];
  line: Pt[];
  ink: number;
}

export interface SolveResult {
  /** Shortest winning line found; may need pixel-perfect drawing. */
  best: Candidate | null;
  /** Shortest line found that survives hand wobble. Star thresholds are based on this. */
  robust: Candidate | null;
  robustScore: number;
  winners: Candidate[];
  evals: number;
  noLineWins: boolean;
}

export interface SolveOptions {
  samples?: number;
  refineIters?: number;
  seed?: number;
  /** Ignore candidates longer than this. */
  maxInk?: number;
}

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Candidates shorter than this are skipped so a stored hint can never round down into a tap. */
const MIN_CANDIDATE = MIN_LINE + 0.15;

export function evaluate(level: LevelDef, path: Pt[]): Candidate | null {
  const { line, ink } = traceStroke(level, path);
  if (!line || ink < MIN_CANDIDATE) return null;
  return simulate(level, line, 12).status === 'won' ? { path, line, ink } : null;
}

export function solve(level: LevelDef, opts: SolveOptions = {}): SolveResult {
  const rand = rng(opts.seed ?? 1);
  const samples = opts.samples ?? 2500;
  const refineIters = opts.refineIters ?? 200;
  const maxInk = opts.maxInk ?? 14;
  const u = (a: number, b: number) => a + (b - a) * rand();
  const clampPt = (p: Pt): Pt => [Math.max(0.1, Math.min(WORLD_W - 0.1, p[0])), Math.max(0.1, Math.min(WORLD_H - 0.1, p[1]))];
  const anywhere = (): Pt => [u(0.2, WORLD_W - 0.2), u(0.2, WORLD_H - 0.2)];
  const near = (c: Pt, r: number): Pt => clampPt([c[0] + u(-r, r), c[1] + u(-r, r)]);
  const balls = level.balls.map((b) => [b.x, b.y] as Pt);
  const holes = level.holes.map((h) => [h.x, h.y] as Pt);
  const pick = <T>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const underBall = (): Pt => {
    const b = pick(balls);
    return clampPt([b[0] + u(-1.8, 1.8), b[1] + u(0.5, 4)]);
  };

  let evals = 0;
  const winners: Candidate[] = [];
  const tryPath = (path: Pt[]): Candidate | null => {
    evals++;
    const c = evaluate(level, path);
    if (c && c.ink <= maxInk) {
      winners.push(c);
      return c;
    }
    return null;
  };

  evals++;
  const noLineWins = simulate(level, null, 12).status === 'won';

  for (let i = 0; i < samples; i++) {
    const r = rand();
    let path: Pt[];
    if (r < 0.3) path = [underBall(), anywhere()];
    else if (r < 0.5) {
      const a = underBall();
      const m = near(a, 3);
      path = [a, m, near(m, 3)];
    } else if (r < 0.65) {
      const h = pick(holes);
      path = [underBall(), near([h[0], h[1] - 0.5], 2.5)];
    } else if (r < 0.85) {
      const a = anywhere();
      path = [a, near(a, 3)];
    } else {
      const a = anywhere();
      path = [a, near(a, 1.2)];
    }
    if (rand() < 0.5) path.reverse();
    tryPath(path);
  }

  // Hill-climb the shortest few winners towards less ink (finds fragile "skill shot" minimums).
  const seeds = dedupe(winners.slice().sort((a, b) => a.ink - b.ink)).slice(0, 4);
  for (const seedC of seeds) {
    let cur = seedC;
    for (let it = 0; it < refineIters; it++) {
      const c = tryPath(mutate(cur.path, it / refineIters));
      if (c && c.ink < cur.ink) cur = c;
    }
  }
  winners.sort((a, b) => a.ink - b.ink);

  // The shortest line a normal hand can reproduce: robust to small wobbles.
  const robustCache = new Map<Candidate, number>();
  const robustOf = (c: Candidate) => {
    let r = robustCache.get(c);
    if (r === undefined) {
      r = robustness(level, c.path);
      evals += 24;
      robustCache.set(c, r);
    }
    return r;
  };
  let robust: Candidate | null = null;
  const pool = dedupe(winners);
  const stride = Math.max(1, Math.floor(pool.length / 40));
  for (let i = 0; i < pool.length && !robust; i += stride) if (robustOf(pool[i]) >= ROBUST_MIN) robust = pool[i];
  if (robust) {
    for (let it = 0; it < 50; it++) {
      evals++;
      const c = evaluate(level, mutate(robust.path, it / 50));
      if (c && c.ink < robust.ink && robustOf(c) >= ROBUST_MIN) robust = c;
    }
  }

  return { best: winners[0] ?? null, robust, robustScore: robust ? robustOf(robust) : 0, winners, evals, noLineWins };

  function mutate(src: Pt[], progress: number): Pt[] {
    const sigma = 0.5 * (1 - progress) + 0.04;
    let path = src.map((p) => clampPt([p[0] + gauss(rand) * sigma, p[1] + gauss(rand) * sigma]));
    if (rand() < 0.3) {
      // Pull one end inwards.
      const k = rand() < 0.5 ? 0 : path.length - 1;
      const nb = path[k === 0 ? 1 : path.length - 2];
      const f = u(0.05, 0.3);
      path[k] = [path[k][0] + (nb[0] - path[k][0]) * f, path[k][1] + (nb[1] - path[k][1]) * f];
    }
    if (rand() < 0.1 && path.length === 3) path = [path[0], path[2]];
    return path;
  }
}

/** A line counts as robust when at least this share of wobbly copies still win. */
export const ROBUST_MIN = 0.55;

/** Fraction of nearby lines (as if drawn by a slightly shaky hand) that still win. */
export function robustness(level: LevelDef, path: Pt[], trials = 24, sigma = 0.15, seed = 7): number {
  const rand = rng(seed);
  let wins = 0;
  for (let i = 0; i < trials; i++) {
    const p = path.map((q) => [q[0] + gauss(rand) * sigma, q[1] + gauss(rand) * sigma] as Pt);
    if (evaluate(level, p)) wins++;
  }
  return wins / trials;
}

export interface Tuning {
  par: number;
  stars: [number, number];
  ink: number;
}

const r1 = (v: number) => Math.ceil(v * 10) / 10;

/** Star thresholds and ink budget from the best line found. */
export function tuneFromPar(par: number): Tuning {
  // 3 stars: about the robust par. 2 stars: a sensible hand-drawn path. The budget allows a long,
  // obvious ramp too; that wins with 1 star, which is the answer to "just draw a chute".
  const s3 = r1(par * 1.2 + 0.4);
  const s2 = r1(Math.max(par * 1.8 + 1.2, s3 + 1.0));
  const ink = r1(Math.max(s2 * 1.5, s2 + 2.5, 5));
  return { par, stars: [s3, s2], ink };
}

function dedupe(cs: Candidate[]): Candidate[] {
  const out: Candidate[] = [];
  for (const c of cs) if (!out.some((o) => Math.abs(o.ink - c.ink) < 0.05)) out.push(c);
  return out;
}

function gauss(rand: () => number): number {
  const a = Math.max(1e-9, rand());
  const b = rand();
  return Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b);
}
