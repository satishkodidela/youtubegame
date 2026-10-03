import type { LevelDef, WorldDef } from '../levels/types';
import type { SaveData } from './save';

export interface LevelRef {
  world: number;
  index: number;
  level: LevelDef;
  /** Label shown to the player, e.g. "2-7". */
  label: string;
}

export function flatten(worlds: WorldDef[]): LevelRef[] {
  const out: LevelRef[] = [];
  worlds.forEach((w, wi) => w.levels.forEach((level, index) => out.push({ world: wi, index, level, label: `${wi + 1}-${index + 1}` })));
  return out;
}

/** How many unsolved levels a player may leave behind and still move on. */
export const SKIP_ALLOWANCE = 2;

/** A level is open when at most SKIP_ALLOWANCE levels before it are unsolved. */
export function unlockedMask(levels: LevelRef[], save: SaveData): boolean[] {
  const out: boolean[] = [];
  let unsolved = 0;
  for (const ref of levels) {
    out.push(unsolved <= SKIP_ALLOWANCE);
    if (!save.stars[ref.level.id]) unsolved++;
  }
  return out;
}

/** The level "Play" should continue from: the first open, unsolved level. */
export function continueIndex(levels: LevelRef[], save: SaveData): number {
  const open = unlockedMask(levels, save);
  for (let i = 0; i < levels.length; i++) if (open[i] && !save.stars[levels[i].level.id]) return i;
  return -1;
}
