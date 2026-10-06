export type Scenery = 'trees' | 'mushrooms' | 'palms' | 'factory' | 'windmills';

export interface Theme {
  skyTop: string;
  skyBottom: string;
  /** Distant hills or mountains. */
  far: string;
  /** Near hills along the bottom of the screen. */
  hills: string;
  /** Trees, buildings and other silhouettes on the hills. */
  scenery: Scenery;
  props: string;
  ground: string;
  groundDark: string;
  /** Speckles and strata in the ground. */
  groundSpeck: string;
  /** Grass (or snow, or metal) on top of the ground, and its darker underside. */
  top: string;
  topDark: string;
  accent: string;
  sun: string;
}

// One look per world. Index matches the world order in src/levels/index.ts.
export const THEMES: Theme[] = [
  {
    skyTop: '#62bdf0', skyBottom: '#d9f2ff', far: '#a9dcc0', hills: '#8fd27a', scenery: 'trees', props: '#5cae4c',
    ground: '#9a6438', groundDark: '#4f2f17', groundSpeck: '#b77b48', top: '#6fd14f', topDark: '#3f9a32', accent: '#ff4d4d', sun: '#fff3b0',
  },
  {
    skyTop: '#b796f0', skyBottom: '#ffe6f2', far: '#e7c3ee', hills: '#f3b6d8', scenery: 'mushrooms', props: '#d985b6',
    ground: '#5a8c7e', groundDark: '#2c4c43', groundSpeck: '#72a596', top: '#9ff0b8', topDark: '#5cc487', accent: '#ff4d8d', sun: '#fff0f7',
  },
  {
    skyTop: '#40c4d4', skyBottom: '#e6fffb', far: '#8fd9e6', hills: '#f2dd9a', scenery: 'palms', props: '#3faa7a',
    ground: '#b08a5a', groundDark: '#5e4426', groundSpeck: '#c9a571', top: '#f3d98c', topDark: '#d2b061', accent: '#ff7a3d', sun: '#fffbd0',
  },
  {
    skyTop: '#f08a5d', skyBottom: '#ffe9d6', far: '#e9a98a', hills: '#c98a74', scenery: 'factory', props: '#8f5f57',
    ground: '#5f6574', groundDark: '#2c303a', groundSpeck: '#737a8b', top: '#b6bfd2', topDark: '#858ea3', accent: '#ffcc33', sun: '#fff1c2',
  },
  {
    skyTop: '#7aa7f2', skyBottom: '#eef4ff', far: '#b9cbea', hills: '#dbe6f7', scenery: 'windmills', props: '#9fb1cf',
    ground: '#6f7f91', groundDark: '#36404c', groundSpeck: '#8494a6', top: '#ffffff', topDark: '#cfdcee', accent: '#ff5a5a', sun: '#ffffff',
  },
];

export const INK = '#26315c';
export const INK_GHOST = 'rgba(38,49,92,0.22)';
export const UI_DARK = '#1f2a44';
export const UI_LIGHT = '#ffffff';
export const UI_GREEN = '#2ec27e';
export const UI_GREEN_DARK = '#1f9461';
export const STAR_ON = '#ffc531';
export const STAR_OFF = 'rgba(31,42,68,0.18)';
/** Fredoka is bundled (src/assets/fonts) and loaded before the first frame; the rest are fallbacks. */
export const FONT = 'Fredoka, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

// Cosmetics (see src/game/cosmetics.ts for the list and unlock rules).

export type Unlock = { stars: number } | { streak: number };

export type BallStyle = 'classic' | 'solid' | 'eight' | 'beach' | 'flame' | 'gold' | 'tennis';

export interface BallSkin {
  kind: 'ball';
  id: string;
  style: BallStyle;
  /** Main colour, highlight colour, and the colour of the dimples or markings. */
  base: string;
  light: string;
  mark: string;
  unlock: Unlock;
}

export interface InkSkin {
  kind: 'ink';
  id: string;
  color: string;
  /** The faint colour used for the last attempt's ghost line. */
  ghost: string;
  unlock: Unlock;
}
