import type { BallSkin, BallStyle, InkSkin, Unlock } from '../render/theme';
import type { SaveData } from './save';
import { DEFAULT_LOOK, totalStars } from './save';

// Cosmetics: ball skins and ink colours. They change nothing in physics. A new one unlocks every
// 15 stars, which gives replaying for 3 stars a purpose, and the Daily Hole streak unlocks a few
// more. Unlocks are derived from the save (total stars, best streak), so nothing extra is stored
// except which ones have already been announced.

export type { BallSkin, BallStyle, InkSkin, Unlock };
export type Cosmetic = BallSkin | InkSkin;

export const STARS_PER_UNLOCK = 15;

const ball = (id: string, style: BallStyle, base: string, light: string, mark: string, unlock: Unlock): BallSkin => ({ kind: 'ball', id, style, base, light, mark, unlock });
const ink = (id: string, color: string, ghost: string, unlock: Unlock): InkSkin => ({ kind: 'ink', id, color, ghost, unlock });

export const BALL_SKINS: BallSkin[] = [
  ball('classic', 'classic', '#ffffff', '#ffffff', 'rgba(120,135,165,0.45)', { stars: 0 }),
  ball('sun', 'solid', '#ffd23f', '#fff3b0', 'rgba(200,120,0,0.45)', { stars: 15 }),
  ball('mint', 'solid', '#5fe0b7', '#d6fff2', 'rgba(20,110,80,0.4)', { stars: 45 }),
  ball('berry', 'solid', '#ff6b9d', '#ffd0e0', 'rgba(140,20,70,0.4)', { stars: 75 }),
  ball('eight', 'eight', '#1f2230', '#555a70', '#ffffff', { stars: 105 }),
  ball('beach', 'beach', '#ff5d5d', '#ffffff', '#3d7bff', { stars: 135 }),
  ball('gold', 'gold', '#f5c542', '#fff1b3', '#b8860b', { stars: 165 }),
  ball('tennis', 'tennis', '#d8f542', '#f4ffb0', '#ffffff', { streak: 3 }),
  ball('flame', 'flame', '#ff6a1f', '#ffd36b', '#b32d00', { streak: 7 }),
];

export const INK_SKINS: InkSkin[] = [
  ink('navy', '#26315c', 'rgba(38,49,92,0.22)', { stars: 0 }),
  ink('crimson', '#c0392b', 'rgba(192,57,43,0.25)', { stars: 30 }),
  ink('forest', '#1e8449', 'rgba(30,132,73,0.25)', { stars: 60 }),
  ink('violet', '#7d3cff', 'rgba(125,60,255,0.25)', { stars: 90 }),
  ink('tangerine', '#f3722c', 'rgba(243,114,44,0.28)', { stars: 120 }),
  ink('teal', '#008b8b', 'rgba(0,139,139,0.25)', { stars: 150 }),
  ink('chalk', '#fafafa', 'rgba(255,255,255,0.5)', { streak: 3 }),
  ink('honey', '#e0a800', 'rgba(224,168,0,0.3)', { streak: 14 }),
];

export const ALL_COSMETICS: Cosmetic[] = [...BALL_SKINS, ...INK_SKINS];

export function isUnlocked(c: Cosmetic, save: SaveData): boolean {
  if ('stars' in c.unlock) return totalStars(save) >= c.unlock.stars;
  return save.streak.best >= c.unlock.streak;
}

export function unlockedCosmetics(save: SaveData): Cosmetic[] {
  return ALL_COSMETICS.filter((c) => isUnlocked(c, save));
}

/** Unlocked cosmetics the player has not been shown yet. */
export function newUnlocks(save: SaveData): Cosmetic[] {
  return unlockedCosmetics(save).filter((c) => c.unlock && !(('stars' in c.unlock && c.unlock.stars === 0) || save.seen.includes(c.id)));
}

/** Marks cosmetics as announced. Returns true if the save changed. */
export function markSeen(save: SaveData, items: Cosmetic[]): boolean {
  let changed = false;
  for (const c of items) {
    if (!save.seen.includes(c.id)) {
      save.seen.push(c.id);
      changed = true;
    }
  }
  return changed;
}

/** The chosen ball skin, falling back to the default if the id is unknown or no longer unlocked. */
export function currentBall(save: SaveData): BallSkin {
  const s = BALL_SKINS.find((b) => b.id === save.look.ball);
  return s && isUnlocked(s, save) ? s : BALL_SKINS[0];
}

export function currentInk(save: SaveData): InkSkin {
  const s = INK_SKINS.find((i) => i.id === save.look.ink);
  return s && isUnlocked(s, save) ? s : INK_SKINS[0];
}

/** Stars still needed for the next star-based unlock, or 0 when everything is unlocked. */
export function starsToNextUnlock(save: SaveData): number {
  const total = totalStars(save);
  let next = Infinity;
  for (const c of ALL_COSMETICS) if ('stars' in c.unlock && c.unlock.stars > total) next = Math.min(next, c.unlock.stars);
  return next === Infinity ? 0 : next - total;
}

export { DEFAULT_LOOK };
