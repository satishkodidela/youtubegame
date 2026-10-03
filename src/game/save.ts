// Player progress. Stored as JSON through the platform (YouTube cloud save in production).
// Rules that keep old saves loading in every future version:
//   - levels are keyed by their stable id, never by position
//   - unknown fields are kept and written back untouched
//   - each format change bumps SAVE_VERSION and adds a step to migrate()

export const SAVE_VERSION = 1;

export interface SaveData {
  v: number;
  /** Best star count per level id (1-3). A level is complete when it has an entry. */
  stars: Record<string, number>;
  /** Least ink used per level id, rounded to 0.01. */
  ink: Record<string, number>;
  sfx: boolean;
  [extra: string]: unknown;
}

export function emptySave(): SaveData {
  return { v: SAVE_VERSION, stars: {}, ink: {}, sfx: true };
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
  const out: SaveData = { ...src, v: Math.max(SAVE_VERSION, num(src.v, 0)), stars: {}, ink: {}, sfx: src.sfx !== false };
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
  return out;
}

function migrate(obj: Record<string, unknown>): Record<string, unknown> {
  // v0 -> v1: nothing shipped before v1. Future steps go here, e.g.
  // if (num(obj.v, 0) < 2) obj = { ...obj, v: 2, newField: default };
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

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
