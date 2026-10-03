// Types for the CrazyGames HTML5 SDK v3 loaded from https://sdk.crazygames.com/crazygames-sdk-v3.js.
// Only the parts this game uses. Every call other than init() needs init() to have resolved.

interface CrazyGamesSdk {
  init(): Promise<void>;
  game: {
    loadingStart(): void | Promise<void>;
    loadingStop(): void | Promise<void>;
    gameplayStart(): void | Promise<void>;
    gameplayStop(): void | Promise<void>;
    happytime(): void | Promise<void>;
    settings: { muteAudio: boolean; disableChat: boolean };
    addSettingsChangeListener(listener: (settings: { muteAudio: boolean }) => void): void;
  };
  /** Like localStorage, but synced to the player's CrazyGames account. Preloaded by init(). */
  data: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    clear(): void;
  };
}

interface Window {
  CrazyGames?: { SDK: CrazyGamesSdk };
}
