// Player progress. Stored as JSON through the platform (YouTube cloud save in production).
// Rules that keep old saves loading in every future version:
//   - levels are keyed by their stable id, never by position
//   - unknown fields are kept and written back untouched
//   - each format change bumps SAVE_VERSION and adds a step to migrate()
//
// History: v1 stars, ink and sound. v2 adds the Daily Hole (results and streak), the chosen
// look (ball skin and ink colour) and which unlocks have been announced.

export const SAVE_VERSION = 2;

export interface StreakData {
  /** Day number (see daily.ts) of the latest Daily Hole win, or -1 for none. */
  last: number;
  /** Consecutive days won up to `last`. */
  count: number;
  best: number;
}

export interface Look {
  ball: string;
  ink: string;
}

export interface SaveData {
  v: number;
  /** Best star count per level id (1-3). A level is complete when it has an entry. */
  stars: Record<string, number>;
  /** Least ink used per level id, rounded to 0.01. */
  ink: Record<string, number>;
  sfx: boolean;
  /** Daily Hole: best star count per day number. */
  daily: Record<string, number>;
  streak: StreakData;
  /** Chosen cosmetics, by id (see cosmetics.ts). */
  look: Look;
  /** Unlock ids the player has already been shown, so each is announced once. */
  seen: string[];
  [extra: string]: unknown;
}

export const DEFAULT_LOOK: Look = { ball: 'classic', ink: 'navy' };

export function emptySave(): SaveData {
  return { v: SAVE_VERSION, stars: {}, ink: {}, sfx: true, daily: {}, streak: { last: -1, count: 0, best: 0 }, look: { ...DEFAULT_LOOK }, seen: [] };
}

export function parseSave(raw: string | null | undefined): SaveData {
  if (!raw) return emptySave();
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return emptySave();
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return emptySave();
  const src = migrate(obj as Record<string, unknown>);
  const out: SaveData = { ...src, ...emptySave(), v: Math.max(SAVE_VERSION, num(src.v, 0)), sfx: src.sfx !== false };
  if (isRecord(src.stars)) {
    for (const [id, val] of Object.entries(src.stars)) {
      const s = Math.round(num(val, 0));
      if (s >= 1) out.stars[id] = Math.min(3, s);
    }
  }
  if (isRecord(src.ink)) {
    for (const [id, val] of Object.entries(src.ink)) {
      const v = num(val, -1);
      if (v >= 0) out.ink[id] = v;
    }
  }
  if (isRecord(src.daily)) {
    for (const [day, val] of Object.entries(src.daily)) {
      const s = Math.round(num(val, 0));
      if (/^\d+$/.test(day) && s >= 1) out.daily[day] = Math.min(3, s);
    }
  }
  if (isRecord(src.streak)) {
    const last = Math.round(num(src.streak.last, -1));
    const count = Math.max(0, Math.round(num(src.streak.count, 0)));
    out.streak = { last: last >= 0 ? last : -1, count: last >= 0 ? count : 0, best: Math.max(count, Math.round(num(src.streak.best, 0))) };
  }
  if (isRecord(src.look)) {
    if (typeof src.look.ball === 'string') out.look.ball = src.look.ball;
    if (typeof src.look.ink === 'string') out.look.ink = src.look.ink;
  }
  if (Array.isArray(src.seen)) out.seen = src.seen.filter((x): x is string => typeof x === 'string');
  return out;
}

function migrate(obj: Record<string, unknown>): Record<string, unknown> {
  // v0 -> v1: nothing shipped before v1.
  // v1 -> v2: new fields only; parseSave fills their defaults, so the version just moves on.
  if (num(obj.v, 0) < 2) obj = { ...obj, v: 2 };
  return obj;
}

export function serializeSave(save: SaveData): string {
  return JSON.stringify(save);
}

export function totalStars(save: SaveData): number {
  let t = 0;
  for (const s of Object.values(save.stars)) t += s;
  return t;
}

/** Records a finished level. Returns true if anything improved (and the save should be written). */
export function recordWin(save: SaveData, levelId: string, stars: number, ink: number): boolean {
  let changed = false;
  if ((save.stars[levelId] ?? 0) < stars) {
    save.stars[levelId] = stars;
    changed = true;
  }
  const rounded = Math.round(ink * 100) / 100;
  if (save.ink[levelId] === undefined || rounded < save.ink[levelId]) {
    save.ink[levelId] = rounded;
    changed = true;
  }
  return changed;
}

/** True until the player has finished anything: the first session skips the title screen. */
export function isFresh(save: SaveData): boolean {
  return Object.keys(save.stars).length === 0 && Object.keys(save.daily).length === 0;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
