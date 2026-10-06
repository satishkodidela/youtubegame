# Draw to Hole

A one-finger physics puzzle built for **YouTube Playables** and **CrazyGames**. Draw one line, lift
your finger, and the ball drops and rolls. Get it in the hole. Less ink earns more stars. The same
game code ships to both: each build includes only its own platform's SDK code.

- 60 levels in 5 worlds of 12, each world adding one idea:
  1. **Meadow**: ramps, walls and gaps
  2. **Springs**: bouncy pads that throw the ball higher than it started
  3. **Lagoon**: water, where a splash means a retry
  4. **Workshop**: moving platforms, lifts and spinning bars, where the line also sets the timing
  5. **Gusts**: wind zones and updrafts, then two-ball levels
- Level 1 teaches itself with a ghost finger that draws the answer, and a first session lands
  straight in it: the title screen waits until there is something to come back to. The first level
  of each world shows a one-line tip about its new idea. The few words on screen (button labels,
  win headlines, tips) are all in `src/game/strings.ts`, ready for translation.
- Retry is instant: tap during a roll to start over. The last line stays as a faint ghost so you can
  adjust it. A win card moves on by itself after about 2 seconds; tapping it keeps it open to retry
  for 3 stars.
- Help before frustration: after 2 misses on the first 15 levels (3 later) a hint button shows a
  line that's known to work, and after 4 misses a skip button appears (the unlock rules always
  allowed skipping 2 levels; now players can see it).
- **Daily Hole**: one new level a day, the same for everyone, from a bundled set of 120 verified
  levels (no server needed). Winning it on consecutive days builds a streak, shown on the title
  screen, with rewards at 3, 7 and 14 days.
- **Looks**: ball skins and ink colours. A new one unlocks every 15 stars, a few more come from the
  streak. They change nothing in physics.
- **Gold ink**: an expert medal for finishing a level with no more ink than the solver's own line.
  Once a level has 3 stars, the ink meter shows where that line ends.
- Progress is always in view: holes done per world on the level grid and the win card, the star
  total counting up after every win, and a preview of the next world when one is finished.
- Look and feel: each world has its own scenery (trees, mushrooms, palms and the sea, factories,
  snowy mountains), the ground, grass, water and hazards are textured and shaded, and the UI uses a
  bundled rounded font with labelled buttons. The ball leaves a trail and squashes when it lands,
  play slows for a moment when it drops in, a miss pops a short word (SPLASH!, MISSED!), a 3-star
  finish rains confetti, and a quiet synthesised music loop plays under the sound effects.

## Commands

```bash
npm install
npm run dev            # play at http://localhost:5173, editor at /editor.html, all levels at /levels.html
npm test               # unit tests and the full level check (every level, every hint)
npm run build             # YouTube Playables bundle -> dist/
npm run build:crazygames  # CrazyGames bundle -> dist-crazygames/
npm run build:preview     # one self-contained HTML file -> dist-preview/index.html (saves to localStorage)
npm run smoke             # runs dist/ against a mock Playables SDK (needs `npm run build` first)
npm run smoke:crazygames  # runs dist-crazygames/ against a mock CrazyGames SDK (needs `npm run build:crazygames`)
npm run par -- src/levels/w2-springs.json [ids...] [--write]   # level tuning tool, see below
npm run difficulty [-- --reorder [--write]]   # beginner win rate per level; optionally reorder each world by it
npm run daily-gen      # regenerate the 120 Daily Hole levels (several minutes, see below)
npm run perf           # frame-rate benchmark on a simulated low-end phone (needs `npm run build:preview` first)
npm run promo          # store covers and preview videos rendered from the real game -> promo-out/ (needs ffmpeg)
```

The TypeScript tools (`par`, `difficulty`, `daily-gen`) run through `tsx`, which is a dev dependency.

The smoke tests use Playwright's Chromium. If Playwright has no browser installed, run
`npx playwright install chromium`, or point `CHROMIUM_PATH` at an existing Chromium.

Dev-server shortcuts while playing: `[` and `]` change level, `h` shows the hint, `w` plays the
hint, `d` opens today's Daily Hole, `r` retries and `Esc` pauses. These are compiled out of the builds.

## CI

`.github/workflows/ci.yml` runs on every pull request into `main` and every push to `main`:

| Check | What it runs |
| --- | --- |
| **Typecheck and tests** | `npm run typecheck`, `npm test` (unit tests, the full level check including the Daily Holes, and the difficulty-curve check) |
| **Build and SDK smoke test** | All three builds, then `npm run smoke` and `npm run smoke:crazygames`. It uploads each build as a downloadable artifact (`youtube-playables-build`, `crazygames-build`, `preview-build`) and reports bundle sizes |

Make both checks required in **Settings → Rules → Rulesets** (or **Settings → Branches**) for
`main`, so a pull request can't merge while either one fails.

## How it works

| Path | What it is |
| --- | --- |
| `src/sim/` | Physics and rules, with no DOM access, so tests and tools run them headless. `sim.ts` (Planck.js world, fixed 120 Hz step), `stroke.ts` (drawing rules), `shapes.ts` (geometry shared by physics, drawing and rendering), `solver.ts` (par finder), `beginner.ts` (a modelled first-time player, for the difficulty curve) |
| `src/game/` | `game.ts` (screens, input, HUD), `save.ts` (versioned save), `progress.ts` (unlocks), `daily.ts` (Daily Hole and streak), `cosmetics.ts` (skins and unlock rules), `audio.ts` (synthesised sound and music), `strings.ts` (every word on screen) |
| `src/render/` | Canvas 2D drawing: scene, icons, logo, per-world themes and the skin types, and the bundled Fredoka font (`src/assets/fonts`, SIL Open Font License) |
| `src/platform/` | The only code that talks to a host. `platform.ts` has one adapter per platform (YouTube `ytgame`, CrazyGames SDK v3, plain web), and the build flags keep only the right one |
| `src/levels/*.json` | Level data, one file per world, plus `daily.json` (generated) |
| `src/editor/` | Dev-only level editor and overview pages (never bundled) |
| `scripts/` | `par.ts` (tuning), `difficulty.ts` (difficulty curve), `daily-gen.ts` (Daily Hole generator), `smoke.mjs` and `smoke-crazygames.mjs` (SDK checks), `perf.mjs` (frame rate), `promo.mjs` (store art), `format.ts` (JSON layout) |

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

**Performance on low-end phones.** Painting pixels is the cost, not JavaScript: frame time scales with
canvas size. The sky, scenery and everything in a level that never moves (including the textured
ground) are painted once into a cached image, the HUD's fixed parts (panel, button bodies, meter
track) are added on top, and that image is copied each frame. Only moving things (ball, line, water
surface, wind streaks, flags, moving parts, the ink level) are drawn per frame. If frames stay slow
(median over 22 ms), the game steps its resolution down from 2× towards 1× pixel density.
`npm run perf` measures this: with the CPU slowed 6× at 390×844 and 2× density, the busiest levels
run at about 30–45 fps (13 fps before the caching). Runs are noisy, so compare a change against
`main` on the same machine.

**Unlocks.** A level is open while at most 2 levels before it are unsolved, so a player can skip two
hard levels and keep going.

**Daily Hole.** `daily.ts` numbers days by the device's local calendar, so a new hole appears at
local midnight and everyone on the same date gets the same level: day 0 is 3 October 2026 and the
set of 120 wraps around. Results are saved per day number, and the streak counts consecutive days
with a win (a streak is alive if yesterday or today was won). No clock or level comes from a
server, which keeps the game within the no-outside-requests rule.

**Looks.** `cosmetics.ts` lists the ball skins and ink colours with what unlocks each (a star
total or a best streak). Unlocks are derived from the save, so only the chosen look and which
unlocks have been announced are stored. The gold-ink medal is derived too: a level's best ink is
compared with the length of its stored hint.

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
A level may carry `"theme": N` to pick its look (Daily Holes do; campaign levels use their world's).

**Difficulty curve.** `npm run difficulty` plays every level 500 times as a modelled beginner
(`src/sim/beginner.ts`: one rough ramp from the ball towards the flag, with a shaky hand) and
prints how often it wins. The number is pessimistic, since real players learn and use hints, but
the order between levels is what matters. Levels in each world are ordered by it: easiest first,
and the hardest ones spread out among medium ones instead of stacked. `--reorder --write` applies
that order (the first level of world 1 is pinned, since it is the tutorial). `tests/difficulty.test.ts`
fails the build if the first 20 levels stop opening gently, if a world's first level is a wall, or
if two very hard levels sit back to back, so a later edit can't reintroduce a wall where the
session-length metric is decided.

**Daily Holes.** `npm run daily-gen` builds `src/levels/daily.json` from six templates (ledges,
springs, ponds, lifts, gusts, spinners) with a seeded random generator, mirrored half the time,
and keeps only candidates that pass the same checks as hand-made levels: not won without a line, a
robust par found by the solver (which sets ink, stars and the hint), and a beginner win rate between
2% and 75%. Seeds are processed in order, so the output is reproducible however many processes run,
and each week of seven is sorted easy to hard. Regenerating changes future days only if you keep
the same seeds; ids are `d` + seed.

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

`index.html` has a `<!--PLATFORM_SDK-->` slot. The Playables build fills it with
`<script src="https://www.youtube.com/game_api/v1">` as the **first script** on the page. The
CrazyGames build fills it with its own SDK, and the preview and dev builds leave it empty.

| Requirement | Where it's handled |
| --- | --- |
| SDK loads before any game code | `vite.config.ts` injects the SDK tag first. The game is one module script after it |
| `firstFrameReady` then `gameReady` | `main.ts`: the first frame is drawn, then `firstFrameReady`, `loadData`, and `gameReady` once the save is applied |
| Pause and resume through the SDK only | `ytgame.system.onPause/onResume` stop the frame loop, physics, input and audio. The Page Visibility fallback exists only in dev and preview builds (`__PLAYABLES__` removes it) |
| Audio respects YouTube's setting | `isAudioEnabled` and `onAudioEnabledChange`. No AudioContext is created while it's off. There's also an in-game toggle |
| Cloud save only | `saveData`/`loadData`. There's no localStorage, cookies or IndexedDB in `dist/` |
| Save backward compatibility | `save.ts` has a version field and a migration hook, keys by level id, and keeps unknown fields. v2 added the Daily Hole, streak and look; v1 saves upgrade in place. Tests cover v0 and v1 saves, newer saves and corrupt data |
| Don't lose progress | If the save can't be read after 3 tries, the session plays on but never writes, so it can't overwrite the real save |
| Score | `sendScore` with total stars, sent whenever the total goes up |
| Health | Uncaught errors call `health.logError`, and SDK call failures call `logWarning` |
| No outside requests | Everything is bundled (the font is inlined in the script, sound and music are synthesised). `npm run smoke` fails on any request outside the game |
| Responsive, touch and mouse | Pointer events, resizing keeps state, and it works in portrait and landscape |
| No external links, sharing, ads or IAP | None |
| Bundle size | About 390 KB (121 KB gzipped), of which the 120 Daily Holes are about 50 KB and the inlined font about 44 KB. The limit is 30 MiB for the initial bundle |

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

## CrazyGames integration

`npm run build:crazygames` writes `dist-crazygames/`, which loads
`https://sdk.crazygames.com/crazygames-sdk-v3.js` first. To upload it, zip the **contents** of that
folder so `index.html` sits at the top of the zip. You can also download the `crazygames-build`
artifact from any CI run on `main`.

| What CrazyGames looks for | How the game does it |
| --- | --- |
| SDK initialised before use | `SDK.init()` runs first, and nothing else is called until it resolves |
| Loading events | `loadingStart` after init, then `loadingStop` once the save is loaded and the game is playable |
| Gameplay events | `gameplayStart` while a level is being played (a first session is in level 1 right after `loadingStop`). `gameplayStop` on the title, level select, looks, pause menu, win card and world card. Only changes are reported |
| Progress save | Through the **Data Module** (`SDK.data`), synced to the player's CrazyGames account. Same save format and versioning as YouTube |
| Mute through the SDK | Follows `SDK.game.settings.muteAudio`, including live changes. No AudioContext is created while muted |
| Celebrations | `happytime()` on every 3-star win |
| Works outside CrazyGames | If the SDK can't load or `init()` fails, the game falls back to localStorage and still runs |

**Submission form answers for this build:**

- **Does your game save progress?** Yes, using the Data Module from the CrazyGames SDK. The Data
  Module only works once this option is selected.
- **The game supports mobile devices:** checked.
- **Mobile orientation:** PORTRAIT. The playfield is 10 × 14, so it gets small on a phone held
  sideways. Desktop is unaffected.
- **Online multiplayer:** unchecked.
- **Supports CrazyGames muting audio through SDK:** checked.

Ads aren't integrated yet. The SDK's `ad.requestAd` would be the place to add them, and audio and
gameplay would need to pause while an ad plays.

The CrazyGames typings in `src/platform/crazygames.d.ts` cover only what the game uses. The
CrazyGames docs couldn't be reached from the build environment, so they were checked against two
published SDK integrations. Compare them with the current docs before you submit.

## Store art

`npm run promo` renders store art with the game's own renderer and physics, so it always matches
the current levels and look:

- Covers: 1920×1080, 800×1200 and 800×800 PNG. Each shows a drawn line, the ball's dotted flight
  and the flag.
- Preview videos: 1920×1080 and 1080×1620 H.264 MP4 at 30 fps, under 20 seconds. Five levels from
  different worlds are drawn, released and finished with 3 stars.

The shots and clips are chosen in `src/editor/promo.ts`. Listing text for CrazyGames (category,
tags, description, controls) is in `store/crazygames-listing.md`.
