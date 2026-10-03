// End-to-end check of the CrazyGames build (dist-crazygames/) against a mock CrazyGames SDK v3.
// Run `npm run build:crazygames` first, then `npm run smoke:crazygames`. Uses Playwright's Chromium.
//
// Checks: SDK first on the page, nothing used before init(), loadingStart -> loadingStop,
// gameplayStart/Stop around real play (not menus, pause or the win card), saves through the
// Data Module, happytime on a 3-star win, the mute setting (including a live change), no outside
// network calls, no errors, and a working localStorage fallback when the SDK can't load.
import { audioContexts, calls, drawLevelOneRamp, playLevelOne, smoke, tapPlay, waitFor, W, H } from './smoke-lib.mjs';

const KEY = 'draw-to-hole-save';

// Records SDK calls in window.__calls. Any call before init() resolves is logged as "early:<name>".
const MOCK_SDK = `
(() => {
  const m = window.__mock || {};
  const calls = (window.__calls = []);
  const log = (name, arg) => calls.push({ name, arg });
  const store = new Map(Object.entries(m.data || {}));
  const listeners = [];
  let ready = false;
  const api = (name, fn) => (...args) => { log(ready ? name : 'early:' + name, args[1] ?? args[0]); return fn(...args); };
  const settings = { muteAudio: !!m.muted, disableChat: false };
  window.CrazyGames = { SDK: {
    init: () => {
      log('init');
      if (m.initFails) return Promise.reject(new Error('SDK disabled on this domain'));
      return new Promise((r) => setTimeout(() => { ready = true; r(); }, 50));
    },
    game: {
      loadingStart: api('loadingStart', () => {}),
      loadingStop: api('loadingStop', () => {}),
      gameplayStart: api('gameplayStart', () => {}),
      gameplayStop: api('gameplayStop', () => {}),
      happytime: api('happytime', () => {}),
      settings,
      addSettingsChangeListener: api('addSettingsChangeListener', (cb) => listeners.push(cb)),
    },
    data: {
      getItem: api('getItem', (k) => (store.has(k) ? store.get(k) : null)),
      setItem: api('setItem', (k, v) => store.set(k, String(v))),
      removeItem: api('removeItem', (k) => store.delete(k)),
      clear: api('clear', () => store.clear()),
    },
  } };
  window.__setMuted = (v) => { settings.muteAudio = v; listeners.forEach((cb) => cb(settings)); };
})();
`;

const names = (c) => c.map((x) => x.name);
const gameplay = (c) => names(c).filter((n) => n === 'gameplayStart' || n === 'gameplayStop');
const returning = { v: 1, stars: { m02: 2 }, ink: { m02: 5 }, sfx: true, future: 'kept' };

// HUD pause button and the pause screen's resume button, from the game's layout maths.
const btn = Math.round(Math.max(40, Math.min(56, Math.min(W, H) * 0.11)));
const hudH = Math.round(Math.max(56, Math.min(80, H * 0.085)));
const PAUSE = [btn * 0.85 * 0.8, hudH / 2 + 2];
const RESUME = [W / 2, H / 2 - btn * 0.8];

await smoke({
  dist: new URL('../dist-crazygames/', import.meta.url).pathname,
  sdkUrl: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
  mockSdk: MOCK_SDK,
  scenarios: [
    {
      label: 'new player, CrazyGames sound on',
      mock: {},
      async fn(page, check) {
        let c = await calls(page);
        const n = names(c);
        check(n[0] === 'init', `init() is the first SDK call (${n.join(', ')})`);
        check(!n.some((x) => x.startsWith('early:')), 'nothing is used before init() resolves');
        const ls = n.indexOf('loadingStart');
        const gi = n.indexOf('getItem');
        const lp = n.indexOf('loadingStop');
        check(ls > 0 && gi > ls && lp > gi, 'loadingStart -> load save -> loadingStop');
        check(n.filter((x) => x === 'loadingStop').length === 1, 'loadingStop called once');
        // A first session skips the title screen and lands in level 1, so gameplay starts straight away.
        check(gameplay(c).join() === 'gameplayStart', `gameplayStart as a new player lands in level 1 (${gameplay(c).join()})`);

        await page.mouse.click(PAUSE[0], PAUSE[1]);
        await page.waitForTimeout(200);
        c = await calls(page);
        check(gameplay(c).join() === 'gameplayStart,gameplayStop', 'gameplayStop on pause');
        await page.mouse.click(RESUME[0], RESUME[1]);
        await page.waitForTimeout(200);

        await drawLevelOneRamp(page);
        c = await calls(page);
        check(gameplay(c).join().startsWith('gameplayStart,gameplayStop,gameplayStart,gameplayStop'), `start/stop alternate, stop on the win card (${gameplay(c).join()})`);
        const save = c.filter((x) => x.name === 'setItem').pop();
        const data = save ? JSON.parse(save.arg) : null;
        check(!!data && data.v >= 2 && data.stars.m01 === 3, `win saved through the Data Module (${save?.arg})`);
        check(names(c).includes('happytime'), 'happytime on a 3-star win');
        check((await audioContexts(page)) === 1, 'audio starts after a tap when CrazyGames sound is on');
        // The win card moves on to level 2 by itself, which starts gameplay again.
        const advanced = await waitFor(page, async () => gameplay(await calls(page)).length >= 5, 4000);
        c = await calls(page);
        check(advanced && gameplay(c)[4] === 'gameplayStart', `win card auto-advances to the next level (${gameplay(c).join()})`);
      },
    },
    {
      label: 'muted by CrazyGames, then unmuted',
      mock: { muted: true },
      async fn(page, check) {
        await page.mouse.click(W / 2, H - 40); // any tap on the playfield (a new player is already in level 1)
        await page.waitForTimeout(300);
        check((await audioContexts(page)) === 0, 'no audio while CrazyGames has sound muted');
        await page.evaluate(() => window.__setMuted(false));
        await page.mouse.click(W / 2, H - 40); // any tap on the playfield
        await page.waitForTimeout(300);
        check((await audioContexts(page)) === 1, 'sound comes back when CrazyGames unmutes');
      },
    },
    {
      label: 'returning player',
      mock: { data: { [KEY]: JSON.stringify(returning) } },
      async fn(page, check) {
        let c = await calls(page);
        check(!names(c).includes('gameplayStart'), 'no gameplay reported on the title screen');
        await playLevelOne(page, { returning: true }); // "Play" continues at the first unsolved level, which is 1-1 here
        c = await calls(page);
        const save = c.filter((x) => x.name === 'setItem').pop();
        const data = save ? JSON.parse(save.arg) : null;
        check(!!data && data.stars.m01 === 3 && data.stars.m02 === 2 && data.future === 'kept', `progress merged, unknown fields kept (${save?.arg})`);
      },
    },
    {
      label: 'SDK loads but init() fails (e.g. outside crazygames.com)',
      mock: { initFails: true },
      async fn(page, check) {
        await playLevelOne(page);
        const c = await calls(page);
        check(!names(c).some((x) => x !== 'init'), `nothing but init() is called (${names(c).join(', ')})`);
        const stored = await page.evaluate((k) => localStorage.getItem(k), KEY);
        const data = stored ? JSON.parse(stored) : null;
        check(!!data && data.stars.m01 === 3, `still playable, progress kept in localStorage (${stored})`);
      },
    },
    {
      label: 'SDK fails to load',
      sdkFails: true,
      async fn(page, check) {
        await playLevelOne(page);
        const stored = await page.evaluate((k) => localStorage.getItem(k), KEY);
        const data = stored ? JSON.parse(stored) : null;
        check(!!data && data.stars.m01 === 3, `still playable, progress kept in localStorage (${stored})`);
      },
    },
  ],
});
