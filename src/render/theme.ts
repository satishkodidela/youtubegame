export interface Theme {
  skyTop: string;
  skyBottom: string;
  hills: string;
  ground: string;
  groundDark: string;
  top: string;
  accent: string;
}

// One look per world. Index matches the world order in src/levels/index.ts.
export const THEMES: Theme[] = [
  { skyTop: '#7cc8f2', skyBottom: '#dff4ff', hills: '#b6e3a6', ground: '#8a5a33', groundDark: '#6b4225', top: '#5bbf45', accent: '#ff4d4d' },
  { skyTop: '#b39cf0', skyBottom: '#fbe8ff', hills: '#d9c4f5', ground: '#6e4f86', groundDark: '#533a68', top: '#5fd39a', accent: '#ff4d8d' },
  { skyTop: '#5fd0d0', skyBottom: '#e8fffb', hills: '#a7e8d8', ground: '#a58257', groundDark: '#82633f', top: '#f0d58a', accent: '#ff7a3d' },
  { skyTop: '#f59f6a', skyBottom: '#ffeedd', hills: '#f8c9a6', ground: '#5d6270', groundDark: '#464a55', top: '#a4adc0', accent: '#ffcc33' },
  { skyTop: '#8fb4f5', skyBottom: '#f0f5ff', hills: '#c9d8f2', ground: '#6d7c8c', groundDark: '#55616e', top: '#f4f8ff', accent: '#ff5a5a' },
];

export const INK = '#26315c';
export const INK_GHOST = 'rgba(38,49,92,0.22)';
export const UI_DARK = '#1f2a44';
export const UI_LIGHT = '#ffffff';
export const STAR_ON = '#ffc531';
export const STAR_OFF = 'rgba(31,42,68,0.18)';
export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
