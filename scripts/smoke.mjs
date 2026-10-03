// End-to-end check of the Playables build (dist/) against a mock YouTube Playables SDK.
// Run `npm run build` first, then `npm run smoke`. Uses Playwright's Chromium.
//
// Checks the integration points that certification looks at:
//   SDK load order, firstFrameReady -> loadData -> gameReady, cloud save after a win,
//   sendScore, pause/resume freezing the game, the audio setting, no outside network calls,
//   no errors, and that an unreadable save is never overwritten.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = new URL('../dist/', import.meta.url).pathname;
const SDK_URL = 'https://www.youtube.com/game_api/v1';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

// Records every SDK call in window.__calls. Behaviour is configured through window.__mock.
const MOCK_SDK = `
(() => {
  const m = window.__mock || {};
  const calls = (window.__calls = []);
  const log = (name, arg) => calls.push({ name, arg, t: performance.now() });
  let loads = 0;
  window.ytgame = {
    IN_PLAYABLES_ENV: true,
    SDK_VERSION: 'mock',
    game: {
      firstFrameReady: () => log('firstFrameReady'),
      gameReady: () => log('gameReady'),
      loadData: () => { log('loadData'); loads++; return m.failLoad ? Promise.reject(new Error('offline')) : Promise.resolve(m.save || ''); },
      saveData: (d) => { log('saveData', d); return Promise.resolve(); },
    },
    engagement: { sendScore: (s) => { log('sendScore', s.value); return Promise.resolve(); } },
    health: { logError: () => log('logError'), logWarning: () => log('logWarning') },
    system: {
      getLanguage: () => Promise.resolve('en'),
      isAudioEnabled: () => !!m.audio,
      onAudioEnabledChange: (cb) => { window.__audioCb = cb; return () => {}; },
      onPause: (cb) => { window.__pause = cb; return () => {}; },
      onResume: (cb) => { window.__resume = cb; return () => {}; },
    },
  };
})();
`;

// Counts AudioContexts so we can tell whether the game tried to make sound.
const AUDIO_SPY = `
(() => {
  window.__audioContexts = 0;
  const AC = window.AudioContext;
  if (AC) window.AudioContext = class extends AC { constructor(...a) { super(...a); window.__audioContexts++; } };
})();
`;

function serve() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      try {
        const body = await readFile(join(DIST, path === '/' ? 'index.html' : path));
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

let failures = 0;
function check(ok, msg) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
}

// Same layout maths as Game.resize(), so we can draw in world units.
function viewFor(W, H) {
  const hudH = Math.round(Math.max(56, Math.min(80, H * 0.085)));
  const pad = Math.max(6, Math.min(W, H) * 0.015);
  const x = pad, y = hudH + pad * 0.5, w = W - pad * 2, h = H - hudH - pad * 1.5;
  const s = Math.min(w / 10, h / 14);
  return { s, ox: x + (w - 10 * s) / 2, oy: y + (h - 14 * s) / 2 };
}

async function run(browser, base, mock, label, fn) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  const outside = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url === SDK_URL) return route.fulfill({ contentType: 'text/javascript', body: MOCK_SDK });
    if (!url.startsWith(base)) {
      outside.push(url);
      return route.abort();
    }
    return route.continue();
  });
  await page.addInitScript(`window.__mock = ${JSON.stringify(mock)};${AUDIO_SPY}`);
  await page.goto(base);
  await page.waitForTimeout(800);
  console.log(`-- ${label}`);
  await fn(page);
  check(errors.length === 0, `no errors${errors.length ? `: ${errors.join(' | ')}` : ''}`);
  check(outside.length === 0, `no requests outside the game${outside.length ? `: ${outside.join(', ')}` : ''}`);
  await page.close();
}

const calls = (page) => page.evaluate(() => window.__calls);
const snap = (page) => page.evaluate(() => document.querySelector('canvas').toDataURL());

async function playLevelOne(page) {
  const v = viewFor(390, 844);
  await page.mouse.click(195, 844 * 0.62); // Play
  await page.waitForTimeout(400);
  const pts = [[1.4, 3.4], [4, 6.8], [5.75, 8.6]].map(([x, y]) => [v.ox + x * v.s, v.oy + y * v.s]);
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 25 });
  await page.mouse.up();
  await page.waitForTimeout(3500);
}

const server = await serve();
const base = `http://localhost:${server.address().port}/`;
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

try {
  await run(browser, base, { audio: false }, 'new player, sound off', async (page) => {
    const html = await page.content();
    check(html.indexOf(SDK_URL) < html.indexOf('type="module"'), 'SDK script comes before the game script');
    let c = await calls(page);
    const names = c.map((x) => x.name);
    const ff = names.indexOf('firstFrameReady');
    const ld = names.indexOf('loadData');
    const gr = names.indexOf('gameReady');
    check(ff >= 0 && ld > ff && gr > ld, `startup order firstFrameReady -> loadData -> gameReady (${names.join(', ')})`);
    check(names.filter((n) => n === 'gameReady').length === 1, 'gameReady called once');

    await playLevelOne(page);
    c = await calls(page);
    const save = c.filter((x) => x.name === 'saveData').pop();
    const data = save ? JSON.parse(save.arg) : null;
    check(!!data && data.v >= 1 && data.stars.m01 >= 1, `win is cloud-saved (${save?.arg})`);
    const score = c.filter((x) => x.name === 'sendScore').pop();
    check(!!score && score.arg === data?.stars.m01, `sendScore reports total stars (${score?.arg})`);
    check((await page.evaluate(() => window.__audioContexts)) === 0, 'no audio started while YouTube audio is off');

    await page.evaluate(() => window.__pause());
    await page.waitForTimeout(100);
    const a = await snap(page);
    await page.waitForTimeout(400);
    const b = await snap(page);
    check(a === b, 'onPause freezes the game');
    await page.evaluate(() => window.__resume());
    await page.waitForTimeout(400);
    check((await snap(page)) !== b, 'onResume restarts it');

    await page.setViewportSize({ width: 1280, height: 720 });
    await page.waitForTimeout(300);
    const dims = await page.evaluate(() => [document.querySelector('canvas').clientWidth, document.querySelector('canvas').clientHeight]);
    check(dims[0] === 1280 && dims[1] === 720, 'canvas follows a resize');
  });

  const returning = { v: 1, stars: { m02: 2 }, ink: { m02: 5 }, sfx: true, future: 'kept' };
  await run(browser, base, { audio: true, save: JSON.stringify(returning) }, 'returning player, sound on', async (page) => {
    await playLevelOne(page); // "Play" continues at the first unsolved level, which is 1-1 here
    const c = await calls(page);
    const save = c.filter((x) => x.name === 'saveData').pop();
    const data = save ? JSON.parse(save.arg) : null;
    check(!!data && data.stars.m01 === 3 && data.stars.m02 === 2 && data.future === 'kept', `progress merged, unknown fields kept (${save?.arg})`);
    const score = c.filter((x) => x.name === 'sendScore').pop();
    check(score?.arg === 5, `score is the new total (${score?.arg})`);
    check((await page.evaluate(() => window.__audioContexts)) === 1, 'audio starts after a tap when YouTube audio is on');
  });

  await run(browser, base, { audio: false, failLoad: true }, 'save cannot be read', async (page) => {
    await page.waitForTimeout(2500);
    let c = await calls(page);
    check(c.some((x) => x.name === 'gameReady'), 'still becomes playable');
    await playLevelOne(page);
    c = await calls(page);
    check(!c.some((x) => x.name === 'saveData'), 'never overwrites a save it could not read');
  });
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
