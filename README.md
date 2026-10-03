# Draw to Hole

A one-finger physics puzzle built for **YouTube Playables**. Draw one line, lift your finger, and
the ball drops and rolls. Get it in the hole. Less ink earns more stars.

- 60 levels in 5 worlds of 12, each world adding one idea:
  1. **Meadow**: ramps, walls and gaps
  2. **Springs**: bouncy pads that throw the ball higher than it started
  3. **Lagoon**: water, where a splash means a retry
  4. **Workshop**: moving platforms, lifts and spinning bars, where the line also sets the timing
  5. **Gusts**: wind zones and updrafts, then two-ball levels
- The UI has no text, so nothing needs translating. Level 1 teaches itself with a ghost finger that
  draws the answer.
- Retry is instant: tap during a roll to start over. The last line stays as a faint ghost so you can
  adjust it.
- After 3 misses on a level, a hint button appears and shows a line that's known to work.

## Commands

```bash
npm install
npm run dev            # play at http://localhost:5173, editor at /editor.html, all levels at /levels.html
npm test               # unit tests and the full level check (every level, every hint)
npm run build          # YouTube Playables bundle -> dist/
npm run build:preview  # one self-contained HTML file -> dist-preview/index.html (saves to localStorage)
npm run smoke          # runs dist/ against a mock Playables SDK (needs `npm run build` first)
npm run par -- src/levels/w2-springs.json [ids...] [--write]   # level tuning tool, see below
```

`npm run smoke` uses Playwright's Chromium. If Playwright has no browser installed, run
`npx playwright install chromium`, or point `CHROMIUM_PATH` at an existing Chromium.

Dev-server shortcuts while playing: `[` and `]` change level, `h` shows the hint, `w` plays the
hint, `r` retries and `Esc` pauses. These are compiled out of the builds.

## How it works

| Path | What it is |
| --- | --- |
| `src/sim/` | Physics and rules, with no DOM access, so tests and tools run them headless. `sim.ts` (Planck.js world, fixed 120 Hz step), `stroke.ts` (drawing rules), `shapes.ts` (geometry shared by physics, drawing and rendering), `solver.ts` (par finder) |
| `src/game/` | `game.ts` (screens, input, HUD), `save.ts` (versioned save), `progress.ts` (unlocks), `audio.ts` (synthesised sound) |
| `src/render/` | Canvas 2D drawing: scene, icons, per-world themes |
| `src/platform/` | The only code that talks to YouTube. `platform.ts` wraps the `ytgame` SDK |
| `src/levels/*.json` | Level data, one file per world |
| `src/editor/` | Dev-only level editor and overview pages (never bundled) |
| `scripts/` | `par.ts` (tuning), `smoke.mjs` (SDK check), `format.ts` (JSON layout) |

**Determinism.** Nothing moves while you draw. The physics world is built when the ball is released
and steps at exactly 1/120 s, and moving parts use polynomial motion with no `sin`/`cos`. So the
same line always gives the same result, which the tests check.

**Drawing rules.** A line can't pass through solid blocks, pads, a mover's track or a spinner's
sweep, and it stays clear of the ball. A blocked line hugs the obstacle instead of jumping over it.
Strokes shorter than 0.4 units count as a tap, and the ball drops with no line. Drawn lines are
static.

**Ball and line collision.** On screen the line is 0.16 units thick, but in physics it's a
zero-thickness Box2D chain, which is smooth and can't tunnel. The ball has a massless outer "skin"
that collides only with lines, so it rests exactly on the visible edge of the line.

**Unlocks.** A level is open while at most 2 levels before it are unsolved, so a player can skip two
hard levels and keep going.

## Levels

Each level is a JSON object. The playfield is 10 × 14 units, with y pointing **down** and angles in
degrees, clockwise:

```json
{
  "id": "s01",
  "balls": [{ "x": 2.4, "y": 7.6 }],
  "holes": [{ "x": 7.6, "y": 7.0, "w": 2.6 }],
  "ink": 6, "stars": [1.9, 3.5],
  "items": [
    { "t": "box", "x": 2.6, "y": 13, "w": 5.2, "h": 2 },
    { "t": "bouncer", "x": 2.4, "y": 11.83, "w": 2.2, "power": 13 }
  ],
  "hint": [[1.62, 6.53], [2.81, 6.39]]
}
```

Item types: `box`, `poly` (convex, up to 8 points), `bouncer`, `water`, `mover` (`dx`, `dy`,
`period`, `phase`), `spinner` (`speed` in rad/s) and `wind` (`fx`, `fy` as acceleration; gravity
is 16). A hole is a green block with a cup cut into it, and its `y` is the surface of the green.

**`id` is the save key, so never rename or reuse one after release.** Reordering levels is safe.

**Tuning with `npm run par`.** For each level, the solver searches for the shortest line that still
wins when it's redrawn with a slightly shaky hand. That's the robust par: at least 55% of wobbly
copies must still win. From it the solver sets:

- **3 stars**: about the robust par. Clever short lines exist, and finding them is the mastery layer.
- **2 stars**: a sensible hand-drawn path.
- **Ink budget**: room for an obvious long ramp too. That's still a win, but it earns 1 star, which
  is the answer to "just draw a chute to the hole".

It also stores that robust line as the hint, and checks that the rounded copy still wins. Pass
`--write` to save the results.

**Editor** (`/editor.html` under `npm run dev`): pick a level or start a new one, drag things to
move them, edit the selected object's JSON, use "Draw & test" to try a line, use "Auto-tune" to run
the solver in the browser, then copy the JSON into the world file. `/levels.html?world=N` renders
every level with its hint (blue) and its no-line run (red), and flags any level that fails a check.

`tests/levels.test.ts` fails the build if any level wins with no line, if its hint doesn't win, if
the hint needs more ink than the 3-star threshold, or if a ball starts inside something solid.

## YouTube Playables integration

`index.html` has an `<!--YT_SDK-->` slot. The Playables build fills it with
`<script src="https://www.youtube.com/game_api/v1">` as the **first script** on the page, and the
preview and dev builds leave it empty.

| Requirement | Where it's handled |
| --- | --- |
| SDK loads before any game code | `vite.config.ts` injects the SDK tag first. The game is one module script after it |
| `firstFrameReady` then `gameReady` | `main.ts`: the first frame is drawn, then `firstFrameReady`, `loadData`, and `gameReady` once the save is applied |
| Pause and resume through the SDK only | `ytgame.system.onPause/onResume` stop the frame loop, physics, input and audio. The Page Visibility fallback exists only in dev and preview builds (`__PLAYABLES__` removes it) |
| Audio respects YouTube's setting | `isAudioEnabled` and `onAudioEnabledChange`. No AudioContext is created while it's off. There's also an in-game toggle |
| Cloud save only | `saveData`/`loadData`. There's no localStorage, cookies or IndexedDB in `dist/` |
| Save backward compatibility | `save.ts` has a version field and a migration hook, keys by level id, and keeps unknown fields. Tests cover v0 saves, newer saves and corrupt data |
| Don't lose progress | If the save can't be read after 3 tries, the session plays on but never writes, so it can't overwrite the real save |
| Score | `sendScore` with total stars, sent whenever the total goes up |
| Health | Uncaught errors call `health.logError`, and SDK call failures call `logWarning` |
| No outside requests | Everything is bundled (system fonts, synthesised audio). `npm run smoke` fails on any request outside the game |
| Responsive, touch and mouse | Pointer events, resizing keeps state, and it works in portrait and landscape |
| No external links, sharing, ads or IAP | None |
| Bundle size | About 272 KB (66 KB gzipped). The limit is 30 MiB for the initial bundle |

The code can't do these steps for you:

1. Submit the Playables interest form with a hosted build. `dist-preview/index.html` is a single
   file that runs anywhere.
2. Run Google's **SDK Test Suite** against `dist/`. `npm run smoke` covers the same integration
   points with a mock SDK, but the official suite is the one that counts.
3. Make store assets: thumbnails, title and description, with no logos or branding.
4. Play-test on a low-end Android phone. Rendering is plain Canvas 2D at a devicePixelRatio of 2 or
   less.

The SDK typings in `src/platform/ytgame.d.ts` cover only what the game uses. They were written from
the public reference, so check them against the current docs before you submit.
