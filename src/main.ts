import { Game } from './game/game';
import { emptySave, parseSave } from './game/save';
import { WORLDS } from './levels';
import { createPlatform } from './platform/platform';

const platform = createPlatform();

window.addEventListener('error', () => platform.logError());
window.addEventListener('unhandledrejection', () => platform.logError());

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas, platform, WORLDS);
game.start();

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
requestAnimationFrame(() => {
  platform.firstFrameReady();
  void loadSave().then((raw) => {
    // If the save could not be read, play on without writing so real progress is never overwritten.
    if (raw === null) game.setSave(emptySave(), false);
    else game.setSave(parseSave(raw), true);
    platform.gameReady();
  });
});
