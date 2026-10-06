import { Game } from './game/game';
import { emptySave, parseSave } from './game/save';
import { DAILY_LEVELS, WORLDS } from './levels';
import { createPlatform } from './platform/platform';
import { loadFonts } from './render/fonts';

const platform = createPlatform();

window.addEventListener('error', () => platform.logError());
window.addEventListener('unhandledrejection', () => platform.logError());

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas, platform, WORLDS, DAILY_LEVELS);

async function loadSave(): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await platform.load();
    } catch {
      platform.logWarning();
      await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
    }
  }
  return null;
}

// Startup order the SDK expects: first frame on screen -> load cloud save -> interactive.
// The font is inlined in the bundle, so waiting for it costs a frame or two at most.
void loadFonts().then(() => {
  game.start();
  requestAnimationFrame(startup);
});

function startup(): void {
  platform.firstFrameReady();
  void loadSave().then((raw) => {
    // If the save could not be read, play on without writing so real progress is never overwritten.
    if (raw === null) game.setSave(emptySave(), false);
    else game.setSave(parseSave(raw), true);
    platform.gameReady();
  });
}
