'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../js/app.js');

function freshState() {
  const s = app.defaultState();
  app.setState(s);
  return s;
}

function addPlayers(names) {
  for (const name of names) app.addPlayer(name);
  return app.getState().players;
}

test('idsKey() is order-independent', () => {
  assert.equal(app.idsKey([3, 1, 2]), app.idsKey([1, 2, 3]));
  assert.equal(app.idsKey([5, 9]), '5-9');
});

test('matchKey() is independent of pair order and side order', () => {
  const a = app.matchKey([1, 2], [3, 4]);
  const b = app.matchKey([3, 4], [1, 2]);
  const c = app.matchKey([2, 1], [4, 3]);
  assert.equal(a, b);
  assert.equal(a, c);
});

test('combinations() returns all k-subsets without repeats', () => {
  const combos = app.combinations([1, 2, 3, 4], 4);
  assert.equal(combos.length, 1);
  const combos2 = app.combinations([1, 2, 3, 4, 5], 4);
  assert.equal(combos2.length, 5); // C(5,4) = 5
});

test('pairSplits() produces exactly the 3 legal 2v2 splits of 4 players, no shared players', () => {
  const splits = app.pairSplits([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
  assert.equal(splits.length, 3);
  for (const s of splits) {
    const ids = [...s.pair1, ...s.pair2].map(p => p.id).sort();
    assert.deepEqual(ids, [1, 2, 3, 4]);
    assert.equal(new Set([...s.pair1.map(p => p.id), ...s.pair2.map(p => p.id)]).size, 4);
  }
});

test('addPlayer(): first 4 players all start at played=0', () => {
  freshState();
  const players = addPlayers(['A', 'B', 'C', 'D']);
  assert.deepEqual(players.map(p => p.played), [0, 0, 0, 0]);
});

test('addPlayer(): a late joiner is fast-forwarded to the current minimum played count (fair start)', () => {
  freshState();
  const [a] = addPlayers(['A']);
  a.played = 7; // simulate games already played before a 2nd player exists
  const [, b] = addPlayers(['B']);
  assert.equal(b.played, 7, 'late joiner should not start behind (unfair advantage) relative to existing players');
});

test('addPlayer(): once there are 4+ players the roster order is shuffled, not left in insertion order', () => {
  // Regression guard for a reported bug: without shuffling, generateNextMatch()'s
  // stable sort always breaks played=0 ties in array order, so the first 4
  // players ever added would face off in every single first match, forever.
  // The original Android app shuffled playerList in createPlayer() for exactly
  // this reason; this test fails if that shuffle is ever removed.
  const seenOrders = new Set();
  for (let trial = 0; trial < 30; trial++) {
    freshState();
    const players = addPlayers(['A', 'B', 'C', 'D']);
    seenOrders.add(players.map(p => p.name).join(','));
  }
  assert.ok(seenOrders.size > 1, `expected roster order to vary across repeated additions, got the same order all ${30} times`);
});

test('addPlayer(): shuffling only kicks in once there are at least 4 players (matches the original trigger condition)', () => {
  freshState();
  const [a, b, c] = addPlayers(['A', 'B', 'C']);
  assert.deepEqual(app.getState().players.map(p => p.name), ['A', 'B', 'C'], 'with fewer than 4 players there is nothing to shuffle for yet');
});

test('toggleActive(): deactivating a player who is behind the active minimum bumps them up first', () => {
  freshState();
  const [a, b, c, d] = addPlayers(['A', 'B', 'C', 'D']);
  b.played = 5; c.played = 5; d.played = 5; // A stays at 0, is the laggard
  app.toggleActive(a.id); // deactivate A while behind
  assert.equal(a.played, 5, 'should be bumped to the active minimum (excluding itself) before benching');
  assert.equal(a.active, false);
});

test('toggleActive(): reactivating does not change played count', () => {
  freshState();
  const [a] = addPlayers(['A', 'B', 'C', 'D']);
  app.toggleActive(a.id);
  const playedWhileInactive = a.played;
  app.toggleActive(a.id);
  assert.equal(a.played, playedWhileInactive);
  assert.equal(a.active, true);
});

test('generateNextMatch(): errors out with fewer than 4 active players', () => {
  freshState();
  addPlayers(['A', 'B', 'C']);
  const result = app.generateNextMatch();
  assert.equal(result.error, 'too_few');
  assert.equal(app.getState().currentMatch, null);
});

test('generateNextMatch(): with exactly 4 active players, selects all of them', () => {
  freshState();
  const players = addPlayers(['A', 'B', 'C', 'D']);
  const result = app.generateNextMatch();
  assert.equal(result.error, null);
  const match = app.getState().currentMatch;
  const ids = [...match.pair1, ...match.pair2].sort();
  assert.deepEqual(ids, players.map(p => p.id).sort());
});

test('generateNextMatch(): never puts the same player on both teams', () => {
  freshState();
  addPlayers(['A', 'B', 'C', 'D', 'E', 'F']);
  for (let i = 0; i < 20; i++) {
    const { error } = app.generateNextMatch();
    assert.equal(error, null);
    const { currentMatch } = app.getState();
    const ids = [...currentMatch.pair1, ...currentMatch.pair2];
    assert.equal(new Set(ids).size, 4, '4 distinct players required per match');
    app.recordCurrentMatchResult(); // uses state.liveScore defaults
  }
});

test('generateNextMatch(): only picks players from the least-played layer', () => {
  freshState();
  const [a, b, c, d, e] = addPlayers(['A', 'B', 'C', 'D', 'E']);
  [a, b, c, d].forEach(p => (p.played = 10));
  e.played = 0; // E has played far less than everyone else
  app.generateNextMatch();
  const { currentMatch } = app.getState();
  const ids = [...currentMatch.pair1, ...currentMatch.pair2];
  assert.ok(ids.includes(e.id), 'the least-played player must always be included');
});

test('recordCurrentMatchResult(): updates played/won/lost/goals for both teams correctly', () => {
  freshState();
  const [a, b, c, d] = addPlayers(['A', 'B', 'C', 'D']);
  app.generateNextMatch();
  const { currentMatch } = app.getState();
  app.getState().liveScore = { score1: 5, score2: 3 };
  app.recordCurrentMatchResult();

  const winners = currentMatch.pair1.map(app.getPlayer);
  const losers = currentMatch.pair2.map(app.getPlayer);
  for (const p of winners) {
    assert.equal(p.played, 1);
    assert.equal(p.won, 1);
    assert.equal(p.lost, 0);
    assert.equal(p.goalsFor, 5);
    assert.equal(p.goalsAgainst, 3);
  }
  for (const p of losers) {
    assert.equal(p.played, 1);
    assert.equal(p.won, 0);
    assert.equal(p.lost, 1);
    assert.equal(p.goalsFor, 3);
    assert.equal(p.goalsAgainst, 5);
  }
  assert.equal(app.getState().finishedMatches.length, 1);
});

test('winLoseRatio(): 0 when no games played, otherwise won/(won+lost)', () => {
  const fresh = { won: 0, lost: 0 };
  assert.equal(app.winLoseRatio(fresh), 0);
  assert.equal(app.winLoseRatio({ won: 3, lost: 1 }), 0.75);
});

test('resetData(): clears every list and counter back to defaults', () => {
  freshState();
  addPlayers(['A', 'B', 'C', 'D']);
  app.generateNextMatch();
  app.recordCurrentMatchResult();
  app.resetData();
  const s = app.getState();
  assert.deepEqual(s.players, []);
  assert.deepEqual(s.finishedMatches, []);
  assert.equal(s.currentMatch, null);
  assert.deepEqual(s.pairStats, {});
});

test('fairness over many rounds: played counts stay perfectly balanced across players', () => {
  freshState();
  addPlayers(['A', 'B', 'C', 'D', 'E']); // odd count -> always exactly one benched per round
  for (let i = 0; i < 200; i++) {
    const { error } = app.generateNextMatch();
    assert.equal(error, null);
    app.getState().liveScore = { score1: 5, score2: 3 };
    app.recordCurrentMatchResult();
  }
  const played = app.getState().players.map(p => p.played);
  assert.equal(Math.max(...played) - Math.min(...played), 0, 'play counts must never diverge by more than the unavoidable rounding');
});

test('fairness: deactivated players stop accumulating games, reactivated players rejoin fairly', () => {
  freshState();
  const [a, b, c, d, e] = addPlayers(['A', 'B', 'C', 'D', 'E']);
  for (let i = 0; i < 20; i++) {
    app.generateNextMatch();
    app.getState().liveScore = { score1: 5, score2: 3 };
    app.recordCurrentMatchResult();
  }
  app.toggleActive(e.id);
  const frozenPlayed = e.played;
  for (let i = 0; i < 20; i++) {
    app.generateNextMatch();
    app.getState().liveScore = { score1: 5, score2: 3 };
    app.recordCurrentMatchResult();
  }
  assert.equal(e.played, frozenPlayed, 'benched player must not accumulate games');
  const activePlayed = [a, b, c, d].map(p => p.played);
  assert.equal(Math.max(...activePlayed) - Math.min(...activePlayed), 0);
});
