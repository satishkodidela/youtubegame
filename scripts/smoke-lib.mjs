// Shared harness for the platform smoke tests (smoke.mjs for YouTube, smoke-crazygames.mjs).
// Serves a build folder, swaps the platform's SDK script for a mock, and runs scenarios in Chromium.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
export const W = 390;
export const H = 844;

// Counts AudioContexts so a test can tell whether the game tried to make sound.
const AUDIO_SPY = `
(() => {
  window.__audioContexts = 0;
  const AC = window.AudioContext;
  if (AC) window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__audioContexts++; } };
})();
`;

// Same layout maths as Game.resize(), so tests can tap and draw in world units.
export function viewFor(w, h) {
  const hudH = Math.round(Math.max(56, Math.min(80, h * 0.085)));
  const pad = Math.max(6, Math.min(w, h) * 0.015);
  const x = pad, y = hudH + pad * 0.5, fw = w - pad * 2, fh = h - hudH - pad * 1.5;
  const s = Math.min(fw / 10, fh / 14);
  return { s, ox: x + (fw - 10 * s) / 2, oy: y + (fh - 14 * s) / 2 };
}

export const calls = (page) => page.evaluate(() => window.__calls);
export const snap = (page) => page.evaluate(() => document.querySelector('canvas').toDataURL());
export const audioContexts = (page) => page.evaluate(() => window.__audioContexts);

/** Taps Play on the title screen (returning players; a first session lands in level 1 by itself). */
export async function tapPlay(page) {
  await page.mouse.click(W / 2, H * 0.58);
  await page.waitForTimeout(400);
}

/** Waits until a predicate on the page holds, polling, up to `ms`. Returns whether it did. */
export async function waitFor(page, pred, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await pred()) return true;
    await page.waitForTimeout(100);
  }
  return pred();
}

/** The game's screen, level id and play phase, as it mirrors them onto the canvas for tests. */
export const state = (page) => page.evaluate(() => ({ ...document.querySelector('canvas').dataset }));

/** Draws level 1's ramp (a 3-star line) and lets the ball roll in. */
export async function drawLevelOneRamp(page, { wait = 3500 } = {}) {
  const v = viewFor(W, H);
  const pts = [[1.4, 3.4], [4, 6.8], [5.75, 8.6]].map(([x, y]) => [v.ox + x * v.s, v.oy + y * v.s]);
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(wait);
}

/** Plays level 1: taps Play first for a returning player; a new player is already in the level. */
export async function playLevelOne(page, { returning = false } = {}) {
  if (returning) await tapPlay(page);
  await drawLevelOneRamp(page);
}

function serve(dir) {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      try {
        const body = await readFile(join(dir, path === '/' ? 'index.html' : path));
        res.writeHead(200, { 'content-type': TYPES[extname(path) || '.html'] ?? 'application/octet-stream' });
        res.end(body);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, () => resolve(server));
  });
}

/**
 * Runs scenarios against a build. Each scenario: { label, mock, fn(page, check), sdkFails? }.
 * `mock` is exposed to the mock SDK as window.__mock. With `sdkFails`, the SDK script fails to load.
 */
export async function smoke({ dist, sdkUrl, mockSdk, scenarios }) {
  let failures = 0;
  const check = (ok, msg) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
    if (!ok) failures++;
  };
  const server = await serve(dist);
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  try {
    for (const sc of scenarios) {
      const page = await browser.newPage({ viewport: { width: W, height: H } });
      const errors = [];
      const outside = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => {
        // A blocked SDK shows up as a failed resource load; that is the scenario, not a bug.
        if (m.type() === 'error' && !(sc.sdkFails && m.text().includes('Failed to load resource'))) errors.push(m.text());
      });
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (url === sdkUrl) return sc.sdkFails ? route.abort() : route.fulfill({ contentType: 'text/javascript', body: mockSdk });
        if (!url.startsWith(base)) {
          outside.push(url);
          return route.abort();
        }
        return route.continue();
      });
      await page.addInitScript(`window.__mock = ${JSON.stringify(sc.mock ?? {})};${AUDIO_SPY}`);
      await page.goto(base);
      await page.waitForTimeout(800);
      console.log(`-- ${sc.label}`);
      if (!sc.sdkFails) {
        const html = await page.content();
        check(html.indexOf(sdkUrl) >= 0 && html.indexOf(sdkUrl) < html.indexOf('type="module"'), 'SDK script comes before the game script');
      }
      await sc.fn(page, check);
      check(errors.length === 0, `no errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
      check(outside.length === 0, `no requests outside the game${outside.length ? `: ${outside.join(', ')}` : ''}`);
      await page.close();
    }
  } finally {
    await browser.close();
    server.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exit(failures ? 1 : 0);
}
