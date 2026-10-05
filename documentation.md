# CsocsoMaster2 — business logic and implementation

This document describes the business logic and implementation details of
the browser-based (HTML/CSS/vanilla JS) rewrite of the Android app
[CsocsoMaster](https://github.com/Tepsi/CsocsoMaster). The business rules
(who should play with whom, against whom) are identical to the original
Android app — this document focuses mainly on *how* the browser version
implements the same logic, and where the implementation differs from the
original.

## 1. Goal

A single static web page (`index.html` + `css/style.css` + `js/app.js`)
that can run in any mobile (Android/iOS) or desktop browser, with no
install and no build step. It helps run a foosball tournament/evening:
adding players, drawing 2v2 matches so that everyone plays a roughly equal
share, recording results, and keeping a live standings table.

## 2. State model (`js/app.js`, the `state` object)

There is no class hierarchy (no `Player`/`Pair`/`Match` objects the way the
original Java code had) — a single, module-scoped plain `state` object
holds everything:

```js
state = {
  nextPlayerId: 1,
  players: [ {id, name, played, won, lost, goalsFor, goalsAgainst, active}, ... ],
  pairStats:  { "idA-idB": count, ... },           // how many times this exact 2-player team has teamed up
  groupStats: { "idA-idB-idC-idD": count, ... },    // how many times this exact 4-player group has faced off (in any pair split)
  matchStats: { "idA-idB|idC-idD": count, ... },    // how many times this exact 2v2 split has occurred
  finishedMatches: [ {pair1Names, pair2Names, score1, score2, time}, ... ],
  currentMatch: { pair1: [idA, idB], pair2: [idC, idD] } | null,
  liveScore: { score1, score2 },
  settings: { keepScore: bool, winScore: number }
}
```

### The four-level "how many times has this happened" hierarchy

The same four levels as the original Android app (see section 2 of the
original `csocsomaster/documentation.md`), just implemented here as
**string-keyed maps** instead of object references:

1. `Player.played` — the individual level (on each element of the `players` array)
2. `pairStats[idsKey([a,b])]` — how many times this *exact 2-player team* has teamed up
3. `groupStats[idsKey([a,b,c,d])]` — how many times this *4-player group* has faced off, in any pair split
4. `matchStats[matchKey([a,b],[c,d])]` — how many times this *exact* 2v2 match has occurred

`idsKey(ids)` and `matchKey(pair1ids, pair2ids)` build a canonical
(order-independent) key: ids are always sorted ascending, and in
`matchKey`, whichever pair contains the smaller id comes first — so the
same matchup, no matter in which order the players are passed in, always
produces the same key. This is the equivalent of the canonical sorting the
original Android code did in `sortPlayers()`/the `Match` constructor, just
implemented with plain string keys instead of classes.

## 3. Adding a new player (`addPlayer(name)`)

1. Trim the name; do nothing if empty.
2. **Fair start**: the new player's `played` is set to the current minimum
   among active players (`minPlayed(null)`), not to 0 — so a player joining
   later doesn't get a "free" advantage.
3. Push a new player object `{id, name, played, won:0, lost:0, goalsFor:0,
   goalsAgainst:0, active:true}` onto `state.players`.

There is no separate "pair/match generation" step like the original
Android app had (`generatePairs()`/`generateMatches()`) — there, that was a
pre-built universe for bookkeeping purposes; here, `generateNextMatch()`
(see section 5) computes the legal pairings **on demand, at the moment
they're needed** — there's no need to maintain a pre-stored list.

## 4. Player active/inactive state (`toggleActive(id)`)

If a player is transitioning from *active to inactive*, and their `played`
count is lower than the active minimum computed without them
(`minPlayed(excludeId=id)`), the code first bumps their `played` up to that
level, then flips the `active` flag. Same rule as the original Android app:
when the player is reactivated later, they shouldn't get an unfair
advantage from a lower `played` count.

## 5. Drawing the next match — `generateNextMatch()`

This is the heart of the engine, and functionally implements **exactly**
the original Android `MatchFragment.generateNextMatch()` algorithm, just
with a different data structure (see section 13 — "Differences from the
original implementation").

1. **Filter active players**: `activePlayers()` — if fewer than 4, return
   `{error: 'too_few'}` and set `state.currentMatch = null`.
2. **Sort by `played`**, and pick the layer with the lowest `played`
   (`toPlay`): the first 4 (after sorting) are always included, and every
   further player is also included as long as their `played` exactly
   matches the 4th player's (`lowestToPlay`) value.
3. **`mustPlay` set**: if `toPlay` is exactly 4 people, all of them are
   mandatory. If there are more (due to a tie), only those with `played`
   *strictly* lower than `lowestToPlay` are mandatory (known edge case: if
   the entire tied layer is ≥4 people with equal `played`, `mustPlay` stays
   empty — see section 8).
4. **Candidate 4-combinations**: `combinations(toPlay, 4)` — every 4-player
   subset of `toPlay` that contains all `mustPlay` members.
5. **For every 4-combination, generate all 3 possible 2v2 splits**
   (`pairSplits`): `(a,b) vs (c,d)`, `(a,c) vs (b,d)`, `(a,d) vs (b,c)`.
   Each split is a match candidate, for which we compute:
   - `pairCount` = the sum of `pairPlayedCount` for both sides
   - `groupCount` = the `groupPlayedCount` of the 4-player group
   - `matchCount` = the `matchPlayedCount` of this exact 2v2 split
6. **Sort** by `(pairCount, groupCount, matchCount)` ascending (JS array
   `.sort()`, which is a stable sort in V8 — this matters, because in a tie
   the generation order decides, see the note about determinism between
   tests in `test/integration.test.js`).
7. The best candidate (`candidates[0]`) becomes the new
   `state.currentMatch`, and `state.liveScore` resets to `{score1:
   winScore, score2: winScore - 1}`.

### Why is there no pre-generated "universe of matches"?

The original Android app's `PlayerFragment.generatePairs()`/
`generateMatches()` built the entire set of possible (non-disqualified)
pairs and matches into a global list up front, and the draw filtered from
that. This port instead **generates the relevant combinations directly, on
every draw**, from the `toPlay`/`mustPlay` sets. The two approaches
provably produce the same result (see the Node simulations run during
development: 200+ rounds, perfectly balanced `played` counts, every pair
used evenly), but this requires simpler code and less state to maintain (no
separate `pairs`/`matches` list to keep in sync). There's also no need for
a "disqualifies" (shared-player exclusion) check here, because `pairSplits`
guarantees two disjoint teams built from 4 *distinct* people — there's no
way for a split to pit someone against themselves.

## 6. Recording a result (`recordCurrentMatchResult()` + `applyResult()`)

- Each of the 4 counters (`pairStats` for both sides, `groupStats`,
  `matchStats`) gets +1 at its key.
- `applyResult(playerIds, ownScore, oppScore)` for every player on both
  sides: `played++`, `goalsFor += ownScore`, `goalsAgainst += oppScore`,
  and `won++` if `ownScore > oppScore`, otherwise `lost++`.
- A `finishedMatches` entry (`pair1Names`, `pair2Names`, `score1`,
  `score2`, `time`) is appended to the history.

### Behavior of the "Next" button

The `btn-next` button **simultaneously**: if there's an active
`currentMatch`, it closes it out (`recordCurrentMatchResult()`), **and**
immediately generates the next one (`generateNextMatch()`). If there's no
active match yet (e.g. the very first click after the app loads), it just
generates the first one, without recording anything. The "New pairing"
button (`btn-skip`) **only** redraws, never records — exactly the same dual
semantics as the original Android "Next"/"Cancel" button pair.

## 7. Score steppers (`incScore`/`decScore`) — deliberately "quirky" mutual-clamp behavior

Ported byte-for-byte from the original Android `MatchFragment` logic:

- **Increment** (`incScore(pairNum)`): if this side is at `max-1` and the
  *other* side is exactly at `max`, the other side gets reset to `max-1`
  (because from this point on both sides can no longer be at the maximum
  at the same time — a foosball match has no draw). Then this side
  increments, if it hasn't reached the maximum.
- **Decrement** (`decScore(pairNum)`): if this side is exactly at `max`,
  the *other* side gets bumped up to `max` (as if "undoing" the fact that
  this side had won). Then this side decrements, if it's not 0.

This might look like a bug at first glance, but it's **intentional**: it
reproduces the exact same quirky behavior the original Android `onClick`
handler had for the `tvNumberPicker1`/`tvNumberPicker2` fields.
`test/integration.test.js` specifically verifies that clicks driven through
the DOM produce exactly the same result as the pure `incScore`/`decScore`
functions — if this behavior were ever "fixed," that test would fail.

## 8. Settings (`state.settings`)

- `keepScore` (checkbox): when turned off, the score steppers get
  `visibility: hidden` (`renderMatch()`), but `state.liveScore` keeps
  tracking the current match's result in the background — it's just not
  displayed.
- `winScore` (number): how many goals are needed to win. When a new match
  is generated, this provides the starting scores (`{winScore,
  winScore-1}`). If the user changes this **mid-match**, and the current
  score was sitting exactly at the old maximum, the code bumps it up to the
  new maximum (and if the other side would reach or exceed the new maximum,
  it's set to `newMax-1`) — the same logic as the original Android
  `onSharedPreferenceChanged` handler.

## 9. Internationalization — Hungarian/English toggle

Unlike the original Android app (which only ever shipped Hungarian
strings), this port is bilingual. All UI text lives in a single
`I18N = { hu: {...}, en: {...} }` dictionary at the top of `js/app.js`,
looked up through one helper:

```js
function t(key) {
  const lang = (state && state.settings && state.settings.lang) || 'hu';
  const dict = I18N[lang] || I18N.hu;
  return dict[key] !== undefined ? dict[key] : (I18N.hu[key] || key);
}
```

- **Static markup** (tab labels, button text, placeholders, table headers,
  settings labels) is tagged in `index.html` with `data-i18n` (text
  content), `data-i18n-placeholder`, `data-i18n-title`, or
  `data-i18n-aria-label` attributes, each pointing at a dictionary key. The
  Hungarian text is left in the HTML as a no-JS fallback. `applyStaticI18n()`
  walks all four attribute selectors on every render and overwrites the
  corresponding property with `t(key)`.
- **Dynamic text** generated in JS (the "N games/meccs" suffix per player
  row, toast messages, the reset confirmation dialog) calls `t(key)`
  directly at the point of rendering/use, instead of going through
  `applyStaticI18n()`.
- The current language is stored at `state.settings.lang` (`'hu'` or
  `'en'`, default `'hu'`) — it rides along with the rest of `state` through
  the existing `localStorage` persistence (section 11), so the choice
  survives a reload automatically, with no separate storage key needed.
- **The language is a preference, not data.** `resetData()` explicitly
  preserves `state.settings` (which includes `lang`, `keepScore`, and
  `winScore`) across a reset — only players/matches/history are cleared.
  This also fixed a latent bug: before this change, "Reset data" and "Load
  player list" (which calls `resetData()` internally) silently reset
  `keepScore`/`winScore` back to defaults too, not just the language.
- The header's HU/EN pill (`.lang-btn[data-lang="hu|en"]`) sets
  `state.settings.lang` on click and triggers a full `persistAndRender()`,
  which re-runs `applyStaticI18n()` and re-renders every tab — so the
  currently displayed match, table, and results all re-translate instantly,
  not just newly-created elements. `renderLangToggle()` also keeps
  `document.documentElement.lang` and the active-button highlight in sync.

To add a third language, add a new top-level key to `I18N` with the same
set of keys as `hu`/`en` (missing keys fall back to the Hungarian value via
`t()`), and add a corresponding `<button class="lang-btn" data-lang="...">`
to the toggle widget in `index.html`.

## 10. Standings table (`renderTable()`)

Only players with `played > 0` are shown, sorted by:

1. **Win/lose ratio** (`winLoseRatio`), descending
2. On a tie: **goal difference** (`goalsFor - goalsAgainst`), descending
3. On a further tie: **goals scored**, descending

Same `BY_RESULTS` logic as the original `MyPlayerRecyclerViewAdapter2`.

## 11. Results list (`renderFinishedMatches()`)

The `finishedMatches` array is displayed in **reverse** (newest first)
order — this is a deliberate difference from the original Android app
(which showed insertion order, i.e. oldest first), since newest-first is a
more familiar browser UX pattern. The winning team gets the `win` (green)
CSS class, the losing team gets `loss` (red), same as the original (there's
no draw handling, since foosball matches can't end in a draw).

## 12. Persistence — `localStorage`

After every mutating action (`persistAndRender()`), the **entire `state`**
is JSON-serialized and saved to `localStorage` (under the
`csocsoMaster.state.v1` key). On startup (`loadState()`), it's restored
from there. In addition, a separate, smaller key
(`csocsoMaster.playerListCsv`) stores just the CSV of player names, for the
Settings panel's "Save/Load player list" buttons — this is the equivalent
of the original Android app's `SharedPreferences`-based name-only save.

## 13. Differences from the original Android implementation (summary)

| Area | Original Android | CsocsoMaster2 (browser) |
|---|---|---|
| Data model | `Player`/`Pair`/`Match`/`MatchParticipants` classes, equality based on object identity | A plain `state` object, string-keyed maps (`pairStats`/`groupStats`/`matchStats`) |
| Match universe | Pre-generated `pairs`/`matches` list (for bookkeeping) | Candidates generated on demand, at draw time (`combinations` + `pairSplits`) |
| Persistence | Only the player-name CSV (`SharedPreferences`); everything else is lost on process death | **Entire state** auto-saves after every change (`localStorage`); the name-list save/load remains as a separate, additional feature |
| Results list order | Insertion order (oldest first) | Newest first |
| Language | Hungarian only (hardcoded strings) | Hungarian + English, toggled live via the header pill, choice persisted (section 9) |
| Testability | No automated tests | `test/logic.test.js` (pure algorithm) + `test/integration.test.js` (real DOM, real clicks) |

The drawing algorithm (who plays with/against whom) and the score
steppers' quirky behavior were **deliberately left unchanged** — the goal
here was functional equivalence with the original Android app, not a
redesign.

## 14. Testing

See the "Regression tests" section of `README.md` for how to run them
(`npm test` / `npm run test:watch`). In short:

- **`test/logic.test.js`** — pure algorithm tests (loaded via `require()`,
  no DOM involved): fairness over 200+ simulated rounds, tie-break order,
  fair-start for new players, activate/deactivate behavior.
- **`test/integration.test.js`** — the real `index.html` + `js/app.js`
  loaded into a `jsdom` window (`test/helpers/jsdomApp.js`), driven by real
  clicks/form submits/change events — this is the actual code that runs in
  a browser, not a reimplementation.

**Important gotcha** (see also the "jsdom gotcha" section in `CLAUDE.md`):
`window.eval()` only runs in jsdom's own VM context if the `JSDOM`
constructor was created with the `runScripts: 'dangerously'` option.
Without it, the evaluated code would silently run in Node's own global
scope instead (where there's no `document`/`localStorage`), and the tests
would appear to pass while not actually testing anything real — which is
exactly what happened in the first version of the test harness, before it
was fixed.
