// Frame-rate benchmark for low-end phones. Not part of CI (timings are noisy on shared runners).
//   npm run build:preview && npm run perf
// Loads dist-preview/index.html at phone size (390x844, 2x pixel density) with the CPU slowed down
// 6x, opens a few busy levels and records frame intervals while idle and while the ball rolls.
// Options: --cpu N (throttle factor, default 6), --seconds N (per phase, default 4), --dpr N (default 2)
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const CPU = opt('--cpu', 6);
const SECONDS = opt('--seconds', 4);
const DPR = opt('--dpr', 2);
const W = 390;
const H = 844;
const FILE = new URL('../dist-preview/index.html', import.meta.url).href;

const worlds = ['w1-meadow', 'w2-springs', 'w3-lagoon', 'w4-workshop', 'w5-gusts'].map(
  (f) => JSON.parse(readFileSync(new URL(`../src/levels/${f}.json`, import.meta.url), 'utf8')).levels,
);
// [world, level] pairs, 0-based: water stepping stones, twin windmills, storm bridge (wind + 2 balls).
const CASES = [
  [2, 4],
  [3, 10],
  [4, 9],
];

// Same layout maths as Game.resize() and the select screen, so we can tap and draw in world units.
const hudH = Math.round(Math.max(56, Math.min(80, H * 0.085)));
const pad = Math.max(6, Math.min(W, H) * 0.015);
const fx = pad, fy = hudH + pad * 0.5, fw = W - pad * 2, fh = H - hudH - pad * 1.5;
const s = Math.min(fw / 10, fh / 14);
const view = { s, ox: fx + (fw - 10 * s) / 2, oy: fy + (fh - 14 * s) / 2 };
const size = Math.round(Math.max(40, Math.min(56, Math.min(W, H) * 0.11)));

function tilePos(i) {
  const top = hudH + 16;
  const availW = W - 32;
  const availH = H - top - 24;
  const cols = availW > availH ? 4 : 3;
  const cell = Math.min(availW / cols, availH / Math.ceil(12 / cols), 130);
  const gx = (W - cell * cols) / 2;
  const gy = top + (availH - cell * Math.ceil(12 / cols)) / 2;
  return [gx + (i % cols) * cell + cell / 2, gy + Math.floor(i / cols) * cell + cell / 2];
}

function stats(intervals) {
  const sorted = intervals.slice().sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return {
    fps: +(1000 / mean).toFixed(1),
    p50: +pct(0.5).toFixed(1),
    p95: +pct(0.95).toFixed(1),
    over33ms: intervals.filter((x) => x > 33.4).length,
    frames: intervals.length,
  };
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const allStars = Object.fromEntries(worlds.flat().map((l) => [l.id, 1]));
const results = [];

for (const [wi, li] of CASES) {
  const level = worlds[wi][li];
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: DPR });
  await page.addInitScript((save) => {
    try {
      localStorage.setItem('draw-to-hole-save', save);
    } catch {}
    window.__frames = [];
    const tick = (t) => {
      window.__frames.push(t);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, JSON.stringify({ v: 1, stars: allStars, ink: {}, sfx: false }));
  const cdp = await page.context().newCDPSession(page);
  await page.goto(FILE);
  await page.waitForTimeout(800);

  // Title -> level select -> world -> level.
  await page.mouse.click(W / 2, H * 0.62 + size * 1.75);
  await page.waitForTimeout(300);
  for (let k = 0; k < wi; k++) {
    await page.mouse.click(W / 2 + size * 2.05, hudH / 2 + 4);
    await page.waitForTimeout(150);
  }
  const [tx, ty] = tilePos(li);
  await page.mouse.click(tx, ty);
  await page.waitForTimeout(500);

  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  const measure = async () => {
    await page.evaluate(() => (window.__frames = []));
    await page.waitForTimeout(SECONDS * 1000);
    const f = await page.evaluate(() => window.__frames);
    return stats(f.slice(1).map((t, i) => t - f[i]));
  };
  const idle = await measure();

  // Draw the level's hint and release, then measure while it rolls.
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  const pts = level.hint.map(([x, y]) => [view.ox + x * view.s, view.oy + y * view.s]);
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 20 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
  await page.mouse.up();
  const roll = await measure();

  results.push({ level: `${wi + 1}-${li + 1} ${level.id}`, idle, roll });
  await page.close();
}
await browser.close();

console.log(`CPU throttle ${CPU}x, ${W}x${H} @${DPR}x, ${SECONDS}s per phase`);
for (const r of results) {
  for (const phase of ['idle', 'roll']) {
    const m = r[phase];
    console.log(`${r.level.padEnd(12)} ${phase.padEnd(5)} ${String(m.fps).padStart(5)} fps  p50 ${m.p50}ms  p95 ${m.p95}ms  >33ms: ${m.over33ms}/${m.frames}`);
  }
}
