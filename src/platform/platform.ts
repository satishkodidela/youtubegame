/// <reference path="./ytgame.d.ts" />
/// <reference path="./crazygames.d.ts" />

// Everything the game needs from its host. Each build includes only its own host code:
//   YouTube Playables (__PLAYABLES__)  the ytgame SDK; no browser storage at all
//   CrazyGames (__CRAZYGAMES__)        the CrazyGames SDK v3, with a localStorage fallback
//   dev and preview builds             localStorage and page visibility

export interface Platform {
  readonly name: 'youtube' | 'crazygames' | 'web' | 'memory';
  firstFrameReady(): void;
  gameReady(): void;
  load(): Promise<string>;
  save(data: string): Promise<void>;
  sendScore(value: number): void;
  /** Called every frame with whether the player is actively playing (not in a menu, pause or win card). */
  setGameplay(active: boolean): void;
  /** A great moment, such as a 3-star finish. */
  celebrate(): void;
  audioEnabled(): boolean;
  onAudioChange(cb: (enabled: boolean) => void): void;
  onPause(cb: () => void): void;
  onResume(cb: () => void): void;
  logError(): void;
  logWarning(): void;
}

export function createPlatform(): Platform {
  if (__CRAZYGAMES__) return crazyGames();
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
    setGameplay() {},
    celebrate() {},
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
    setGameplay() {},
    celebrate() {},
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
    setGameplay() {},
    celebrate() {},
    audioEnabled: () => true,
    onAudioChange() {},
    onPause() {},
    onResume() {},
    logError() {},
    logWarning() {},
  };
}

/**
 * CrazyGames SDK v3. Saves go through the Data Module (synced to the player's account; select
 * "Data Module" for progress save when submitting). If the SDK is missing or init() fails, for
 * example when the build is opened outside CrazyGames, it falls back to localStorage.
 */
function crazyGames(): Platform {
  const fallback = web();
  const sdk = typeof window !== 'undefined' ? window.CrazyGames?.SDK : undefined;
  if (!sdk) return { ...fallback, name: 'web' };

  let ok = false;
  let sentGameplay = false;
  const audioListeners: ((enabled: boolean) => void)[] = [];
  const muted = () => {
    try {
      return !!sdk.game.settings.muteAudio;
    } catch {
      return false;
    }
  };
  // SDK calls may return promises; never let one throw or reject into the game.
  const call = (fn: () => unknown) => {
    if (!ok) return false;
    try {
      const r = fn() as Promise<unknown> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => {});
      return true;
    } catch {
      return false;
    }
  };
  const ready: Promise<boolean> = sdk
    .init()
    .then(() => {
      ok = true;
      call(() => sdk.game.loadingStart());
      call(() => sdk.game.addSettingsChangeListener(() => audioListeners.forEach((cb) => cb(!muted()))));
      audioListeners.forEach((cb) => cb(!muted()));
      return true;
    })
    .catch(() => false);

  return {
    name: 'crazygames',
    firstFrameReady() {},
    gameReady() {
      void ready.then(() => call(() => sdk.game.loadingStop()));
    },
    async load() {
      if (!(await ready)) return fallback.load();
      try {
        return sdk.data.getItem(STORAGE_KEY) ?? '';
      } catch {
        return fallback.load();
      }
    },
    async save(data) {
      if (!(await ready)) return fallback.save(data);
      try {
        sdk.data.setItem(STORAGE_KEY, data);
      } catch {
        await fallback.save(data);
      }
    },
    sendScore() {},
    setGameplay(active) {
      // Only report changes, and only once the SDK is ready to hear them.
      if (active === sentGameplay) return;
      if (call(() => (active ? sdk.game.gameplayStart() : sdk.game.gameplayStop()))) sentGameplay = active;
    },
    celebrate() {
      call(() => sdk.game.happytime());
    },
    audioEnabled: () => !muted(),
    onAudioChange: (cb) => void audioListeners.push(cb),
    onPause: fallback.onPause,
    onResume: fallback.onResume,
    logError() {},
    logWarning() {},
  };
}
