/// <reference path="./ytgame.d.ts" />

// Everything the game needs from its host. Inside YouTube Playables this is the ytgame SDK.
// The web fallback (localStorage, page visibility) exists only in the dev and preview builds;
// __PLAYABLES__ strips it from the Playables bundle so certification never sees those APIs.

export interface Platform {
  readonly name: 'youtube' | 'web' | 'memory';
  firstFrameReady(): void;
  gameReady(): void;
  load(): Promise<string>;
  save(data: string): Promise<void>;
  sendScore(value: number): void;
  audioEnabled(): boolean;
  onAudioChange(cb: (enabled: boolean) => void): void;
  onPause(cb: () => void): void;
  onResume(cb: () => void): void;
  logError(): void;
  logWarning(): void;
}

export function createPlatform(): Platform {
  const yt = typeof window !== 'undefined' ? window.ytgame : undefined;
  if (yt && yt.IN_PLAYABLES_ENV) return youtube(yt);
  if (!__PLAYABLES__) return web();
  return memory();
}

function youtube(yt: typeof ytgame): Platform {
  let saving: Promise<void> = Promise.resolve();
  const warn = () => {
    try {
      yt.health.logWarning();
    } catch {
      /* nothing else to do */
    }
  };
  return {
    name: 'youtube',
    firstFrameReady: () => yt.game.firstFrameReady(),
    gameReady: () => yt.game.gameReady(),
    load: () => yt.game.loadData(),
    save(data) {
      // Serialise writes so an older save can never land after a newer one.
      saving = saving.then(() => yt.game.saveData(data)).catch(warn);
      return saving;
    },
    sendScore(value) {
      yt.engagement.sendScore({ value }).catch(warn);
    },
    audioEnabled: () => yt.system.isAudioEnabled(),
    onAudioChange: (cb) => void yt.system.onAudioEnabledChange(cb),
    onPause: (cb) => void yt.system.onPause(cb),
    onResume: (cb) => void yt.system.onResume(cb),
    logError: () => yt.health.logError(),
    logWarning: warn,
  };
}

const STORAGE_KEY = 'draw-to-hole-save';

function web(): Platform {
  return {
    name: 'web',
    firstFrameReady() {},
    gameReady() {},
    async load() {
      try {
        return window.localStorage.getItem(STORAGE_KEY) ?? '';
      } catch {
        return '';
      }
    },
    async save(data) {
      try {
        window.localStorage.setItem(STORAGE_KEY, data);
      } catch {
        /* private mode or storage blocked: progress lasts for this visit only */
      }
    },
    sendScore() {},
    audioEnabled: () => true,
    onAudioChange() {},
    onPause(cb) {
      document.addEventListener('visibilitychange', () => document.hidden && cb());
    },
    onResume(cb) {
      document.addEventListener('visibilitychange', () => !document.hidden && cb());
    },
    logError() {},
    logWarning() {},
  };
}

function memory(): Platform {
  let stored = '';
  return {
    name: 'memory',
    firstFrameReady() {},
    gameReady() {},
    load: async () => stored,
    save: async (data) => {
      stored = data;
    },
    sendScore() {},
    audioEnabled: () => true,
    onAudioChange() {},
    onPause() {},
    onResume() {},
    logError() {},
    logWarning() {},
  };
}
