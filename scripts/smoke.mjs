// End-to-end check of the YouTube Playables build (dist/) against a mock Playables SDK.
// Run `npm run build` first, then `npm run smoke`. Uses Playwright's Chromium.
//
// Checks the integration points that certification looks at:
//   SDK load order, firstFrameReady -> loadData -> gameReady, cloud save after a win,
//   sendScore, pause/resume freezing the game, the audio setting, no outside network calls,
//   no errors, and that an unreadable save is never overwritten.
import { audioContexts, calls, playLevelOne, smoke, snap } from './smoke-lib.mjs';

// Records every SDK call in window.__calls. Behaviour is configured through window.__mock.
const MOCK_SDK = `
(() => {
  const m = window.__mock || {};
  const calls = (window.__calls = []);
  const log = (name, arg) => calls.push({ name, arg, t: performance.now() });
  window.ytgame = {
    IN_PLAYABLES_ENV: true,
    SDK_VERSION: 'mock',
    game: {
      firstFrameReady: () => log('firstFrameReady'),
      gameReady: () => log('gameReady'),
      loadData: () => { log('loadData'); return m.failLoad ? Promise.reject(new Error('offline')) : Promise.resolve(m.save || ''); },
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

const returning = { v: 1, stars: { m02: 2 }, ink: { m02: 5 }, sfx: true, future: 'kept' };

await smoke({
  dist: new URL('../dist/', import.meta.url).pathname,
  sdkUrl: 'https://www.youtube.com/game_api/v1',
  mockSdk: MOCK_SDK,
  scenarios: [
    {
      label: 'new player, sound off',
      mock: { audio: false },
      async fn(page, check) {
        let c = await calls(page);
        const names = c.map((x) => x.name);
        const ff = names.indexOf('firstFrameReady');
        const ld = names.indexOf('loadData');
        const gr = names.indexOf('gameReady');
        check(ff >= 0 && ld > ff && gr > ld, `startup order firstFrameReady -> loadData -> gameReady (${names.join(', ')})`);
        check(names.filter((n) => n === 'gameReady').length === 1, 'gameReady called once');

        await playLevelOne(page); // a first session starts in level 1, with no title screen
        c = await calls(page);
        const save = c.filter((x) => x.name === 'saveData').pop();
        const data = save ? JSON.parse(save.arg) : null;
        check(!!data && data.v >= 2 && data.stars.m01 >= 1, `win is cloud-saved in the current format (${save?.arg})`);
        check(!!data && data.streak && data.daily && data.look, 'save carries the v2 fields (daily, streak, look)');
        const score = c.filter((x) => x.name === 'sendScore').pop();
        check(!!score && score.arg === data?.stars.m01, `sendScore reports total stars (${score?.arg})`);
        check((await audioContexts(page)) === 0, 'no audio started while YouTube audio is off');

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
      },
    },
    {
      label: 'returning player, sound on',
      mock: { audio: true, save: JSON.stringify(returning) },
      async fn(page, check) {
        await playLevelOne(page, { returning: true }); // "Play" continues at the first unsolved level, which is 1-1 here
        const c = await calls(page);
        const save = c.filter((x) => x.name === 'saveData').pop();
        const data = save ? JSON.parse(save.arg) : null;
        check(!!data && data.stars.m01 === 3 && data.stars.m02 === 2 && data.future === 'kept', `progress merged, unknown fields kept (${save?.arg})`);
        check(!!data && data.v === 2 && data.streak && data.streak.count === 0, `v1 save upgraded to v2 (${save?.arg})`);
        const score = c.filter((x) => x.name === 'sendScore').pop();
        check(score?.arg === 5, `score is the new total (${score?.arg})`);
        check((await audioContexts(page)) === 1, 'audio starts after a tap when YouTube audio is on');
      },
    },
    {
      label: 'save cannot be read',
      mock: { audio: false, failLoad: true },
      async fn(page, check) {
        await page.waitForTimeout(2500);
        let c = await calls(page);
        check(c.some((x) => x.name === 'gameReady'), 'still becomes playable');
        await playLevelOne(page);
        c = await calls(page);
        check(!c.some((x) => x.name === 'saveData'), 'never overwrites a save it could not read');
      },
    },
  ],
});
