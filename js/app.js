'use strict';

/*
 * CsocsoMaster — browser port of the original Android app's scheduling logic.
 * All state lives in-memory in `state` and is mirrored to localStorage after
 * every mutation, so (unlike the original Android app) a page refresh does
 * not lose player stats or match history.
 */

const STORAGE_KEY = 'csocsoMaster.state.v1';
const PLAYERLIST_KEY = 'csocsoMaster.playerListCsv';

let state = null;

/* ---------- i18n ---------- */

const I18N = {
  hu: {
    settingsTitle: 'Beállítások',
    tabPlayers: 'Játékosok',
    tabMatch: 'Meccs',
    tabTable: 'Táblázat',
    tabResults: 'Eredmények',
    addPlayerPlaceholder: 'Új játékos neve',
    addPlayerBtn: '+ Hozzáad',
    playersEmpty: 'Még nincs felvéve játékos. Adj hozzá legalább 4-et a meccsek elindításához.',
    matchEmpty: 'Nincs aktív meccs. Adj hozzá legalább 4 aktív játékost, majd nyomd meg a "Következő" vagy "Új párosítás" gombot.',
    decreaseAria: 'Csökkentés',
    increaseAria: 'Növelés',
    nextBtn: 'Következő',
    skipBtn: 'Új párosítás',
    tooFewHint: 'Túl kevés aktív játékos (minimum 4 kell)!',
    tableName: 'Név',
    tablePlayed: 'J',
    tableWon: 'GY',
    tableLost: 'V',
    tableRatio: '%',
    tableGf: 'LG',
    tableGa: 'KG',
    tableGd: 'GK',
    noMatchesPlayed: 'Még nincs lejátszott meccs.',
    settingKeepScore: 'Eredmény mutatása meccs közben',
    settingWinScore: 'Hány gól kell a győzelemhez',
    saveListBtn: 'Játékoslista mentése',
    loadListBtn: 'Játékoslista betöltése',
    resetBtn: 'Adatok törlése',
    closeBtn: 'Bezárás',
    gamesSuffix: 'meccs',
    toastTooFew: 'Túl kevés aktív játékos!',
    toastListSaved: 'Játékoslista elmentve.',
    toastNoList: 'Nincs elmentett játékoslista.',
    toastListLoaded: 'Játékoslista betöltve.',
    toastDataReset: 'Adatok törölve.',
    confirmReset: 'Biztosan törlöd az összes játékost, meccset és eredményt?'
  },
  en: {
    settingsTitle: 'Settings',
    tabPlayers: 'Players',
    tabMatch: 'Match',
    tabTable: 'Table',
    tabResults: 'Results',
    addPlayerPlaceholder: 'New player name',
    addPlayerBtn: '+ Add',
    playersEmpty: 'No players yet. Add at least 4 to start matches.',
    matchEmpty: 'No active match. Add at least 4 active players, then press "Next" or "New pairing".',
    decreaseAria: 'Decrease',
    increaseAria: 'Increase',
    nextBtn: 'Next',
    skipBtn: 'New pairing',
    tooFewHint: 'Too few active players (minimum 4 required)!',
    tableName: 'Name',
    tablePlayed: 'P',
    tableWon: 'W',
    tableLost: 'L',
    tableRatio: '%',
    tableGf: 'GF',
    tableGa: 'GA',
    tableGd: 'GD',
    noMatchesPlayed: 'No matches played yet.',
    settingKeepScore: 'Show score during match',
    settingWinScore: 'Goals needed to win',
    saveListBtn: 'Save player list',
    loadListBtn: 'Load player list',
    resetBtn: 'Reset data',
    closeBtn: 'Close',
    gamesSuffix: 'games',
    toastTooFew: 'Too few active players!',
    toastListSaved: 'Player list saved.',
    toastNoList: 'No saved player list.',
    toastListLoaded: 'Player list loaded.',
    toastDataReset: 'Data reset.',
    confirmReset: 'Are you sure you want to delete all players, matches and results?'
  }
};

function t(key) {
  const lang = (state && state.settings && state.settings.lang) || 'hu';
  const dict = I18N[lang] || I18N.hu;
  return dict[key] !== undefined ? dict[key] : (I18N.hu[key] || key);
}

function defaultState() {
  return {
    nextPlayerId: 1,
    players: [],        // {id, name, played, won, lost, goalsFor, goalsAgainst, active}
    pairStats: {},       // key: sorted "idA-idB" -> times that pair has played together
    groupStats: {},      // key: sorted "idA-idB-idC-idD" -> times these 4 faced off (any split)
    matchStats: {},      // key: canonical "idA-idB|idC-idD" -> times this exact pairing occurred
    finishedMatches: [],  // {pair1Names, pair2Names, score1, score2, time}
    currentMatch: null,   // {pair1: [idA, idB], pair2: [idC, idD]}
    liveScore: { score1: 0, score2: 0 },
    settings: { keepScore: true, winScore: 5, lang: 'hu' }
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const merged = Object.assign(defaultState(), parsed);
      merged.settings = Object.assign(defaultState().settings, parsed.settings);
      return merged;
    }
  } catch (e) {
    console.warn('Failed to load saved state, starting fresh.', e);
  }
  return defaultState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to persist state.', e);
  }
}

/* ---------- domain helpers ---------- */

function getPlayer(id) {
  return state.players.find(p => p.id === id) || null;
}

function activePlayers() {
  return state.players.filter(p => p.active);
}

function minPlayed(excludeId) {
  const pool = activePlayers().filter(p => p.id !== excludeId);
  if (pool.length === 0) return 0;
  return Math.min(...pool.map(p => p.played));
}

function winLoseRatio(p) {
  const total = p.won + p.lost;
  return total > 0 ? p.won / total : 0;
}

function idsKey(ids) {
  return ids.slice().sort((a, b) => a - b).join('-');
}

function matchKey(pair1ids, pair2ids) {
  const p1 = pair1ids.slice().sort((a, b) => a - b);
  const p2 = pair2ids.slice().sort((a, b) => a - b);
  return p1[0] <= p2[0] ? `${p1.join('-')}|${p2.join('-')}` : `${p2.join('-')}|${p1.join('-')}`;
}

function pairPlayedCount(ids) {
  return state.pairStats[idsKey(ids)] || 0;
}

function groupPlayedCount(ids4) {
  return state.groupStats[idsKey(ids4)] || 0;
}

function matchPlayedCount(pair1ids, pair2ids) {
  return state.matchStats[matchKey(pair1ids, pair2ids)] || 0;
}

function combinations(arr, k) {
  const result = [];
  const combo = [];
  function backtrack(start) {
    if (combo.length === k) {
      result.push(combo.slice());
      return;
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i]);
      backtrack(i + 1);
      combo.pop();
    }
  }
  backtrack(0);
  return result;
}

function pairSplits(combo) {
  const [a, b, c, d] = combo;
  return [
    { pair1: [a, b], pair2: [c, d] },
    { pair1: [a, c], pair2: [b, d] },
    { pair1: [a, d], pair2: [b, c] }
  ];
}

/**
 * Picks the next 2v2 match.
 *
 * Tie-break hierarchy (coarsest to finest), mirroring the original Android
 * app's MatchFragment.generateNextMatch():
 *   1. individual fairness — only players from the least-played layer may play
 *   2. pair fairness — prefer teams (pairs) that have played together least
 *   3. group variety — prefer groups of 4 that have faced off least overall
 *   4. matchup variety — prefer the exact 2v2 split that has repeated least
 */
function generateNextMatch() {
  const active = activePlayers();
  if (active.length < 4) {
    state.currentMatch = null;
    return { error: 'too_few' };
  }

  const sorted = active.slice().sort((a, b) => a.played - b.played);
  const lowestToPlay = sorted[3].played;
  const toPlay = sorted.filter(p => p.played <= lowestToPlay);
  const mustPlay = toPlay.length === 4 ? toPlay.slice() : toPlay.filter(p => p.played < lowestToPlay);

  const combos = combinations(toPlay, 4).filter(combo => mustPlay.every(mp => combo.includes(mp)));

  const candidates = [];
  for (const combo of combos) {
    for (const split of pairSplits(combo)) {
      const pair1ids = split.pair1.map(p => p.id);
      const pair2ids = split.pair2.map(p => p.id);
      candidates.push({
        pair1: split.pair1,
        pair2: split.pair2,
        pairCount: pairPlayedCount(pair1ids) + pairPlayedCount(pair2ids),
        groupCount: groupPlayedCount(pair1ids.concat(pair2ids)),
        matchCount: matchPlayedCount(pair1ids, pair2ids)
      });
    }
  }

  candidates.sort((a, b) =>
    (a.pairCount - b.pairCount) ||
    (a.groupCount - b.groupCount) ||
    (a.matchCount - b.matchCount)
  );

  const best = candidates[0];
  state.currentMatch = {
    pair1: best.pair1.map(p => p.id),
    pair2: best.pair2.map(p => p.id)
  };
  state.liveScore = { score1: state.settings.winScore, score2: state.settings.winScore - 1 };
  return { error: null };
}

function recordCurrentMatchResult() {
  const match = state.currentMatch;
  if (!match) return;

  const { score1, score2 } = state.liveScore;
  const pair1ids = match.pair1;
  const pair2ids = match.pair2;

  state.pairStats[idsKey(pair1ids)] = pairPlayedCount(pair1ids) + 1;
  state.pairStats[idsKey(pair2ids)] = pairPlayedCount(pair2ids) + 1;
  state.groupStats[idsKey(pair1ids.concat(pair2ids))] = groupPlayedCount(pair1ids.concat(pair2ids)) + 1;
  state.matchStats[matchKey(pair1ids, pair2ids)] = matchPlayedCount(pair1ids, pair2ids) + 1;

  applyResult(pair1ids, score1, score2);
  applyResult(pair2ids, score2, score1);

  state.finishedMatches.push({
    pair1Names: pair1ids.map(id => getPlayer(id).name),
    pair2Names: pair2ids.map(id => getPlayer(id).name),
    score1,
    score2,
    time: Date.now()
  });
}

function applyResult(playerIds, ownScore, oppScore) {
  for (const id of playerIds) {
    const p = getPlayer(id);
    p.played++;
    p.goalsFor += ownScore;
    p.goalsAgainst += oppScore;
    if (ownScore > oppScore) p.won++;
    else p.lost++;
  }
}

function addPlayer(name) {
  name = name.trim();
  if (!name) return;
  const played = minPlayed(null);
  state.players.push({
    id: state.nextPlayerId++,
    name,
    played,
    won: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    active: true
  });
}

function toggleActive(id) {
  const p = getPlayer(id);
  if (!p) return;
  if (p.active) {
    const mp = minPlayed(id);
    if (p.played < mp) p.played = mp;
  }
  p.active = !p.active;
}

function resetData() {
  const settings = state ? state.settings : defaultState().settings;
  state = defaultState();
  state.settings = settings; // preferences (language, score settings) are not "data" to be wiped
}

/* ---------- rendering ---------- */

const els = {};

function cacheEls() {
  [
    'player-list', 'player-list-empty', 'form-add-player', 'input-player-name',
    'match-empty', 'match-display', 'too-few-hint',
    'team1-player1', 'team1-player2', 'team2-player1', 'team2-player2',
    'score1', 'score2', 'score-control-1', 'score-control-2',
    'btn-next', 'btn-skip',
    'results-table-body', 'table-empty',
    'finished-match-list', 'finished-empty',
    'btn-settings', 'settings-overlay', 'btn-settings-close',
    'setting-keep-score', 'setting-win-score',
    'btn-save-list', 'btn-load-list', 'btn-reset-data',
    'toast'
  ].forEach(id => { els[id] = document.getElementById(id); });
}

function renderPlayers() {
  const list = els['player-list'];
  list.innerHTML = '';
  const players = state.players;
  els['player-list-empty'].hidden = players.length > 0;

  for (const p of players) {
    const li = document.createElement('li');
    li.className = 'player-row' + (p.active ? '' : ' inactive');
    li.innerHTML = `
      <span class="status-dot"></span>
      <span class="player-row-name"></span>
      <span class="player-row-played"></span>
    `;
    li.querySelector('.player-row-name').textContent = p.name;
    li.querySelector('.player-row-played').textContent = `${p.played} ${t('gamesSuffix')}`;
    li.addEventListener('click', () => {
      toggleActive(p.id);
      persistAndRender();
    });
    list.appendChild(li);
  }
}

function renderMatch() {
  const match = state.currentMatch;
  const tooFew = activePlayers().length < 4;
  els['too-few-hint'].hidden = !tooFew;

  if (!match) {
    els['match-empty'].hidden = false;
    els['match-display'].hidden = true;
    return;
  }

  els['match-empty'].hidden = true;
  els['match-display'].hidden = false;

  const [a1, a2] = match.pair1.map(getPlayer);
  const [b1, b2] = match.pair2.map(getPlayer);
  els['team1-player1'].textContent = a1.name;
  els['team1-player2'].textContent = a2.name;
  els['team2-player1'].textContent = b1.name;
  els['team2-player2'].textContent = b2.name;

  els['score1'].textContent = state.liveScore.score1;
  els['score2'].textContent = state.liveScore.score2;

  const keepScore = state.settings.keepScore;
  els['score-control-1'].style.visibility = keepScore ? 'visible' : 'hidden';
  els['score-control-2'].style.visibility = keepScore ? 'visible' : 'hidden';
}

function renderTable() {
  const body = els['results-table-body'];
  body.innerHTML = '';
  const rows = state.players
    .filter(p => p.played > 0)
    .sort((a, b) => {
      const ra = winLoseRatio(a), rb = winLoseRatio(b);
      if (ra !== rb) return rb - ra;
      const gdA = a.goalsFor - a.goalsAgainst, gdB = b.goalsFor - b.goalsAgainst;
      if (gdA !== gdB) return gdB - gdA;
      return b.goalsFor - a.goalsFor;
    });

  els['table-empty'].hidden = rows.length > 0;

  for (const p of rows) {
    const tr = document.createElement('tr');
    const gd = p.goalsFor - p.goalsAgainst;
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td>${p.played}</td>
      <td>${p.won}</td>
      <td>${p.lost}</td>
      <td>${Math.round(winLoseRatio(p) * 100)}%</td>
      <td>${p.goalsFor}</td>
      <td>${p.goalsAgainst}</td>
      <td>${gd > 0 ? '+' + gd : gd}</td>
    `;
    body.appendChild(tr);
  }
}

function renderFinishedMatches() {
  const list = els['finished-match-list'];
  list.innerHTML = '';
  const matches = state.finishedMatches.slice().reverse();
  els['finished-empty'].hidden = matches.length > 0;

  for (const m of matches) {
    const li = document.createElement('li');
    li.className = 'finished-match-row';
    const pair1Wins = m.score1 > m.score2;
    li.innerHTML = `
      <div class="fm-team ${pair1Wins ? 'win' : 'loss'}">${escapeHtml(m.pair1Names.join(' & '))}</div>
      <div class="fm-score">${m.score1} - ${m.score2}</div>
      <div class="fm-team ${pair1Wins ? 'loss' : 'win'}">${escapeHtml(m.pair2Names.join(' & '))}</div>
    `;
    list.appendChild(li);
  }
}

function renderSettings() {
  els['setting-keep-score'].checked = state.settings.keepScore;
  els['setting-win-score'].value = state.settings.winScore;
}

function renderLangToggle() {
  const lang = state.settings.lang || 'hu';
  document.documentElement.lang = lang;
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === lang);
  });
}

/** Applies translated text/placeholder/title/aria-label to every static element marked with a data-i18n-* attribute. */
function applyStaticI18n() {
  document.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  document.querySelectorAll('[data-i18n-title]').forEach(el => { el.title = t(el.dataset.i18nTitle); });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAriaLabel)); });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderAll() {
  applyStaticI18n();
  renderLangToggle();
  renderPlayers();
  renderMatch();
  renderTable();
  renderFinishedMatches();
  renderSettings();
}

function persistAndRender() {
  saveState();
  renderAll();
}

/* ---------- toast ---------- */

let toastTimer = null;
function showToast(message) {
  const toast = els['toast'];
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2200);
}

/* ---------- tabs ---------- */

function initTabs() {
  const buttons = document.querySelectorAll('.tab-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
      document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
    });
  });
}

/* ---------- score stepper (mirrors original mutual-clamp behaviour) ---------- */

function incScore(pairNum) {
  const max = state.settings.winScore;
  const s = state.liveScore;
  if (pairNum === 1) {
    if (s.score1 === max - 1 && s.score2 === max) s.score2 = max - 1;
    if (s.score1 < max) s.score1++;
  } else {
    if (s.score2 === max - 1 && s.score1 === max) s.score1 = max - 1;
    if (s.score2 < max) s.score2++;
  }
}

function decScore(pairNum) {
  const max = state.settings.winScore;
  const s = state.liveScore;
  if (pairNum === 1) {
    if (s.score1 === max) s.score2 = max;
    if (s.score1 > 0) s.score1--;
  } else {
    if (s.score2 === max) s.score1 = max;
    if (s.score2 > 0) s.score2--;
  }
}

/* ---------- wiring ---------- */

function initEvents() {
  els['form-add-player'].addEventListener('submit', e => {
    e.preventDefault();
    const input = els['input-player-name'];
    addPlayer(input.value);
    input.value = '';
    persistAndRender();
  });

  document.querySelectorAll('.btn-score-inc').forEach(btn => {
    btn.addEventListener('click', () => {
      incScore(Number(btn.dataset.pair));
      persistAndRender();
    });
  });
  document.querySelectorAll('.btn-score-dec').forEach(btn => {
    btn.addEventListener('click', () => {
      decScore(Number(btn.dataset.pair));
      persistAndRender();
    });
  });

  els['btn-next'].addEventListener('click', () => {
    if (state.currentMatch) {
      recordCurrentMatchResult();
    }
    const result = generateNextMatch();
    if (result.error === 'too_few') showToast(t('toastTooFew'));
    persistAndRender();
  });

  els['btn-skip'].addEventListener('click', () => {
    const result = generateNextMatch();
    if (result.error === 'too_few') showToast(t('toastTooFew'));
    persistAndRender();
  });

  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.settings.lang = btn.dataset.lang;
      persistAndRender();
    });
  });

  els['btn-settings'].addEventListener('click', () => { els['settings-overlay'].hidden = false; });
  els['btn-settings-close'].addEventListener('click', () => { els['settings-overlay'].hidden = true; });
  els['settings-overlay'].addEventListener('click', e => {
    if (e.target === els['settings-overlay']) els['settings-overlay'].hidden = true;
  });

  els['setting-keep-score'].addEventListener('change', () => {
    state.settings.keepScore = els['setting-keep-score'].checked;
    persistAndRender();
  });

  els['setting-win-score'].addEventListener('change', () => {
    const oldMax = state.settings.winScore;
    let newMax = parseInt(els['setting-win-score'].value, 10);
    if (!Number.isFinite(newMax) || newMax < 1) newMax = oldMax;
    const s = state.liveScore;
    if (s.score1 === oldMax) { s.score1 = newMax; if (s.score2 >= newMax) s.score2 = newMax - 1; }
    if (s.score2 === oldMax) { s.score2 = newMax; if (s.score1 >= newMax) s.score1 = newMax - 1; }
    state.settings.winScore = newMax;
    persistAndRender();
  });

  els['btn-save-list'].addEventListener('click', () => {
    const csv = state.players.map(p => p.name).join(',');
    localStorage.setItem(PLAYERLIST_KEY, csv);
    showToast(t('toastListSaved'));
  });

  els['btn-load-list'].addEventListener('click', () => {
    const csv = localStorage.getItem(PLAYERLIST_KEY) || '';
    if (!csv) {
      showToast(t('toastNoList'));
      return;
    }
    resetData();
    for (const name of csv.split(',')) {
      if (name) addPlayer(name);
    }
    els['settings-overlay'].hidden = true;
    showToast(t('toastListLoaded'));
    persistAndRender();
  });

  els['btn-reset-data'].addEventListener('click', () => {
    if (!confirm(t('confirmReset'))) return;
    resetData();
    els['settings-overlay'].hidden = true;
    showToast(t('toastDataReset'));
    persistAndRender();
  });
}

/* ---------- init ---------- */

function initApp() {
  cacheEls();
  state = loadState();
  initTabs();
  initEvents();
  renderAll();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', initApp);
}

/* ---------- test hooks (Node only — no-op in the browser) ---------- */

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    defaultState,
    getState: () => state,
    setState: s => { state = s; },
    loadState, saveState,
    getPlayer, activePlayers, minPlayed, winLoseRatio,
    idsKey, matchKey, pairPlayedCount, groupPlayedCount, matchPlayedCount,
    combinations, pairSplits,
    generateNextMatch, recordCurrentMatchResult, applyResult,
    addPlayer, toggleActive, resetData,
    incScore, decScore,
    t, I18N,
    initApp
  };
}
