import type { FailReason } from '../sim/sim';

// Every word the player sees, in one place so the game can be translated later. Keep them short:
// they are drawn on buttons and banners sized for phones.

export const T = {
  play: 'PLAY',
  daily: 'DAILY',
  levels: 'LEVELS',
  looks: 'LOOKS',
  next: 'NEXT',
  resume: 'RESUME',
  paused: 'PAUSED',
  /** Win headline by stars earned (index 1..3). */
  win: ['', 'NICE!', 'GREAT!', 'PERFECT!'],
  inkUsed: (ink: string) => `Ink used: ${ink}`,
  forThree: (ink: string) => `3 stars at ${ink} or less`,
  allStars: 'Shortest line. Well done!',
  goldInk: 'Gold ink: as short as the par line!',
  worldClear: 'WORLD CLEAR!',
  allClear: 'ALL CLEAR!',
  fail: { water: 'SPLASH!', out: 'MISSED!', stuck: 'STUCK!', timeout: 'TOO SLOW!' } as Record<FailReason, string>,
  /** Tip for the first level of each world, shown until that level is solved. */
  worldTips: [
    'Draw a line to guide the ball into the hole',
    'Pink pads bounce the ball high',
    'Water is a splash. Build a bridge!',
    'Platforms start moving when the ball drops',
    'Wind pushes the ball. Use it!',
  ],
  hintTip: 'Stuck? Tap the bulb for a hint',
  dailyTip: 'A new Daily Hole every day. Keep your streak!',
  starsTip: 'Shorter lines earn more stars',
  twoBallsTip: 'Two balls: get them both in!',
};
