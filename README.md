# CsocsoMaster2

Browser-based rewrite of [CsocsoMaster](https://github.com/Tepsi/CsocsoMaster)
(the original Android app). Same fair-rotation foosball match scheduler, but
as a static HTML/CSS/JS page — runs in any modern browser on Android, iOS,
or a PC, no install or build step required.

## Running it

Just open `index.html` in a browser. For the best mobile experience, serve
it over a local web server instead of using `file://` (iOS Safari is
stricter about some APIs under `file://`):

```bash
# any static file server works, e.g.:
npx serve .
# or
python -m http.server 8000
```

Then open the shown address on your phone (same Wi-Fi network as the PC).

No dependencies, no build tooling, no backend — it's plain HTML, CSS and
vanilla JS (`js/app.js`).

## What it does

- Add players; the app auto-balances 2v2 matches so everyone gets a fair,
  even number of games (same scheduling algorithm as the original app — see
  "Algorithm" below)
- Mark players active/inactive (bench them without losing their stats)
- Score entry per match, configurable score needed to win
- Live standings table (win %, goal difference)
- Match history
- Hungarian/English UI toggle (the HU/EN pill in the header) — the whole UI,
  including toasts and the confirm dialog, re-translates instantly; the
  choice is a persisted preference, so it survives "Reset data" and page
  reloads

## Differences from the original Android app

- **State survives a refresh.** The Android app only persisted a CSV of
  player *names*; everything else (scores, stats, history) was lost when the
  app closed. This version auto-saves the full state (players, stats, match
  history, settings) to the browser's `localStorage` after every change.
  "Adatok törlése" (reset) in Settings clears it intentionally.
- The "save/load player list" feature from the original is kept as-is (names
  only, via a Settings button) for quickly starting a fresh session with the
  same roster.
- The scheduling algorithm itself is unchanged — see
  [`../csocsomaster/documentation.md`](../csocsomaster/documentation.md) for
  the detailed original write-up (sections 4 and 6 cover pairing/scheduling).

## Algorithm (short version)

For the next match, players are ranked by games played. The 4 (or more, on a
tie) who've played least form the eligible pool; among all legal 2v2 splits
of that pool, the app picks the one where, in order: (1) the two teams have
played together least, (2) this exact group of 4 has faced off least overall,
(3) this exact 2v2 pairing has repeated least. This keeps both individual
playing time and team/matchup variety fair over a long session.

## Browser support

Vanilla ES2017 JS, no polyfills — works on any current Chrome/Safari/Firefox/
Edge, mobile or desktop.

## Regression tests

Node is only needed for testing — the shipped app itself has zero runtime
dependencies and no build step.

```bash
npm install        # once, pulls in jsdom (dev-only dependency)
npm test            # run the full suite once
npm run test:watch  # re-run automatically on every save to js/*.js or test/*.js
```

The suite (`test/`) covers two levels:

- **`test/logic.test.js`** — pure unit tests of the scheduling algorithm
  (fairness over hundreds of simulated rounds, tie-break ordering, pair/
  group/matchup variety, fair-start for late joiners, bench/reactivate
  behaviour) by `require()`-ing `js/app.js` directly, no DOM involved.
- **`test/integration.test.js`** — DOM-level tests that load the real
  `index.html` and evaluate the real `js/app.js` inside a `jsdom` window via
  `test/helpers/jsdomApp.js`, then drive it with real clicks/form submits/
  change events (adding players, generating/recording matches, the score
  steppers' clamp behaviour, settings, save/load player list, reset,
  surviving a simulated reload). This is the same code that ships to
  browsers, not a reimplementation — a regression here means the actual app
  broke.

Run `npm run test:watch` while working on `js/app.js`, `index.html`, or the
tests themselves; it reruns the whole suite on every save and keeps running
until you stop it (Ctrl+C).
