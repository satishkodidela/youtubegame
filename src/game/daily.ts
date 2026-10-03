import type { LevelDef } from '../levels/types';
import type { SaveData } from './save';

// The Daily Hole: one level per calendar day, the same for every player, with no server.
// Days are numbered from the device's local calendar, so a new hole appears at local midnight.
// The level set is bundled (src/levels/daily.json) and repeats once it runs out.

const MS_PER_DAY = 86_400_000;

/** Local calendar day number: the same for everyone on the same calendar date. */
export function dayNumber(now = Date.now()): number {
  const local = now - new Date(now).getTimezoneOffset() * 60_000;
  return Math.floor(local / MS_PER_DAY);
}

/** Day 0 of the Daily Hole: 3 October 2026. */
export const DAILY_EPOCH_DAY = Date.UTC(2026, 9, 3) / MS_PER_DAY;

/** Which bundled level a day gets. Wraps when the set runs out, and handles days before the epoch. */
export function dailyIndex(day: number, count: number): number {
  if (count <= 0) return -1;
  return (((day - DAILY_EPOCH_DAY) % count) + count) % count;
}

export function dailyLevel(levels: LevelDef[], day: number): LevelDef | null {
  const i = dailyIndex(day, levels.length);
  return i >= 0 ? levels[i] : null;
}

/** Day streak milestones that unlock a reward (see cosmetics.ts). */
export const STREAK_REWARDS = [3, 7, 14];

/** The streak as the player sees it today: alive if the last win was today or yesterday. */
export function currentStreak(save: SaveData, today: number): number {
  const { last, count } = save.streak;
  return last === today || last === today - 1 ? count : 0;
}

/** Whether today's hole is already won. */
export function dailyDone(save: SaveData, today: number): boolean {
  return (save.daily[String(today)] ?? 0) > 0;
}

/**
 * Records a Daily Hole win. The first win of a day extends the streak (or starts a new one after
 * a missed day); later wins only improve the stars. Returns true if the save changed.
 */
export function recordDaily(save: SaveData, day: number, stars: number): boolean {
  let changed = false;
  const key = String(day);
  if ((save.daily[key] ?? 0) < stars) {
    save.daily[key] = stars;
    changed = true;
  }
  const s = save.streak;
  if (s.last !== day) {
    s.count = s.last === day - 1 ? s.count + 1 : 1;
    s.last = day;
    s.best = Math.max(s.best, s.count);
    changed = true;
  }
  return changed;
}
