import { describe, expect, it } from 'vitest';
import { recordDaily } from '../src/game/daily';
import { SAVE_VERSION, emptySave, isFresh, parseSave, recordWin, serializeSave, totalStars } from '../src/game/save';

describe('save data', () => {
  it('starts empty for missing or corrupt data', () => {
    for (const raw of ['', null, undefined, 'not json', '[]', '42', '"x"', '{"stars": 5}']) {
      const s = parseSave(raw as string);
      expect(s.stars).toEqual({});
      expect(s.sfx).toBe(true);
    }
  });

  it('round-trips', () => {
    const s = emptySave();
    recordWin(s, 'm01', 3, 2.345);
    recordWin(s, 's04', 1, 9);
    const back = parseSave(serializeSave(s));
    expect(back.stars).toEqual({ m01: 3, s04: 1 });
    expect(back.ink).toEqual({ m01: 2.35, s04: 9 });
    expect(totalStars(back)).toBe(4);
  });

  it('keeps the best result only', () => {
    const s = emptySave();
    expect(recordWin(s, 'm01', 2, 5)).toBe(true);
    expect(recordWin(s, 'm01', 1, 6)).toBe(false);
    expect(s.stars.m01).toBe(2);
    expect(recordWin(s, 'm01', 2, 4)).toBe(true);
    expect(s.ink.m01).toBe(4);
    expect(recordWin(s, 'm01', 3, 4.5)).toBe(true);
    expect(s.stars.m01).toBe(3);
  });

  it('reads saves written by older versions (v0: no version field)', () => {
    const s = parseSave('{"stars":{"m01":3,"m02":2},"sfx":false}');
    expect(s.v).toBe(SAVE_VERSION);
    expect(s.stars).toEqual({ m01: 3, m02: 2 });
    expect(s.sfx).toBe(false);
  });

  it('upgrades a v1 save to v2 with empty daily, streak and look fields', () => {
    const s = parseSave('{"v":1,"stars":{"m01":3},"ink":{"m01":2.5},"sfx":true}');
    expect(s.v).toBe(2);
    expect(s.stars).toEqual({ m01: 3 });
    expect(s.daily).toEqual({});
    expect(s.streak).toEqual({ last: -1, count: 0, best: 0 });
    expect(s.look).toEqual({ ball: 'classic', ink: 'navy' });
    expect(s.seen).toEqual([]);
    expect(isFresh(s)).toBe(false);
    expect(isFresh(emptySave())).toBe(true);
  });

  it('round-trips v2 fields and cleans bad ones', () => {
    const s = emptySave();
    recordDaily(s, 20000, 2);
    s.look = { ball: 'sun', ink: 'crimson' };
    s.seen.push('sun');
    const back = parseSave(serializeSave(s));
    expect(back.daily).toEqual({ '20000': 2 });
    expect(back.streak).toEqual({ last: 20000, count: 1, best: 1 });
    expect(back.look).toEqual({ ball: 'sun', ink: 'crimson' });
    expect(back.seen).toEqual(['sun']);
    const bad = parseSave('{"v":2,"daily":{"abc":3,"5":"x","7":9,"8":0},"streak":{"last":"x","count":4},"look":{"ball":3},"seen":[1,"ok"]}');
    expect(bad.daily).toEqual({ '7': 3 });
    expect(bad.streak).toEqual({ last: -1, count: 0, best: 4 });
    expect(bad.look).toEqual({ ball: 'classic', ink: 'navy' });
    expect(bad.seen).toEqual(['ok']);
  });

  it('keeps fields it does not understand, so newer saves survive an older build', () => {
    const raw = JSON.stringify({ v: SAVE_VERSION + 3, stars: { m01: 3 }, ink: {}, sfx: true, cosmetics: ['red-ball'] });
    const s = parseSave(raw);
    expect(s.v).toBe(SAVE_VERSION + 3);
    const again = JSON.parse(serializeSave(s));
    expect(again.cosmetics).toEqual(['red-ball']);
    expect(again.v).toBe(SAVE_VERSION + 3);
  });

  it('cleans bad values', () => {
    const s = parseSave('{"stars":{"a":7,"b":0,"c":"x","d":2.4},"ink":{"a":-1,"b":3}}');
    expect(s.stars).toEqual({ a: 3, d: 2 });
    expect(s.ink).toEqual({ b: 3 });
  });
});
