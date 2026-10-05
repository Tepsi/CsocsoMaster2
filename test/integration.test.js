'use strict';

/*
 * DOM-level regression tests. These load the real index.html and evaluate
 * the real js/app.js inside a jsdom window — the exact code shipped to
 * browsers — and drive it via real clicks/form submits/change events, the
 * same way a user or a browser automation tool would.
 *
 * `nodeApp` (plain require, no DOM) is used only as an independent
 * ground-truth calculator for the score-stepper test, so expected values
 * are computed by the same pure function rather than hand-derived by hand
 * in the test (which would be error-prone for the quirky mutual-clamp
 * behaviour it replicates from the original Android app).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const nodeApp = require('../js/app.js');
const {
  loadApp, click, clickSelector, setValue, setChecked, fireEvent, text, addPlayerViaUi
} = require('./helpers/jsdomApp');

function addFourPlayers(dom, names = ['Alice', 'Bob', 'Carol', 'Dave']) {
  names.forEach(n => addPlayerViaUi(dom, n));
}

test('adding players renders them and hides the empty-state hint', () => {
  const dom = loadApp();
  assert.equal(dom.window.document.getElementById('player-list-empty').hidden, false);

  addFourPlayers(dom);

  assert.equal(dom.window.document.getElementById('player-list-empty').hidden, true);
  const names = [...dom.window.document.querySelectorAll('#player-list .player-row-name')].map(e => e.textContent);
  // Order is intentionally not asserted here: once there are 4+ players the
  // roster is shuffled (see the dedicated shuffle test below), so only set
  // membership is guaranteed, not insertion order.
  assert.deepEqual(names.slice().sort(), ['Alice', 'Bob', 'Carol', 'Dave']);
});

test('clicking a player row toggles active/inactive styling', () => {
  const dom = loadApp();
  addFourPlayers(dom);

  const rowBefore = dom.window.document.querySelector('#player-list .player-row');
  assert.equal(rowBefore.classList.contains('inactive'), false);

  rowBefore.dispatchEvent(new dom.window.Event('click', { bubbles: true, cancelable: true }));

  const rowAfter = dom.window.document.querySelector('#player-list .player-row');
  assert.equal(rowAfter.classList.contains('inactive'), true);
});

test('fewer than 4 active players: shows a hint, keeps the match area empty, no crash', () => {
  const dom = loadApp();
  addFourPlayers(dom, ['A', 'B', 'C']);

  click(dom, 'btn-skip');

  assert.equal(text(dom, 'too-few-hint') !== null, true);
  assert.equal(dom.window.document.getElementById('too-few-hint').hidden, false);
  assert.equal(dom.window.document.getElementById('match-display').hidden, true);
});

test('"Új párosítás" generates a match with 4 distinct players from the pool', () => {
  const dom = loadApp();
  addFourPlayers(dom);

  click(dom, 'btn-skip');

  assert.equal(dom.window.document.getElementById('match-display').hidden, false);
  const shown = [
    text(dom, 'team1-player1'), text(dom, 'team1-player2'),
    text(dom, 'team2-player1'), text(dom, 'team2-player2')
  ];
  assert.equal(new Set(shown).size, 4, 'all 4 shown names must be distinct');
  assert.deepEqual(shown.slice().sort(), ['Alice', 'Bob', 'Carol', 'Dave']);
});

test('score steppers: DOM clicks match the pure incScore/decScore ground truth for an arbitrary sequence', () => {
  const dom = loadApp();
  addFourPlayers(dom);
  click(dom, 'btn-skip'); // seeds liveScore to {winScore, winScore-1} = {5,4}

  nodeApp.setState(nodeApp.defaultState());
  nodeApp.getState().liveScore = { score1: 5, score2: 4 };

  const sequence = [
    ['dec', 1], ['dec', 1], ['inc', 2], ['inc', 1], ['inc', 1], ['inc', 1], ['dec', 2], ['dec', 2]
  ];
  for (const [dir, pair] of sequence) {
    if (dir === 'inc') nodeApp.incScore(pair); else nodeApp.decScore(pair);
    clickSelector(dom, `.btn-score-${dir}[data-pair="${pair}"]`);
  }

  assert.equal(text(dom, 'score1'), String(nodeApp.getState().liveScore.score1));
  assert.equal(text(dom, 'score2'), String(nodeApp.getState().liveScore.score2));
});

test('settings: unchecking "show score" hides the score steppers, re-checking shows them again', () => {
  const dom = loadApp();
  addFourPlayers(dom);
  click(dom, 'btn-skip');

  setChecked(dom, 'setting-keep-score', false);
  fireEvent(dom, 'setting-keep-score', 'change');
  assert.equal(dom.window.document.getElementById('score-control-1').style.visibility, 'hidden');
  assert.equal(dom.window.document.getElementById('score-control-2').style.visibility, 'hidden');

  setChecked(dom, 'setting-keep-score', true);
  fireEvent(dom, 'setting-keep-score', 'change');
  assert.equal(dom.window.document.getElementById('score-control-1').style.visibility, 'visible');
});

test('settings: raising the win score bumps a score currently at the old max up to the new max', () => {
  const dom = loadApp();
  addFourPlayers(dom);
  click(dom, 'btn-skip'); // liveScore defaults to {5,4} — score1 sits at the (old) max of 5

  setValue(dom, 'setting-win-score', '10');
  fireEvent(dom, 'setting-win-score', 'change');

  assert.equal(text(dom, 'score1'), '10');
  assert.equal(text(dom, 'score2'), '4');
});

test('Next: first click only generates a match (nothing recorded yet)', () => {
  const dom = loadApp();
  addFourPlayers(dom);

  click(dom, 'btn-next');

  assert.equal(dom.window.document.getElementById('finished-empty').hidden, false);
  assert.equal(dom.window.document.getElementById('match-display').hidden, false);
});

test('Next: second click records the previous match and shows it in Results + Table', () => {
  const dom = loadApp();
  addFourPlayers(dom);

  click(dom, 'btn-next'); // generates match #1 (liveScore defaults to {5,4})
  click(dom, 'btn-next'); // records match #1, generates match #2

  assert.equal(dom.window.document.getElementById('finished-empty').hidden, true);
  const rows = dom.window.document.querySelectorAll('#finished-match-list .finished-match-row');
  assert.equal(rows.length, 1);

  const teams = rows[0].querySelectorAll('.fm-team');
  assert.equal(teams[0].classList.contains('win'), true, 'team with the higher score (5) should be marked as the winner');
  assert.equal(teams[1].classList.contains('loss'), true);

  const tableRows = dom.window.document.querySelectorAll('#results-table-body tr');
  assert.equal(tableRows.length, 4, 'all 4 players from the recorded match should now have stats');
});

test('Table tab: standings are sorted by win ratio, then goal difference, then goals for — matching what was actually recorded', () => {
  const dom = loadApp();
  addFourPlayers(dom);

  const wins = {}, losses = {}, gf = {}, ga = {};
  function note(name, isWin, scoreFor, scoreAgainst) {
    wins[name] = (wins[name] || 0) + (isWin ? 1 : 0);
    losses[name] = (losses[name] || 0) + (isWin ? 0 : 1);
    gf[name] = (gf[name] || 0) + scoreFor;
    ga[name] = (ga[name] || 0) + scoreAgainst;
  }

  const ROUNDS = 6;
  for (let i = 0; i < ROUNDS; i++) {
    click(dom, 'btn-next'); // records the previous round (from round 2 on) and generates this round's match

    // Force a lopsided, deterministic result for whichever match was just generated.
    for (let j = 0; j < 6; j++) clickSelector(dom, '.btn-score-inc[data-pair="1"]');
    for (let j = 0; j < 6; j++) clickSelector(dom, '.btn-score-dec[data-pair="2"]');

    const t1 = [text(dom, 'team1-player1'), text(dom, 'team1-player2')];
    const t2 = [text(dom, 'team2-player1'), text(dom, 'team2-player2')];
    const s1 = Number(text(dom, 'score1'));
    const s2 = Number(text(dom, 'score2'));
    t1.forEach(n => note(n, true, s1, s2));
    t2.forEach(n => note(n, false, s2, s1));
  }
  click(dom, 'btn-next'); // records the final round

  const expectedOrder = ['Alice', 'Bob', 'Carol', 'Dave'].slice().sort((x, y) => {
    const rx = wins[x] / (wins[x] + losses[x]);
    const ry = wins[y] / (wins[y] + losses[y]);
    if (rx !== ry) return ry - rx;
    const gdx = gf[x] - ga[x], gdy = gf[y] - ga[y];
    if (gdx !== gdy) return gdy - gdx;
    return gf[y] - gf[x];
  });

  const renderedNames = [...dom.window.document.querySelectorAll('#results-table-body tr td:first-child')]
    .map(td => td.textContent);
  assert.deepEqual(renderedNames, expectedOrder);
});

test('Save/Load player list: round-trips names via localStorage and resets everyone\'s stats', () => {
  const dom = loadApp();
  addFourPlayers(dom, ['Zoli', 'Peti', 'Gabi', 'Timi']);
  click(dom, 'btn-next');
  click(dom, 'btn-next'); // record one result so stats become non-zero

  click(dom, 'btn-settings');
  click(dom, 'btn-save-list');
  click(dom, 'btn-reset-data');
  assert.equal(dom.window.document.querySelectorAll('#player-list .player-row').length, 0);

  click(dom, 'btn-load-list');

  const names = [...dom.window.document.querySelectorAll('#player-list .player-row-name')].map(e => e.textContent);
  assert.deepEqual(names.slice().sort(), ['Gabi', 'Peti', 'Timi', 'Zoli']);

  const playedTexts = [...dom.window.document.querySelectorAll('#player-list .player-row-played')].map(e => e.textContent);
  assert.ok(playedTexts.every(t => t === '0 meccs'), 'loading the name list must not carry over old stats');
});

test('Reset data: confirming clears players, matches and results', () => {
  const dom = loadApp({ confirmReturns: true });
  addFourPlayers(dom);
  click(dom, 'btn-next');
  click(dom, 'btn-next');

  click(dom, 'btn-reset-data');

  assert.equal(dom.window.document.querySelectorAll('#player-list .player-row').length, 0);
  assert.equal(dom.window.document.getElementById('finished-empty').hidden, false);
  assert.equal(dom.window.document.getElementById('match-display').hidden, true);
});

test('Reset data: cancelling the confirm dialog leaves existing data untouched', () => {
  const dom = loadApp({ confirmReturns: false });
  addFourPlayers(dom);

  click(dom, 'btn-reset-data');

  assert.equal(dom.window.document.querySelectorAll('#player-list .player-row').length, 4);
});

test('state survives a simulated reload (re-dispatching DOMContentLoaded re-reads localStorage)', () => {
  const dom = loadApp();
  addFourPlayers(dom);
  click(dom, 'btn-next');
  click(dom, 'btn-next');

  const playersBefore = [...dom.window.document.querySelectorAll('#player-list .player-row-name')].map(e => e.textContent);
  const resultsBefore = dom.window.document.querySelectorAll('#finished-match-list .finished-match-row').length;

  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

  const playersAfter = [...dom.window.document.querySelectorAll('#player-list .player-row-name')].map(e => e.textContent);
  const resultsAfter = dom.window.document.querySelectorAll('#finished-match-list .finished-match-row').length;

  assert.deepEqual(playersAfter, playersBefore);
  assert.equal(resultsAfter, resultsBefore);
  assert.equal(resultsAfter, 1);
});

test('language toggle: Hungarian is the default — correct tab label, active toggle button, <html lang>', () => {
  const dom = loadApp();

  const playersTab = dom.window.document.querySelector('.tab-btn[data-tab="players"]');
  assert.equal(playersTab.textContent, 'Játékosok');
  assert.equal(dom.window.document.querySelector('.lang-btn[data-lang="hu"]').classList.contains('active'), true);
  assert.equal(dom.window.document.querySelector('.lang-btn[data-lang="en"]').classList.contains('active'), false);
  assert.equal(dom.window.document.documentElement.lang, 'hu');
});

test('language toggle: switching to English re-translates static text, dynamic text, and the active toggle button', () => {
  const dom = loadApp();
  addFourPlayers(dom);

  clickSelector(dom, '.lang-btn[data-lang="en"]');

  assert.equal(dom.window.document.querySelector('.tab-btn[data-tab="players"]').textContent, 'Players');
  assert.equal(dom.window.document.querySelector('.tab-btn[data-tab="match"]').textContent, 'Match');
  assert.equal(dom.window.document.getElementById('btn-next').textContent, 'Next');
  assert.equal(dom.window.document.getElementById('input-player-name').placeholder, 'New player name');
  assert.equal(dom.window.document.querySelector('.lang-btn[data-lang="en"]').classList.contains('active'), true);
  assert.equal(dom.window.document.documentElement.lang, 'en');

  // dynamic per-player text (not just static markup) must also re-render in the new language
  const playedText = dom.window.document.querySelector('#player-list .player-row-played').textContent;
  assert.equal(playedText, '0 games');

  // switching back to Hungarian restores the original strings
  clickSelector(dom, '.lang-btn[data-lang="hu"]');
  assert.equal(dom.window.document.querySelector('.tab-btn[data-tab="players"]').textContent, 'Játékosok');
  assert.equal(dom.window.document.querySelector('#player-list .player-row-played').textContent, '0 meccs');
});

test('language toggle: toast messages are translated too', () => {
  const dom = loadApp();
  addFourPlayers(dom, ['A', 'B', 'C']); // only 3 -> triggers the "too few" toast

  clickSelector(dom, '.lang-btn[data-lang="en"]');
  click(dom, 'btn-skip');
  assert.equal(text(dom, 'toast'), 'Too few active players!');

  clickSelector(dom, '.lang-btn[data-lang="hu"]');
  click(dom, 'btn-skip');
  assert.equal(text(dom, 'toast'), 'Túl kevés aktív játékos!');
});

test('language toggle: the chosen language survives Reset data and Save/Load player list (it is a preference, not data)', () => {
  const dom = loadApp();
  addFourPlayers(dom);
  clickSelector(dom, '.lang-btn[data-lang="en"]');

  click(dom, 'btn-reset-data');
  assert.equal(dom.window.document.querySelector('.lang-btn[data-lang="en"]').classList.contains('active'), true);
  assert.equal(dom.window.document.querySelector('.tab-btn[data-tab="players"]').textContent, 'Players');

  addFourPlayers(dom, ['Zoli', 'Peti', 'Gabi', 'Timi']);
  click(dom, 'btn-settings');
  click(dom, 'btn-save-list');
  click(dom, 'btn-load-list');
  assert.equal(dom.window.document.querySelector('.lang-btn[data-lang="en"]').classList.contains('active'), true);
});

test('language toggle: the chosen language persists across a simulated reload', () => {
  const dom = loadApp();
  clickSelector(dom, '.lang-btn[data-lang="en"]');

  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded', { bubbles: true, cancelable: true }));

  assert.equal(dom.window.document.querySelector('.lang-btn[data-lang="en"]').classList.contains('active'), true);
  assert.equal(dom.window.document.documentElement.lang, 'en');
  assert.equal(dom.window.document.querySelector('.tab-btn[data-tab="players"]').textContent, 'Players');
});
