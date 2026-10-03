import { describe, expect, it } from 'vitest';
import { DAILY_EPOCH_DAY, currentStreak, dailyDone, dailyIndex, dayNumber, recordDaily } from '../src/game/daily';
import { emptySave } from '../src/game/save';

describe('daily hole', () => {
  it('numbers days by the local calendar date', () => {
    const noon = new Date(2026, 9, 3, 12, 0, 0).getTime();
    expect(dayNumber(noon)).toBe(DAILY_EPOCH_DAY);
    expect(dayNumber(new Date(2026, 9, 3, 0, 0, 1).getTime())).toBe(DAILY_EPOCH_DAY);
    expect(dayNumber(new Date(2026, 9, 3, 23, 59, 59).getTime())).toBe(DAILY_EPOCH_DAY);
    expect(dayNumber(new Date(2026, 9, 4, 0, 0, 1).getTime())).toBe(DAILY_EPOCH_DAY + 1);
    expect(dayNumber(new Date(2026, 9, 2, 23, 59, 59).getTime())).toBe(DAILY_EPOCH_DAY - 1);
  });

  it('serves one level per day and wraps around the set', () => {
    expect(dailyIndex(DAILY_EPOCH_DAY, 120)).toBe(0);
    expect(dailyIndex(DAILY_EPOCH_DAY + 119, 120)).toBe(119);
    expect(dailyIndex(DAILY_EPOCH_DAY + 120, 120)).toBe(0);
    expect(dailyIndex(DAILY_EPOCH_DAY - 1, 120)).toBe(119);
    expect(dailyIndex(DAILY_EPOCH_DAY + 5, 0)).toBe(-1);
  });

  it('counts a streak across consecutive days and resets after a missed day', () => {
    const s = emptySave();
    const d = 1000;
    expect(currentStreak(s, d)).toBe(0);
    expect(recordDaily(s, d, 2)).toBe(true);
    expect(s.streak).toEqual({ last: d, count: 1, best: 1 });
    expect(dailyDone(s, d)).toBe(true);
    expect(dailyDone(s, d + 1)).toBe(false);
    // A second win the same day improves stars only.
    expect(recordDaily(s, d, 3)).toBe(true);
    expect(recordDaily(s, d, 1)).toBe(false);
    expect(s.daily[String(d)]).toBe(3);
    expect(s.streak.count).toBe(1);
    recordDaily(s, d + 1, 1);
    recordDaily(s, d + 2, 1);
    expect(s.streak).toEqual({ last: d + 2, count: 3, best: 3 });
    expect(currentStreak(s, d + 2)).toBe(3);
    expect(currentStreak(s, d + 3)).toBe(3); // still alive: yesterday was won
    expect(currentStreak(s, d + 4)).toBe(0); // missed a day
    recordDaily(s, d + 4, 2);
    expect(s.streak).toEqual({ last: d + 4, count: 1, best: 3 });
  });
});
