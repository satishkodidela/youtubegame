// Types for the YouTube Playables SDK loaded from https://www.youtube.com/game_api/v1.
// Only the parts this game uses.

declare namespace ytgame {
  const IN_PLAYABLES_ENV: boolean;
  const SDK_VERSION: string;

  namespace game {
    function firstFrameReady(): void;
    function gameReady(): void;
    function loadData(): Promise<string>;
    function saveData(data: string): Promise<void>;
  }

  namespace engagement {
    function sendScore(score: { value: number }): Promise<void>;
  }

  namespace health {
    function logError(): void;
    function logWarning(): void;
  }

  namespace system {
    function getLanguage(): Promise<string>;
    function isAudioEnabled(): boolean;
    function onAudioEnabledChange(callback: (isAudioEnabled: boolean) => void): () => void;
    function onPause(callback: () => void): () => void;
    function onResume(callback: () => void): () => void;
  }
}

interface Window {
  ytgame?: typeof ytgame;
}
