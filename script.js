/**
 * ============================================================
 * Cricket Analytics Dashboard — script.js
 * ============================================================
 * Reads four CricHeroes leaderboard CSVs using PapaParse:
 *   1874258_batting_leaderboard.csv
 *   1874258_bowling_leaderboard.csv
 *   1874258_fielding_leaderboard.csv
 *   1874258_mvp_leaderboard.csv
 *
 * Columns used:
 *  Batting:  player_id, name, team_name, total_match, innings,
 *            total_runs, highest_run, average, not_out,
 *            strike_rate, ball_faced, 4s, 6s, 50s, 100s
 *  Bowling:  player_id, name, team_name, total_match, innings,
 *            total_wickets, overs, economy, SR, maidens,
 *            avg, runs, dot_balls
 *  Fielding: player_id, name, team_name, catches, caught_behind,
 *            run_outs, stumpings, caught_and_bowl,
 *            total_catches, total_dismissal
 *  MVP:      Player Name, Team Name, Player Role,
 *            Batting, Bowling, Fielding, Total
 * ============================================================
 */

/* ── Points Table — loaded from points_table.csv at runtime ── */
let POINTS_TABLE = [];

/* ── CSV file paths (relative to index.html) ── */
const CSV_FILES = {
  batting:      './1874258_batting_leaderboard.csv',
  bowling:      './1874258_bowling_leaderboard.csv',
  fielding:     './1874258_fielding_leaderboard.csv',
  mvp:          './1874258_mvp_leaderboard.csv',
  pointsTable:  './points_table.csv'
};

/* ── Team colour palette — Kite-toned ── */
const TEAM_COLORS = {
  rcb: { bg: 'rgba(229,57,53,0.70)',   border: '#e53935' },
  ww:  { bg: 'rgba(25,118,210,0.70)',  border: '#1976d2' },
  def: { bg: 'rgba(56,126,209,0.70)',  border: '#387ed1' }
};

/* ── Chart.js defaults — Kite light theme ── */
Chart.defaults.color        = '#7a7a7a';
Chart.defaults.borderColor  = '#e7e7e7';
Chart.defaults.font.family  = "Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size    = 11;

/* ── Application state ── */
const state = {
  batting:  [],
  bowling:  [],
  fielding: [],
  mvp:      [],
  team:     'ALL',
  player:   'ALL'
};

/* Chart instances — destroyed before recreation */
const charts = {};


/* ============================================================
   Utility helpers
   ============================================================ */

/** Safely parse a numeric string; returns 0 on failure */
function num(v) {
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

/** Escape string for safe innerHTML insertion */
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Trigger a CSS animation by toggling a class */
function flash(el, cls) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth;   // force reflow
  el.classList.add(cls);
}

/** Destroy a named chart if it exists */
function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

/** Show an empty-state message inside a chart canvas wrapper */
function showEmptyChart(canvasId, message) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const wrap = canvas.closest('.chart-wrap');
  if (!wrap) return;
  canvas.style.display = 'none';
  let empty = wrap.querySelector('.chart-empty');
  if (!empty) {
    empty = document.createElement('div');
    empty.className = 'chart-empty';
    wrap.appendChild(empty);
  }
  empty.innerHTML = `<div class="chart-empty-icon">📭</div><div class="chart-empty-text">${esc(message)}</div>`;
}

/** Hide the empty-state overlay and show the canvas again */
function hideEmptyChart(canvasId) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  canvas.style.display = '';
  const wrap = canvas.closest('.chart-wrap');
  if (!wrap) return;
  const empty = wrap.querySelector('.chart-empty');
  if (empty) empty.remove();
}

/** Render the Season MVP banner */
function renderTopPerformer(mvp) {
  const banner = document.getElementById('topPerformerBanner');
  if (!banner) return;
  const rows = [...mvp].filter(r => num(r.Total) > 0).sort((a, b) => num(b.Total) - num(a.Total));
  if (!rows.length) { banner.classList.add('hidden'); return; }
  const top = rows[0];
  document.getElementById('tp-name').textContent  = top['Player Name'] || '—';
  document.getElementById('tp-team').textContent  = top['Team Name']   || '';
  document.getElementById('tp-stats').innerHTML =
    `<span class="tp-stat">MVP ${num(top.Total).toFixed(2)} pts</span>` +
    (top['Player Role'] ? `<span class="tp-stat">${esc(top['Player Role'])}</span>` : '') +
    `<span class="tp-stat">${top.Matches || 0} matches</span>`;
  banner.classList.remove('hidden');
}


/* ============================================================
   CSV loading
   ============================================================ */

/**
 * Fetch and parse a CSV file using PapaParse.
 * @param {string} path  URL/path to the CSV file
 * @returns {Promise<Object[]>}  Array of row objects (keyed by header)
 */
async function loadCSV(path) {
  const res  = await fetch(path);
  const text = await res.text();
  return new Promise((resolve, reject) => {
    Papa.parse(text, {
      header:         true,
      skipEmptyLines: true,
      complete: r => resolve(r.data),
      error:    e => reject(e)
    });
  });
}


/* ============================================================
   Spinner
   ============================================================ */
const showSpinner = () => document.getElementById('spinner').classList.remove('hidden');
const hideSpinner = () => document.getElementById('spinner').classList.add('hidden');


/* ============================================================
   Player dropdown
   ============================================================ */

/** Collect unique player names, optionally filtered by team */
function getUniquePlayers(team) {
  const names = new Set();
  [...state.batting, ...state.bowling].forEach(r => {
    if (!r.name) return;
    if (team && team !== 'ALL' && r.team_name !== team) return;
    names.add(r.name.trim());
  });
  return [...names].sort();
}

function populatePlayerDropdown() {
  const sel = document.getElementById('playerFilter');
  const prev = sel.value;
  sel.innerHTML = '<option value="ALL">All Players</option>';
  getUniquePlayers(state.team).forEach(name => {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });
  /* Keep selection if still valid */
  if (prev !== 'ALL' && [...sel.options].some(o => o.value === prev)) {
    sel.value = prev;
  } else {
    sel.value = 'ALL';
    state.player = 'ALL';
  }
}


/* ============================================================
   Data filters
   ============================================================ */

function filterBatting() {
  return state.batting
    .filter(r => state.team   === 'ALL' || r.team_name === state.team)
    .filter(r => state.player === 'ALL' || (r.name && r.name.trim() === state.player));
}

function filterBowling() {
  return state.bowling
    .filter(r => state.team   === 'ALL' || r.team_name === state.team)
    .filter(r => state.player === 'ALL' || (r.name && r.name.trim() === state.player));
}

function filterFielding() {
  return state.fielding
    .filter(r => state.team   === 'ALL' || r.team_name === state.team)
    .filter(r => state.player === 'ALL' || (r.name && r.name.trim() === state.player));
}

function filterMvp() {
  return state.mvp
    .filter(r => state.team   === 'ALL' || r['Team Name'] === state.team)
    .filter(r => state.player === 'ALL' || (r['Player Name'] && r['Player Name'].trim().toLowerCase() === state.player.toLowerCase()));
}


/* ============================================================
   Team colour helpers (for per-player bars)
   ============================================================ */

/** Return the batting/bowling row that has team_name for a given player name */
function playerRow(name) {
  return state.batting.find(r => r.name && r.name.trim() === name)
      || state.bowling.find(r => r.name && r.name.trim() === name)
      || null;
}

function barBg(name) {
  const r = playerRow(name);
  if (!r) return TEAM_COLORS.def.bg;
  if (r.team_name && r.team_name.includes('RCB')) return TEAM_COLORS.rcb.bg;
  if (r.team_name && r.team_name.includes('WW'))  return TEAM_COLORS.ww.bg;
  return TEAM_COLORS.def.bg;
}

function barBorder(name) {
  const r = playerRow(name);
  if (!r) return TEAM_COLORS.def.border;
  if (r.team_name && r.team_name.includes('RCB')) return TEAM_COLORS.rcb.border;
  if (r.team_name && r.team_name.includes('WW'))  return TEAM_COLORS.ww.border;
  return TEAM_COLORS.def.border;
}


/* ============================================================
   KPI Cards
   ============================================================ */

function renderKPIs(batting, bowling, fielding, mvp) {
  /* Batting */
  const totalRuns = batting.reduce((s, r) => s + num(r.total_runs), 0);

  let highestScore = 0, highestPlayer = '';
  batting.forEach(r => {
    const h = num(r.highest_run);
    if (h > highestScore) { highestScore = h; highestPlayer = r.name || ''; }
  });

  let bestAvg = 0, bestAvgPlayer = '';
  batting
    .filter(r => num(r.innings) >= 2 && r.average && r.average !== '-')
    .forEach(r => {
      const a = num(r.average);
      if (a > bestAvg) { bestAvg = a; bestAvgPlayer = r.name || ''; }
    });

  let bestSR = 0, bestSRPlayer = '';
  batting
    .filter(r => num(r.ball_faced) >= 10)
    .forEach(r => {
      const sr = num(r.strike_rate);
      if (sr > bestSR) { bestSR = sr; bestSRPlayer = r.name || ''; }
    });

  /* Bowling */
  const totalWickets = bowling.reduce((s, r) => s + num(r.total_wickets), 0);

  let bestEcon = Infinity, bestEconPlayer = '';
  bowling
    .filter(r => num(r.overs) >= 2 && num(r.economy) > 0)
    .forEach(r => {
      const e = num(r.economy);
      if (e < bestEcon) { bestEcon = e; bestEconPlayer = r.name || ''; }
    });

  /* Fielding */
  const totalDismissals = fielding.reduce((s, r) => s + num(r.total_dismissal), 0);

  /* MVP */
  const topMvp = mvp.length
    ? mvp.reduce((best, r) => num(r.Total) > num(best.Total) ? r : best, mvp[0])
    : null;

  /* Update DOM */
  function set(id, val, sub) {
    const valEl = document.getElementById(`val-${id}`);
    const subEl = document.getElementById(`sub-${id}`);
    if (valEl) { valEl.textContent = val; flash(valEl, 'kpi-pop'); }
    if (subEl)   subEl.textContent = sub ?? '';
  }

  set('runs',       totalRuns.toLocaleString(),                    '');
  set('highest',    highestScore || '—',                           highestPlayer);
  set('avg',        bestAvg     ? bestAvg.toFixed(2)      : '—',   bestAvgPlayer);
  set('sr',         bestSR      ? bestSR.toFixed(1)       : '—',   bestSRPlayer);
  set('wickets',    totalWickets || '—',                           '');
  set('economy',    bestEcon !== Infinity ? bestEcon.toFixed(2) : '—', bestEconPlayer);
  set('dismissals', totalDismissals || '—',                        '');

  if (topMvp) {
    set('mvp', topMvp['Player Name'], `${num(topMvp.Total).toFixed(2)} pts · ${topMvp['Team Name']}`);
  } else {
    set('mvp', '—', '');
  }
}


/* ============================================================
   Player Profile Card
   ============================================================ */

function renderPlayerDetail(playerName) {
  const section = document.getElementById('playerDetailSection');
  const card    = document.getElementById('playerDetailCard');

  if (playerName === 'ALL') { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  const bat   = state.batting.find(r  => r.name          && r.name.trim()          === playerName) || {};
  const bowl  = state.bowling.find(r  => r.name          && r.name.trim()          === playerName) || {};
  const field = state.fielding.find(r => r.name          && r.name.trim()          === playerName) || {};
  const mvpR  = state.mvp.find(r      => r['Player Name'] && r['Player Name'].trim().toLowerCase() === playerName.toLowerCase()) || {};

  const initials  = playerName.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  const teamName  = bat.team_name || bowl.team_name || '';
  const isRCB     = teamName.includes('RCB');
  const isWW      = teamName.includes('WW');

  const badgeStyle = isRCB
    ? 'background:var(--rcb-lt);color:var(--rcb);border:1px solid rgba(229,57,53,0.3);'
    : isWW
      ? 'background:var(--ww-lt);color:var(--ww);border:1px solid rgba(25,118,210,0.3);'
      : '';

  /* Build stat tiles */
  const batStats = bat.total_runs !== undefined ? `
    <div class="pstat"><div class="pstat-label">Runs</div><div class="pstat-value">${bat.total_runs ?? '—'}</div></div>
    <div class="pstat"><div class="pstat-label">Highest</div><div class="pstat-value">${bat.highest_run || '—'}</div></div>
    <div class="pstat"><div class="pstat-label">Average</div><div class="pstat-value">${bat.average || '—'}</div></div>
    <div class="pstat"><div class="pstat-label">Strike Rate</div><div class="pstat-value">${bat.strike_rate || '—'}</div></div>
    <div class="pstat"><div class="pstat-label">Innings</div><div class="pstat-value">${bat.innings || 0}</div></div>
    <div class="pstat"><div class="pstat-label">Not Outs</div><div class="pstat-value">${bat.not_out || 0}</div></div>
    <div class="pstat"><div class="pstat-label">4s / 6s</div><div class="pstat-value">${bat['4s'] || 0} / ${bat['6s'] || 0}</div></div>
    <div class="pstat"><div class="pstat-label">50s / 100s</div><div class="pstat-value">${bat['50s'] || 0} / ${bat['100s'] || 0}</div></div>
  ` : '';

  const hasWickets = num(bowl.overs) > 0;
  const bowlStats = hasWickets ? `
    <div class="pstat"><div class="pstat-label">Wickets</div><div class="pstat-value">${bowl.total_wickets ?? '—'}</div></div>
    <div class="pstat"><div class="pstat-label">Economy</div><div class="pstat-value">${bowl.economy || '—'}</div></div>
    <div class="pstat"><div class="pstat-label">Overs</div><div class="pstat-value">${bowl.overs}</div></div>
    <div class="pstat"><div class="pstat-label">Maidens</div><div class="pstat-value">${bowl.maidens || 0}</div></div>
    <div class="pstat"><div class="pstat-label">Bowling SR</div><div class="pstat-value">${bowl.SR || '—'}</div></div>
    <div class="pstat"><div class="pstat-label">Dot Balls</div><div class="pstat-value">${bowl.dot_balls || 0}</div></div>
  ` : '';

  const fieldStats = field.total_dismissal !== undefined ? `
    <div class="pstat"><div class="pstat-label">Dismissals</div><div class="pstat-value">${field.total_dismissal}</div></div>
    <div class="pstat"><div class="pstat-label">Catches</div><div class="pstat-value">${num(field.catches) + num(field.caught_behind)}</div></div>
    <div class="pstat"><div class="pstat-label">Run Outs</div><div class="pstat-value">${field.run_outs || 0}</div></div>
    <div class="pstat"><div class="pstat-label">Stumpings</div><div class="pstat-value">${field.stumpings || 0}</div></div>
  ` : '';

  const mvpStat = mvpR.Total ? `
    <div class="pstat pstat-mvp">
      <div class="pstat-label">MVP Score</div>
      <div class="pstat-value">${num(mvpR.Total).toFixed(2)}</div>
    </div>
  ` : '';

  card.innerHTML = `
    <div class="player-avatar">${esc(initials)}</div>
    <div class="player-info">
      <div>
        <div class="player-name">${esc(playerName)}</div>
        <div class="player-meta">
          <span class="player-team-badge" style="${badgeStyle}">${esc(teamName)}</span>
          ${mvpR['Player Role'] ? `<span class="player-role">${esc(mvpR['Player Role'])}</span>` : ''}
          ${mvpR['Bowling Style'] && mvpR['Bowling Style'] !== 'None' ? `<span class="player-role">· ${esc(mvpR['Bowling Style'])}</span>` : ''}
        </div>
      </div>
      <div class="player-stats-grid">
        ${batStats}${bowlStats}${fieldStats}${mvpStat}
      </div>
    </div>
  `;
}


/* ============================================================
   Shared chart config builder
   ============================================================ */

/**
 * Build a horizontal bar chart config (Chart.js).
 * @param {string[]} labels
 * @param {number[]} data
 * @param {string[]} bgColors
 * @param {string[]} borderColors
 */
function hBarConfig(labels, data, bgColors, borderColors) {
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: bgColors,
        borderColor:      borderColors,
        borderWidth: 1,
        borderRadius: 4,
        borderSkipped: false
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 380, easing: 'easeOutQuart' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#172035',
          titleColor: '#ffffff',
          bodyColor: '#b0bec5',
          borderColor: '#2c3e60',
          borderWidth: 1,
          padding: 8,
          callbacks: { label: ctx => `  ${ctx.raw}` }
        }
      },
      scales: {
        x: {
          grid: { color: '#f0f3f5' },
          ticks: { color: '#7a7a7a', font: { size: 11 } }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#383838', font: { size: 11 } }
        }
      }
    }
  };
}


/* ============================================================
   Individual chart renderers
   ============================================================ */

/* Batting — Top runs */
function renderTopBatters(batting) {
  destroyChart('topBatters');
  const rows = [...batting]
    .filter(r => num(r.total_runs) > 0)
    .sort((a, b) => num(b.total_runs) - num(a.total_runs))
    .slice(0, 12);
  if (!rows.length) { showEmptyChart('topBattersChart', 'No batting data for this selection'); return; }
  hideEmptyChart('topBattersChart');
  const labels = rows.map(r => r.name);
  const data   = rows.map(r => num(r.total_runs));
  const ctx = document.getElementById('topBattersChart').getContext('2d');
  charts.topBatters = new Chart(ctx, hBarConfig(labels, data, labels.map(barBg), labels.map(barBorder)));
}

/* Batting — Strike rate */
function renderStrikeRate(batting) {
  destroyChart('strikeRate');
  const rows = [...batting]
    .filter(r => num(r.ball_faced) >= 10 && num(r.strike_rate) > 0)
    .sort((a, b) => num(b.strike_rate) - num(a.strike_rate))
    .slice(0, 12);
  if (!rows.length) { showEmptyChart('strikeRateChart', 'No strike rate data (min 10 balls)'); return; }
  hideEmptyChart('strikeRateChart');
  const labels = rows.map(r => r.name);
  const data   = rows.map(r => num(r.strike_rate));
  const ctx = document.getElementById('strikeRateChart').getContext('2d');
  charts.strikeRate = new Chart(ctx, hBarConfig(labels, data, labels.map(barBg), labels.map(barBorder)));
}

/* Batting — Average */
function renderBattingAvg(batting) {
  destroyChart('battingAvg');
  const rows = [...batting]
    .filter(r => num(r.innings) >= 2 && r.average && r.average !== '-' && num(r.average) > 0)
    .sort((a, b) => num(b.average) - num(a.average))
    .slice(0, 12);
  if (!rows.length) { showEmptyChart('battingAvgChart', 'No average data (min 2 innings)'); return; }
  hideEmptyChart('battingAvgChart');
  const labels = rows.map(r => r.name);
  const data   = rows.map(r => num(r.average));
  const ctx = document.getElementById('battingAvgChart').getContext('2d');
  charts.battingAvg = new Chart(ctx, hBarConfig(labels, data, labels.map(barBg), labels.map(barBorder)));
}

/* Batting — Boundaries (grouped stacked bar) */
function renderBoundaries(batting) {
  destroyChart('boundaries');
  const rows = [...batting]
    .filter(r => num(r['4s']) + num(r['6s']) > 0)
    .sort((a, b) => (num(b['4s']) + num(b['6s'])) - (num(a['4s']) + num(a['6s'])))
    .slice(0, 12);
  if (!rows.length) { showEmptyChart('boundariesChart', 'No boundary data for this selection'); return; }
  hideEmptyChart('boundariesChart');
  const labels = rows.map(r => r.name);
  const ctx = document.getElementById('boundariesChart').getContext('2d');
  charts.boundaries = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: '4s',
          data: rows.map(r => num(r['4s'])),
          backgroundColor: 'rgba(59,130,246,0.75)',
          borderColor: '#3b82f6', borderWidth: 1, borderRadius: 3
        },
        {
          label: '6s',
          data: rows.map(r => num(r['6s'])),
          backgroundColor: 'rgba(249,115,22,0.75)',
          borderColor: '#f97316', borderWidth: 1, borderRadius: 3
        }
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 450 },
      plugins: { legend: { display: true, labels: { color: '#7a7a7a', font: { size: 11 }, boxWidth: 10 } } },
      scales: {
        x: { stacked: true, grid: { color: '#f0f3f5' }, ticks: { color: '#7a7a7a', font: { size: 11 } } },
        y: { stacked: true, grid: { display: false }, ticks: { color: '#383838', font: { size: 11 } } }
      }
    }
  });
}

/* Bowling — Wickets */
function renderWickets(bowling) {
  destroyChart('wickets');
  const rows = [...bowling]
    .filter(r => num(r.total_wickets) > 0)
    .sort((a, b) => num(b.total_wickets) - num(a.total_wickets))
    .slice(0, 12);
  if (!rows.length) { showEmptyChart('wicketsChart', 'No wickets data for this selection'); return; }
  hideEmptyChart('wicketsChart');
  const labels = rows.map(r => r.name);
  const data   = rows.map(r => num(r.total_wickets));
  const ctx = document.getElementById('wicketsChart').getContext('2d');
  charts.wickets = new Chart(ctx, hBarConfig(labels, data, labels.map(barBg), labels.map(barBorder)));
}

/* Bowling — Economy (ascending = lower is better; colour-coded green→red) */
function renderEconomy(bowling) {
  destroyChart('economy');
  const rows = [...bowling]
    .filter(r => num(r.overs) >= 2 && num(r.economy) > 0)
    .sort((a, b) => num(a.economy) - num(b.economy))   // ascending: best first
    .slice(0, 12);
  if (!rows.length) { showEmptyChart('economyChart', 'No economy data (min 2 overs)'); return; }
  hideEmptyChart('economyChart');
  const labels = rows.map(r => r.name);
  const data   = rows.map(r => num(r.economy));
  const n = data.length;
  /* Interpolate green → orange → red */
  const bgColors = data.map((_, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const r = Math.round(34  + t * 205);
    const g = Math.round(197 - t * 148);
    const b = Math.round(94  - t * 72);
    return `rgba(${r},${g},${b},0.75)`;
  });
  const ctx = document.getElementById('economyChart').getContext('2d');
  charts.economy = new Chart(ctx, hBarConfig(labels, data, bgColors, bgColors.map(c => c.replace('0.75', '1'))));
}

/* Fielding — Dismissals (stacked: catches + run-outs + stumpings) */
function renderFielding(fielding) {
  destroyChart('fielding');
  const rows = [...fielding]
    .filter(r => num(r.total_dismissal) > 0)
    .sort((a, b) => num(b.total_dismissal) - num(a.total_dismissal))
    .slice(0, 12);
  if (!rows.length) { showEmptyChart('fieldingChart', 'No fielding data for this selection'); return; }
  hideEmptyChart('fieldingChart');
  const labels = rows.map(r => r.name);
  const ctx = document.getElementById('fieldingChart').getContext('2d');
  charts.fielding = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Catches',
          data: rows.map(r => num(r.catches) + num(r.caught_behind)),
          backgroundColor: 'rgba(34,197,94,0.75)',
          borderColor: '#22c55e', borderWidth: 1, borderRadius: 3
        },
        {
          label: 'Run Outs',
          data: rows.map(r => num(r.run_outs)),
          backgroundColor: 'rgba(249,115,22,0.75)',
          borderColor: '#f97316', borderWidth: 1, borderRadius: 3
        },
        {
          label: 'Stumpings',
          data: rows.map(r => num(r.stumpings)),
          backgroundColor: 'rgba(139,92,246,0.75)',
          borderColor: '#8b5cf6', borderWidth: 1, borderRadius: 3
        }
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 450 },
      plugins: { legend: { display: true, labels: { color: '#7a7a7a', font: { size: 11 }, boxWidth: 10 } } },
      scales: {
        x: { stacked: true, grid: { color: '#f0f3f5' }, ticks: { color: '#7a7a7a', font: { size: 11 } } },
        y: { stacked: true, grid: { display: false }, ticks: { color: '#383838', font: { size: 11 } } }
      }
    }
  });
}

/* MVP — Leaderboard (gold/silver/bronze medals) */
function renderMvp(mvp) {
  destroyChart('mvp');
  const rows = [...mvp]
    .filter(r => num(r.Total) > 0)
    .sort((a, b) => num(b.Total) - num(a.Total))
    .slice(0, 12);
  if (!rows.length) { showEmptyChart('mvpChart', 'No MVP data for this selection'); return; }
  hideEmptyChart('mvpChart');
  const labels = rows.map(r => r['Player Name']);
  const data   = rows.map(r => parseFloat(num(r.Total).toFixed(2)));
  const bgColors = rows.map((_, i) => {
    if (i === 0) return 'rgba(251,191,36,0.9)';   // gold
    if (i === 1) return 'rgba(209,213,219,0.8)';  // silver
    if (i === 2) return 'rgba(217,119,6,0.8)';    // bronze
    return 'rgba(249,115,22,0.65)';
  });
  const borderColors = rows.map((_, i) => {
    if (i === 0) return '#fbbf24';
    if (i === 1) return '#d1d5db';
    if (i === 2) return '#d97706';
    return '#f97316';
  });
  const ctx = document.getElementById('mvpChart').getContext('2d');
  charts.mvp = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ data, backgroundColor: bgColors, borderColor: borderColors, borderWidth: 1, borderRadius: 4 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 450 },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: ctx => `  ${parseFloat(ctx.raw).toFixed(2)} pts` } }
      },
      scales: {
        x: { grid: { color: '#f0f3f5' }, ticks: { color: '#7a7a7a', font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { color: '#383838', font: { size: 11 } } }
      }
    }
  });
}

/* ============================================================
   League Standings — Points Table + Charts
   ============================================================ */

/** Render the HTML points table from POINTS_TABLE static data */
function renderPointsTable() {
  const wrap = document.getElementById('pointsTableWrap');
  if (!wrap) return;

  const teamColor = t => t.includes('WW') ? 'var(--ww)' : 'var(--rcb)';

  const rows = POINTS_TABLE.map((r, i) => {
    const nrrClass  = r.NRR >= 0 ? 'pt-nrr-pos' : 'pt-nrr-neg';
    const nrrSign   = r.NRR >= 0 ? '+' : '';
    const last5Html = r.last5.map(res =>
      `<span class="pt-badge pt-badge-${res.toLowerCase()}">${res}</span>`
    ).join('');
    const leaderCls = i === 0 ? ' pt-leader-row' : '';
    const leaderCup = i === 0 ? ' <span class="pt-leader-cup">🏆</span>' : '';

    return `
      <tr class="${leaderCls}">
        <td class="pt-rank">${r.rank}</td>
        <td>
          <div class="pt-team">
            <div class="pt-team-dot" style="background:${teamColor(r.team)}"></div>
            <div>
              <div class="pt-team-name">${esc(r.team)}${leaderCup}</div>
            </div>
          </div>
        </td>
        <td class="td-center">${r.M}</td>
        <td class="td-center" style="color:var(--green);font-weight:600">${r.W}</td>
        <td class="td-center" style="color:var(--red);font-weight:600">${r.L}</td>
        <td class="td-center">${r.D}</td>
        <td class="td-center">${r.NR}</td>
        <td class="td-center"><span class="${nrrClass}">${nrrSign}${r.NRR.toFixed(3)}</span></td>
        <td class="td-center" style="color:var(--text-secondary)">${r.For}</td>
        <td class="td-center" style="color:var(--text-secondary)">${r.Against}</td>
        <td class="pt-pts">${r.Pts}</td>
        <td><div class="pt-last5">${last5Html}</div></td>
      </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="points-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Team</th>
          <th class="th-center">M</th>
          <th class="th-center">W</th>
          <th class="th-center">L</th>
          <th class="th-center">D</th>
          <th class="th-center">NR</th>
          <th class="th-center">NRR</th>
          <th class="th-center">For</th>
          <th class="th-center">Against</th>
          <th class="th-center">Pts</th>
          <th>Last 5</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/** Grouped bar — Wins vs Losses per team */
function renderWinLossChart() {
  destroyChart('winLoss');
  const labels = POINTS_TABLE.map(r => r.short);
  const ctx = document.getElementById('winLossChart').getContext('2d');
  charts.winLoss = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Wins',
          data: POINTS_TABLE.map(r => r.W),
          backgroundColor: 'rgba(0,162,91,0.75)',
          borderColor: '#00a25b',
          borderWidth: 1, borderRadius: 4
        },
        {
          label: 'Losses',
          data: POINTS_TABLE.map(r => r.L),
          backgroundColor: 'rgba(230,64,64,0.70)',
          borderColor: '#e64040',
          borderWidth: 1, borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: true, labels: { color: '#7a7a7a', font: { size: 11 }, boxWidth: 10 } },
        tooltip: {
          backgroundColor: '#172035', titleColor: '#fff',
          bodyColor: '#b0bec5', borderColor: '#2c3e60', borderWidth: 1, padding: 8
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#383838', font: { size: 12, weight: '500' } }
        },
        y: {
          grid: { color: '#f0f3f5' },
          ticks: { color: '#7a7a7a', font: { size: 11 }, stepSize: 1 },
          max: Math.max(...POINTS_TABLE.map(r => r.M)) + 1
        }
      }
    }
  });
}

/** Horizontal bar — NRR comparison */
function renderNRRChart() {
  destroyChart('nrr');
  const ctx = document.getElementById('nrrChart').getContext('2d');
  const labels = POINTS_TABLE.map(r => r.short);
  const data   = POINTS_TABLE.map(r => r.NRR);
  const bgColors = data.map(v => v >= 0
    ? 'rgba(0,162,91,0.75)'
    : 'rgba(230,64,64,0.70)'
  );
  const borderColors = data.map(v => v >= 0 ? '#00a25b' : '#e64040');

  charts.nrr = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'NRR',
        data,
        backgroundColor: bgColors,
        borderColor: borderColors,
        borderWidth: 1, borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#172035', titleColor: '#fff',
          bodyColor: '#b0bec5', borderColor: '#2c3e60', borderWidth: 1, padding: 8,
          callbacks: { label: ctx => `  NRR: ${ctx.raw >= 0 ? '+' : ''}${ctx.raw.toFixed(3)}` }
        }
      },
      scales: {
        x: {
          grid: { color: '#f0f3f5' },
          ticks: { color: '#7a7a7a', font: { size: 11 } }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#383838', font: { size: 13, weight: '500' } }
        }
      }
    }
  });
}

/* ── Team comparison doughnut helper ── */
function doughnutConfig(rcbVal, wwVal, tooltipSuffix) {
  return {
    type: 'doughnut',
    data: {
      labels: ['RCB', 'WW'],
      datasets: [{
        data: [rcbVal, wwVal],
        backgroundColor: ['rgba(229,57,53,0.75)', 'rgba(25,118,210,0.75)'],
        borderColor:      ['#e53935', '#1976d2'],
        borderWidth: 2, hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 450 }, cutout: '60%',
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: '#7a7a7a', padding: 14, font: { size: 11 }, boxWidth: 10 } },
        tooltip: {
          backgroundColor: '#172035', titleColor: '#ffffff',
          bodyColor: '#b0bec5', borderColor: '#2c3e60', borderWidth: 1, padding: 8,
          callbacks: { label: ctx => `  ${ctx.label}: ${ctx.raw}${tooltipSuffix}` }
        }
      }
    }
  };
}

/* Team runs doughnut */
function renderTeamRunsChart() {
  destroyChart('teamRuns');
  const rcb = state.batting.filter(r => r.team_name && r.team_name.includes('RCB')).reduce((s, r) => s + num(r.total_runs), 0);
  const ww  = state.batting.filter(r => r.team_name && r.team_name.includes('WW')).reduce((s, r) => s + num(r.total_runs), 0);
  charts.teamRuns = new Chart(document.getElementById('teamRunsChart').getContext('2d'), doughnutConfig(rcb, ww, ' runs'));
}

/* Team wickets doughnut */
function renderTeamWicketsChart() {
  destroyChart('teamWickets');
  const rcb = state.bowling.filter(r => r.team_name && r.team_name.includes('RCB')).reduce((s, r) => s + num(r.total_wickets), 0);
  const ww  = state.bowling.filter(r => r.team_name && r.team_name.includes('WW')).reduce((s, r) => s + num(r.total_wickets), 0);
  charts.teamWickets = new Chart(document.getElementById('teamWicketsChart').getContext('2d'), doughnutConfig(rcb, ww, ' wickets'));
}

/* ── New batting charts ── */

/* Sixes Leaderboard */
function renderSixes(batting) {
  destroyChart('sixes');
  const rows = [...batting].filter(r => num(r['6s']) > 0)
    .sort((a, b) => num(b['6s']) - num(a['6s'])).slice(0, 12);
  if (!rows.length) { showEmptyChart('sixesChart', 'No sixes data'); return; }
  hideEmptyChart('sixesChart');
  charts.sixes = new Chart(document.getElementById('sixesChart').getContext('2d'),
    hBarConfig(rows.map(r => r.name), rows.map(r => num(r['6s'])),
      rows.map(r => barBg(r.name)), rows.map(r => barBorder(r.name))));
}

/* Balls Faced */
function renderBallsFaced(batting) {
  destroyChart('ballsFaced');
  const rows = [...batting].filter(r => num(r.ball_faced) > 0)
    .sort((a, b) => num(b.ball_faced) - num(a.ball_faced)).slice(0, 12);
  if (!rows.length) { showEmptyChart('ballsFacedChart', 'No balls faced data'); return; }
  hideEmptyChart('ballsFacedChart');
  charts.ballsFaced = new Chart(document.getElementById('ballsFacedChart').getContext('2d'),
    hBarConfig(rows.map(r => r.name), rows.map(r => num(r.ball_faced)),
      rows.map(r => barBg(r.name)), rows.map(r => barBorder(r.name))));
}

/* ── New bowling charts ── */

/* Dot Balls Bowled */
function renderDotBalls(bowling) {
  destroyChart('dotBalls');
  const rows = [...bowling].filter(r => num(r.dot_balls) > 0)
    .sort((a, b) => num(b.dot_balls) - num(a.dot_balls)).slice(0, 12);
  if (!rows.length) { showEmptyChart('dotBallsChart', 'No dot ball data'); return; }
  hideEmptyChart('dotBallsChart');
  charts.dotBalls = new Chart(document.getElementById('dotBallsChart').getContext('2d'),
    hBarConfig(rows.map(r => r.name), rows.map(r => num(r.dot_balls)),
      rows.map(r => barBg(r.name)), rows.map(r => barBorder(r.name))));
}

/* Maiden Overs */
function renderMaidens(bowling) {
  destroyChart('maidens');
  const rows = [...bowling].filter(r => num(r.maidens) > 0)
    .sort((a, b) => num(b.maidens) - num(a.maidens)).slice(0, 12);
  if (!rows.length) { showEmptyChart('maidensChart', 'No maiden overs data'); return; }
  hideEmptyChart('maidensChart');
  charts.maidens = new Chart(document.getElementById('maidensChart').getContext('2d'),
    hBarConfig(rows.map(r => r.name), rows.map(r => num(r.maidens)),
      rows.map(r => barBg(r.name)), rows.map(r => barBorder(r.name))));
}

/* Bowling Strike Rate (ascending = lower is better) */
function renderBowlingSR(bowling) {
  destroyChart('bowlingSR');
  const rows = [...bowling].filter(r => num(r.SR) > 0 && num(r.total_wickets) >= 2)
    .sort((a, b) => num(a.SR) - num(b.SR)).slice(0, 12);
  if (!rows.length) { showEmptyChart('bowlingSRChart', 'No bowling SR data (min 2 wkts)'); return; }
  hideEmptyChart('bowlingSRChart');
  const n = rows.length;
  const bgColors = rows.map((_, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    const r = Math.round(34 + t * 205), g = Math.round(197 - t * 148), b = Math.round(94 - t * 72);
    return `rgba(${r},${g},${b},0.75)`;
  });
  charts.bowlingSR = new Chart(document.getElementById('bowlingSRChart').getContext('2d'),
    hBarConfig(rows.map(r => r.name), rows.map(r => num(r.SR)), bgColors, bgColors.map(c => c.replace('0.75','1'))));
}

/* Overs Bowled */
function renderOversBowled(bowling) {
  destroyChart('oversBowled');
  const rows = [...bowling].filter(r => num(r.overs) > 0)
    .sort((a, b) => num(b.overs) - num(a.overs)).slice(0, 12);
  if (!rows.length) { showEmptyChart('oversBowledChart', 'No overs data'); return; }
  hideEmptyChart('oversBowledChart');
  charts.oversBowled = new Chart(document.getElementById('oversBowledChart').getContext('2d'),
    hBarConfig(rows.map(r => r.name), rows.map(r => num(r.overs)),
      rows.map(r => barBg(r.name)), rows.map(r => barBorder(r.name))));
}

/* ── New fielding charts ── */

/* Dismissal Breakdown stacked bar */
function renderDismissalBreakdown(fielding) {
  destroyChart('dismissalBreakdown');
  const rows = [...fielding].filter(r => num(r.total_dismissal) > 0)
    .sort((a, b) => num(b.total_dismissal) - num(a.total_dismissal)).slice(0, 12);
  if (!rows.length) { showEmptyChart('dismissalBreakdownChart', 'No fielding data'); return; }
  hideEmptyChart('dismissalBreakdownChart');
  const labels = rows.map(r => r.name);
  const ctx = document.getElementById('dismissalBreakdownChart').getContext('2d');
  charts.dismissalBreakdown = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Catches',   data: rows.map(r => num(r.catches)),  backgroundColor: 'rgba(56,126,209,0.75)' },
        { label: 'Run Outs',  data: rows.map(r => num(r.run_outs)), backgroundColor: 'rgba(255,167,38,0.75)' },
        { label: 'Stumpings', data: rows.map(r => num(r.stumpings)),backgroundColor: 'rgba(102,187,106,0.75)' },
        { label: 'C&B',       data: rows.map(r => num(r.caught_and_bowl)), backgroundColor: 'rgba(171,71,188,0.75)' },
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
      scales: {
        x: { stacked: true, grid: { color: '#f0f0f0' }, ticks: { font: { size: 11 } } },
        y: { stacked: true, grid: { display: false }, ticks: { font: { size: 11 } } }
      }
    }
  });
}

/* Fielding contribution doughnut */
function renderFieldingShare(fielding) {
  destroyChart('fieldingShare');
  const rows = [...fielding].filter(r => num(r.total_dismissal) > 0)
    .sort((a, b) => num(b.total_dismissal) - num(a.total_dismissal)).slice(0, 8);
  if (!rows.length) { showEmptyChart('fieldingShareChart', 'No fielding data'); return; }
  hideEmptyChart('fieldingShareChart');
  const palette = ['#387ed1','#e53935','#43a047','#fb8c00','#8e24aa','#00acc1','#f4511e','#6d4c41'];
  const ctx = document.getElementById('fieldingShareChart').getContext('2d');
  charts.fieldingShare = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: rows.map(r => r.name),
      datasets: [{ data: rows.map(r => num(r.total_dismissal)), backgroundColor: palette, borderWidth: 2 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } }
    }
  });
}

/* Team MVP doughnut */
function renderTeamMvpChart() {
  destroyChart('teamMvp');
  const rcb = parseFloat(state.mvp.filter(r => r['Team Name'] && r['Team Name'].includes('RCB')).reduce((s, r) => s + num(r.Total), 0).toFixed(2));
  const ww  = parseFloat(state.mvp.filter(r => r['Team Name'] && r['Team Name'].includes('WW')).reduce((s, r) => s + num(r.Total), 0).toFixed(2));
  charts.teamMvp = new Chart(document.getElementById('teamMvpChart').getContext('2d'), doughnutConfig(rcb, ww, ' pts'));
}


/* ============================================================
   Main render — called on every filter change
   ============================================================ */

function renderTopHeroes(batting, bowling, fielding, mvp) {
  const grid = document.getElementById('topHeroesGrid');
  if (!grid) return;

  /* Helper: get top value and ALL players tied at that value */
  function topTied(arr, valFn, filterFn) {
    const filtered = arr.filter(filterFn || (() => true));
    if (!filtered.length) return { val: null, players: [] };
    const sorted = [...filtered].sort((a,b) => valFn(b) - valFn(a));
    const best = valFn(sorted[0]);
    return { val: best, players: sorted.filter(r => valFn(r) === best) };
  }
  /* Helper: for ascending (lower = better) */
  function topTiedAsc(arr, valFn, filterFn) {
    const filtered = arr.filter(filterFn || (() => true));
    if (!filtered.length) return { val: null, players: [] };
    const sorted = [...filtered].sort((a,b) => valFn(a) - valFn(b));
    const best = valFn(sorted[0]);
    return { val: best, players: sorted.filter(r => valFn(r) === best) };
  }

  const tBat      = topTied(batting,  r => num(r.total_runs),      r => num(r.total_runs) > 0);
  const tBowl     = topTied(bowling,  r => num(r.total_wickets),   r => num(r.total_wickets) > 0);
  const tField    = topTied(fielding, r => num(r.total_dismissal), r => num(r.total_dismissal) > 0);
  const tMvp      = topTied(mvp,      r => num(r.Total),           r => num(r.Total) > 0);
  const tSixes    = topTied(batting,  r => num(r['6s']),           r => num(r['6s']) > 0);
  const tBalls    = topTied(batting,  r => num(r.ball_faced),      r => num(r.ball_faced) > 0);
  const tDots     = topTied(bowling,  r => num(r.dot_balls),       r => num(r.dot_balls) > 0);
  const tMaiden   = topTied(bowling,  r => num(r.maidens),         r => num(r.maidens) > 0);
  const tBowlSR   = topTiedAsc(bowling, r => num(r.SR),           r => num(r.SR) > 0 && num(r.total_wickets) >= 2);
  const tOvers    = topTied(bowling,  r => num(r.overs),           r => num(r.overs) > 0);
  const tCatches  = topTied(fielding, r => num(r.catches),         r => num(r.catches) > 0);
  const tRunOut   = topTied(fielding, r => num(r.run_outs),        r => num(r.run_outs) > 0);

  function heroCard(icon, label, tied, nameKey, teamKey, statLabel) {
    if (!tied.players.length) return `<div class="hero-card hero-empty"><div class="hero-icon">${icon}</div><div class="hero-label">${label}</div><div class="hero-empty-msg">No data</div></div>`;
    const names = tied.players.map(r => (nameKey ? r[nameKey] : r.name) || '').filter(Boolean);
    const team  = tied.players[0][teamKey] || '';
    const isRCB = team.includes('RCB');
    const color = tied.players.length > 1 ? '#7b5ea7' : (isRCB ? 'var(--rcb)' : 'var(--ww)');
    const initials = names.map(n => n.split(' ').map(w => w[0]||'').join('').slice(0,2).toUpperCase()).join('/').slice(0,5);
    const displayTeam = tied.players.length > 1 ? tied.players.map(r => (r[teamKey]||'').includes('WW')?'WW':'RCB').join(' & ') : (team.includes('WW')?'WW':'RCB');
    const statVal = tied.val !== null ? (Number.isInteger(tied.val) ? tied.val : parseFloat(tied.val).toFixed(tied.val < 10 ? 2 : 1)) : '—';
    return `
      <div class="hero-card" style="--hero-color:${color}">
        <div class="hero-icon">${icon}</div>
        <div class="hero-label">${label}</div>
        <div class="hero-avatar" style="background:${color}">${initials}</div>
        <div class="hero-name">${names.map(esc).join(' &amp; ')}</div>
        <div class="hero-team">${esc(displayTeam)}</div>
        <div class="hero-stat">${statVal} <span class="hero-stat-label">${statLabel}</span></div>
      </div>`;
  }

  grid.innerHTML =
    /* Row 1 — Main heroes */
    heroCard('🏏', 'Top Batter',       tBat,     null,          'team_name',   'runs') +
    heroCard('🎯', 'Top Bowler',       tBowl,    null,          'team_name',   'wickets') +
    heroCard('🧤', 'Top Fielder',      tField,   null,          'team_name',   'dismissals') +
    heroCard('🏆', 'Season MVP',       tMvp,     'Player Name', 'Team Name',   'pts') +
    /* Row 2 — Batting specials */
    heroCard('💥', 'Six Machine',      tSixes,   null,          'team_name',   'sixes') +
    heroCard('⏱️', 'Most Balls Faced', tBalls,   null,          'team_name',   'balls') +
    /* Row 3 — Bowling specials */
    heroCard('🔒', 'Dot Ball King',    tDots,    null,          'team_name',   'dots') +
    heroCard('🎖️', 'Maiden Master',   tMaiden,  null,          'team_name',   'maidens') +
    heroCard('⚡', 'Best Bowl SR',     tBowlSR,  null,          'team_name',   'SR') +
    heroCard('🏃', 'Workhorse',        tOvers,   null,          'team_name',   'overs') +
    /* Row 4 — Fielding specials */
    heroCard('🙌', 'Catch King',       tCatches, null,          'team_name',   'catches') +
    heroCard('🚀', 'Run Out Hero',     tRunOut,  null,          'team_name',   'run outs');
}

function renderDashboard() {
  const batting  = filterBatting();
  const bowling  = filterBowling();
  const fielding = filterFielding();
  const mvp      = filterMvp();

  renderKPIs(batting, bowling, fielding, mvp);
  renderTopHeroes(batting, bowling, fielding, mvp);
  renderPlayerDetail(state.player);
  renderTopBatters(batting);
  renderStrikeRate(batting);
  renderBattingAvg(batting);
  renderBoundaries(batting);
  renderSixes(batting);
  renderBallsFaced(batting);

  renderWickets(bowling);
  renderEconomy(bowling);
  renderDotBalls(bowling);
  renderMaidens(bowling);
  renderBowlingSR(bowling);
  renderOversBowled(bowling);

  renderFielding(fielding);
  renderMvp(mvp);
  renderDismissalBreakdown(fielding);
  renderFieldingShare(fielding);

  /* Team comparison always uses the full unfiltered dataset */
  renderTeamRunsChart();
  renderTeamWicketsChart();
  renderTeamMvpChart();

  renderFullStatsTable(batting, bowling, fielding, mvp);
}

/* ── Consolidated Full Player Stats Table ── */
function renderFullStatsTable(batting, bowling, fielding, mvp) {
  const wrap = document.getElementById('fullStatsTableWrap');
  if (!wrap) return;

  /* Build a map of all unique player names */
  const playerMap = {};

  batting.forEach(r => {
    const key = r.name?.trim(); if (!key) return;
    if (!playerMap[key]) playerMap[key] = { name: key, team: r.team_name || '' };
    playerMap[key].bat = r;
  });
  bowling.forEach(r => {
    const key = r.name?.trim(); if (!key) return;
    if (!playerMap[key]) playerMap[key] = { name: key, team: r.team_name || '' };
    playerMap[key].bowl = r;
  });
  fielding.forEach(r => {
    const key = r.name?.trim(); if (!key) return;
    if (!playerMap[key]) playerMap[key] = { name: key, team: r.team_name || '' };
    playerMap[key].field = r;
  });
  mvp.forEach(r => {
    const key = r['Player Name']?.trim().toLowerCase(); if (!key) return;
    const match = Object.keys(playerMap).find(k => k.toLowerCase() === key);
    if (match) playerMap[match].mvp = r;
  });

  const players = Object.values(playerMap).sort((a, b) => {
    const aRuns = num(a.bat?.total_runs) || 0;
    const bRuns = num(b.bat?.total_runs) || 0;
    return bRuns - aRuns;
  });

  if (!players.length) { wrap.innerHTML = '<p class="table-empty">No data for this selection.</p>'; return; }

  const teamDot = t => `<span class="pt-team-dot" style="background:${t.includes('WW') ? 'var(--ww)' : 'var(--rcb)'}"></span>`;
  const d = v => (v !== undefined && v !== null && v !== '' && v !== '-') ? v : '—';
  const n = (v, dec) => { const x = num(v); return x ? (dec !== undefined ? x.toFixed(dec) : x) : '—'; };

  const rows = players.map(p => {
    const b = p.bat || {}, bw = p.bowl || {}, f = p.field || {}, m = p.mvp || {};
    const teamShort = p.team.includes('WW') ? 'WW' : p.team.includes('RCB') ? 'RCB' : p.team;
    return `<tr>
      <td class="fst-name">${teamDot(p.team)}${esc(p.name)}</td>
      <td class="fst-team">${esc(teamShort)}</td>
      <td class="fst-num">${n(b.total_match || bw.total_match || f.total_match)}</td>
      <td class="fst-num">${n(b.total_runs)}</td>
      <td class="fst-num">${d(b.highest_run)}</td>
      <td class="fst-num">${n(b.average, 2)}</td>
      <td class="fst-num">${n(b.strike_rate, 1)}</td>
      <td class="fst-num">${n(b.ball_faced)}</td>
      <td class="fst-num">${n(b['4s'])}</td>
      <td class="fst-num">${n(b['6s'])}</td>
      <td class="fst-num">${n(b['50s'])}</td>
      <td class="fst-num fst-divider">${n(bw.total_wickets)}</td>
      <td class="fst-num">${d(bw.overs)}</td>
      <td class="fst-num">${n(bw.economy, 2)}</td>
      <td class="fst-num">${n(bw.SR, 1)}</td>
      <td class="fst-num">${n(bw.maidens)}</td>
      <td class="fst-num">${n(bw.dot_balls)}</td>
      <td class="fst-num fst-divider">${n(f.catches)}</td>
      <td class="fst-num">${n(f.run_outs)}</td>
      <td class="fst-num">${n(f.stumpings)}</td>
      <td class="fst-num">${n(f.caught_and_bowl)}</td>
      <td class="fst-num">${n(f.total_dismissal)}</td>
      <td class="fst-num fst-divider fst-mvp">${m.Total ? num(m.Total).toFixed(2) : '—'}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="fst-table">
      <thead>
        <tr>
          <th rowspan="2" class="fst-name-h">Player</th>
          <th rowspan="2">Team</th>
          <th rowspan="2">M</th>
          <th colspan="8" class="fst-group-bat">Batting</th>
          <th colspan="6" class="fst-group-bowl">Bowling</th>
          <th colspan="5" class="fst-group-field">Fielding</th>
          <th rowspan="2" class="fst-group-mvp">MVP</th>
        </tr>
        <tr>
          <th>Runs</th><th>HS</th><th>Avg</th><th>SR</th><th>Balls</th><th>4s</th><th>6s</th><th>50s</th>
          <th>Wkts</th><th>Ov</th><th>Econ</th><th>BSR</th><th>Mdn</th><th>Dots</th>
          <th>Ct</th><th>RO</th><th>St</th><th>C&B</th><th>Dis</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}


/* ============================================================
   Event listeners
   ============================================================ */

document.getElementById('teamFilter').addEventListener('change', e => {
  state.team   = e.target.value;
  state.player = 'ALL';
  populatePlayerDropdown();   /* re-filter player list by selected team */
  renderDashboard();
});

document.getElementById('playerFilter').addEventListener('change', e => {
  state.player = e.target.value;
  renderDashboard();
});

document.getElementById('resetBtn').addEventListener('click', () => {
  state.team   = 'ALL';
  state.player = 'ALL';
  document.getElementById('teamFilter').value = 'ALL';
  populatePlayerDropdown();   /* restore full player list */
  renderDashboard();
});


/* ============================================================
   Initialisation
   ============================================================ */

/* ============================================================
   Points Table — PDF auto-loader (PDF.js)
   ============================================================ */

const PDF_WORKER_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

/* Candidate PDF filenames to try, in order */
const PDF_CANDIDATES = [
  './points_table.pdf',
  './points table Machaxi Box Cricket Season-2.pdf',
  './points table Machaxi Box Cricket Season-3.pdf',
  './points table Machaxi Box Cricket Season-4.pdf'
];

/** Extract all text from a PDF URL using PDF.js. Returns null if unavailable. */
async function extractPDFText(url) {
  if (!window.pdfjsLib) return null;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;
  const resp = await fetch(url);
  if (!resp.ok) return null;
  const buf = await resp.arrayBuffer();
  const pdf = await window.pdfjsLib.getDocument({ data: buf }).promise;
  const parts = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page    = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items   = content.items
      .filter(i => i.str.trim())
      .sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
    parts.push(items.map(i => i.str.trim()).join(' '));
  }
  return parts.join(' ');
}

/** Parse one team's row from the extracted PDF text.
 *  CricHeroes column order: Team  M  W  L  T  D  NR  Pts  NRR  For  Against  Last5
 */
function parseTeamFromText(text, fragment, fullName, shortName) {
  const esc = fragment.replace(/[()[\]{}.*+?^$|\\]/g, '\\$&');
  const re  = new RegExp(
    esc + '[^\\d]{0,80}' +
    '(\\d+)\\s+' +              // M
    '(\\d+)\\s+' +              // W
    '(\\d+)\\s+' +              // L
    '(\\d+)\\s+' +              // T
    '(\\d+)\\s+' +              // D
    '(\\d+)\\s+' +              // NR
    '(\\d+)\\s+' +              // Pts
    '([+\\-]?\\d+\\.\\d+)\\s+' + // NRR
    '(\\d+\\/[\\d.]+)\\s+' +    // For
    '(\\d+\\/[\\d.]+)',           // Against
    'i'
  );
  const m = text.match(re);
  if (!m) return null;

  /* Extract Last 5 results — isolated W/L letters right after the Against score */
  const afterAgainst = text.slice(text.search(new RegExp(m[10].replace('/', '\\/'), 'i')) + m[10].length, text.search(new RegExp(m[10].replace('/', '\\/'), 'i')) + m[10].length + 60);
  const last5 = (afterAgainst.match(/\b[WL]\b/gi) || []).slice(0, 5).map(r => r.toUpperCase());

  return {
    team: fullName, short: shortName,
    M: +m[1], W: +m[2], L: +m[3], T: +m[4], D: +m[5], NR: +m[6],
    Pts: +m[7], NRR: parseFloat(m[8]), For: m[9], Against: m[10],
    last5
  };
}

/** Try each candidate PDF filename; parse and return POINTS_TABLE array or null. */
async function loadPointsTableFromPDF() {
  let text = null;
  for (const path of PDF_CANDIDATES) {
    try { text = await extractPDFText(path); } catch (_) { text = null; }
    if (text) break;
  }
  if (!text) return null;

  const ww  = parseTeamFromText(text, 'Weekend Warriors',       'Weekend Warriors (WW)',       'WW');
  const rcb = parseTeamFromText(text, 'Royal Cricket Blasters', 'Royal Cricket Blasters (RCB)', 'RCB');
  if (!ww || !rcb) return null;

  return [ww, rcb]
    .sort((a, b) => b.Pts - a.Pts || b.NRR - a.NRR)
    .map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Parse raw points_table.csv rows into typed objects */
function parsePointsTable(rows) {
  return rows.map(r => ({
    rank:    parseInt(r.rank,  10),
    team:    r.team,
    short:   r.short,
    M:       parseInt(r.M,    10),
    W:       parseInt(r.W,    10),
    L:       parseInt(r.L,    10),
    D:       parseInt(r.D,    10),
    T:       parseInt(r.T,    10),
    NR:      parseInt(r.NR,   10),
    NRR:     parseFloat(r.NRR),
    For:     r.For,
    Against: r.Against,
    Pts:     parseInt(r.Pts,  10),
    last5:   (r.last5 || '').split('|').filter(Boolean)
  })).sort((a, b) => a.rank - b.rank);
}

async function init() {
  showSpinner();
  try {
    /* Load player CSVs and attempt PDF points table in parallel */
    const [batting, bowling, fielding, mvp, pdfTable] = await Promise.all([
      loadCSV(CSV_FILES.batting),
      loadCSV(CSV_FILES.bowling),
      loadCSV(CSV_FILES.fielding),
      loadCSV(CSV_FILES.mvp),
      loadPointsTableFromPDF().catch(() => null)
    ]);
    state.batting  = batting;
    state.bowling  = bowling;
    state.fielding = fielding;
    state.mvp      = mvp;

    if (pdfTable && pdfTable.length) {
      /* PDF parsed successfully */
      POINTS_TABLE = pdfTable;
    } else {
      /* Fall back to points_table.csv */
      const ptRows = await loadCSV(CSV_FILES.pointsTable).catch(() => []);
      POINTS_TABLE = parsePointsTable(ptRows);
    }

    /* Static renders — only need to run once */
    renderPointsTable();
    renderWinLossChart();
    renderNRRChart();
    populatePlayerDropdown();
    renderDashboard();
  } catch (err) {
    console.error('Failed to load data:', err);
    document.getElementById('serverWarning').classList.remove('hidden');
  } finally {
    hideSpinner();
  }
}

init();
