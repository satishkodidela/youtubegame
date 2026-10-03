import { describe, expect, it } from 'vitest';
import { WORLDS } from '../src/levels';
import { Sim } from '../src/sim/sim';
import { traceStroke } from '../src/sim/stroke';

describe('determinism', () => {
  it('the same line always gives the same result', () => {
    for (const w of WORLDS) {
      const level = w.levels[7];
      const { line } = traceStroke(level, level.hint);
      const run = () => {
        const sim = new Sim(level, line);
        const trace: number[] = [];
        while (sim.status === 'running' && sim.time < 14) {
          sim.step();
          for (const b of sim.ballViews()) trace.push(b.x, b.y);
        }
        return { status: sim.status, time: sim.time, trace };
      };
      const a = run();
      const b = run();
      expect(b.status).toBe(a.status);
      expect(b.time).toBe(a.time);
      expect(b.trace).toEqual(a.trace);
    }
  });
});
