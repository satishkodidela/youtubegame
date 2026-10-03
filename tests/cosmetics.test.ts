import { describe, expect, it } from 'vitest';
import { ALL_COSMETICS, BALL_SKINS, INK_SKINS, currentBall, currentInk, isUnlocked, markSeen, newUnlocks, starsToNextUnlock } from '../src/game/cosmetics';
import { emptySave } from '../src/game/save';

describe('cosmetics', () => {
  it('has unique ids and a default of each kind that is always unlocked', () => {
    const ids = ALL_COSMETICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const s = emptySave();
    expect(isUnlocked(BALL_SKINS[0], s)).toBe(true);
    expect(isUnlocked(INK_SKINS[0], s)).toBe(true);
    expect(currentBall(s).id).toBe('classic');
    expect(currentInk(s).id).toBe('navy');
  });

  it('unlocks by total stars and by best streak', () => {
    const s = emptySave();
    expect(newUnlocks(s)).toEqual([]);
    expect(starsToNextUnlock(s)).toBe(15);
    for (let i = 0; i < 5; i++) s.stars[`m0${i}`] = 3;
    const fresh = newUnlocks(s);
    expect(fresh.map((c) => c.id)).toEqual(['sun']);
    expect(markSeen(s, fresh)).toBe(true);
    expect(markSeen(s, fresh)).toBe(false);
    expect(newUnlocks(s)).toEqual([]);
    expect(starsToNextUnlock(s)).toBe(15);
    s.streak.best = 3;
    expect(newUnlocks(s).map((c) => c.id)).toEqual(['tennis', 'chalk']);
  });

  it('falls back to the default look when the chosen item is unknown or locked', () => {
    const s = emptySave();
    s.look = { ball: 'flame', ink: 'nope' };
    expect(currentBall(s).id).toBe('classic');
    expect(currentInk(s).id).toBe('navy');
    s.streak.best = 7;
    expect(currentBall(s).id).toBe('flame');
  });
});
