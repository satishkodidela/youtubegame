import { describe, expect, it } from 'vitest';
import { continueIndex, flatten, unlockedMask } from '../src/game/progress';
import { emptySave } from '../src/game/save';
import type { LevelDef, WorldDef } from '../src/levels/types';

const lv = (id: string): LevelDef => ({ id, balls: [], holes: [], ink: 1, stars: [1, 1], items: [], hint: [] });
const worlds: WorldDef[] = [
  { id: 'a', name: 'A', levels: [lv('a1'), lv('a2'), lv('a3')] },
  { id: 'b', name: 'B', levels: [lv('b1'), lv('b2')] },
];
const levels = flatten(worlds);

describe('progress', () => {
  it('labels levels by world and number', () => {
    expect(levels.map((l) => l.label)).toEqual(['1-1', '1-2', '1-3', '2-1', '2-2']);
  });

  it('opens the first three levels at the start (two may be skipped)', () => {
    expect(unlockedMask(levels, emptySave())).toEqual([true, true, true, false, false]);
  });

  it('opens more as levels are solved', () => {
    const s = emptySave();
    s.stars.a1 = 1;
    expect(unlockedMask(levels, s)).toEqual([true, true, true, true, false]);
    s.stars.a3 = 2;
    expect(unlockedMask(levels, s)).toEqual([true, true, true, true, true]);
  });

  it('continues from the first open unsolved level', () => {
    const s = emptySave();
    expect(continueIndex(levels, s)).toBe(0);
    s.stars.a1 = 3;
    s.stars.a2 = 3;
    expect(continueIndex(levels, s)).toBe(2);
    for (const l of levels) s.stars[l.level.id] = 1;
    expect(continueIndex(levels, s)).toBe(-1);
  });
});
