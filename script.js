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
  batting:      './batting_leaderboard.csv',
  bowling:      './bowling_leaderboard.csv',
  fielding:     './fielding_leaderboard.csv',
  mvp:          './mvp_leaderboard.csv',
  pointsTable:  './points_table.csv',
  matchBatting: './data/match_batting.csv',
  matchBowling: './data/match_bowling.csv',
  matchMeta:    './data/match_meta.csv',
  matchBalls:   './cricheroes_data/tournament_all_balls.csv'
};

/* ── Color palette (assigned by team index from points table) ── */
const COLOR_PALETTE = [
  { bg: 'rgba(229,57,53,0.70)',  border: '#e53935', light: 'rgba(229,57,53,0.09)',  cssVar: 'team-0' },
  { bg: 'rgba(25,118,210,0.70)', border: '#1976d2', light: 'rgba(25,118,210,0.09)', cssVar: 'team-1' },
  { bg: 'rgba(56,183,74,0.70)',  border: '#388e3c', light: 'rgba(56,183,74,0.09)',  cssVar: 'team-2' },
  { bg: 'rgba(251,140,0,0.70)',  border: '#f57c00', light: 'rgba(251,140,0,0.09)',  cssVar: 'team-3' },
  { bg: 'rgba(103,58,183,0.70)', border: '#7b1fa2', light: 'rgba(103,58,183,0.09)', cssVar: 'team-4' },
];

/* Built at runtime from points_table.csv — keys are lowercase team full names */
let TEAMS = {};

function buildTeamRegistry(ptRows) {
  TEAMS = {};
  ptRows.forEach((row, idx) => {
    const full  = (row.team  || '').trim();
    const short = (row.short || full.substring(0, 3).toUpperCase()).trim();
    if (!full) return;
    const colors = COLOR_PALETTE[idx % COLOR_PALETTE.length];
    const entry = { full, short, idx, colors,
      chipClass: `team-chip-${idx}`, heatClass: `hm-team-${idx}`, roClass: `ro-team-${idx}` };
    TEAMS[full.toLowerCase()] = entry;
    // Also index by short code for quick lookup
    TEAMS[short.toLowerCase()] = entry;
  });
  injectTeamCSSVars();
}

function injectTeamCSSVars() {
  const root = document.documentElement;
  Object.values(TEAMS).forEach(t => {
    root.style.setProperty(`--${t.colors.cssVar}`,     t.colors.border);
    root.style.setProperty(`--${t.colors.cssVar}-lt`,  t.colors.light);
  });
}

function getTeam(name) {
  if (!name) return null;
  const lc = name.toLowerCase();
  // Exact key match
  if (TEAMS[lc]) return TEAMS[lc];
  // Partial match
  for (const [key, entry] of Object.entries(TEAMS)) {
    if (lc.includes(key) || key.includes(lc)) return entry;
  }
  return null;
}
function teamShort(name)      { const t = getTeam(name); return t ? t.short  : (name || '?'); }
function teamBg(name)         { const t = getTeam(name); return t ? t.colors.bg     : 'rgba(56,126,209,0.70)'; }
function teamBorder(name)     { const t = getTeam(name); return t ? t.colors.border : '#387ed1'; }
function teamLight(name)      { const t = getTeam(name); return t ? t.colors.light  : 'rgba(56,126,209,0.09)'; }
function teamChipClass(name)  { const t = getTeam(name); return t ? t.chipClass : 'team-chip-0'; }
function teamHeatClass(name)  { const t = getTeam(name); return t ? t.heatClass : 'hm-team-0'; }
function teamRoClass(name)    { const t = getTeam(name); return t ? t.roClass   : 'ro-team-0'; }
function teamCssVar(name)     { const t = getTeam(name); return t ? `var(--${t.colors.cssVar})` : 'var(--team-0)'; }
function teamList()           { return [...new Set(Object.values(TEAMS).filter(t => typeof t.idx === 'number').sort((a,b) => a.idx - b.idx))]; }

function populateDynamicHTML() {
  const tList = teamList();

  // Header badges
  const badgesEl = document.getElementById('team-badges-container');
  if (badgesEl) {
    badgesEl.innerHTML = tList.map((t, i) =>
      (i > 0 ? '<span class="vs-text" aria-hidden="true">vs</span>' : '') +
      `<span class="team-badge team-${t.idx}">${t.short}</span>`
    ).join('');
  }

  // Header subtitle
  const subtitleEl = document.getElementById('header-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `Analytics Dashboard · ${tList.map(t => t.short).join(' vs ')}`;
  }

  // Team filter dropdown
  const sel = document.getElementById('teamFilter');
  if (sel) {
    // Remove all options except 'All Teams'
    while (sel.options.length > 1) sel.remove(1);
    tList.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.full;
      opt.textContent = t.full;
      sel.appendChild(opt);
    });
  }

  // Team comparison heading
  const headingEl = document.getElementById('team-heading');
  if (headingEl) {
    headingEl.textContent = `${tList.map(t => t.short).join(' vs ')} — Team Comparison`;
  }

  // Win margin legend
  const legendEl = document.getElementById('win-margin-legend');
  if (legendEl) {
    const dots = {'0':'🔴','1':'🔵','2':'🟢','3':'🟠'};
    legendEl.textContent = '(' + tList.map((t,i) => `${dots[i]||'⚫'} ${t.short}`).join(' · ') + ')';
  }
}

/* ── Chart.js defaults — Kite light theme ── */
Chart.defaults.color        = '#7a7a7a';
Chart.defaults.borderColor  = '#e7e7e7';
Chart.defaults.font.family  = "Roboto, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size    = 11;

/* ── Application state ── */
const state = {
  batting:       [],
  bowling:       [],
  fielding:      [],
  mvp:           [],
  team:          'ALL',
  player:        'ALL',
  matchBatting:  [],
  matchBowling:  [],
  matchMeta:     [],
  matchBalls:    [],
  selectedMatchId: ''
};

/* Chart instances — destroyed before recreation */
const charts = {};

/* Currently selected form player */
let formSelectedPlayer = '';


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
/* Page-level loading state — shows skeleton shimmer in KPI cards and charts */
const showSpinner = () => {
  document.body.classList.add('loading');
  document.getElementById('topLoadBar').classList.remove('hidden');
};
const hideSpinner = () => {
  document.body.classList.remove('loading');
  document.getElementById('topLoadBar').classList.add('hidden');
};

/* ── Scorecard extraction toast ── */
function showExtractionToast(msg) {
  const toast = document.getElementById('extractionToast');
  document.getElementById('toastTitleText').textContent = 'Loading scorecards';
  document.getElementById('toastSpinner').style.display = '';
  document.getElementById('toastSub').textContent = msg || 'Discovering PDF files…';
  document.getElementById('toastBarFill').style.width = '0%';
  toast.classList.remove('hidden');
  document.getElementById('toastDismiss').onclick = () => toast.classList.add('hidden');
}
function updateExtractionToast(done, total, matchId) {
  const pct = Math.round((done / total) * 100);
  document.getElementById('toastBarFill').style.width = pct + '%';
  document.getElementById('toastSub').textContent = `Match ${matchId} (${done}/${total})`;
}
function hideExtractionToast() {
  document.getElementById('toastSpinner').style.display = 'none';
  document.getElementById('toastTitleText').textContent = 'Scorecards ready ✓';
  document.getElementById('toastBarFill').style.width = '100%';
  document.getElementById('toastSub').textContent = `All matches loaded`;
  setTimeout(() => document.getElementById('extractionToast').classList.add('hidden'), 2500);
}


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
  return r?.team_name ? teamBg(r.team_name) : 'rgba(56,126,209,0.70)';
}

function barBorder(name) {
  const r = playerRow(name);
  return r?.team_name ? teamBorder(r.team_name) : '#387ed1';
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
    if (subEl) {
      const text = sub ?? '';
      subEl.textContent = text;
      subEl.style.display = text ? '' : 'none'; /* hide pill when empty — no blank badge */
    }
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

function computeMatchAwards() {
  /* Returns { mom, bestBat, bestBowl } — each is { matchId: playerName } */
  const metaByMatch = {};
  (state.matchMeta||[]).forEach(m => metaByMatch[m.match_id] = m);

  const mom = {}, bestBat = {}, bestBowl = {};
  const allMids = [...new Set([
    ...(state.matchBatting||[]).map(r => r.match_id),
    ...(state.matchBowling||[]).map(r => r.match_id)
  ])];

  allMids.forEach(mid => {
    const meta      = metaByMatch[mid] || {};
    const winnerStr = meta.winner || '';
    const batInM    = (state.matchBatting||[]).filter(r => r.match_id === mid);
    const bowlInM   = (state.matchBowling||[]).filter(r => r.match_id === mid);

    /* Best Batsman — most runs */
    const topBatter = batInM.reduce((best, r) =>
      (parseInt(r.runs)||0) > (parseInt(best?.runs)||0) ? r : best, null);
    if (topBatter && (parseInt(topBatter.runs)||0) > 0)
      bestBat[mid] = (topBatter.player||'').trim();

    /* Best Bowler — most wickets, tie-break by economy */
    const topBowler = [...bowlInM].sort((a, b) => {
      const wd = (parseInt(b.wickets)||0) - (parseInt(a.wickets)||0);
      return wd !== 0 ? wd : (parseFloat(a.economy)||99) - (parseFloat(b.economy)||99);
    })[0];
    if (topBowler && (parseInt(topBowler.wickets)||0) > 0)
      bestBowl[mid] = (topBowler.player||'').trim();

    /* Man of the Match — best scorer from winning team */
    if (winnerStr) {
      /* build player → team map from batting records */
      const playerTeam = {};
      batInM.forEach(r => {
        const p = (r.player||'').trim();
        if (p) playerTeam[p] = r.batting_team || '';
      });

      const scores = {};
      batInM.forEach(r => {
        const p = (r.player||'').trim();
        if (p && winnerStr.includes(playerTeam[p]||'__')) {
          scores[p] = (scores[p]||0) + (parseInt(r.runs)||0);
        }
      });
      bowlInM.forEach(r => {
        const p = (r.player||'').trim();
        if (p && winnerStr.includes(playerTeam[p]||'__')) {
          scores[p] = (scores[p]||0) + (parseInt(r.wickets)||0) * 15;
        }
      });

      const topMOM = Object.entries(scores).sort((a,b) => b[1]-a[1])[0];
      if (topMOM && topMOM[1] > 0) mom[mid] = topMOM[0];
    }
  });

  return { mom, bestBat, bestBowl };
}

function buildPlayerHighlights(playerName) {
  const _pLower  = (playerName||'').toLowerCase();
  const batRows  = (state.matchBatting  || []).filter(r => (r.player||'').trim().toLowerCase() === _pLower);
  const bowlRows = (state.matchBowling  || []).filter(r => (r.player||'').trim().toLowerCase() === _pLower);
  if (!batRows.length && !bowlRows.length) return '';

  /* ── MATCH AWARDS ── */
  const awards    = computeMatchAwards();
  const momCount  = Object.values(awards.mom).filter(p => p.toLowerCase() === _pLower).length;
  const bbatCount = Object.values(awards.bestBat).filter(p => p.toLowerCase() === _pLower).length;
  const bbowlCount= Object.values(awards.bestBowl).filter(p => p.toLowerCase() === _pLower).length;

  const awardTiles = [
    momCount  > 0 ? `<div class="hl-tile hl-tile-gold"><div class="hl-tile-val">${momCount}</div><div class="hl-tile-lbl">🏆 Man of Match</div></div>` : '',
    bbatCount > 0 ? `<div class="hl-tile hl-tile-blue"><div class="hl-tile-val">${bbatCount}</div><div class="hl-tile-lbl">🏏 Best Batsman</div></div>` : '',
    bbowlCount> 0 ? `<div class="hl-tile hl-tile-purple"><div class="hl-tile-val">${bbowlCount}</div><div class="hl-tile-lbl">🎳 Best Bowler</div></div>` : '',
  ].filter(Boolean).join('');


  const parts = [];

  /* ── MATCH AWARDS SECTION ── */
  if (awardTiles) {
    parts.push(`<div class="hl-section hl-section-awards">
      <div class="hl-section-title">🏆 Match Awards</div>
      <div class="hl-tiles">${awardTiles}</div>
    </div>`);
  }

  /* ── BATTING HIGHLIGHTS ── */
  if (batRows.length) {
    const dismCounts  = {};
    const dismissedBy = {};
    const caughtBy    = {};

    batRows.forEach(r => {
      const dt = (r.dismissal_type || 'unknown').toLowerCase();
      dismCounts[dt] = (dismCounts[dt] || 0) + 1;
      const db = (r.dismissed_by || '').trim();
      if (db && dt !== 'not_out' && dt !== 'run_out') dismissedBy[db] = (dismissedBy[db] || 0) + 1;
      const cb = (r.caught_by || '').trim();
      if (cb && (dt === 'caught' || dt === 'stumped')) caughtBy[cb] = (caughtBy[cb] || 0) + 1;
    });

    /* Dismissal tiles */
    const DMAP = [
      ['caught',  '🫴 Caught'],  ['bowled', '🎳 Bowled'],
      ['run_out', '🏃 Run Out'], ['lbw',    '🦵 LBW'],
      ['stumped', '🧤 Stumped'], ['not_out','✅ Not Out']
    ];
    const tiles = DMAP.filter(([k]) => dismCounts[k])
      .map(([k, lbl]) =>
        `<div class="hl-tile"><div class="hl-tile-val">${dismCounts[k]}</div><div class="hl-tile-lbl">${lbl}</div></div>`)
      .join('');

    /* Nemesis bowler */
    const topBowler = Object.entries(dismissedBy).sort((a,b)=>b[1]-a[1])[0];

    /* Best innings */
    const bestInn = batRows.reduce((best, r) => {
      const x = parseInt(r.runs)||0;
      return x > (best?.runs||0) ? { runs:x, notOut: r.dismissal_type==='not_out', mid: r.match_id } : best;
    }, null);

    /* Season totals from match data */
    const totalFours  = batRows.reduce((s,r)=>s+(parseInt(r.fours)||0),0);
    const totalSixes  = batRows.reduce((s,r)=>s+(parseInt(r.sixes)||0),0);
    const ducks       = batRows.filter(r=>parseInt(r.runs)===0 && r.dismissal_type!=='not_out').length;

    /* Top catcher */
    const topCatcher = Object.entries(caughtBy).sort((a,b)=>b[1]-a[1])[0];

    let html = `<div class="hl-section"><div class="hl-section-title">🏏 Batting Highlights</div>`;
    if (tiles) html += `<div class="hl-tiles">${tiles}</div>`;
    if (topBowler) html += `<div class="hl-fact">😤 <b>Nemesis bowler:</b> <span class="hl-name">${esc(topBowler[0])}</span> dismissed him <b>${topBowler[1]}×</b></div>`;
    if (topCatcher && topCatcher[1] >= 2) html += `<div class="hl-fact">🧤 <b>Caught most by:</b> <span class="hl-name">${esc(topCatcher[0])}</span> (${topCatcher[1]} times)</div>`;
    if (bestInn && bestInn.runs > 0) html += `<div class="hl-fact">⭐ <b>Best innings:</b> <span class="hl-name">${bestInn.runs}${bestInn.notOut?'*':''}</span> runs</div>`;
    if (totalFours || totalSixes) html += `<div class="hl-fact">💥 <b>Season boundaries:</b> <b>${totalFours}</b> fours &nbsp;·&nbsp; <b>${totalSixes}</b> sixes</div>`;
    if (ducks >= 1) html += `<div class="hl-fact">🦆 <b>Ducks this season:</b> <b>${ducks}</b></div>`;
    html += `</div>`;
    parts.push(html);
  }

  /* ── BOWLING HIGHLIGHTS ── */
  if (bowlRows.length) {
    /* Who did this bowler dismiss? — scan matchBatting dismissed_by */
    const victims = {};
    (state.matchBatting||[]).forEach(r => {
      const db = (r.dismissed_by||'').trim().toLowerCase();
      if (db === _pLower) {
        const v = (r.player||'').trim();
        if (v) victims[v] = (victims[v]||0)+1;
      }
    });
    const topVictim = Object.entries(victims).sort((a,b)=>b[1]-a[1])[0];

    /* Best spell (most wickets in a single match) */
    const bestSpell = bowlRows.reduce((best,r) => {
      const w = parseInt(r.wickets)||0;
      return w > (best?.w||0) ? { w, r: parseInt(r.runs)||0, mid: r.match_id } : best;
    }, null);

    /* Maiden count */
    const totalMaidens = bowlRows.reduce((s,r)=>s+(parseInt(r.maidens)||0),0);

    let html = `<div class="hl-section"><div class="hl-section-title">🎳 Bowling Highlights</div>`;
    if (topVictim) html += `<div class="hl-fact">🎯 <b>Favourite victim:</b> <span class="hl-name">${esc(topVictim[0])}</span> (dismissed <b>${topVictim[1]}×</b>)</div>`;
    if (bestSpell && bestSpell.w > 0) html += `<div class="hl-fact">⚡ <b>Best spell:</b> <span class="hl-name">${bestSpell.w}/${bestSpell.r}</span></div>`;
    if (totalMaidens > 0) html += `<div class="hl-fact">🔒 <b>Maiden overs:</b> <b>${totalMaidens}</b></div>`;
    html += `</div>`;
    parts.push(html);
  }

  return parts.length ? `<div class="player-highlights">${parts.join('')}</div>` : '';
}

/** Normalize a player name for fuzzy matching: lowercase, strip punctuation, collapse spaces */
function normName(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Find an MVP row by player name using fallback strategies:
 * 1. Exact match after normalization  ("Arun 102raaga" = "Arun 102.raaga")
 * 2. One is a prefix of the other     ("Manjunath" vs "Manjunath H", "Leela Anna" vs "Leel")
 * 3. First word matches               ("Girish Cricket" vs "GIRISH G")
 */
function findMvpByName(mvpList, name) {
  const n = normName(name);
  // 1. Normalized exact
  let r = mvpList.find(r => normName(r['Player Name']) === n);
  if (r) return r;
  // 2. Prefix — only when the shorter side is >3 chars to avoid false first-name matches
  r = mvpList.find(r => {
    const m = normName(r['Player Name']);
    const shorter = m.length < n.length ? m : n;
    const longer  = m.length < n.length ? n : m;
    return shorter.length > 3 && longer.startsWith(shorter);
  });
  if (r) return r;
  // 3. First word only (last resort)
  const firstName = n.split(' ')[0];
  return mvpList.find(r => normName(r['Player Name']).split(' ')[0] === firstName) || null;
}

function renderPlayerDetail(playerName) {
  const section = document.getElementById('playerDetailSection');
  const card    = document.getElementById('playerDetailCard');

  if (playerName === 'ALL') { section.classList.add('hidden'); return; }
  section.classList.remove('hidden');

  const bat   = state.batting.find(r  => r.name          && r.name.trim()          === playerName) || {};
  const bowl  = state.bowling.find(r  => r.name          && r.name.trim()          === playerName) || {};
  const field = state.fielding.find(r => r.name          && r.name.trim()          === playerName) || {};
  const mvpR  = findMvpByName(state.mvp, playerName) || {};

  const initials  = playerName.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
  const teamName  = bat.team_name || bowl.team_name || '';
  const _t = getTeam(teamName);
  const badgeStyle = _t
    ? `background:${_t.colors.light};color:${_t.colors.border};border:1px solid ${_t.colors.bg};`
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

  const highlights = buildPlayerHighlights(playerName);
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
    ${highlights}
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

  const teamColor = t => teamCssVar(t);

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
        <td class="td-center pt-wins-col">${r.W}</td>
        <td class="td-center pt-loss-col">${r.L}</td>
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
function doughnutConfig(vals, tooltipSuffix) {
  const tList = teamList();
  return {
    type: 'doughnut',
    data: {
      labels: tList.map(t => t.short),
      datasets: [{
        data: vals,
        backgroundColor: tList.map(t => t.colors.bg.replace('0.70', '0.75')),
        borderColor:      tList.map(t => t.colors.border),
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
  const teams = teamList();
  const runsPerTeam = teams.map(t => state.batting.filter(r => getTeam(r.team_name) === t).reduce((s, r) => s + num(r.total_runs), 0));
  charts.teamRuns = new Chart(document.getElementById('teamRunsChart').getContext('2d'), doughnutConfig(runsPerTeam, ' runs'));
}

/* Team wickets doughnut */
function renderTeamWicketsChart() {
  destroyChart('teamWickets');
  const teams = teamList();
  const wktsPerTeam = teams.map(t => state.bowling.filter(r => getTeam(r.team_name) === t).reduce((s, r) => s + num(r.total_wickets), 0));
  charts.teamWickets = new Chart(document.getElementById('teamWicketsChart').getContext('2d'), doughnutConfig(wktsPerTeam, ' wickets'));
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
  const teams = teamList();
  const mvpPerTeam = teams.map(t => parseFloat(state.mvp.filter(r => getTeam(r['Team Name']) === t).reduce((s, r) => s + num(r.Total), 0).toFixed(2)));
  charts.teamMvp = new Chart(document.getElementById('teamMvpChart').getContext('2d'), doughnutConfig(mvpPerTeam, ' pts'));
}


/* ============================================================
   NEW RENDER FUNCTIONS — Match Scorecard CSV powered
   ============================================================ */

/* ─────────────────────────────────────────
   Tooltip defaults for new charts
───────────────────────────────────────── */
const TOOLTIP_DEFAULTS = {
  backgroundColor: '#172035',
  titleColor: '#ffffff',
  bodyColor: '#b0bec5',
  borderColor: '#2c3e60',
  borderWidth: 1,
  padding: 8
};

/* ─────────────────────────────────────────
   Helper: get team color for a player name
   using matchBatting/matchBowling data
───────────────────────────────────────── */
function matchPlayerTeam(playerName, matchBatting, matchBowling) {
  const batRow  = matchBatting.find(r => r.player && r.player.trim() === playerName);
  const bowlRow = matchBowling.find(r => r.player && r.player.trim() === playerName);
  const team = (batRow && batRow.batting_team) || (bowlRow && bowlRow.bowling_team) || '';
  const t = getTeam(team);
  if (t) return { bg: t.colors.bg, border: t.colors.border, chipClass: t.chipClass };
  return { bg: 'rgba(56,126,209,0.70)', border: '#387ed1', chipClass: 'team-chip-0' };
}

/* ─────────────────────────────────────────
   Helper: parse "DD Mon YYYY" → Date object
   for chronological sorting
───────────────────────────────────────── */
function parseMatchDate(dateStr) {
  if (!dateStr) return new Date(0);
  const months = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
  const parts = dateStr.trim().split(/\s+/);
  if (parts.length === 3) {
    const d = parseInt(parts[0], 10);
    const m = months[parts[1].toLowerCase().slice(0,3)];
    const y = parseInt(parts[2], 10);
    if (!isNaN(d) && m !== undefined && !isNaN(y)) return new Date(y, m, d);
  }
  return new Date(dateStr) || new Date(0);
}

/* ─────────────────────────────────────────
   A. Form Tracker
───────────────────────────────────────── */

function renderFormTracker(matchBatting, matchBowling) {
  const wrap = document.getElementById('formHeatMap');
  if (!wrap) return;

  if (!matchBatting || matchBatting.length === 0) {
    wrap.innerHTML = '<p class="sc-placeholder">No match data available.</p>';
    return;
  }

  /* ── Build sorted match list — most recent FIRST (M-last★ on left, M1 on right) ── */
  const _chronoIds = [...new Set(matchBatting.map(r => r.match_id))]
    .sort((a, b) => parseInt(a) - parseInt(b));          // oldest → newest
  const matchIds = [..._chronoIds].reverse();             // newest → oldest (display order)
  const _n = _chronoIds.length;
  const matchLabel = (_id, i) => {
    const num = _n - i;                                   // M12, M11 … M1
    return i === 0 ? `M${num} ★` : `M${num}`;
  };

  const matchDates = {};
  matchBatting.forEach(r => { matchDates[r.match_id] = r.match_date || ''; });

  /* ── Presence maps: match-level AND date-level ──
     Rule: if a player appeared in ANY match on the same day, they were
     present for ALL matches that day (same-day = always in squad).        */
  const presenceMap     = {}; /* playerName → Set<matchId>  */
  const datePresentMap  = {}; /* playerName → Set<normDate> */
  const _normDate = d => (d || '').trim().replace(/\s+\d{4}$/, '').toLowerCase(); /* "14 Mar 2026"→"14 mar" */
  const _addPresence = (rows) => rows.forEach(r => {
    const p = (r.player || '').trim(); if (!p) return;
    if (!presenceMap[p])    presenceMap[p]    = new Set();
    if (!datePresentMap[p]) datePresentMap[p] = new Set();
    presenceMap[p].add(r.match_id);
    datePresentMap[p].add(_normDate(r.match_date));
  });
  _addPresence(matchBatting);
  if (matchBowling) _addPresence(matchBowling);

  /* ── Collect all players with per-match batting data ── */
  const playerMap = {}; /* { player: { team, totalRuns, matches: { matchId: { runs, balls, dismissal } } } } */
  matchBatting.forEach(r => {
    const p = (r.player || '').trim(); if (!p) return;
    if (!playerMap[p]) playerMap[p] = { team: r.batting_team, totalRuns: 0, matches: {} };
    playerMap[p].totalRuns += parseInt(r.runs) || 0;
    playerMap[p].matches[r.match_id] = {
      runs:      parseInt(r.runs) || 0,
      balls:     parseInt(r.balls) || 0,
      dismissal: r.dismissal_type || ''
    };
  });

  /* Sort players: by total runs desc */
  const players = Object.entries(playerMap).sort((a, b) => b[1].totalRuns - a[1].totalRuns);

  /* ── Cell background colour based on runs ── */
  function cellBg(d) {
    if (!d) return 'hm-dnb';
    if (d.runs === 0) return 'hm-duck';
    if (d.runs <= 9)  return 'hm-r1';
    if (d.runs <= 19) return 'hm-r2';
    if (d.runs <= 29) return 'hm-r3';
    if (d.runs <= 39) return 'hm-r4';
    if (d.runs <= 49) return 'hm-r5';
    return 'hm-great';
  }

  /* ── Build header ── */
  const headerCells = matchIds.map((id, i) =>
    `<th class="hm-match-th" title="${matchDates[id]}">${matchLabel(id, i)}</th>`
  ).join('');

  /* ── Build rows ── */
  const bodyRows = players.map(([name, d]) => {
    const teamCls = teamHeatClass(d.team);
    const cells = matchIds.map(id => {
      const m = d.matches[id];
      if (!m) {
        const present = presenceMap[name]?.has(id)
                     || datePresentMap[name]?.has(_normDate(matchDates[id]));
        return present
          ? `<td class="hm-cell hm-dnb" title="Did not bat">—</td>`
          : `<td class="hm-cell hm-dnb hm-abs" title="Absent / Did not play">A</td>`;
      }
      const notOut = m.dismissal === 'not_out' ? '*' : '';
      // isDuck = m.runs === 0 && m.dismissal !== 'not_out'; (reserved for future use)
      const tip = `${m.runs}${notOut} (${m.balls}b) · ${(m.dismissal || '').replace('_', ' ')}`;
      return `<td class="hm-cell ${cellBg(m)}" title="${tip}">${m.runs}${notOut}</td>`;
    }).join('');

    return `<tr class="hm-row" data-player="${esc(name)}">
      <td class="hm-name ${teamCls}">${esc(name)}</td>
      ${cells}
      <td class="hm-total">${d.totalRuns}</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="hm-table">
      <thead>
        <tr>
          <th class="hm-name-th">Player</th>
          ${headerCells}
          <th class="hm-total-th">Total</th>
        </tr>
        <tr class="hm-date-row">
          <td></td>
          ${matchIds.map(id => `<td class="hm-date-cell">${matchDates[id]?.replace(' 2026','') || ''}</td>`).join('')}
          <td></td>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`;

  /* ── Click row → show detail chart ── */
  const detailWrap = document.getElementById('formDetailWrap');
  const closeBtn   = document.getElementById('formDetailClose');
  const titleEl    = document.getElementById('formDetailTitle');

  wrap.querySelectorAll('.hm-row').forEach(row => {
    row.addEventListener('click', () => {
      const player = row.dataset.player;
      wrap.querySelectorAll('.hm-row').forEach(r => r.classList.remove('hm-row-active'));
      row.classList.add('hm-row-active');
      if (titleEl) titleEl.textContent = `📈 ${player} — Match-by-Match`;
      if (detailWrap) detailWrap.style.display = '';
      renderFormChart(player, matchBatting, matchBowling);
    });
  });

  if (closeBtn) {
    closeBtn.onclick = () => {
      if (detailWrap) detailWrap.style.display = 'none';
      wrap.querySelectorAll('.hm-row').forEach(r => r.classList.remove('hm-row-active'));
      document.querySelectorAll('.hm-row').forEach(r => r.classList.remove('hm-row-active'));
      destroyChart('form');
    };
  }

  /* ── Tab switching ── */
  document.querySelectorAll('.hm-tab').forEach(tab => {
    tab.onclick = () => {
      const target = tab.dataset.hmTab;
      document.querySelectorAll('.hm-tab').forEach(t => t.classList.remove('hm-tab-active'));
      tab.classList.add('hm-tab-active');
      document.querySelectorAll('.hm-pane').forEach(p => p.style.display = 'none');
      const pane = document.getElementById('hmPane-' + target);
      if (pane) pane.style.display = '';
      if (detailWrap) detailWrap.style.display = 'none';
      destroyChart('form');
    };
  });
}

/* ── Bowling Heat Map ── */
function renderBowlingFormTracker(matchBowling, matchBatting) {
  const wrap = document.getElementById('bowlHeatMap');
  if (!wrap) return;
  if (!matchBowling?.length) {
    wrap.innerHTML = '<p class="sc-placeholder">No bowling data available.</p>';
    return;
  }

  /* Sorted match list — most recent FIRST */
  const _chronoIds = [...new Set(matchBowling.map(r => r.match_id))]
    .sort((a, b) => parseInt(a) - parseInt(b));          // oldest → newest
  const matchIds = [..._chronoIds].reverse();             // newest → oldest (display order)
  const _n = _chronoIds.length;
  const matchLabel = (_id, i) => {
    const num = _n - i;
    return i === 0 ? `M${num} ★` : `M${num}`;
  };

  const matchDates = {};
  matchBowling.forEach(r => { matchDates[r.match_id] = r.match_date || ''; });

  /* ── Presence maps: match-level AND date-level (same day = in squad all day) ── */
  const presenceMap    = {};
  const datePresentMap = {};
  const _normDate = d => (d || '').trim().replace(/\s+\d{4}$/, '').toLowerCase();
  const _addP = (rows) => rows.forEach(r => {
    const p = (r.player || '').trim(); if (!p) return;
    if (!presenceMap[p])    presenceMap[p]    = new Set();
    if (!datePresentMap[p]) datePresentMap[p] = new Set();
    presenceMap[p].add(r.match_id);
    datePresentMap[p].add(_normDate(r.match_date));
  });
  _addP(matchBowling);
  if (matchBatting) _addP(matchBatting);

  /* Build player map: { player: { team, totalWkts, matches: { matchId: {w,r,o,eco} } } } */
  const playerMap = {};
  matchBowling.forEach(r => {
    const p = (r.player || '').trim(); if (!p) return;
    if (!playerMap[p]) playerMap[p] = { team: r.bowling_team, totalWkts: 0, matches: {} };
    playerMap[p].totalWkts += parseInt(r.wickets) || 0;
    playerMap[p].matches[r.match_id] = {
      w:   parseInt(r.wickets)  || 0,
      r:   parseInt(r.runs)     || 0,
      o:   parseFloat(r.overs)  || 0,
      eco: parseFloat(r.economy)|| 0
    };
  });

  /* Sort players by total wickets desc */
  const players = Object.entries(playerMap).sort((a, b) => b[1].totalWkts - a[1].totalWkts);

  /* Cell class by wickets + economy (for 0W) */
  function bowlBg(m) {
    if (!m) return 'hm-dnb';
    if (m.w === 0) {
      if (m.eco <= 5)  return 'hm-b0-tight';   // 0W but economic — decent
      if (m.eco <= 7)  return 'hm-b0-avg';     // 0W, average economy
      return 'hm-b0-exp';                       // 0W and expensive — bad
    }
    if (m.w === 1) return 'hm-b1';
    if (m.w === 2) return 'hm-b2';
    if (m.w === 3) return 'hm-b3';
    return 'hm-b4';
  }

  const headerCells = matchIds.map((id, i) =>
    `<th class="hm-match-th" title="${matchDates[id]}">${matchLabel(id, i)}</th>`
  ).join('');

  const bodyRows = players.map(([name, d]) => {
    const teamCls = teamHeatClass(d.team);
    const cells = matchIds.map(id => {
      const m = d.matches[id];
      if (!m) {
        const present = presenceMap[name]?.has(id)
                     || datePresentMap[name]?.has(_normDate(matchDates[id]));
        return present
          ? `<td class="hm-cell hm-dnb" title="Did not bowl">—</td>`
          : `<td class="hm-cell hm-dnb hm-abs" title="Absent / Did not play">A</td>`;
      }
      const tip = `${m.w}W / ${m.r}R · ${m.o}ov · Eco ${m.eco}`;
      return `<td class="hm-cell ${bowlBg(m)}" title="${tip}">${m.w}/${m.r}</td>`;
    }).join('');
    return `<tr class="hm-row" data-player="${esc(name)}">
      <td class="hm-name ${teamCls}">${esc(name)}</td>
      ${cells}
      <td class="hm-total">${d.totalWkts}W</td>
    </tr>`;
  }).join('');

  wrap.innerHTML = `
    <table class="hm-table">
      <thead>
        <tr>
          <th class="hm-name-th">Player</th>
          ${headerCells}
          <th class="hm-total-th">Total</th>
        </tr>
        <tr class="hm-date-row">
          <td></td>
          ${matchIds.map(id => `<td class="hm-date-cell">${(matchDates[id]||'').replace(' 2026','')}</td>`).join('')}
          <td></td>
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`;

  /* Row click → detail chart */
  const detailWrap = document.getElementById('formDetailWrap');
  const titleEl    = document.getElementById('formDetailTitle');
  wrap.querySelectorAll('.hm-row').forEach(row => {
    row.addEventListener('click', () => {
      const player = row.dataset.player;
      wrap.querySelectorAll('.hm-row').forEach(r => r.classList.remove('hm-row-active'));
      row.classList.add('hm-row-active');
      if (titleEl) titleEl.textContent = `🎳 ${player} — Bowling by Match`;
      if (detailWrap) detailWrap.style.display = '';
      renderFormChart(player, state.matchBatting, state.matchBowling);
    });
  });
}

function renderFormChart(playerName, matchBatting, matchBowling) {
  destroyChart('form');
  const canvas = document.getElementById('formChart');
  if (!canvas) return;

  /* Collect all match dates, sorted chronologically */
  const dateSet = new Set();
  matchBatting.forEach(r => { if (r.match_date) dateSet.add(r.match_date); });
  matchBowling.forEach(r => { if (r.match_date) dateSet.add(r.match_date); });

  const sortedDates = [...dateSet].sort((a, b) => parseMatchDate(a) - parseMatchDate(b));

  /* Aggregate runs & wickets per match date for this player */
  const runsPerDate = {};
  const wicketsPerDate = {};
  sortedDates.forEach(d => { runsPerDate[d] = 0; wicketsPerDate[d] = 0; });

  matchBatting
    .filter(r => r.player && r.player.trim() === playerName)
    .forEach(r => {
      if (r.match_date in runsPerDate) runsPerDate[r.match_date] += num(r.runs);
    });

  matchBowling
    .filter(r => r.player && r.player.trim() === playerName)
    .forEach(r => {
      if (r.match_date in wicketsPerDate) wicketsPerDate[r.match_date] += num(r.wickets);
    });

  const tc = matchPlayerTeam(playerName, matchBatting, matchBowling);
  const runsColor    = tc.border || '#387ed1';
  const wicketsColor = '#fb8c00';

  const ctx = canvas.getContext('2d');
  charts.form = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sortedDates,
      datasets: [
        {
          label: 'Runs',
          data: sortedDates.map(d => runsPerDate[d]),
          borderColor: runsColor,
          backgroundColor: runsColor.replace(')', ', 0.08)').replace('rgb', 'rgba').replace('#', 'rgba(') || 'rgba(56,126,209,0.08)',
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.3,
          fill: true,
          yAxisID: 'yRuns'
        },
        {
          label: 'Wickets',
          data: sortedDates.map(d => wicketsPerDate[d]),
          borderColor: wicketsColor,
          backgroundColor: 'rgba(251,140,0,0.08)',
          borderWidth: 2,
          pointRadius: 4,
          pointHoverRadius: 6,
          tension: 0.3,
          borderDash: [4, 3],
          yAxisID: 'yWkts'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      animation: { duration: 350 },
      plugins: {
        legend: {
          display: true,
          position: 'top',
          labels: { color: '#7a7a7a', font: { size: 11 }, boxWidth: 12, padding: 16 }
        },
        tooltip: {
          ...TOOLTIP_DEFAULTS,
          callbacks: {
            title: items => `Match: ${items[0].label}`,
            label: item => `  ${item.dataset.label}: ${item.raw}`
          }
        },
        title: {
          display: true,
          text: playerName,
          color: '#383838',
          font: { size: 12, weight: '600' },
          padding: { bottom: 8 }
        }
      },
      scales: {
        x: {
          grid: { color: '#f0f3f5' },
          ticks: { color: '#7a7a7a', font: { size: 10 }, maxRotation: 45 }
        },
        yRuns: {
          type: 'linear',
          position: 'left',
          grid: { color: '#f0f3f5' },
          ticks: { color: '#7a7a7a', font: { size: 11 }, stepSize: 5 },
          title: { display: true, text: 'Runs', color: '#7a7a7a', font: { size: 10 } }
        },
        yWkts: {
          type: 'linear',
          position: 'right',
          grid: { drawOnChartArea: false },
          ticks: { color: wicketsColor, font: { size: 11 }, stepSize: 1 },
          title: { display: true, text: 'Wickets', color: wicketsColor, font: { size: 10 } },
          min: 0
        }
      }
    }
  });
}


/* ─────────────────────────────────────────
   B. Scorecard Viewer
───────────────────────────────────────── */

function renderScorecardViewer(matchMeta, matchBatting, matchBowling) {
  const sel     = document.getElementById('matchSelect');
  const content = document.getElementById('scorecardContent');
  if (!sel || !content) return;

  if (!matchMeta || matchMeta.length === 0) {
    content.innerHTML = `
      <div class="sc-placeholder">
        <div class="sc-placeholder-icon">📋</div>
        <div>Scorecard data is being extracted — refresh the page to check again.</div>
      </div>`;
    return;
  }

  /* Sort matches — most recent first */
  const sorted = [...matchMeta].sort((a, b) => parseMatchDate(b.match_date) - parseMatchDate(a.match_date));

  /* Populate dropdown */
  sel.innerHTML = '<option value="">— Select a match —</option>';
  sorted.forEach((m, i) => {
    const opt = document.createElement('option');
    opt.value = m.match_id;
    const t1  = m.innings1_team ? teamShort(m.innings1_team) : '?';
    const t2  = m.innings2_team ? teamShort(m.innings2_team) : '?';
    const label = i === 0 ? `Match ${i + 1} ★ Latest` : `Match ${i + 1}`;
    opt.textContent = `${label} — ${t1} vs ${t2} (${m.match_date || 'Unknown date'})`;
    sel.appendChild(opt);
  });

  /* Restore previously selected match if still present */
  if (state.selectedMatchId && [...sel.options].some(o => o.value === state.selectedMatchId)) {
    sel.value = state.selectedMatchId;
    renderScorecardForMatch(state.selectedMatchId, matchMeta, matchBatting, matchBowling);
  } else {
    content.innerHTML = `
      <div class="sc-placeholder">
        <div class="sc-placeholder-icon">📋</div>
        <div>Select a match above to view the scorecard.</div>
      </div>`;
  }

  sel.addEventListener('change', e => {
    state.selectedMatchId = e.target.value;
    if (!state.selectedMatchId) {
      content.innerHTML = `<div class="sc-placeholder"><div class="sc-placeholder-icon">📋</div><div>Select a match above to view the scorecard.</div></div>`;
      return;
    }
    renderScorecardForMatch(state.selectedMatchId, matchMeta, matchBatting, matchBowling);
  });
}

function renderScorecardForMatch(matchId, matchMeta, matchBatting, matchBowling) {
  const content = document.getElementById('scorecardContent');
  if (!content) return;

  const meta = matchMeta.find(m => String(m.match_id) === String(matchId));
  if (!meta) {
    content.innerHTML = `<div class="sc-placeholder"><div class="sc-placeholder-icon">❓</div><div>Match not found.</div></div>`;
    return;
  }

  const innings1Bat  = matchBatting.filter(r => String(r.match_id) === String(matchId) && String(r.innings) === '1');
  const innings2Bat  = matchBatting.filter(r => String(r.match_id) === String(matchId) && String(r.innings) === '2');
  const innings1Bowl = matchBowling.filter(r => String(r.match_id) === String(matchId) && String(r.innings) === '1');
  const innings2Bowl = matchBowling.filter(r => String(r.match_id) === String(matchId) && String(r.innings) === '2');

  function calcScore(batRows, bowlRows) {
    /* Use bowling-side total so extras (wides, no-balls, leg-byes) are included */
    const runs = bowlRows?.length
      ? bowlRows.reduce((s, r) => s + num(r.runs), 0)
      : batRows.reduce((s, r) => s + num(r.runs), 0);
    const wkts = batRows.filter(r => r.dismissal_type && r.dismissal_type !== 'not_out' && r.dismissal_type !== 'unknown' && r.dismissal_type !== 'retired_hurt').length;
    return runs ? `${runs}/${wkts}` : '';
  }

  function dismissalText(row) {
    switch (row.dismissal_type) {
      case 'not_out':      return `<span class="sc-not-out">not out</span>`;
      case 'retired_hurt': return `<span class="sc-dis">retired hurt</span>`;
      case 'bowled':       return `<span class="sc-dis">b ${esc(row.dismissed_by || '')}</span>`;
      case 'caught':       return `<span class="sc-dis">c ${esc(row.caught_by || '')} b ${esc(row.dismissed_by || '')}</span>`;
      case 'lbw':          return `<span class="sc-dis">lbw b ${esc(row.dismissed_by || '')}</span>`;
      case 'run_out':      return `<span class="sc-dis">run out${row.dismissed_by ? ' (' + esc(row.dismissed_by) + ')' : ''}</span>`;
      case 'stumped':      return `<span class="sc-dis">st ${esc(row.caught_by || '')} b ${esc(row.dismissed_by || '')}</span>`;
      default:             return `<span class="sc-dis">${esc(row.dismissal_type || '')}</span>`;
    }
  }

  function buildBattingTable(batRows, bowlTotal) {
    if (!batRows.length) return '<p style="padding:12px;color:#b0b0b0;font-size:12px;">No batting data.</p>';
    const sorted = [...batRows].sort((a, b) => num(a.position) - num(b.position));
    const rows = sorted.map(r => `
      <tr>
        <td>${num(r.position) || ''}</td>
        <td style="text-align:left;font-weight:600;">${esc(r.player)}<br>${dismissalText(r)}</td>
        <td><strong>${num(r.runs)}</strong></td>
        <td>${num(r.balls)}</td>
        <td>${num(r.fours)}</td>
        <td>${num(r.sixes)}</td>
        <td>${num(r.strike_rate) ? num(r.strike_rate).toFixed(1) : '—'}</td>
      </tr>`).join('');
    /* Use bowling-side total (bowlTotal) so extras appear in the Total row */
    const displayRuns = bowlTotal > 0 ? bowlTotal : sorted.reduce((s, r) => s + num(r.runs), 0);
    const totalWkts   = sorted.filter(r => r.dismissal_type && r.dismissal_type !== 'not_out' && r.dismissal_type !== 'unknown' && r.dismissal_type !== 'retired_hurt').length;
    return `
      <table class="sc-table">
        <thead><tr>
          <th>#</th><th style="text-align:left;min-width:160px;">Batter</th>
          <th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="sc-total-row">
          <td></td><td style="text-align:left;font-weight:700;">Total</td>
          <td><strong>${displayRuns}/${totalWkts}</strong></td>
          <td colspan="4"></td>
        </tr></tfoot>
      </table>`;
  }

  function buildBowlingTable(bowlRows) {
    if (!bowlRows.length) return '<p style="padding:12px;color:#b0b0b0;font-size:12px;">No bowling data.</p>';
    const rows = bowlRows.map(r => `
      <tr>
        <td style="text-align:left;font-weight:600;">${esc(r.player)}</td>
        <td>${num(r.overs)}</td>
        <td>${num(r.maidens)}</td>
        <td>${num(r.runs)}</td>
        <td><strong>${num(r.wickets)}</strong></td>
        <td>${num(r.dot_balls)}</td>
        <td>${num(r.fours_conceded)}</td>
        <td>${num(r.sixes_conceded)}</td>
        <td>${num(r.wides)}</td>
        <td>${num(r.no_balls)}</td>
        <td>${num(r.economy) ? num(r.economy).toFixed(2) : '—'}</td>
      </tr>`).join('');
    return `
      <table class="sc-table">
        <thead><tr>
          <th style="text-align:left;min-width:140px;">Bowler</th>
          <th>O</th><th>M</th><th>R</th><th>W</th>
          <th>Dots</th><th>4s</th><th>6s</th><th>WD</th><th>NB</th><th>Eco</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function buildInningsBlock(inningsNum, battingTeam, batRows, bowlRows) {
    const teamAbbr = battingTeam ? teamShort(battingTeam) : `Inn ${inningsNum}`;
    const bowlTotal = bowlRows.reduce((s, r) => s + num(r.runs), 0);
    const score     = calcScore(batRows, bowlRows);
    return `
      <div class="scorecard-innings-block">
        <div class="sc-innings-header">
          <span class="sc-innings-title">${inningsNum === 1 ? '1st' : '2nd'} Innings — ${esc(teamAbbr)}</span>
          ${score ? `<span class="sc-innings-score">${score}</span>` : ''}
        </div>
        <div class="sc-section-label">Batting</div>
        ${buildBattingTable(batRows, bowlTotal)}
        <div class="sc-section-label">Bowling</div>
        ${buildBowlingTable(bowlRows)}
      </div>`;
  }

  const resultLine = meta.result ? `<div style="padding:8px 16px 4px;font-size:11px;color:#7a7a7a;font-style:italic;">${esc(meta.result)}${meta.toss_winner ? ` · Toss: ${esc(teamShort(meta.toss_winner))} chose to ${esc(meta.toss_decision || '')}` : ''}</div>` : '';

  const momLine = meta.man_of_match
    ? `<div style="padding:4px 16px 8px;font-size:12px;">🏅 <strong>Man of the Match:</strong> ${esc(meta.man_of_match)}</div>`
    : '';

  /* Best batter: highest runs in this match */
  const allBat = [...innings1Bat, ...innings2Bat];
  const bestBatRow = allBat.length
    ? allBat.reduce((a, b) => (num(b.runs) > num(a.runs) ? b : a))
    : null;
  const bestBatLine = bestBatRow && num(bestBatRow.runs) > 0
    ? `<span>🏏 <strong>Best Bat:</strong> ${esc(bestBatRow.player)} — ${num(bestBatRow.runs)}(${num(bestBatRow.balls)})</span>`
    : '';

  /* Best bowler: most wickets (fewest runs tiebreak) */
  const allBowl = [...innings1Bowl, ...innings2Bowl];
  const bestBowlRow = allBowl.length
    ? allBowl.slice().sort((a, b) => {
        const wDiff = (num(b.wickets) - num(a.wickets));
        return wDiff !== 0 ? wDiff : num(a.runs) - num(b.runs);
      })[0]
    : null;
  const bestBowlLine = bestBowlRow && num(bestBowlRow.wickets) > 0
    ? `<span>🎳 <strong>Best Bowl:</strong> ${esc(bestBowlRow.player)} — ${num(bestBowlRow.wickets)}/${num(bestBowlRow.runs)}</span>`
    : '';

  const perfLine = (bestBatLine || bestBowlLine)
    ? `<div style="padding:2px 16px 8px;font-size:12px;display:flex;gap:24px;flex-wrap:wrap;">${bestBatLine}${bestBowlLine}</div>`
    : '';

  content.innerHTML =
    resultLine +
    momLine +
    perfLine +
    buildInningsBlock(1, meta.innings1_team, innings1Bat, innings1Bowl) +
    buildInningsBlock(2, meta.innings2_team, innings2Bat, innings2Bowl);

  /* Worm chart — rendered after innerHTML is set so canvas exists in DOM */
  renderMatchWorm(state.matchBalls, matchId, state.matchMeta);
}


/* ─────────────────────────────────────────
   C. Bowling Discipline
───────────────────────────────────────── */

function renderBowlingDiscipline(matchBowling) {
  renderExtrasPerBowler(matchBowling);
  renderDotPct(matchBowling);
  renderBoundaryPct(matchBowling);
  renderWicketTypePie(state.matchBatting);
}

function renderExtrasPerBowler(matchBowling) {
  destroyChart('extrasPerBowler');
  if (!matchBowling || matchBowling.length === 0) {
    showEmptyChart('extrasPerBowlerChart', 'Scorecard data loading…');
    return;
  }
  hideEmptyChart('extrasPerBowlerChart');

  /* Aggregate per bowler */
  const totals = {};
  matchBowling.forEach(r => {
    const p = (r.player || '').trim();
    if (!p) return;
    if (!totals[p]) totals[p] = { wides: 0, noBalls: 0 };
    totals[p].wides   += num(r.wides);
    totals[p].noBalls += num(r.no_balls);
  });

  const sorted = Object.entries(totals)
    .map(([name, v]) => ({ name, total: v.wides + v.noBalls, ...v }))
    .filter(r => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  if (!sorted.length) { showEmptyChart('extrasPerBowlerChart', 'No extras data'); return; }

  const ctx = document.getElementById('extrasPerBowlerChart').getContext('2d');
  charts.extrasPerBowler = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(r => r.name),
      datasets: [
        { label: 'Wides',    data: sorted.map(r => r.wides),   backgroundColor: 'rgba(229,57,53,0.75)',  borderColor: '#e53935', borderWidth: 1, borderRadius: 3 },
        { label: 'No-Balls', data: sorted.map(r => r.noBalls), backgroundColor: 'rgba(251,140,0,0.75)',  borderColor: '#fb8c00', borderWidth: 1, borderRadius: 3 }
      ]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 380 },
      plugins: {
        legend: { display: true, labels: { color: '#7a7a7a', font: { size: 11 }, boxWidth: 10 } },
        tooltip: { ...TOOLTIP_DEFAULTS }
      },
      scales: {
        x: { stacked: false, grid: { color: '#f0f3f5' }, ticks: { color: '#7a7a7a', font: { size: 11 } } },
        y: { grid: { display: false }, ticks: { color: '#383838', font: { size: 11 } } }
      }
    }
  });
}

function renderDotPct(matchBowling) {
  destroyChart('dotPct');
  if (!matchBowling || matchBowling.length === 0) {
    showEmptyChart('dotPctChart', 'Scorecard data loading…');
    return;
  }
  hideEmptyChart('dotPctChart');

  const totals = {};
  matchBowling.forEach(r => {
    const p = (r.player || '').trim();
    if (!p) return;
    if (!totals[p]) totals[p] = { dots: 0, balls: 0 };
    totals[p].dots  += num(r.dot_balls);
    totals[p].balls += Math.round(num(r.overs) * 6);
  });

  const sorted = Object.entries(totals)
    .filter(([, v]) => v.balls > 0)
    .map(([name, v]) => ({ name, pct: parseFloat(((v.dots / v.balls) * 100).toFixed(1)) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 12);

  if (!sorted.length) { showEmptyChart('dotPctChart', 'No dot ball data'); return; }

  const n = sorted.length;
  const bgColors = sorted.map((_, i) => {
    const t = n > 1 ? i / (n - 1) : 0;
    /* Green (high %) → Red (low %) */
    const rv = Math.round(34  + (1 - t) * 205);
    const gv = Math.round(197 - (1 - t) * 148);
    const bv = Math.round(94  - (1 - t) * 72);
    return `rgba(${rv},${gv},${bv},0.75)`;
  });

  const ctx = document.getElementById('dotPctChart').getContext('2d');
  charts.dotPct = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(r => r.name),
      datasets: [{
        label: 'Dot %',
        data: sorted.map(r => r.pct),
        backgroundColor: bgColors,
        borderColor: bgColors.map(c => c.replace('0.75', '1')),
        borderWidth: 1, borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 380 },
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS, callbacks: { label: ctx => `  ${ctx.raw}%` } }
      },
      scales: {
        x: { grid: { color: '#f0f3f5' }, ticks: { color: '#7a7a7a', font: { size: 11 }, callback: v => v + '%' } },
        y: { grid: { display: false }, ticks: { color: '#383838', font: { size: 11 } } }
      }
    }
  });
}

function renderBoundaryPct(matchBowling) {
  destroyChart('boundaryPct');
  if (!matchBowling || matchBowling.length === 0) {
    showEmptyChart('boundaryPctChart', 'Scorecard data loading…');
    return;
  }
  hideEmptyChart('boundaryPctChart');

  const totals = {};
  matchBowling.forEach(r => {
    const p = (r.player || '').trim();
    if (!p) return;
    if (!totals[p]) totals[p] = { fours: 0, sixes: 0, balls: 0 };
    totals[p].fours += num(r.fours_conceded);
    totals[p].sixes += num(r.sixes_conceded);
    totals[p].balls += Math.round(num(r.overs) * 6);
  });

  const sorted = Object.entries(totals)
    .filter(([, v]) => v.balls > 0)
    .map(([name, v]) => ({ name, pct: parseFloat((((v.fours + v.sixes) / v.balls) * 100).toFixed(1)) }))
    .sort((a, b) => a.pct - b.pct)  /* ascending — lower is better */
    .slice(0, 12);

  if (!sorted.length) { showEmptyChart('boundaryPctChart', 'No boundary conceded data'); return; }

  const n = sorted.length;
  const bgColors = sorted.map((_, i) => {
    /* Ascending order: best (green) first, worst (red) last */
    const t = n > 1 ? i / (n - 1) : 0;
    const rv = Math.round(34  + t * 205);
    const gv = Math.round(197 - t * 148);
    const bv = Math.round(94  - t * 72);
    return `rgba(${rv},${gv},${bv},0.75)`;
  });

  const ctx = document.getElementById('boundaryPctChart').getContext('2d');
  charts.boundaryPct = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(r => r.name),
      datasets: [{
        label: 'Boundary %',
        data: sorted.map(r => r.pct),
        backgroundColor: bgColors,
        borderColor: bgColors.map(c => c.replace('0.75', '1')),
        borderWidth: 1, borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 380 },
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS, callbacks: { label: ctx => `  ${ctx.raw}%` } }
      },
      scales: {
        x: { grid: { color: '#f0f3f5' }, ticks: { color: '#7a7a7a', font: { size: 11 }, callback: v => v + '%' } },
        y: { grid: { display: false }, ticks: { color: '#383838', font: { size: 11 } } }
      }
    }
  });
}

function renderWicketTypePie(matchBatting) {
  destroyChart('wicketTypePie');
  if (!matchBatting || matchBatting.length === 0) {
    showEmptyChart('wicketTypePieChart', 'Scorecard data loading…');
    return;
  }
  hideEmptyChart('wicketTypePieChart');

  const counts = { bowled: 0, caught: 0, lbw: 0, run_out: 0, stumped: 0, other: 0 };
  matchBatting.forEach(r => {
    const dt = (r.dismissal_type || '').toLowerCase();
    if (dt === 'not_out' || dt === 'retired_hurt' || dt === 'unknown' || dt === '') return;
    if (dt in counts) counts[dt]++;
    else counts.other++;
  });

  const labels = Object.keys(counts).filter(k => counts[k] > 0);
  const data   = labels.map(k => counts[k]);
  const colorMap = {
    bowled:  '#e53935', caught: '#1976d2', lbw: '#fb8c00',
    run_out: '#43a047', stumped: '#ab47bc', other: '#9e9e9e'
  };
  const bgColors = labels.map(l => colorMap[l] || '#9e9e9e');

  if (!data.length) { showEmptyChart('wicketTypePieChart', 'No wicket type data'); return; }

  const ctx = document.getElementById('wicketTypePieChart').getContext('2d');
  charts.wicketTypePie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.map(l => l.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())),
      datasets: [{
        data,
        backgroundColor: bgColors.map(c => c + 'bf'),
        borderColor: bgColors,
        borderWidth: 2, hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '55%',
      animation: { duration: 450 },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: '#7a7a7a', padding: 10, font: { size: 11 }, boxWidth: 10 } },
        tooltip: { ...TOOLTIP_DEFAULTS, callbacks: { label: ctx => `  ${ctx.label}: ${ctx.raw}` } }
      }
    }
  });
}


/* ─────────────────────────────────────────
   D. Dismissal Analysis
───────────────────────────────────────── */

function renderDismissalAnalysis(matchBatting) {
  renderDismissalTypePie(matchBatting);
  renderNotOutPct(matchBatting);
}

function renderDismissalTypePie(matchBatting) {
  destroyChart('dismissalTypePie');
  if (!matchBatting || matchBatting.length === 0) {
    showEmptyChart('dismissalTypePieChart', 'Scorecard data loading…');
    return;
  }
  hideEmptyChart('dismissalTypePieChart');

  const colorMap = {
    bowled:       '#e53935',
    caught:       '#1976d2',
    lbw:          '#fb8c00',
    run_out:      '#43a047',
    not_out:      '#9e9e9e',
    retired_hurt: '#ab47bc',
    stumped:      '#00acc1',
    unknown:      '#cfd8dc'
  };

  const counts = {};
  matchBatting.forEach(r => {
    const dt = (r.dismissal_type || 'unknown').toLowerCase();
    counts[dt] = (counts[dt] || 0) + 1;
  });

  const order = ['bowled','caught','lbw','run_out','stumped','not_out','retired_hurt','unknown'];
  const labels = order.filter(k => (counts[k] || 0) > 0);
  const data   = labels.map(k => counts[k]);
  const bgColors = labels.map(l => colorMap[l] || '#9e9e9e');

  if (!data.length) { showEmptyChart('dismissalTypePieChart', 'No dismissal data'); return; }

  const ctx = document.getElementById('dismissalTypePieChart').getContext('2d');
  charts.dismissalTypePie = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels.map(l => l.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())),
      datasets: [{
        data,
        backgroundColor: bgColors.map(c => c + 'bf'),
        borderColor: bgColors,
        borderWidth: 2, hoverOffset: 6
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      cutout: '55%',
      animation: { duration: 450 },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: '#7a7a7a', padding: 10, font: { size: 11 }, boxWidth: 10 } },
        tooltip: { ...TOOLTIP_DEFAULTS, callbacks: { label: ctx => `  ${ctx.label}: ${ctx.raw}` } }
      }
    }
  });
}

function renderNotOutPct(matchBatting) {
  destroyChart('notOutPct');
  if (!matchBatting || matchBatting.length === 0) {
    showEmptyChart('notOutPctChart', 'Scorecard data loading…');
    return;
  }
  hideEmptyChart('notOutPctChart');

  const playerData = {};
  matchBatting.forEach(r => {
    const p = (r.player || '').trim();
    if (!p) return;
    if (!playerData[p]) playerData[p] = { innings: 0, notOuts: 0 };
    playerData[p].innings++;
    if ((r.dismissal_type || '').toLowerCase() === 'not_out') playerData[p].notOuts++;
  });

  const sorted = Object.entries(playerData)
    .filter(([, v]) => v.innings >= 3)
    .map(([name, v]) => ({ name, pct: parseFloat(((v.notOuts / v.innings) * 100).toFixed(1)) }))
    .sort((a, b) => b.pct - a.pct)
    .slice(0, 12);

  if (!sorted.length) { showEmptyChart('notOutPctChart', 'No data (min 3 innings)'); return; }

  const ctx = document.getElementById('notOutPctChart').getContext('2d');
  charts.notOutPct = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(r => r.name),
      datasets: [{
        label: 'Not Out %',
        data: sorted.map(r => r.pct),
        backgroundColor: 'rgba(0,162,91,0.70)',
        borderColor: '#00a25b',
        borderWidth: 1, borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      animation: { duration: 380 },
      plugins: {
        legend: { display: false },
        tooltip: { ...TOOLTIP_DEFAULTS, callbacks: { label: ctx => `  ${ctx.raw}%` } }
      },
      scales: {
        x: { grid: { color: '#f0f3f5' }, max: 100, ticks: { color: '#7a7a7a', font: { size: 11 }, callback: v => v + '%' } },
        y: { grid: { display: false }, ticks: { color: '#383838', font: { size: 11 } } }
      }
    }
  });
}


/* ─────────────────────────────────────────
   E. Toss Analysis
───────────────────────────────────────── */

function renderTossAnalysis(matchMeta) {
  destroyChart('tossAnalysis');
  if (!matchMeta || matchMeta.length === 0) {
    showEmptyChart('tossAnalysisChart', 'Scorecard data loading…');
    return;
  }
  hideEmptyChart('tossAnalysisChart');

  /* Per team: toss wins, matches won when won toss, matches won when lost toss */
  const tList = teamList();
  const tossTeamsMap = {};
  tList.forEach(t => { tossTeamsMap[t.short] = { tossWins: 0, wonWhenTossWin: 0, wonWhenTossLoss: 0 }; });

  matchMeta.forEach(m => {
    const tossTeam   = m.toss_winner || '';
    const winner     = m.winner || '';
    const tossEntry  = getTeam(tossTeam);
    const winEntry   = getTeam(winner);
    const tossShortKey = tossEntry ? tossEntry.short : null;
    const winShortKey  = winEntry  ? winEntry.short  : null;

    if (tossShortKey && tossTeamsMap[tossShortKey]) {
      tossTeamsMap[tossShortKey].tossWins++;
      if (winShortKey === tossShortKey) tossTeamsMap[tossShortKey].wonWhenTossWin++;
      else                              tossTeamsMap[tossShortKey].wonWhenTossLoss++;
    }
  });

  const ctx = document.getElementById('tossAnalysisChart').getContext('2d');
  charts.tossAnalysis = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: tList.map(t => t.short),
      datasets: [
        {
          label: 'Toss Wins',
          data: tList.map(t => (tossTeamsMap[t.short] || {}).tossWins || 0),
          backgroundColor: tList.map(t => t.colors.bg.replace('0.70', '0.55')),
          borderColor: tList.map(t => t.colors.border),
          borderWidth: 1, borderRadius: 3
        },
        {
          label: 'Won (toss won)',
          data: tList.map(t => (tossTeamsMap[t.short] || {}).wonWhenTossWin || 0),
          backgroundColor: tList.map(t => t.colors.bg.replace('0.70', '0.85')),
          borderColor: tList.map(t => t.colors.border),
          borderWidth: 1, borderRadius: 3
        },
        {
          label: 'Won (toss lost)',
          data: tList.map(t => (tossTeamsMap[t.short] || {}).wonWhenTossLoss || 0),
          backgroundColor: tList.map(() => 'rgba(0,162,91,0.65)'),
          borderColor: tList.map(() => '#00a25b'),
          borderWidth: 1, borderRadius: 3
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: '#7a7a7a', font: { size: 11 }, boxWidth: 10, padding: 12 } },
        tooltip: { ...TOOLTIP_DEFAULTS }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#383838', font: { size: 12, weight: '500' } } },
        y: { grid: { color: '#f0f3f5' }, ticks: { color: '#7a7a7a', font: { size: 11 }, stepSize: 1 } }
      }
    }
  });
}


/* ─────────────────────────────────────────
   E (2). Extras Team Chart
───────────────────────────────────────── */

function renderExtrasTeamChart(matchBowling) {
  destroyChart('extrasTeam');
  if (!matchBowling || matchBowling.length === 0) {
    showEmptyChart('extrasTeamChart', 'Scorecard data loading…');
    return;
  }
  hideEmptyChart('extrasTeamChart');

  /* Each row's bowling_team is the team doing the bowling (conceding extras) */
  const tList = teamList();
  const extTeams = {};
  tList.forEach(t => { extTeams[t.short] = { wides: 0, noBalls: 0 }; });
  matchBowling.forEach(r => {
    const bt = (r.bowling_team || '').toLowerCase();
    const tEntry = getTeam(bt);
    const key = tEntry ? tEntry.short : null;
    if (!key) return;
    extTeams[key].wides   += num(r.wides);
    extTeams[key].noBalls += num(r.no_balls);
  });

  const ctx = document.getElementById('extrasTeamChart').getContext('2d');
  charts.extrasTeam = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: tList.map(t => `${t.short} Bowling`),
      datasets: [
        {
          label: 'Wides',
          data: tList.map(t => (extTeams[t.short] || {}).wides || 0),
          backgroundColor: tList.map(t => t.colors.bg),
          borderColor: tList.map(t => t.colors.border),
          borderWidth: 1, borderRadius: 3
        },
        {
          label: 'No-Balls',
          data: tList.map(t => (extTeams[t.short] || {}).noBalls || 0),
          backgroundColor: tList.map(t => t.colors.bg.replace('0.70', '0.40')),
          borderColor: tList.map(t => t.colors.border),
          borderWidth: 1, borderRadius: 3, borderDash: [4, 2]
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: true, position: 'bottom', labels: { color: '#7a7a7a', font: { size: 11 }, boxWidth: 10, padding: 12 } },
        tooltip: { ...TOOLTIP_DEFAULTS }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#383838', font: { size: 12, weight: '500' } } },
        y: { grid: { color: '#f0f3f5' }, ticks: { color: '#7a7a7a', font: { size: 11 }, stepSize: 1 } }
      }
    }
  });
}


/* ─────────────────────────────────────────
   F. Bowler vs Batsman Matchup Table
───────────────────────────────────────── */

function renderMatchupTable(matchBatting) {
  const banner = document.getElementById('matchupBanner');
  const wrap   = document.getElementById('matchupTableWrap');
  if (!wrap) return;

  if (!matchBatting || matchBatting.length === 0) {
    if (banner) banner.classList.remove('hidden');
    wrap.innerHTML = '';
    return;
  }

  /* Filter to actual dismissals by a bowler */
  const dismissalTypes = new Set(['bowled', 'caught', 'lbw', 'stumped']);
  const dismissals = matchBatting.filter(r =>
    r.dismissal_type && dismissalTypes.has(r.dismissal_type.toLowerCase()) &&
    r.dismissed_by && r.dismissed_by.trim() !== ''
  );

  if (!dismissals.length) {
    if (banner) banner.classList.remove('hidden');
    wrap.innerHTML = '';
    return;
  }

  if (banner) banner.classList.add('hidden');

  /* Collect unique bowlers (rows) and batsmen (columns) */
  const bowlerSet  = new Set();
  const batsmanSet = new Set();
  dismissals.forEach(r => {
    bowlerSet.add(r.dismissed_by.trim());
    batsmanSet.add(r.player.trim());
  });

  const bowlers  = [...bowlerSet].sort();
  const batsmen  = [...batsmanSet].sort();

  /* Build matrix: matrix[bowler][batsman] = count */
  const matrix = {};
  bowlers.forEach(b => { matrix[b] = {}; batsmen.forEach(bt => { matrix[b][bt] = 0; }); });
  dismissals.forEach(r => {
    const b  = r.dismissed_by.trim();
    const bt = r.player.trim();
    if (matrix[b] && bt in matrix[b]) matrix[b][bt]++;
  });

  /* Row totals */
  const rowTotals = {};
  bowlers.forEach(b => { rowTotals[b] = batsmen.reduce((s, bt) => s + matrix[b][bt], 0); });
  /* Col totals */
  const colTotals = {};
  batsmen.forEach(bt => { colTotals[bt] = bowlers.reduce((s, b) => s + matrix[b][bt], 0); });
  const grandTotal = bowlers.reduce((s, b) => s + rowTotals[b], 0);

  /* Build HTML table */
  const headerCells = batsmen.map(bt => `<th class="matchup-bat-th" title="${esc(bt)}"><div class="matchup-rotated">${esc(bt)}</div></th>`).join('');
  const headerRow = `<tr><th class="matchup-bowler-th">Bowler ↓ · Batsman →</th>${headerCells}<th class="matchup-total-col">Total</th></tr>`;

  const bodyRows = bowlers.map(b => {
    const cells = batsmen.map(bt => {
      const v = matrix[b][bt];
      if (v === 0) return `<td>–</td>`;
      const hitClass = v >= 2 ? ' matchup-cell-hit matchup-cell-hit2' : ' matchup-cell-hit';
      return `<td class="${hitClass}">${v}</td>`;
    }).join('');
    return `<tr><td>${esc(b)}</td>${cells}<td class="matchup-total-col">${rowTotals[b]}</td></tr>`;
  }).join('');

  const totalCells = batsmen.map(bt => `<td class="">${colTotals[bt]}</td>`).join('');
  const totalRow = `<tr class="matchup-total-row"><td>Total</td>${totalCells}<td class="matchup-total-col">${grandTotal}</td></tr>`;

  wrap.innerHTML = `
    <table class="matchup-table">
      <thead>${headerRow}</thead>
      <tbody>${bodyRows}${totalRow}</tbody>
    </table>`;
}


/* ============================================================
   Main render — called on every filter change
   ============================================================ */

function renderTopHeroes(batting, bowling, fielding, _mvp, matchBatting, matchBowling) {
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
  const tMvp      = topTied(state.mvp, r => num(r.Total),           r => num(r.Total) > 0); /* always unfiltered — Season MVP is absolute */
  const tSixes    = topTied(batting,  r => num(r['6s']),           r => num(r['6s']) > 0);
  const tBalls    = topTied(batting,  r => num(r.ball_faced),      r => num(r.ball_faced) > 0);
  const tDots     = topTied(bowling,  r => num(r.dot_balls),       r => num(r.dot_balls) > 0);
  /* Dot balls FACED as batsman: approx = balls_faced − (non-boundary scoring balls) − boundary balls
     = ball_faced − (total_runs − 3×4s − 5×6s), clamped ≥ 0 */
  const batDotsArr = batting.map(r => ({
    ...r,
    _batDots: Math.max(0, num(r.ball_faced) - (num(r.total_runs) - 3*num(r['4s']) - 5*num(r['6s'])))
  }));
  topTied(batDotsArr, r => r._batDots, r => num(r.ball_faced) >= 10); // tBatDots reserved
  const tMaiden   = topTied(bowling,  r => num(r.maidens),         r => num(r.maidens) > 0);
  const tBowlSR   = topTiedAsc(bowling, r => num(r.SR),           r => num(r.SR) > 0 && num(r.total_wickets) >= 2);
  const tOvers    = topTied(bowling,  r => num(r.overs),           r => num(r.overs) > 0);
  const tCatches  = topTied(fielding, r => num(r.catches),         r => num(r.catches) > 0);
  const tRunOut   = topTied(fielding, r => num(r.run_outs),        r => num(r.run_outs) > 0);

  function heroCard(icon, label, tied, nameKey, teamKey, statLabel, extraClass = '') {
    if (!tied.players.length) return `<div class="hero-card hero-empty${extraClass ? ' ' + extraClass : ''}"><div class="hero-icon">${icon}</div><div class="hero-label">${label}</div><div class="hero-empty-msg">No data</div></div>`;
    const names = tied.players.map(r => (nameKey ? r[nameKey] : r.name) || '').filter(Boolean);
    const team  = tied.players[0][teamKey] || '';
    const count = tied.players.length;
    const color = count > 1 ? '#7b5ea7' : (teamBorder(team) || 'var(--team-0)');
    // Avatar: initials for solo, count badge for ties
    const initials = count > 1
      ? `×${count}`
      : (names[0] || '').split(' ').map(w => w[0]||'').join('').slice(0,2).toUpperCase();
    // Name: first name only + "& N others" if 3+, or "A & B" if exactly 2
    const displayName = count === 1 ? names[0]
      : count === 2 ? names.slice(0,2).map(esc).join(' &amp; ')
      : `${esc(names[0])} <span class="hero-tied-rest">&amp; ${count - 1} others tied</span>`;
    // Team: unique teams only
    const uniqueTeams = [...new Set(tied.players.map(r => teamShort(r[teamKey]||'')))];
    const displayTeam = uniqueTeams.join(' &amp; ');
    const statVal = tied.val !== null ? (Number.isInteger(tied.val) ? tied.val : parseFloat(tied.val).toFixed(tied.val < 10 ? 2 : 1)) : '—';
    return `
      <div class="hero-card${extraClass ? ' ' + extraClass : ''}" style="--hero-color:${color}">
        <div class="hero-icon">${icon}</div>
        <div class="hero-label">${label}</div>
        <div class="hero-avatar" style="background:${color}">${initials}</div>
        <div class="hero-name">${displayName}</div>
        <div class="hero-team">${displayTeam}</div>
        <div class="hero-stat">${statVal} <span class="hero-stat-label">${statLabel}</span></div>
      </div>`;
  }

  /* ── Match-level fun heroes (from PDF-extracted data) ── */
  /* Build a tied-object from a sorted [name, {n, team}][] entry-list */
  function matchTiedFromMap(sortedEntries) {
    if (!sortedEntries.length) return { val: 0, players: [] };
    const best = sortedEntries[0][1].n;
    if (best <= 0) return { val: 0, players: [] };
    const tied = sortedEntries.filter(([, d]) => d.n === best);
    return {
      val: best,
      players: tied.map(([name, d]) => ({ name, team_name: d.team }))
    };
  }

  const _emptyTied  = { val: 0, players: [] };

  /* ── MOM from match_meta (official CricHeroes award) ── */
  let tMOM = _emptyTied;
  {
    const momMap = {};
    (state.matchMeta || []).forEach(m => {
      const p = (m.man_of_match || '').trim(); if (!p) return;
      if (!momMap[p]) momMap[p] = { n: 0, team: m.man_of_match_team || '' };
      momMap[p].n++;
    });
    tMOM = matchTiedFromMap(Object.entries(momMap).sort((a, b) => b[1].n - a[1].n));
  }

  /* ── Best Batter / Best Bowler counts (per match) ── */
  let tBestBatCount = _emptyTied, tBestBowlCount = _emptyTied;

  if (matchBatting?.length) {
    const allMatchIds = [...new Set(matchBatting.map(r => String(r.match_id)))];

    /* Best Batter per match: most runs in that match */
    const bestBatMap = {};
    allMatchIds.forEach(mid => {
      const rows = matchBatting.filter(r => String(r.match_id) === mid);
      const max  = Math.max(...rows.map(r => num(r.runs)));
      rows.filter(r => num(r.runs) === max).forEach(r => {
        const p = (r.player || '').trim(); if (!p) return;
        if (!bestBatMap[p]) bestBatMap[p] = { n: 0, team: r.batting_team };
        bestBatMap[p].n++;
      });
    });
    tBestBatCount = matchTiedFromMap(Object.entries(bestBatMap).sort((a,b) => b[1].n - a[1].n));

    /* Best Bowler per match: most wickets in that match */
    if (matchBowling?.length) {
      const allBowlIds = [...new Set(matchBowling.map(r => String(r.match_id)))];
      const bestBowlMap = {};
      allBowlIds.forEach(mid => {
        const rows = matchBowling.filter(r => String(r.match_id) === mid);
        const max  = Math.max(...rows.map(r => num(r.wickets)));
        if (max <= 0) return;
        rows.filter(r => num(r.wickets) === max).forEach(r => {
          const p = (r.player || '').trim(); if (!p) return;
          if (!bestBowlMap[p]) bestBowlMap[p] = { n: 0, team: r.bowling_team };
          bestBowlMap[p].n++;
        });
      });
      tBestBowlCount = matchTiedFromMap(Object.entries(bestBowlMap).sort((a,b) => b[1].n - a[1].n));
    }

  }

  grid.innerHTML =
    /* Row 1 — Match awards */
    heroCard('🏅', 'Man of the Match',  tMOM,          null,          'team_name',   'times MOM', 'hero-card-mom') +
    heroCard('🏏', 'Best Batter',       tBestBatCount, null,          'team_name',   'times top scorer') +
    heroCard('🎳', 'Best Bowler',       tBestBowlCount,null,          'team_name',   'times top wicket taker') +
    /* Row 2 — Season totals */
    heroCard('📊', 'Most Runs',         tBat,          null,          'team_name',   'runs') +
    heroCard('🎯', 'Most Wickets',      tBowl,         null,          'team_name',   'wickets') +
    heroCard('🧤', 'Top Fielder',       tField,        null,          'team_name',   'dismissals') +
    heroCard('🏆', 'Season MVP',        tMvp,          'Player Name', 'Team Name',   'pts') +
    /* Row 3 — Batting specials */
    heroCard('💥', 'Six Machine',       tSixes,        null,          'team_name',   'sixes') +
    heroCard('⏱️', 'Most Balls Faced',  tBalls,        null,          'team_name',   'balls') +
    /* Row 4 — Bowling specials */
    heroCard('🔒', 'Dot Ball King',     tDots,         null,          'team_name',   'dots bowled') +
    heroCard('🎖️', 'Maiden Master',    tMaiden,       null,          'team_name',   'maidens') +
    heroCard('⚡', 'Best Bowl SR',      tBowlSR,       null,          'team_name',   'SR') +
    heroCard('🏃', 'Workhorse',         tOvers,        null,          'team_name',   'overs') +
    /* Row 5 — Fielding specials */
    heroCard('🙌', 'Catch King',        tCatches,      null,          'team_name',   'catches') +
    heroCard('🚀', 'Run Out Hero',      tRunOut,       null,          'team_name',   'run outs');
}

/* ══════════════════════════════════════════════════════
   G. Fun Awards & Season Records
   ══════════════════════════════════════════════════════ */

function _awardCard(icon, title, player, team, value, detail, color) {
  const badge = team
    ? `<span class="award-team-badge ${teamChipClass(team)}">${teamShort(team)}</span>`
    : '';
  const names = (player || '—').split(' & ').map(n => n.trim()).filter(Boolean);
  let nameHTML;
  if (names.length <= 1) {
    /* Single player — normal */
    nameHTML = `<div class="award-player">${esc(names[0] || '—')}</div>`;
  } else if (names.length <= 4) {
    /* 2–4 players — two per line */
    const lines = [];
    for (let i = 0; i < names.length; i += 2)
      lines.push(names.slice(i, i + 2).map(n => esc(n)).join(' &amp; '));
    nameHTML = `<div class="award-player award-player-sm">${lines.join('<br>')}</div>`;
  } else {
    /* 5+ tied — show count badge + scrollable pill list */
    const pills = names.map(n => `<span class="award-tied-pill">${esc(n)}</span>`).join('');
    nameHTML = `
      <div class="award-player award-player-tied">
        <span class="award-tied-badge">${names.length} Tied</span>
      </div>
      <div class="award-tied-list">${pills}</div>`;
  }
  return `<div class="award-card ${color}">
    <div class="award-icon">${icon}</div>
    <div class="award-title">${title}</div>
    ${nameHTML}
    ${badge}
    <div class="award-value">${value}</div>
    <div class="award-detail">${detail}</div>
  </div>`;
}

function renderFunAwards(matchBatting, matchBowling) {
  const grid = document.getElementById('funAwardsGrid');
  if (!grid) return;
  if (!matchBatting?.length || !matchBowling?.length) {
    grid.innerHTML = '<p class="sc-placeholder">Extracting scorecard data…</p>'; return;
  }

  /* Man of the Match tally */
  // MOM award is shown in Top Heroes — not duplicated here.

  /* Run-outs suffered */
  const runOutMap = {};
  matchBatting.forEach(r => {
    if ((r.dismissal_type || '') !== 'run_out') return;
    const p = r.player; if (!p) return;
    if (!runOutMap[p]) runOutMap[p] = { n: 0, team: r.batting_team };
    runOutMap[p].n++;
  });
  const roSorted = Object.entries(runOutMap).sort((a,b) => b[1].n - a[1].n);
  const roBest   = roSorted[0]?.[1]?.n || 0;
  const roTied   = roSorted.filter(([,d]) => d.n === roBest);
  const roName   = roTied.map(([n]) => n).join(' & ') || '—';
  const roD      = roTied[0]?.[1] || { n: 0, team: '' };

  /* Ducks */
  const duckMap = {};
  matchBatting.forEach(r => {
    const dt = (r.dismissal_type || '').toLowerCase();
    if (parseInt(r.runs) !== 0 || dt === 'not_out' || dt === '') return;
    const p = r.player; if (!p) return;
    if (!duckMap[p]) duckMap[p] = { n: 0, team: r.batting_team };
    duckMap[p].n++;
  });
  const dkSorted = Object.entries(duckMap).sort((a,b) => b[1].n - a[1].n);
  const dkBest   = dkSorted[0]?.[1]?.n || 0;
  const dkTied   = dkSorted.filter(([,d]) => d.n === dkBest);
  const dkName   = dkTied.map(([n]) => n).join(' & ') || '—';
  const dkD      = dkTied[0]?.[1] || { n: 0, team: '' };

  /* Most wides season total */
  const wideMap = {};
  matchBowling.forEach(r => {
    const p = r.player; if (!p) return;
    if (!wideMap[p]) wideMap[p] = { n: 0, team: r.bowling_team };
    wideMap[p].n += parseInt(r.wides) || 0;
  });
  const wdSorted = Object.entries(wideMap).sort((a,b) => b[1].n - a[1].n);
  const wdBest   = wdSorted[0]?.[1]?.n || 0;
  const wdTied   = wdSorted.filter(([,d]) => d.n === wdBest);
  const wdName   = wdTied.map(([n]) => n).join(' & ') || '—';
  const wdD      = wdTied[0]?.[1] || { n: 0, team: '' };

  /* Most no-balls */
  const nbMap = {};
  matchBowling.forEach(r => {
    const p = r.player; if (!p) return;
    if (!nbMap[p]) nbMap[p] = { n: 0, team: r.bowling_team };
    nbMap[p].n += parseInt(r.no_balls) || 0;
  });
  const nbSorted = Object.entries(nbMap).sort((a,b) => b[1].n - a[1].n);
  const nbBest   = nbSorted[0]?.[1]?.n || 0;
  const nbTied   = nbSorted.filter(([,d]) => d.n === nbBest);
  const nbName   = nbTied.map(([n]) => n).join(' & ') || '—';
  const nbD      = nbTied[0]?.[1] || { n: 0, team: '' };

  /* Dot Absorber: most dot balls faced as batsman (balls - non-boundary scoring approx) */
  const dotAbsMap = {};
  matchBatting.forEach(r => {
    const p = r.player; if (!p) return;
    const dots = Math.max(0,
      (parseInt(r.balls)||0) - ((parseInt(r.runs)||0) - 3*(parseInt(r.fours)||0) - 5*(parseInt(r.sixes)||0))
    );
    if (!dotAbsMap[p]) dotAbsMap[p] = { n: 0, team: r.batting_team };
    dotAbsMap[p].n += dots;
  });
  const daSorted = Object.entries(dotAbsMap).sort((a,b) => b[1].n - a[1].n);
  const daBest   = daSorted[0]?.[1]?.n || 0;
  const daTied   = daSorted.filter(([,d]) => d.n === daBest);
  const daName   = daTied.map(([n]) => n).join(' & ') || '—';
  const daD      = daTied[0]?.[1] || { n: 0, team: '' };

  /* Run-out caller (partner during run-outs) */
  const callerSorted = matchBatting ? (() => {
    const pEvents = inferRunOutPartnerships(matchBatting);
    const cMap = {};
    pEvents.forEach(e => {
      const p = e.partner; if (!p || p === '?') return;
      if (!cMap[p]) cMap[p] = { n: 0, team: e.partnerTeam };
      cMap[p].n++;
    });
    return Object.entries(cMap).sort((a,b) => b[1].n - a[1].n);
  })() : [];
  const callerBest  = callerSorted[0]?.[1]?.n || 0;
  const callerTied  = callerSorted.filter(([,d]) => d.n === callerBest);
  const callerName  = callerTied.map(([n]) => n).join(' & ') || '—';
  const callerD     = callerTied[0]?.[1] || { n: 0, team: '' };

  /* Fielder's Friend: batsman dismissed caught the most */
  const ffMap = {};
  matchBatting.forEach(r => {
    if ((r.dismissal_type || '') !== 'caught') return;
    const p = (r.player || '').trim(); if (!p) return;
    if (!ffMap[p]) ffMap[p] = { n: 0, team: r.batting_team };
    ffMap[p].n++;
  });
  const ffSorted = Object.entries(ffMap).sort((a,b) => b[1].n - a[1].n);
  const ffBest   = ffSorted[0]?.[1]?.n || 0;
  const ffTied   = ffSorted.filter(([,d]) => d.n === ffBest);
  const ffName   = ffTied.map(([n]) => n).join(' & ') || '—';
  const ffD      = ffTied[0]?.[1] || { n: 0, team: '' };

  /* Boundary Painter: bowler who conceded most fours in the season */
  const bpMap = {};
  matchBowling.forEach(r => {
    const p = (r.player || '').trim(); if (!p) return;
    if (!bpMap[p]) bpMap[p] = { n: 0, team: r.bowling_team };
    bpMap[p].n += parseInt(r.fours_conceded) || 0;
  });
  const bpSorted = Object.entries(bpMap).sort((a,b) => b[1].n - a[1].n);
  const bpBest   = bpSorted[0]?.[1]?.n || 0;
  const bpTied   = bpSorted.filter(([,d]) => d.n === bpBest);
  const bpName   = bpTied.map(([n]) => n).join(' & ') || '—';
  const bpD      = bpTied[0]?.[1] || { n: 0, team: '' };

  /* Bogey Bowler: batsman dismissed most times by the same bowler / fielder */
  const nemesisMap = {};
  matchBatting.forEach(r => {
    const dt = (r.dismissal_type || '');
    const db = (r.dismissed_by || '').trim();
    if (!db || dt === 'not_out' || dt === 'retired_hurt' || dt === '' || dt === 'unknown') return;
    const p = (r.player || '').trim(); if (!p) return;
    const key = p + '||' + db;
    if (!nemesisMap[key]) nemesisMap[key] = { n: 0, batter: p, dismisser: db, team: r.batting_team };
    nemesisMap[key].n++;
  });
  const nemSorted  = Object.entries(nemesisMap).sort((a,b) => b[1].n - a[1].n);
  const nemBest    = nemSorted[0]?.[1]?.n || 0;
  const nemTied    = nemSorted.filter(([,d]) => d.n === nemBest);
  const nemName    = nemTied.map(([,d]) => d.batter).join(' & ') || '—';
  const nemD       = nemTied[0]?.[1] || { n: 0, team: '', dismisser: '—' };
  const nemDetail  = `times dismissed by ${nemD.dismisser}`;

  /* Six-O-Matic: bowler who conceded the most sixes this season */
  const sixConcMap = {};
  matchBowling.forEach(r => {
    const p = (r.player || '').trim(); if (!p) return;
    if (!sixConcMap[p]) sixConcMap[p] = { n: 0, team: r.bowling_team };
    sixConcMap[p].n += parseInt(r.sixes_conceded) || 0;
  });
  const scSorted = Object.entries(sixConcMap).sort((a,b) => b[1].n - a[1].n);
  const scBest   = scSorted[0]?.[1]?.n || 0;
  const scTied   = scSorted.filter(([,d]) => d.n === scBest);
  const scName   = scTied.map(([n]) => n).join(' & ') || '—';
  const scD      = scTied[0]?.[1] || { n: 0, team: '' };

  /* Slowcoach: lowest batting strike rate (season total, min 20 balls) */
  const srTotMap = {};
  matchBatting.forEach(r => {
    const p = (r.player || '').trim(); if (!p) return;
    if (!srTotMap[p]) srTotMap[p] = { runs: 0, balls: 0, team: r.batting_team };
    srTotMap[p].runs  += parseInt(r.runs)  || 0;
    srTotMap[p].balls += parseInt(r.balls) || 0;
  });
  const slowList = Object.entries(srTotMap)
    .filter(([, d]) => d.balls >= 20)
    .map(([name, d]) => [name, { n: Math.round((d.runs / d.balls) * 1000) / 10, team: d.team }])
    .sort((a, b) => a[1].n - b[1].n);   // ascending — lowest SR first
  const slowBest = slowList[0]?.[1]?.n ?? null;
  const slowTied = slowBest !== null ? slowList.filter(([, d]) => d.n === slowBest) : [];
  const slowName = slowTied.map(([n]) => n).join(' & ') || '—';
  const slowD    = slowTied[0]?.[1] || { n: 0, team: '' };

  grid.innerHTML =
    _awardCard('🏃', 'Run-Out Magnet',      roName,     roD.team,     roD.n,     'times run out this season',    'c-danger') +
    _awardCard('📞', 'Run-Out Caller',       callerName, callerD.team, callerBest,'times at crease when partner was run out', 'c-danger') +
    _awardCard('🦆', 'Duck King',            dkName,     dkD.team,     dkD.n,     'dismissed for zero',            'c-warning') +
    _awardCard('💨', 'Wide Man',             wdName,     wdD.team,     wdD.n,     'wides bowled this season',      'c-warning') +
    _awardCard('⚾', 'No-Ball King',         nbName,     nbD.team,     nbD.n,     'no-balls this season',          'c-info') +
    _awardCard('🧱', 'Dot Absorber',         daName,     daD.team,     daBest,    'dot balls faced as batsman',    'c-info') +
    _awardCard('😈', 'Bogey Bowler',         nemName,    nemD.team,    nemBest,   nemDetail,                       'c-danger') +
    _awardCard('🍭', 'Six-O-Matic',         scName,     scD.team,     scBest,    'sixes conceded this season',    'c-warning') +
    _awardCard('🐢', 'Slowcoach',           slowName,   slowD.team,   slowBest ?? '—', 'strike rate (min 20 balls)', 'c-info') +
    _awardCard('🕸️', "Fielder's Friend",    ffName,     ffD.team,     ffBest,    'times dismissed caught',        'c-warning') +
    _awardCard('🎨', 'Boundary Painter',    bpName,     bpD.team,     bpBest,    'fours conceded this season',    'c-info');
}

/* ══════════════════════════════════════════════════════
   Running Awards — derived from ball-by-ball CSV
   ══════════════════════════════════════════════════════ */

function renderRunningAwards(balls) {
  const grid = document.getElementById('funAwardsGrid');
  if (!grid || !balls?.length) return;

  /* Aggregate per batsman */
  const map = {};
  balls.forEach(b => {
    const bat   = (b.batsman || '').trim(); if (!bat) return;
    const run   = parseInt(b.run) || 0;
    const extra = (b.extra_type || '').trim();
    const isWide = extra === 'WD';

    if (!map[bat]) map[bat] = { singles: 0, doubles: 0, totalRuns: 0, balls: 0, runRuns: 0, team: b.batting_team };
    const d = map[bat];

    /* Only off-bat deliveries contribute to running runs */
    if (extra === '') {
      d.totalRuns += run;
      if (run === 1) d.singles++;
      if (run === 2) d.doubles++;
      if (run === 1 || run === 2 || run === 3) d.runRuns += run;
    }
    /* Balls faced: every delivery except wides */
    if (!isWide) d.balls++;
  });

  /* Singles King: most singles */
  const singlesArr = Object.entries(map).sort((a, b) => b[1].singles - a[1].singles);
  const singlesKing = singlesArr[0] || null;
  const singlesVal  = singlesKing?.[1]?.singles || 0;
  const singlesName = singlesArr.filter(([,d]) => d.singles === singlesVal).map(([n]) => n).join(' & ') || '—';
  const singlesTeam = singlesArr.filter(([,d]) => d.singles === singlesVal)[0]?.[1]?.team || '';

  /* Quick Hands: highest singles rate % (min 20 balls) */
  const srArr = Object.entries(map)
    .filter(([, d]) => d.balls >= 20)
    .map(([n, d]) => [n, { pct: d.balls > 0 ? (d.singles / d.balls * 100) : 0, team: d.team }])
    .sort((a, b) => b[1].pct - a[1].pct);
  const qhBest = srArr[0] || null;
  const qhVal  = qhBest ? Math.round(qhBest[1].pct) : 0;
  const qhName = srArr.filter(([,d]) => Math.round(d.pct) === qhVal).map(([n]) => n).join(' & ') || '—';
  const qhTeam = srArr.filter(([,d]) => Math.round(d.pct) === qhVal)[0]?.[1]?.team || '';

  /* Doubles Dynamo: most doubles */
  const doubArr = Object.entries(map).sort((a, b) => b[1].doubles - a[1].doubles);
  const doubVal  = doubArr[0]?.[1]?.doubles || 0;
  const doubName = doubArr.filter(([,d]) => d.doubles === doubVal).map(([n]) => n).join(' & ') || '—';
  const doubTeam = doubArr.filter(([,d]) => d.doubles === doubVal)[0]?.[1]?.team || '';

  /* Running Machine: highest % of runs from running (singles+2s) vs total runs (min 20 total runs) */
  const rmArr = Object.entries(map)
    .filter(([, d]) => d.totalRuns >= 20)
    .map(([n, d]) => [n, { pct: d.totalRuns > 0 ? (d.runRuns / d.totalRuns * 100) : 0, team: d.team }])
    .sort((a, b) => b[1].pct - a[1].pct);
  const rmBest = rmArr[0] || null;
  const rmVal  = rmBest ? Math.round(rmBest[1].pct) : 0;
  const rmName = rmArr.filter(([,d]) => Math.round(d.pct) === rmVal).map(([n]) => n).join(' & ') || '—';
  const rmTeam = rmArr.filter(([,d]) => Math.round(d.pct) === rmVal)[0]?.[1]?.team || '';

  grid.innerHTML +=
    _awardCard('1️⃣', 'Singles King',     singlesName, singlesTeam, singlesVal,  'singles taken this season',            'c-info') +
    _awardCard('👐', 'Quick Hands',       qhName,      qhTeam,      `${qhVal}%`, 'singles per ball (min 20 balls)',       'c-success') +
    _awardCard('2️⃣', 'Doubles Dynamo',   doubName,    doubTeam,    doubVal,     'doubles taken this season',            'c-success') +
    _awardCard('🏃', 'Running Machine',   rmName,      rmTeam,      `${rmVal}%`, '% runs from running (min 20 runs)',     'c-success');
}

/* ══════════════════════════════════════════════════════
   Ball Insights — over-by-over, bowler dist, worm chart
   ══════════════════════════════════════════════════════ */

function renderBallInsights(balls, matchMeta) {
  /* Show partial-data banner if ball CSV covers fewer matches than total */
  const ballSection = document.getElementById('ball-insights-heading')?.closest('section');
  const existingBanner = ballSection?.querySelector('.ball-data-notice');
  if (existingBanner) existingBanner.remove();

  if (balls?.length && ballSection) {
    const ballMatchCount  = new Set(balls.map(b => b.match_id)).size;
    const totalMatchCount = (matchMeta || []).filter(m => m.winner).length;
    if (ballMatchCount < totalMatchCount) {
      const notice = document.createElement('div');
      notice.className = 'ball-data-notice';
      notice.style.cssText = 'margin:0 0 12px;padding:8px 12px;background:#fff8e1;border-left:3px solid #f9a825;border-radius:4px;font-size:12px;color:#5d4037;';
      notice.innerHTML = `⚠️ Ball-by-ball data available for <strong>${ballMatchCount} of ${totalMatchCount}</strong> matches — charts below reflect those matches only.`;
      ballSection.querySelector('.section-header').after(notice);
    }
  }

  if (!balls?.length) return;
  renderOverByOverChart(balls);
  renderBowlerScoringDistChart(balls);
  renderDeathOverCharts(balls);
  renderWinMarginChart(matchMeta);
}

function renderOverByOverChart(balls) {
  const ctx = document.getElementById('overByOverChart');
  if (!ctx) return;

  /* Determine max over number from data (handles T10 and T12 matches) */
  const maxOv = balls.reduce((mx, b) => {
    const ov = parseInt((b.over_ball || '').toString().split('.')[0]);
    return ov > mx ? ov : mx;
  }, 10);

  /* Aggregate runs and dots per over number across all matches/innings */
  const overRuns  = Array(maxOv).fill(0);
  const overDots  = Array(maxOv).fill(0);
  const overBalls = Array(maxOv).fill(0);

  balls.forEach(b => {
    const ob = (b.over_ball || '').toString();
    const overIdx = parseInt(ob.split('.')[0]) - 1;
    if (overIdx < 0 || overIdx >= maxOv) return;
    const run = (parseInt(b.run) || 0) + (parseInt(b.extra_run) || 0);
    overRuns[overIdx]  += run;
    if ((b.extra_type || '') !== 'WD') overBalls[overIdx]++;
    if (b.is_dot_ball === '1' || b.is_dot_ball === true || b.is_dot_ball === 1) overDots[overIdx]++;
  });

  const labels   = Array.from({ length: maxOv }, (_, i) => `Over ${i + 1}`);
  const avgRPO   = overBalls.map((b, i) => b > 0 ? +(overRuns[i] / (b / 6)).toFixed(2) : 0);
  const dotPct   = overBalls.map((b, i) => b > 0 ? Math.round(overDots[i] / b * 100) : 0);

  if (charts.overByOver) charts.overByOver.destroy();
  charts.overByOver = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar',
          label: 'Avg Runs/Over',
          data: avgRPO,
          backgroundColor: 'rgba(25,118,210,0.60)',
          borderColor: '#1976d2',
          borderWidth: 1,
          yAxisID: 'yRuns',
          order: 2,
        },
        {
          type: 'line',
          label: 'Dot Ball %',
          data: dotPct,
          borderColor: '#e53935',
          backgroundColor: 'rgba(229,57,53,0.12)',
          tension: 0.3,
          pointRadius: 4,
          yAxisID: 'yDot',
          order: 1,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        yRuns: { position: 'left',  title: { display: true, text: 'Avg RPO' }, beginAtZero: true },
        yDot:  { position: 'right', title: { display: true, text: 'Dot %'  }, beginAtZero: true, max: 100,
                 grid: { drawOnChartArea: false } }
      }
    }
  });
}

function renderBowlerScoringDistChart(balls) {
  const ctx = document.getElementById('scoringDistChart');
  if (!ctx) return;

  /* Per bowler: count dot, single, 2s, boundary (4/6) deliveries */
  const bowlerMap = {};
  balls.forEach(b => {
    const bowler = (b.bowler || '').trim(); if (!bowler) return;
    const run    = parseInt(b.run) || 0;
    const extra  = (b.extra_type || '').trim();
    if (!bowlerMap[bowler]) bowlerMap[bowler] = { dots: 0, ones: 0, twos: 0, bdry: 0, total: 0 };
    const d = bowlerMap[bowler];
    if (extra === 'WD') return;   /* skip wides for distribution */
    d.total++;
    if (b.is_dot_ball === '1' || b.is_dot_ball === 1) d.dots++;
    else if (run === 1 && extra === '') d.ones++;
    else if (run === 2 && extra === '') d.twos++;
    else if (run === 4 || run === 6) d.bdry++;
  });

  /* Only bowlers with at least 12 balls */
  const entries = Object.entries(bowlerMap).filter(([, d]) => d.total >= 12);
  /* Sort by dot% descending */
  entries.sort((a, b) => (b[1].dots / b[1].total) - (a[1].dots / a[1].total));

  const labels   = entries.map(([n]) => n.split(' ')[0]);  /* first name only for space */
  const dotPct   = entries.map(([, d]) => +(d.dots  / d.total * 100).toFixed(1));
  const onesPct  = entries.map(([, d]) => +(d.ones  / d.total * 100).toFixed(1));
  const twosPct  = entries.map(([, d]) => +(d.twos  / d.total * 100).toFixed(1));
  const bdryPct  = entries.map(([, d]) => +(d.bdry  / d.total * 100).toFixed(1));

  if (charts.scoringDist) charts.scoringDist.destroy();
  charts.scoringDist = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Dots %',       data: dotPct,  backgroundColor: '#5c6bc0' },
        { label: 'Singles %',    data: onesPct, backgroundColor: '#29b6f6' },
        { label: 'Twos %',       data: twosPct, backgroundColor: '#66bb6a' },
        { label: 'Boundaries %', data: bdryPct, backgroundColor: '#ef5350' },
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' }, tooltip: { callbacks: {
        label: ctx => `${ctx.dataset.label}: ${ctx.raw}%`
      }}},
      scales: {
        x: { stacked: true, max: 100, title: { display: true, text: '% of deliveries' } },
        y: { stacked: true }
      }
    }
  });
}

function renderDeathOverCharts(balls) {
  const ctx = document.getElementById('deathOverBowlChart');
  if (!ctx) return;

  /* Death overs = last 5 overs (dynamically computed) */
  const maxOvD = balls.reduce((mx, b) => {
    const ov = parseInt((b.over_ball || '').toString().split('.')[0]);
    return ov > mx ? ov : mx;
  }, 10);
  const deathBalls = balls.filter(b => {
    const ov = parseInt((b.over_ball || '').toString().split('.')[0]);
    return ov >= maxOvD - 4;
  });

  const bMap = {};
  deathBalls.forEach(b => {
    const bowler = (b.bowler || '').trim(); if (!bowler) return;
    const run    = (parseInt(b.run) || 0) + (parseInt(b.extra_run) || 0);
    const extra  = (b.extra_type || '').trim();
    if (!bMap[bowler]) bMap[bowler] = { runs: 0, balls: 0, dots: 0, team: '' };
    const d = bMap[bowler];
    d.runs += run;
    if (extra !== 'WD') { d.balls++; if (b.is_dot_ball === '1' || b.is_dot_ball === 1) d.dots++; }
  });

  const entries = Object.entries(bMap)
    .filter(([, d]) => d.balls >= 6)
    .map(([n, d]) => [n, {
      eco:     d.balls > 0 ? +(d.runs / (d.balls / 6)).toFixed(2) : 0,
      dotPct:  d.balls > 0 ? Math.round(d.dots / d.balls * 100) : 0,
    }])
    .sort((a, b) => a[1].eco - b[1].eco);  /* best economy first */

  if (!entries.length) return;

  const labels  = entries.map(([n]) => n.split(' ')[0]);
  const ecoData = entries.map(([, d]) => d.eco);
  const dotData = entries.map(([, d]) => d.dotPct);

  if (charts.deathOverBowl) charts.deathOverBowl.destroy();
  charts.deathOverBowl = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: 'bar', label: 'Economy (death overs)',
          data: ecoData, backgroundColor: 'rgba(25,118,210,0.65)', yAxisID: 'yEco', order: 2
        },
        {
          type: 'line', label: 'Dot %',
          data: dotData, borderColor: '#e53935', backgroundColor: 'rgba(229,57,53,0.1)',
          tension: 0.3, pointRadius: 4, yAxisID: 'yDot', order: 1
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        yEco: { position: 'left',  title: { display: true, text: 'Economy' }, beginAtZero: true },
        yDot: { position: 'right', title: { display: true, text: 'Dot %'  }, beginAtZero: true, max: 100,
                grid: { drawOnChartArea: false } }
      }
    }
  });
}

function renderWinMarginChart(matchMeta) {
  const ctx = document.getElementById('winMarginChart');
  if (!ctx || !matchMeta?.length) return;

  /* Extract numeric margin from margin string like "5 runs" or "3 wickets" */
  const parsed = matchMeta
    .filter(m => m.margin)
    .map(m => {
      const numMatch = (m.margin || '').match(/(\d+)/);
      const val      = numMatch ? parseInt(numMatch[1]) : 0;
      const byRuns   = (m.margin || '').toLowerCase().includes('run');
      return { date: m.match_date, winner: m.winner, val, byRuns, label: m.margin };
    })
    .filter(m => m.val > 0)
    .sort((a, b) => new Date(a.date) - new Date(b.date));

  if (!parsed.length) return;

  /* Separate runs-wins and wickets-wins onto dual Y-axes to avoid unit mixing */
  const runsData   = parsed.map(m => m.byRuns  ? m.val : null);
  const wktsData   = parsed.map(m => !m.byRuns ? m.val : null);

  if (charts.winMargin) charts.winMargin.destroy();
  charts.winMargin = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: parsed.map((_m, i) => `M${i + 1}`),
      datasets: [
        {
          label: 'Won by Runs',
          data:  runsData,
          backgroundColor: parsed.map(m => (getTeam(m.winner || '') || {colors: {bg: 'rgba(56,126,209,0.70)'}}).colors.bg.replace('0.70','0.75')),
          borderColor:     parsed.map(m => (getTeam(m.winner || '') || {colors: {border: '#387ed1'}}).colors.border),
          borderWidth: 1,
          yAxisID: 'yRuns',
        },
        {
          label: 'Won by Wickets',
          data:  wktsData,
          backgroundColor: parsed.map(m => (getTeam(m.winner || '') || {colors: {bg: 'rgba(56,126,209,0.70)'}}).colors.bg.replace('0.70','0.35')),
          borderColor:     parsed.map(m => (getTeam(m.winner || '') || {colors: {border: '#387ed1'}}).colors.border),
          borderWidth: 1,
          borderDash: [4, 4],
          yAxisID: 'yWkts',
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'bottom', labels: { font: { size: 11 }, boxWidth: 12, padding: 10 } },
        tooltip: { callbacks: {
          title: (items) => {
            const m = parsed[items[0].dataIndex];
            return `${m.winner || 'Winner'} — ${m.date || ''}`;
          },
          label: (item) => {
            const m = parsed[item.dataIndex];
            return `Margin: ${m.label}`;
          }
        }}
      },
      scales: {
        yRuns: { position: 'left',  title: { display: true, text: 'Runs' },    beginAtZero: true, grid: { color: '#f0f3f5' } },
        yWkts: { position: 'right', title: { display: true, text: 'Wickets' }, beginAtZero: true, max: 10,
                 grid: { drawOnChartArea: false } }
      }
    }
  });
}

function renderMatchWorm(balls, matchId, matchMeta) {
  const wrap = document.getElementById('wormChartWrap');
  const ctx  = document.getElementById('wormChart');
  if (!wrap || !ctx) return;

  if (!balls?.length || !matchId) { wrap.style.display = 'none'; return; }

  const matchBalls = balls.filter(b => String(b.match_id) === String(matchId));
  if (!matchBalls.length) { wrap.style.display = 'none'; return; }

  /* Resolve team names for legend from match meta */
  const meta  = (matchMeta || []).find(m => String(m.match_id) === String(matchId));
  const team1 = meta?.innings1_team
    ? teamShort(meta.innings1_team) + ' (1st inn)'
    : '1st Innings';
  const team2 = meta?.innings2_team
    ? teamShort(meta.innings2_team) + ' (2nd inn)'
    : '2nd Innings';

  /* Group by innings */
  function buildWorm(inningsNum) {
    const inn = matchBalls
      .filter(b => String(b.innings) === String(inningsNum))
      .slice()  /* preserve order — CSV is newest-first, so reverse */
      .reverse();

    let cum = 0;
    const points = [{ ball: 0, runs: 0 }];
    inn.forEach(b => {
      const run = (parseInt(b.run) || 0) + (parseInt(b.extra_run) || 0);
      const extra = (b.extra_type || '').trim();
      if (extra !== 'WD') { /* legal delivery advances ball count */
        cum += run;
        points.push({ ball: points.length, runs: cum });
      }
    });
    return points;
  }

  const worm1 = buildWorm(1);
  const worm2 = buildWorm(2);
  const maxBalls = Math.max(worm1.length, worm2.length);

  if (charts.worm) charts.worm.destroy();
  charts.worm = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array.from({ length: maxBalls }, (_, i) => i),
      datasets: [
        {
          label: team1,
          data:  worm1.map(p => p.runs),
          borderColor: '#1976d2', backgroundColor: 'rgba(25,118,210,0.08)',
          tension: 0.2, pointRadius: 0, fill: false,
        },
        {
          label: team2,
          data:  worm2.map(p => p.runs),
          borderColor: '#e53935', backgroundColor: 'rgba(229,57,53,0.08)',
          tension: 0.2, pointRadius: 0, fill: false,
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: 'top' } },
      scales: {
        x: { title: { display: true, text: 'Ball number' } },
        y: { title: { display: true, text: 'Cumulative runs' }, beginAtZero: true }
      }
    }
  });

  wrap.style.display = '';
}

function renderMatchRecords(matchBatting, matchBowling, matchMeta) {
  const grid = document.getElementById('matchRecordsGrid');
  if (!grid) return;
  if (!matchBatting?.length || !matchBowling?.length) {
    grid.innerHTML = '<p class="sc-placeholder">Extracting scorecard data…</p>'; return;
  }

  /* ── tie-aware helper: returns { val, names, team } ── */
  function topTR(arr, valFn, teamKey) {
    if (!arr.length) return { val: 0, names: '—', team: '' };
    const sorted = [...arr].sort((a, b) => valFn(b) - valFn(a));
    const best   = valFn(sorted[0]);
    if (best <= 0) return { val: 0, names: '—', team: '' };
    const tied   = sorted.filter(r => valFn(r) === best);
    const names  = [...new Set(tied.map(r => r.player || ''))].filter(Boolean).join(' & ');
    const team   = tied[0][teamKey] || '';
    return { val: best, names, team, first: sorted[0] };
  }

  /* 1. Highest individual score in a single innings */
  const topBat        = topTR(matchBatting,  r => parseInt(r.runs)||0,           'batting_team');

  /* 2. Most sixes in a single innings */
  const topSixer      = topTR(matchBatting,  r => parseInt(r.sixes)||0,          'batting_team');

  /* 3. Most fours in a single innings */
  const topFours      = topTR(matchBatting,  r => parseInt(r.fours)||0,          'batting_team');

  /* 4. Best bowling spell: most wickets (tie-break: fewest runs) */
  const topBowlArr  = [...matchBowling].sort((a, b) => {
    const wDiff = (parseInt(b.wickets)||0) - (parseInt(a.wickets)||0);
    return wDiff !== 0 ? wDiff : (parseInt(a.runs)||0) - (parseInt(b.runs)||0);
  });
  const topBowlBest = topBowlArr[0] || {};
  const topBowlTied = topBowlArr.filter(r =>
    (parseInt(r.wickets)||0) === (parseInt(topBowlBest.wickets)||0) &&
    (parseInt(r.runs)||0)    === (parseInt(topBowlBest.runs)||0)
  );
  const topBowlNames = [...new Set(topBowlTied.map(r => r.player||''))].filter(Boolean).join(' & ');

  /* 5. Costliest spell */
  const costliest     = topTR(matchBowling,  r => parseInt(r.runs)||0,           'bowling_team');

  /* 6. Most wides in a single match spell */
  const topWideMatch  = topTR(matchBowling,  r => parseInt(r.wides)||0,          'bowling_team');

  /* 7. Most sixes conceded in a single match spell */
  const topSixesCon   = topTR(matchBowling,  r => parseInt(r.sixes_conceded)||0, 'bowling_team');

  /* 8. Most no-balls in a single match spell */
  const topNBMatch    = topTR(matchBowling,  r => parseInt(r.no_balls)||0,       'bowling_team');

  /* 9. Dot Ball Machine: most dot balls in a single spell */
  const topDotSpell   = topTR(matchBowling, r => parseInt(r.dot_balls)||0, 'bowling_team');

  /* 10. Team innings totals — used for highest & lowest */
  const inningsTotals = {};
  matchBatting.forEach(r => {
    const key = `${r.match_id}_${r.innings}_${r.batting_team}`;
    if (!inningsTotals[key]) inningsTotals[key] = { runs: 0, team: r.batting_team, date: r.match_date };
    inningsTotals[key].runs += parseInt(r.runs) || 0;
  });
  const totalsList = Object.values(inningsTotals);

  /* 11. Highest team total */
  const highSorted = [...totalsList].sort((a,b) => b.runs - a.runs);
  const highBest   = highSorted[0]?.runs || 0;
  const highTied   = highSorted.filter(t => t.runs === highBest);
  const highName   = [...new Set(highTied.map(t => t.team))].join(' & ') || '—';
  const highFirst  = highSorted[0] || {};

  /* 12. Lowest team total */
  const lowSorted  = [...totalsList].filter(t => t.runs > 0).sort((a,b) => a.runs - b.runs);
  const lowBest    = lowSorted[0]?.runs || 0;
  const lowTied    = lowSorted.filter(t => t.runs === lowBest);
  const lowName    = [...new Set(lowTied.map(t => t.team))].join(' & ') || '—';
  const lowFirst   = lowSorted[0] || {};

  /* 13. Super All-Rounder: best combined batting + bowling in a single match */
  const arMap = {};
  matchBatting.forEach(r => {
    const p = (r.player || '').trim(); if (!p) return;
    const key = `${r.match_id}_${p}`;
    if (!arMap[key]) arMap[key] = { runs: 0, wickets: 0, player: p, team: r.batting_team, date: r.match_date };
    arMap[key].runs += parseInt(r.runs) || 0;
  });
  matchBowling.forEach(r => {
    const p = (r.player || '').trim(); if (!p) return;
    const key = `${r.match_id}_${p}`;
    if (!arMap[key]) arMap[key] = { runs: 0, wickets: 0, player: p, team: r.bowling_team, date: r.match_date };
    arMap[key].wickets += parseInt(r.wickets) || 0;
  });
  const arScore   = d => d.runs + d.wickets * 15;
  const arSorted  = Object.values(arMap).filter(d => d.runs > 0 && d.wickets > 0).sort((a,b) => arScore(b) - arScore(a));
  const arBestScore = arSorted.length ? arScore(arSorted[0]) : 0;
  const arTied    = arSorted.filter(d => arScore(d) === arBestScore);
  const arName    = arTied.map(d => d.player).join(' & ') || '—';
  const arFirst   = arTied[0] || {};
  const arTeam    = arFirst.team || '';
  const arVal     = arFirst.player ? `${arFirst.runs}R+${arFirst.wickets}W` : '—';

  /* 14. Highest Runs Chased & Lowest Runs Defended — needs matchMeta */
  const matchInnTotals = {};
  matchBatting.forEach(r => {
    const key = `${r.match_id}_${String(r.innings)}`;
    if (!matchInnTotals[key]) matchInnTotals[key] = { runs: 0, team: r.batting_team, date: r.match_date };
    matchInnTotals[key].runs += parseInt(r.runs) || 0;
  });

  /* Highest chased: margin contains "wicket" → innings-2 team won */
  const chasedList = [];
  (matchMeta || []).forEach(m => {
    if (!m.margin || !m.winner) return;
    if (!String(m.margin).toLowerCase().includes('wicket')) return;
    const inn1 = matchInnTotals[`${m.match_id}_1`];
    if (inn1?.runs > 0) chasedList.push({ runs: inn1.runs, team: m.winner, date: m.match_date });
  });
  const highChaseSorted = [...chasedList].sort((a,b) => b.runs - a.runs);
  const highChaseVal    = highChaseSorted[0]?.runs || 0;
  const highChaseTied   = highChaseSorted.filter(c => c.runs === highChaseVal);
  const highChaseName   = [...new Set(highChaseTied.map(c => c.team))].join(' & ') || '—';
  const highChaseFirst  = highChaseSorted[0] || {};

  /* Lowest defended: margin contains "run" → innings-1 team won */
  const defendedList = [];
  (matchMeta || []).forEach(m => {
    if (!m.margin || !m.winner) return;
    if (!String(m.margin).toLowerCase().includes('run')) return;
    const inn1 = matchInnTotals[`${m.match_id}_1`];
    if (inn1?.runs > 0) defendedList.push({ runs: inn1.runs, team: inn1.team, date: m.match_date });
  });
  const lowDefendSorted = [...defendedList].sort((a,b) => a.runs - b.runs);
  const lowDefendVal    = lowDefendSorted[0]?.runs || 0;
  const lowDefendTied   = lowDefendSorted.filter(d => d.runs === lowDefendVal);
  const lowDefendName   = [...new Set(lowDefendTied.map(d => d.team))].join(' & ') || '—';
  const lowDefendFirst  = lowDefendSorted[0] || {};

  /* 15. Highest batting SR in a single innings (min 6 balls) */
  const topSRInnings  = topTR(
    matchBatting.filter(r => (parseInt(r.balls)||0) >= 6),
    r => parseFloat(r.strike_rate)||0,
    'batting_team'
  );

  /* 10. Best economy in a single spell (min 1 over) — lowest is best, sort ascending */
  const ecoFiltered = matchBowling.filter(r => (parseFloat(r.overs)||0) >= 1.0);
  const ecoSorted   = [...ecoFiltered].sort((a, b) => (parseFloat(a.economy)||999) - (parseFloat(b.economy)||999));
  const ecoBestVal  = parseFloat(ecoSorted[0]?.economy) ?? null;
  const ecoTied     = ecoBestVal !== null ? ecoSorted.filter(r => parseFloat(r.economy) === ecoBestVal) : [];
  const ecoNames    = [...new Set(ecoTied.map(r => r.player||''))].filter(Boolean).join(' & ') || '—';
  const ecoFirst    = ecoSorted[0] || {};

  grid.innerHTML =
    _awardCard('🏏', 'Highest Score (Match)', topBat.names, topBat.team,
      topBat.val, `${topBat.first?.balls||0} balls · ${topBat.first?.fours||0}×4 ${topBat.first?.sixes||0}×6`, 'c-success') +

    _awardCard('💥', 'Most Sixes (Innings)', topSixer.names, topSixer.team,
      topSixer.val, `${topSixer.first?.runs||0} runs that day`, 'c-success') +

    _awardCard('🔵', 'Most Fours (Innings)', topFours.names, topFours.team,
      topFours.val, `${topFours.first?.runs||0} runs that day`, 'c-info') +

    _awardCard('🎳', 'Best Bowling Spell', topBowlNames, topBowlBest.bowling_team||'',
      `${topBowlBest.wickets||0}/${topBowlBest.runs||0}`, `${topBowlBest.overs||0} overs`, 'c-info') +

    _awardCard('💸', 'Costliest Spell', costliest.names, costliest.team,
      `${costliest.val} runs`, `${costliest.first?.overs||0} ov · ${costliest.first?.wickets||0} wkts`, 'c-danger') +

    _awardCard('🌊', 'Most Wides in a Spell', topWideMatch.names, topWideMatch.team,
      topWideMatch.val, `wides in one match`, 'c-warning') +

    _awardCard('🚀', 'Most Sixes Conceded', topSixesCon.names, topSixesCon.team,
      topSixesCon.val, `sixes hit off them in one match`, 'c-warning') +

    _awardCard('⚾', 'Most No-Balls (Spell)', topNBMatch.names, topNBMatch.team,
      topNBMatch.val, `no-balls in one match`, 'c-purple') +

    _awardCard('⚡', 'Best SR (Innings)', topSRInnings.names, topSRInnings.team,
      topSRInnings.val, `${topSRInnings.first?.runs||0} runs off ${topSRInnings.first?.balls||0} balls`, 'c-success') +

    _awardCard('🔒', 'Best Economy (Spell)', ecoNames, ecoFirst.bowling_team||'',
      ecoBestVal ?? '—', `${ecoFirst.overs||0} overs · ${ecoFirst.wickets||0} wkts`, 'c-info') +

    _awardCard('⚫', 'Dot Ball Machine',     topDotSpell.names, topDotSpell.team,
      topDotSpell.val, `dots in one spell · ${topDotSpell.first?.overs||0} overs`, 'c-info') +

    _awardCard('🔥', 'Highest Team Total',   highName, highFirst.team||'',
      highBest, `runs · ${highFirst.date||''}`, 'c-success') +

    _awardCard('💀', 'Lowest Team Total',    lowName, lowFirst.team||'',
      lowBest, `runs · ${lowFirst.date||''}`, 'c-danger') +

    _awardCard('🌟', 'Super All-Rounder',    arName, arTeam,
      arVal, `in one match · ${arFirst.date||''}`, 'c-success') +

    _awardCard('🏹', 'Highest Chase',        highChaseName, highChaseFirst.team||'',
      highChaseVal, `runs chased · ${highChaseFirst.date||''}`, 'c-success') +

    _awardCard('🛡️', 'Lowest Defended',      lowDefendName, lowDefendFirst.team||'',
      lowDefendVal, `runs defended · ${lowDefendFirst.date||''}`, 'c-info');
}

function renderExtrasLeaderboard(matchBowling) {
  const canvas = document.getElementById('extrasLeaderboardChart');
  if (!canvas) return;
  if (!matchBowling?.length) { canvas.style.display = 'none'; return; }
  canvas.style.display = '';

  /* Sum wides + no-balls per bowler */
  const bowlerMap = {};
  matchBowling.forEach(r => {
    const p = r.player; if (!p) return;
    if (!bowlerMap[p]) bowlerMap[p] = { wides: 0, noBalls: 0, team: r.bowling_team };
    bowlerMap[p].wides   += parseInt(r.wides)    || 0;
    bowlerMap[p].noBalls += parseInt(r.no_balls) || 0;
  });

  const sorted = Object.entries(bowlerMap)
    .map(([name, d]) => ({ name, ...d, total: d.wides + d.noBalls }))
    .filter(b => b.total > 0)
    .sort((a,b) => b.total - a.total);


  /* Dynamic height — every bowler gets a row */
  canvas.style.height = Math.max(180, sorted.length * 28 + 60) + 'px';
  const ctx = canvas.getContext('2d');
  if (canvas._chartInstance) canvas._chartInstance.destroy();
  canvas._chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sorted.map(b => b.name),
      datasets: [
        {
          label: 'Wides',
          data: sorted.map(b => b.wides),
          backgroundColor: sorted.map(b => (getTeam(b.team)||{colors:{bg:'rgba(56,126,209,0.80)'}}).colors.bg.replace('0.70','0.8')),
          borderRadius: 4
        },
        {
          label: 'No-Balls',
          data: sorted.map(b => b.noBalls),
          backgroundColor: sorted.map(b => (getTeam(b.team)||{colors:{bg:'rgba(56,126,209,0.40)'}}).colors.bg.replace('0.70','0.4')),
          borderRadius: 4
        }
      ]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', boxWidth: 14, font: { size: 11 } } },
        tooltip: {
          callbacks: {
            afterBody: items => {
              const idx = items[0].dataIndex;
              return `Total extras: ${sorted[idx].total}`;
            }
          }
        }
      },
      scales: {
        x: { stacked: true, ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' } },
        y: { stacked: true, ticks: { color: '#cbd5e1', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
      }
    }
  });
}

/* ── Infer batting partnerships from position-order simulation ── */
function inferRunOutPartnerships(matchBatting) {
  /* Group rows by match + innings */
  const groups = {};
  (matchBatting || []).forEach(r => {
    const key = r.match_id + '||' + r.innings;
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  });

  const events = []; /* { victim, victimTeam, partner, partnerTeam, fielder, match_id, match_date } */

  Object.values(groups).forEach(rows => {
    /* Sort by batting position — this IS the order players came to bat */
    const byPos = [...rows].sort((a, b) => parseInt(a.position) - parseInt(b.position));
    if (byPos.length < 2) return;

    /* Simulate the innings forward */
    let crease = [byPos[0], byPos[1]]; /* openers */
    let nextIn  = 2;                    /* index of next batter waiting */

    byPos.forEach(batter => {
      /* Find this batter in the crease */
      const idx = crease.findIndex(c => c.player === batter.player);
      if (idx === -1) return; /* not at crease — skip (shouldn't happen in clean data) */

      const partner = crease[idx === 0 ? 1 : 0]; /* the OTHER batter */

      if (batter.dismissal_type === 'run_out') {
        events.push({
          victim:      (batter.player  || '').trim(),
          victimTeam:  batter.batting_team || '',
          partner:     (partner?.player || '?').trim(),
          partnerTeam: partner?.batting_team || batter.batting_team || '',
          fielder:     (batter.caught_by || '?').trim(),
          match_id:    batter.match_id,
          match_date:  batter.match_date || ''
        });
      }

      /* Replace dismissed batter with next in queue */
      const isOut = batter.dismissal_type &&
                    batter.dismissal_type !== 'not_out' &&
                    batter.dismissal_type !== 'retired_hurt';
      if (isOut) {
        if (nextIn < byPos.length) {
          crease[idx] = byPos[nextIn++];
        } else {
          crease.splice(idx, 1);
        }
      }
    });
  });

  return events;
}

/* ── Run-Out Deep Dive ── */
function renderRunOutAnalysis(matchBatting) {
  const victimCanvas    = document.getElementById('runOutVictimsChart');
  const enforcerCanvas  = document.getElementById('runOutEnforcersChart');
  const partnerCanvas   = document.getElementById('runOutPartnerChart');
  const pairTableWrap   = document.getElementById('runOutPairTableWrap');
  const tableWrap       = document.getElementById('runOutTableWrap');
  if (!victimCanvas || !enforcerCanvas || !tableWrap) return;

  const runOuts = (matchBatting || []).filter(r => r.dismissal_type === 'run_out');

  if (!runOuts.length) {
    tableWrap.innerHTML = '<p class="sc-placeholder">No run-out data available.</p>';
    return;
  }

  /* ── 1. Victim counts ── */
  const victimMap = {};
  runOuts.forEach(r => {
    const p = (r.player || '').trim(); if (!p) return;
    if (!victimMap[p]) victimMap[p] = { n: 0, team: r.batting_team };
    victimMap[p].n++;
  });
  const victims = Object.entries(victimMap).sort((a,b) => b[1].n - a[1].n); /* ALL victims */

  /* ── 2. Fielder (thrower) counts ── */
  const enfMap = {};
  runOuts.forEach(r => {
    const f = (r.caught_by || '').trim(); if (!f) return;
    const _batTeamEntry = getTeam(r.batting_team);
    const enfTeam = teamList().find(t => t !== _batTeamEntry)?.full || '';
    if (!enfMap[f]) enfMap[f] = { n: 0, team: enfTeam };
    enfMap[f].n++;
  });
  const enforcers = Object.entries(enfMap).sort((a,b) => b[1].n - a[1].n); /* ALL fielders */

  /* ── 3. Partnership inference ── */
  const partnershipEvents = inferRunOutPartnerships(matchBatting);

  /* How many times each player was the non-dismissed partner */
  const partnerMap = {};
  partnershipEvents.forEach(e => {
    const p = e.partner; if (!p || p === '?') return;
    if (!partnerMap[p]) partnerMap[p] = { n: 0, team: e.partnerTeam };
    partnerMap[p].n++;
  });
  const topPartners = Object.entries(partnerMap).sort((a,b) => b[1].n - a[1].n); /* ALL partners */

  /* Pair frequency: "A was running when B got out" */
  const pairMap = {};
  partnershipEvents.forEach(e => {
    if (!e.victim || !e.partner || e.partner === '?') return;
    const key = `${e.partner} → ${e.victim}`; /* Partner (caller) → Victim */
    pairMap[key] = (pairMap[key] || 0) + 1;
  });
  const topPairs = Object.entries(pairMap).sort((a,b) => b[1] - a[1]).slice(0, 15);

  /* ── Chart builder — dynamic height so ALL bars are visible ── */
  const buildHBar = (canvas, labels, data, teams, title) => {
    if (!canvas) return;
    if (canvas._chartInstance) canvas._chartInstance.destroy();
    /* 28px per bar + 60px padding — ensures every entry gets room */
    canvas.style.height = Math.max(180, labels.length * 28 + 60) + 'px';
    canvas._chartInstance = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          label: title,
          data,
          backgroundColor: teams.map(t => (getTeam(t)||{colors:{bg:'rgba(56,126,209,0.8)'}}).colors.bg.replace('0.70','0.8')),
          borderRadius: 5
        }]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} time${ctx.parsed.x !== 1 ? 's' : ''}` } }
        },
        scales: {
          x: { ticks: { color: '#94a3b8', stepSize: 1 }, grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { ticks: { color: '#cbd5e1', font: { size: 11 } }, grid: { color: 'rgba(255,255,255,0.04)' } }
        }
      }
    });
  };

  buildHBar(victimCanvas,   victims.map(([n])   => n), victims.map(([,d])   => d.n), victims.map(([,d])   => d.team), 'Times Run Out');
  buildHBar(enforcerCanvas, enforcers.map(([n]) => n), enforcers.map(([,d]) => d.n), enforcers.map(([,d]) => d.team), 'Run-Outs Fielded');
  buildHBar(partnerCanvas,  topPartners.map(([n]) => n), topPartners.map(([,d]) => d.n), topPartners.map(([,d]) => d.team), 'Times as Partner');

  /* ── Pair frequency table ── */
  if (pairTableWrap) {
    if (!topPairs.length) {
      pairTableWrap.innerHTML = '<p class="sc-placeholder">No pair data.</p>';
    } else {
      const pairRows = topPairs.map(([pair, count]) => {
        const [partnerName, victimName] = pair.split(' → ');
        const pTeam = partnerMap[partnerName]?.team || '';
        const vTeam = victimMap[victimName]?.team || '';
        const pBadge = `<span class="ro-fielder ${teamRoClass(pTeam)}">${partnerName}</span>`;
        const vBadge = `<span class="ro-fielder ${teamRoClass(vTeam)}">${victimName}</span>`;
        return `<tr>
          <td>${pBadge} called → ${vBadge} out</td>
          <td class="ro-count">${count}</td>
        </tr>`;
      }).join('');
      pairTableWrap.innerHTML = `
        <table class="ro-table">
          <thead><tr><th>Partner (caller) → Victim (run out)</th><th class="ro-count">×</th></tr></thead>
          <tbody>${pairRows}</tbody>
        </table>`;
    }
  }

  /* ── Full detail table — victim + partner + fielder ── */
  const byVictim = {};
  partnershipEvents.forEach(e => {
    if (!e.victim) return;
    if (!byVictim[e.victim]) byVictim[e.victim] = { team: e.victimTeam, events: [] };
    byVictim[e.victim].events.push(e);
  });

  const sortedV = Object.entries(byVictim).sort((a,b) => b[1].events.length - a[1].events.length);

  const detailRows = sortedV.map(([name, d]) => {
    const badge = `<span class="form-chip ${teamChipClass(d.team)}" style="font-size:0.6rem;padding:2px 5px;">${teamShort(d.team)}</span>`;
    const evList = d.events.map(e => {
      return `<span class="ro-event-pill">
        🤝 <b>${e.partner}</b> <span class="ro-fielder-sm">(partner)</span>
        · ⚡ <b>${e.fielder}</b> <span class="ro-fielder-sm">(fielder)</span>
      </span>`;
    }).join('');
    return `<tr>
      <td class="ro-victim">${name} ${badge}</td>
      <td class="ro-count">${d.events.length}</td>
      <td class="ro-fielders">${evList}</td>
    </tr>`;
  }).join('');

  tableWrap.innerHTML = `
    <table class="ro-table">
      <thead>
        <tr>
          <th>Run-Out Victim</th>
          <th class="ro-count">×</th>
          <th>Partner at Other End &amp; Fielder Who Ran Them Out</th>
        </tr>
      </thead>
      <tbody>${detailRows}</tbody>
    </table>`;
}

/* ════════════════════════════════════════════════════════ */

function renderDashboard() {
  const batting  = filterBatting();
  const bowling  = filterBowling();
  const fielding = filterFielding();
  const mvp      = filterMvp();

  renderKPIs(batting, bowling, fielding, mvp);
  renderTopHeroes(batting, bowling, fielding, mvp, state.matchBatting, state.matchBowling);
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

  /* Scorecard-dependent sections — rendered separately by renderScorecardSections()
     after background PDF extraction completes */
  renderScorecardSections();

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
    const mvpNorm = normName(r['Player Name']); if (!mvpNorm) return;
    const keys = Object.keys(playerMap);
    // 1. Normalized exact
    let match = keys.find(k => normName(k) === mvpNorm);
    // 2. Prefix (shorter side > 3 chars)
    if (!match) match = keys.find(k => {
      const kn = normName(k);
      const shorter = kn.length < mvpNorm.length ? kn : mvpNorm;
      const longer  = kn.length < mvpNorm.length ? mvpNorm : kn;
      return shorter.length > 3 && longer.startsWith(shorter);
    });
    // 3. First word only
    if (!match) match = keys.find(k => normName(k).split(' ')[0] === mvpNorm.split(' ')[0]);
    if (match) playerMap[match].mvp = r;
  });

  const allPlayers = Object.values(playerMap);
  if (!allPlayers.length) { wrap.innerHTML = '<p class="table-empty">No data for this selection.</p>'; return; }

  /* ── Sort state (persists across re-renders) ── */
  if (!renderFullStatsTable._sort) renderFullStatsTable._sort = { key: 'runs', dir: -1 };
  const sortState = renderFullStatsTable._sort;

  /* Value extractor per sort key */
  function sortVal(p, key) {
    const b = p.bat || {}, bw = p.bowl || {}, f = p.field || {}, m = p.mvp || {};
    switch (key) {
      case 'name':    return (p.name || '').toLowerCase();
      case 'team':    return (p.team || '').toLowerCase();
      case 'matches': return num(b.total_match || bw.total_match || f.total_match);
      case 'runs':    return num(b.total_runs);
      case 'hs':      return num(b.highest_run);
      case 'avg':     return num(b.average);
      case 'sr':      return num(b.strike_rate);
      case 'balls':   return num(b.ball_faced);
      case '4s':      return num(b['4s']);
      case '6s':      return num(b['6s']);
      case '50s':     return num(b['50s']);
      case 'wkts':    return num(bw.total_wickets);
      case 'overs':   return num(bw.overs);
      case 'econ':    return num(bw.economy);
      case 'bsr':     return num(bw.SR);
      case 'mdn':     return num(bw.maidens);
      case 'dots':    return num(bw.dot_balls);
      case 'ct':      return num(f.catches);
      case 'ro':      return num(f.run_outs);
      case 'st':      return num(f.stumpings);
      case 'cb':      return num(f.caught_and_bowl);
      case 'dis':     return num(f.total_dismissal);
      case 'mvp':     return num(m.Total);
      default:        return 0;
    }
  }

  const players = allPlayers.sort((a, b) => {
    const av = sortVal(a, sortState.key), bv = sortVal(b, sortState.key);
    if (typeof av === 'string') return sortState.dir * av.localeCompare(bv);
    return sortState.dir * ((bv || 0) - (av || 0));
  });

  const teamDot = t => `<span class="pt-team-dot" style="background:${teamCssVar(t)}"></span>`;
  const d = v => (v !== undefined && v !== null && v !== '' && v !== '-') ? v : '—';
  const n = (v, dec) => { const x = num(v); return x ? (dec !== undefined ? x.toFixed(dec) : x) : '—'; };
  const si = key => {
    if (sortState.key !== key) return '';
    return sortState.dir === -1 ? ' sort-desc' : ' sort-asc';
  };
  const sh = (key, label, cls = '', rowspan = 1) =>
    `<th${rowspan > 1 ? ` rowspan="${rowspan}"` : ''} class="fst-sortable${cls ? ' ' + cls : ''}${si(key)}" data-sort="${key}">${label}</th>`;

  const rows = players.map(p => {
    const b = p.bat || {}, bw = p.bowl || {}, f = p.field || {}, m = p.mvp || {};
    const tShort = teamShort(p.team);
    return `<tr>
      <td class="fst-name">${teamDot(p.team)}${esc(p.name)}</td>
      <td class="fst-team">${esc(tShort)}</td>
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
          ${sh('name',    'Player',  'fst-name-h', 2)}
          ${sh('team',    'Team',    '',           2)}
          ${sh('matches', 'M',       '',           2)}
          <th colspan="8" class="fst-group-bat">Batting</th>
          <th colspan="6" class="fst-group-bowl">Bowling</th>
          <th colspan="5" class="fst-group-field">Fielding</th>
          ${sh('mvp', 'MVP', 'fst-group-mvp', 2)}
        </tr>
        <tr>
          ${sh('runs','Runs')}${sh('hs','HS')}${sh('avg','Avg')}${sh('sr','SR')}${sh('balls','Balls')}${sh('4s','4s')}${sh('6s','6s')}${sh('50s','50s')}
          ${sh('wkts','Wkts')}${sh('overs','Ov')}${sh('econ','Econ')}${sh('bsr','BSR')}${sh('mdn','Mdn')}${sh('dots','Dots')}
          ${sh('ct','Ct')}${sh('ro','RO')}${sh('st','St')}${sh('cb','C&B')}${sh('dis','Dis')}
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;

  /* Attach sort click listeners */
  wrap.querySelectorAll('th[data-sort]').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (sortState.key === key) sortState.dir *= -1;
      else { sortState.key = key; sortState.dir = -1; }
      renderFullStatsTable(batting, bowling, fielding, mvp);
    });
  });
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

  const parsedTeams = teamList().map(t => parseTeamFromText(text, t.full.replace(/\s*\([^)]+\)/, '').trim(), t.full, t.short));
  const validTeams = parsedTeams.filter(Boolean);
  if (validTeams.length < 2) return null;

  return validTeams
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

/* ============================================================
   Scorecard PDF Auto-Extraction Engine
   Reads all 12 match PDFs at startup, parses batting + bowling
   tables, and populates state.matchBatting / matchBowling / matchMeta.

   Actual CricHeroes PDF format (confirmed from live PDFs):
   - Date:   "2026-02-22, 01:34 AM UTC"
   - Toss:   "Royal Cricket Blasters (RCB) opt to bat"
   - Result: "Weekend Warriors (WW) won by 4 wickets"
   - Page 3/4 batting rows start with position number:
       "1 PlayerName [dismissal info] R B M 4s 6s SR"
   - Bowling rows:  "1 BowlerName [(c)] O M R W 0s 4s 6s WD NB Eco"
   - Section markers: "No Batsman Status R B M 4s 6s SR"
                      "No Bowler O M R W 0s 4s 6s WD NB Eco"
   ============================================================ */

const SCORECARD_DIR = './CricHeroesStats/';

/**
 * Auto-discover all Scorecard_*.pdf files by fetching the directory listing.
 * Works with `python -m http.server` which returns an HTML directory listing.
 * Returns an array of { path, matchId } objects sorted by matchId.
 */
async function discoverScorecardPDFs() {
  try {
    const resp = await fetch(SCORECARD_DIR);
    if (!resp.ok) return [];
    const html = await resp.text();
    const found = [...html.matchAll(/href="(Scorecard_(\d+)\.pdf)"/gi)];
    return found
      .map(m => ({ path: SCORECARD_DIR + m[1], matchId: m[2] }))
      .sort((a, b) => a.matchId.localeCompare(b.matchId));
  } catch {
    return [];
  }
}

/** Group PDF text items into rows by Y coordinate (top→bottom). */
function groupIntoRows(items, tolerance = 4) {
  const rows = [];
  for (const item of items) {
    const text = item.str && item.str.trim();
    if (!text) continue;
    const y = item.transform[5];
    const x = item.transform[4];
    let row = rows.find(r => Math.abs(r.y - y) <= tolerance);
    if (!row) { row = { y, cells: [] }; rows.push(row); }
    row.cells.push({ x, text });
  }
  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x);
    row.tokens = row.cells.map(c => c.text);
    row.text   = row.tokens.join(' ');
  }
  return rows.sort((a, b) => b.y - a.y); // descending Y = top first
}

/** Remove position number prefix and role tags like (c), (wk), (RHB), †  */
function cleanPlayerName(raw) {
  return (raw || '')
    .replace(/^\d+\s+/, '')            // leading "N " position number
    .replace(/\(c\s*&\s*wk\)/gi, '')   // (c & wk)
    .replace(/\(c\)/gi, '')
    .replace(/\(wk\)/gi, '')
    .replace(/\([LR]HB\)/gi, '')
    .replace(/†/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Parse match metadata (date, toss, result) from page 1 items.
 *  Actual PDF format:
 *    Date:   "2026-02-22, 01:34 AM UTC"
 *    Toss:   "Royal Cricket Blasters (RCB) opt to bat"
 *    Result: "Weekend Warriors (WW) won by 4 wickets"
 */
function parseScorecardMeta(page1Items, matchId) {
  const rows     = groupIntoRows(page1Items);
  const fullText = rows.map(r => r.text).join(' ');

  // Date — ISO format "YYYY-MM-DD"
  let match_date = '';
  const dateM = fullText.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateM) {
    const [y, mo, d] = dateM[1].split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    match_date = `${parseInt(d, 10)} ${months[parseInt(mo, 10) - 1]} ${y}`;
  }

  // Toss: "Team ... opt to bat/field"
  let toss_winner = '', toss_decision = '';
  const tossM = fullText.match(/(Royal Cricket Blasters|Weekend Warriors)[^.]*?\bopt to\s+(bat|field)/i);
  if (tossM) {
    toss_winner   = (getTeam(tossM[1]) || { full: tossM[1] }).full;
    toss_decision = tossM[2].toLowerCase();
  }

  // Result: "Team ... won by N wickets/runs"
  let result = '', winner = '', margin = '';
  const resM = fullText.match(/(Royal Cricket Blasters|Weekend Warriors)[^.]*?\bwon by\s+(\d+)\s+(wickets?|runs?)/i);
  if (resM) {
    winner = (getTeam(resM[1]) || { full: resM[1] }).full;
    margin = `${resM[2]} ${resM[3]}`;
    result = `${winner} won by ${margin}`;
  } else if (/\btied\b/i.test(fullText)) {
    result = 'Tied'; winner = '';
  }

  return { match_id: matchId, match_date, toss_winner, toss_decision,
           result, winner, margin, innings1_team: '', innings2_team: '' };
}

/** Detect batting team from innings header row like:
 *  "Royal Cricket Blasters (RCB) 74/4 (12.0 Ov) (1st Innings) ..."
 */
function detectBattingTeam(rows) {
  for (const row of rows.slice(0, 8)) {
    if (/Royal Cricket Blasters/i.test(row.text)) return 'Royal Cricket Blasters (RCB)';
    if (/Weekend Warriors/i.test(row.text))       return 'Weekend Warriors (WW)';
  }
  return '';
}

/** Parse dismissal info from left-side tokens of a batting row.
 *  Row always starts with position number, then player name, then status.
 *  Examples after stripping numeric columns:
 *    ["1","Arun","run out","Venkat A"]
 *    ["2","Satyam Goyal","b","Lokesh kumar YC"]
 *    ["3","Murali Cn Cricket","c","†Balaji Balaraju","b","Sudheer Nidiginti"]
 *    ["6","Pavan","(RHB)","not out"]
 */
function parseDismissal(leftTokens) {
  // Skip position number (first token is always a digit string)
  const tokens = (leftTokens[0] && /^\d+$/.test(leftTokens[0]))
    ? leftTokens.slice(1) : leftTokens;

  if (!tokens.length) return { playerName: null, dismissalType: 'not_out', dismissedBy: '', caughtBy: '' };

  const text = tokens.join(' ');

  // Find first dismissal keyword in text
  const kwRe = /\b(not out|retired hurt|run out|lbw b |b (?=[A-Z†])|c (?=[A-Z†]))/i;
  const kw   = kwRe.exec(text);

  if (!kw) {
    // No keyword → whole text is player name (not out / did not bat)
    return { playerName: cleanPlayerName(text), dismissalType: 'not_out', dismissedBy: '', caughtBy: '' };
  }

  const rawName    = text.slice(0, kw.index).trim();
  const playerName = cleanPlayerName(rawName) || cleanPlayerName(text.split(/\s/)[0]);
  const statusText = text.slice(kw.index).trim();
  let dismissalType = 'unknown', dismissedBy = '', caughtBy = '';

  if (/^not out/i.test(statusText)) {
    dismissalType = 'not_out';
  } else if (/^retired hurt/i.test(statusText)) {
    dismissalType = 'retired_hurt';
  } else if (/^run out/i.test(statusText)) {
    dismissalType = 'run_out';
    const after = statusText.replace(/^run out\s*/i, '').replace(/[()]/g, '').replace(/†/g, '').trim();
    caughtBy = after.split(/\s/)[0] || '';
  } else if (/^lbw b /i.test(statusText)) {
    dismissalType = 'lbw';
    dismissedBy = statusText.replace(/^lbw b\s*/i, '').trim().split(/\s/)[0];
  } else if (/^c /i.test(statusText)) {
    dismissalType = 'caught';
    // "c †FielderName b BowlerName" — fielder may have † prefix
    const m = statusText.match(/^c\s+(.+?)\s+b\s+(.+)/i);
    if (m) {
      caughtBy    = m[1].replace(/†/g, '').trim();
      dismissedBy = m[2].trim().split(/\s/)[0];
    }
  } else if (/^b /i.test(statusText)) {
    dismissalType = 'bowled';
    dismissedBy = statusText.replace(/^b\s*/i, '').trim().split(/\s/)[0];
  }

  return { playerName: playerName || null, dismissalType, dismissedBy, caughtBy };
}

/** Parse a batting row.
 *  Actual format: "N PlayerName [tags] [dismissal] R B M 4s 6s SR"
 *  Right-anchor last 6 numeric columns: R B M 4s 6s SR
 */
function tryParseBattingRow(row, matchId, matchDate, innings, battingTeam) {
  const tokens = row.tokens;
  if (tokens.length < 8) return null;

  // First token must be position number 1–11
  if (!/^\d+$/.test(tokens[0])) return null;
  const position = parseInt(tokens[0], 10);
  if (position < 1 || position > 11) return null;

  if (/^(Extras|Total|Fall|To Bat|No Batsman)/i.test(row.text.trim())) return null;

  const n   = tokens.length;
  const sr  = parseFloat(tokens[n - 1]);
  const six = parseInt(tokens[n - 2], 10);
  const fou = parseInt(tokens[n - 3], 10);
  // tokens[n-4] = M (minutes, integer)
  const bal = parseInt(tokens[n - 5], 10);
  const run = parseInt(tokens[n - 6], 10);

  if (isNaN(sr) || isNaN(six) || isNaN(fou) || isNaN(bal) || isNaN(run)) return null;
  if (sr < 0 || six < 0 || fou < 0 || bal < 0 || run < 0) return null;

  const { playerName, dismissalType, dismissedBy, caughtBy } = parseDismissal(tokens.slice(0, n - 6));
  if (!playerName) return null;

  return { match_id: matchId, match_date: matchDate, innings, batting_team: battingTeam,
           position, player: playerName, runs: run, balls: bal, fours: fou, sixes: six,
           strike_rate: sr, dismissal_type: dismissalType,
           dismissed_by: dismissedBy, caught_by: caughtBy };
}

/** Parse a bowling row.
 *  Actual format: "N BowlerName [(c)] O M R W 0s 4s 6s WD NB Eco"
 *  Right-anchor last 10 numeric columns.
 */
function tryParseBowlingRow(row, matchId, matchDate, innings, bowlingTeam) {
  const tokens = row.tokens;
  if (tokens.length < 12) return null;

  // First token must be position number 1–12
  if (!/^\d+$/.test(tokens[0])) return null;
  const pos = parseInt(tokens[0], 10);
  if (pos < 1 || pos > 12) return null;

  if (/^(Fall|Extras|Total|No Bowler)/i.test(row.text.trim())) return null;

  const n   = tokens.length;
  const eco  = parseFloat(tokens[n - 1]);
  const nb   = parseInt(tokens[n - 2], 10);
  const wd   = parseInt(tokens[n - 3], 10);
  const six  = parseInt(tokens[n - 4], 10);
  const fou  = parseInt(tokens[n - 5], 10);
  const dots = parseInt(tokens[n - 6], 10);
  const wkts = parseInt(tokens[n - 7], 10);
  const runs = parseInt(tokens[n - 8], 10);
  const mdn  = parseInt(tokens[n - 9], 10);
  const ovs  = parseFloat(tokens[n - 10]);

  if ([eco, nb, wd, six, fou, dots, wkts, runs, mdn, ovs].some(isNaN)) return null;
  if (ovs <= 0 || eco < 0) return null;

  // Player name = tokens between position number (idx 0) and the 10 numeric columns
  const rawPlayer = tokens.slice(1, n - 10).join(' ');
  const player    = cleanPlayerName(rawPlayer);
  if (!player) return null;

  return { match_id: matchId, match_date: matchDate, innings, bowling_team: bowlingTeam,
           player, overs: ovs, maidens: mdn, runs, wickets: wkts, dot_balls: dots,
           fours_conceded: fou, sixes_conceded: six, wides: wd, no_balls: nb, economy: eco };
}

/** Parse one innings page.
 *  Section markers (actual PDF):
 *    "No Batsman Status R B M 4s 6s SR"  → start batting
 *    "No Bowler O M R W 0s 4s 6s WD NB Eco" → start bowling
 *    "Extras:" / "Total:" / "Fall of Wickets" / "To Bat:" → end section
 */
function parseInningsPage(pageItems, inningsNum, matchId, matchDate, battingTeam) {
  const rows        = groupIntoRows(pageItems);
  const _batEntry  = getTeam(battingTeam);
  const bowlingTeam = teamList().find(t => t !== _batEntry)?.full || '';

  const batting = [], bowling = [];
  let mode = null;

  for (const row of rows) {
    const t = row.text.trim();
    if (!t) continue;

    // Section header detection
    if (/No Batsman\s+Status/i.test(t))          { mode = 'batting'; continue; }
    if (/No Bowler\s+O\s+M\s+R\s+W/i.test(t))   { mode = 'bowling'; continue; }
    if (/^Fall\s+of\s+Wicket/i.test(t) ||
        /^To Bat:/i.test(t) ||
        /^Extras:/i.test(t) ||
        /^Total:/i.test(t))                       { mode = null;      continue; }

    if (mode === 'batting') {
      const parsed = tryParseBattingRow(row, matchId, matchDate, inningsNum, battingTeam);
      if (parsed) batting.push(parsed);
    } else if (mode === 'bowling') {
      const parsed = tryParseBowlingRow(row, matchId, matchDate, inningsNum, bowlingTeam);
      if (parsed) bowling.push(parsed);
    }
  }
  return { batting, bowling };
}

/** Extract one scorecard PDF → { meta, batting[], bowling[] }. */
async function extractScorecardPDF({ path, matchId }) {
  if (!window.pdfjsLib) return null;
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER_SRC;

  let pdfDoc;
  try {
    const resp = await fetch(path);
    if (!resp.ok) return null;
    const buf = await resp.arrayBuffer();
    pdfDoc = await window.pdfjsLib.getDocument({ data: buf }).promise;
  } catch (e) {
    console.warn(`Scorecard load failed: ${path}`, e);
    return null;
  }

  const pageItems = {};
  for (const p of [1, 3, 4]) {
    if (p > pdfDoc.numPages) continue;
    const pg      = await pdfDoc.getPage(p);
    const content = await pg.getTextContent();
    pageItems[p]  = content.items;
  }

  const meta = parseScorecardMeta(pageItems[1] || [], matchId);
  const allBatting = [], allBowling = [];

  for (const [pageNum, inningsNum] of [[3, 1], [4, 2]]) {
    if (!pageItems[pageNum]) continue;
    const rows       = groupIntoRows(pageItems[pageNum]);
    const battingTeam = detectBattingTeam(rows);
    if (!battingTeam) continue;

    if (inningsNum === 1) meta.innings1_team = battingTeam;
    else                  meta.innings2_team = battingTeam;

    const { batting, bowling } = parseInningsPage(pageItems[pageNum], inningsNum, matchId, meta.match_date, battingTeam);
    allBatting.push(...batting);
    allBowling.push(...bowling);
  }

  return { meta, batting: allBatting, bowling: allBowling };
}

/** Per-match localStorage cache helpers */
function getMatchCache(matchId) {
  try {
    const raw = localStorage.getItem(`cricDash_m_${matchId}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function setMatchCache(matchId, data) {
  try { localStorage.setItem(`cricDash_m_${matchId}`, JSON.stringify(data)); } catch(_) {}
}

/**
 * Discover and extract all scorecards.
 * - Auto-discovers PDFs from the directory listing (no hardcoded list).
 * - Loads each match from per-match localStorage cache if available.
 * - Only fetches and parses PDFs that are not yet cached (e.g. new weekly additions).
 * - Calls onProgress(done, total, matchId) after each match.
 */
async function extractAllScorecards(onProgress) {
  const pdfs = await discoverScorecardPDFs();
  if (!pdfs.length) return { matchMeta: [], matchBatting: [], matchBowling: [] };

  const allMeta = [], allBatting = [], allBowling = [];

  for (let i = 0; i < pdfs.length; i++) {
    const entry = pdfs[i];
    if (onProgress) onProgress(i + 1, pdfs.length, entry.matchId);

    /* Try per-match cache first — skips already-processed PDFs instantly */
    let matchData = getMatchCache(entry.matchId);

    if (!matchData) {
      try {
        const result = await extractScorecardPDF(entry);
        if (result) {
          matchData = { meta: result.meta, batting: result.batting, bowling: result.bowling };
          setMatchCache(entry.matchId, matchData);
        }
      } catch (e) {
        console.warn(`Extraction failed for match ${entry.matchId}:`, e);
        continue;
      }
    }

    if (matchData) {
      if (matchData.meta)    allMeta.push(matchData.meta);
      if (matchData.batting) allBatting.push(...matchData.batting);
      if (matchData.bowling) allBowling.push(...matchData.bowling);
    }
  }
  return { matchMeta: allMeta, matchBatting: allBatting, matchBowling: allBowling };
}

const _trimDismissal = name => (name || '')
  .replace(/\s+st\b.*/i,      '')   // "X st Keeper"    → "X"
  .replace(/\s+c&?\s*.*/i,    '')   // "X c& Bowler"    → "X"
  .replace(/\s+run\s*out.*/i, '')   // "X run out …"    → "X"
  .replace(/\s+b\s+\w+$/i,    '')   // "X b Bowler"     → "X"  (trailing only)
  .trim();

/** Re-render only the sections that depend on per-match scorecard data. */
function renderScorecardSections() {
  renderWeekHeroes(state.matchBatting, state.matchBowling);
  renderFormTracker(state.matchBatting, state.matchBowling);
  renderBowlingFormTracker(state.matchBowling, state.matchBatting);
  renderScorecardViewer(state.matchMeta, state.matchBatting, state.matchBowling);
  renderBowlingDiscipline(state.matchBowling);
  renderDismissalAnalysis(state.matchBatting);
  renderTossAnalysis(state.matchMeta);
  renderExtrasTeamChart(state.matchBowling);
  renderFunAwards(state.matchBatting, state.matchBowling);
  renderRunningAwards(state.matchBalls);
  renderMatchRecords(state.matchBatting, state.matchBowling, state.matchMeta);
  renderExtrasLeaderboard(state.matchBowling);
  renderRunOutAnalysis(state.matchBatting);
  renderMatchupTable(state.matchBatting);
  renderBallInsights(state.matchBalls, state.matchMeta);
  /* Re-render top heroes — it uses match data for recent form */
  renderTopHeroes(
    filterBatting(), filterBowling(), filterFielding(), filterMvp(),
    state.matchBatting, state.matchBowling
  );
}

function renderWeekHeroes(matchBatting, matchBowling) {
  const wrap = document.getElementById('weekHeroesWrap');
  const grid = document.getElementById('weekHeroesGrid');
  const title = document.getElementById('weekHeroesTitle');
  if (!wrap || !grid || !matchBatting?.length) return;

  // Find the most recent match date
  const dates = [...new Set(matchBatting.map(r => r.match_date))].filter(Boolean).sort();
  if (!dates.length) return;
  const latestDate = dates[dates.length - 1];

  // Top 3 batters this week: by runs
  const weekBat = matchBatting.filter(r => r.match_date === latestDate);
  const batMap = {};
  weekBat.forEach(r => {
    const p = (r.player || '').trim(); if (!p) return;
    if (!batMap[p]) batMap[p] = { runs: 0, balls: 0, team: r.batting_team };
    batMap[p].runs  += num(r.runs);
    batMap[p].balls += num(r.balls);
  });
  const top3bat = Object.entries(batMap)
    .sort((a, b) => b[1].runs - a[1].runs || a[1].balls - b[1].balls)
    .slice(0, 3);

  // Top 3 bowlers this week: by wickets then economy
  const weekBowl = (matchBowling || []).filter(r => r.match_date === latestDate);
  const bowlMap = {};
  weekBowl.forEach(r => {
    const p = (r.player || '').trim(); if (!p) return;
    if (!bowlMap[p]) bowlMap[p] = { wickets: 0, runs: 0, overs: 0, team: r.bowling_team };
    bowlMap[p].wickets += num(r.wickets);
    bowlMap[p].runs    += num(r.runs);
    bowlMap[p].overs   += num(r.overs);
  });
  const top3bowl = Object.entries(bowlMap)
    .sort((a, b) => {
      if (b[1].wickets !== a[1].wickets) return b[1].wickets - a[1].wickets;
      const ecoA = a[1].overs > 0 ? a[1].runs / a[1].overs : 99;
      const ecoB = b[1].overs > 0 ? b[1].runs / b[1].overs : 99;
      return ecoA - ecoB;
    })
    .slice(0, 3);

  if (!top3bat.length && !top3bowl.length) return;

  // Format date nicely
  const d = new Date(latestDate);
  const dateLabel = isNaN(d) ? latestDate
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  title.textContent = `⚡ This Week's Heroes — ${dateLabel}`;

  const rankClass = i => ['gold','silver','bronze'][i] || '';
  const teamAbbr2 = t => teamShort(t);
  const teamColor = t => teamCssVar(t);
  const initials = name => name.split(' ').map(w => w[0]||'').join('').slice(0,2).toUpperCase();

  const batCards = top3bat.map(([name, d], i) => `
    <div class="week-hero-card">
      <div class="week-hero-rank ${rankClass(i)}">${i+1}</div>
      <div class="week-hero-avatar" style="background:${teamColor(d.team)}">${initials(name)}</div>
      <div class="week-hero-info">
        <div class="week-hero-name">${esc(name)}</div>
        <div class="week-hero-team">${teamAbbr2(d.team)}</div>
      </div>
      <div class="week-hero-stat">${d.runs}<span>runs</span></div>
    </div>`).join('');

  const bowlCards = top3bowl.map(([name, d], i) => {
    const eco = d.overs > 0 ? (d.runs / d.overs).toFixed(1) : '—';
    return `
    <div class="week-hero-card">
      <div class="week-hero-rank ${rankClass(i)}">${i+1}</div>
      <div class="week-hero-avatar" style="background:${teamColor(d.team)}">${initials(name)}</div>
      <div class="week-hero-info">
        <div class="week-hero-name">${esc(name)}</div>
        <div class="week-hero-team">${teamAbbr2(d.team)}</div>
      </div>
      <div class="week-hero-stat">${d.wickets}W<span>eco ${eco}</span></div>
    </div>`;
  }).join('');

  grid.innerHTML = `
    <div class="week-col">
      <div class="week-section-label">🏏 Top Batters</div>
      ${batCards}
    </div>
    <div class="week-col-divider"></div>
    <div class="week-col">
      <div class="week-section-label">🎳 Top Bowlers</div>
      ${bowlCards}
    </div>
  `;
  wrap.style.display = '';
}

/**
 * Phase 2 — runs in background after the base dashboard is visible.
 * Discovers all PDFs in CricHeroesStats/ automatically, loads cached matches
 * instantly, and only extracts new PDFs (e.g. 3 added this week).
 */
async function loadScorecards() {
  /* ── Fast path: pre-built CSVs from extract_scorecards.py (milliseconds) ── */
  try {
    const [metaRes, batRes, bowlRes, ballsRes] = await Promise.all([
      loadCSV(CSV_FILES.matchMeta),
      loadCSV(CSV_FILES.matchBatting),
      loadCSV(CSV_FILES.matchBowling),
      loadCSV(CSV_FILES.matchBalls).catch(() => []),
    ]);
    const valid = r => r?.length > 0 && r[0].match_id !== undefined;
    if (valid(metaRes) && valid(batRes) && valid(bowlRes)) {
      state.matchMeta    = metaRes;
      state.matchBatting = batRes;
      state.matchBowling = bowlRes;
      state.matchBalls   = ballsRes || [];
      state.matchBatting.forEach(r => { r.player = _trimDismissal(r.player); });
      state.matchBowling.forEach(r => { r.player = _trimDismissal(r.player); });
      renderScorecardSections();
      return;   /* done — no PDF parsing needed */
    }
  } catch (_) { /* CSVs not available, fall through to PDF extraction */ }

  /* ── Slow path: extract from PDFs in the browser (first-time fallback) ── */
  showExtractionToast('Discovering PDF files…');
  try {
    const { matchMeta, matchBatting, matchBowling } = await extractAllScorecards(
      (done, total, matchId) => updateExtractionToast(done, total, matchId)
    );
    state.matchMeta    = matchMeta;
    state.matchBatting = matchBatting;
    state.matchBowling = matchBowling;
    state.matchBatting.forEach(r => { r.player = _trimDismissal(r.player); });
    state.matchBowling.forEach(r => { r.player = _trimDismissal(r.player); });
    renderScorecardSections();
    hideExtractionToast();
  } catch (e) {
    console.warn('Scorecard load failed:', e);
    document.getElementById('extractionToast').classList.add('hidden');
  }
}

async function init() {
  showSpinner();
  try {
    /* ── Phase 1: Load leaderboard CSVs → render base dashboard immediately ── */
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
      POINTS_TABLE = pdfTable;
    } else {
      const ptRows = await loadCSV(CSV_FILES.pointsTable).catch(() => []);
      POINTS_TABLE = parsePointsTable(ptRows);
    }

    buildTeamRegistry(POINTS_TABLE);
    populateDynamicHTML();

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

  /* ── Phase 2: Load scorecards lazily — only when the user scrolls to a
       relevant section (Form Tracker, Scorecard Viewer, Ball Insights).
       Falls back to loading after 45 s if the user never scrolls there.
       Saves bandwidth on mobile / slow connections. ── */
  let _scorecardsTriggered = false;
  function _triggerScorecards() {
    if (_scorecardsTriggered) return;
    _scorecardsTriggered = true;
    if (_obs) _obs.disconnect();
    loadScorecards();
  }

  const _watchIds = ['form-heading', 'scorecard-heading', 'ball-insights-heading'];
  let _obs = null;
  if (typeof IntersectionObserver !== 'undefined') {
    _obs = new IntersectionObserver(
      (entries) => { if (entries.some(e => e.isIntersecting)) _triggerScorecards(); },
      { rootMargin: '300px' }   // pre-load 300 px before section enters viewport
    );
    _watchIds.forEach(id => { const el = document.getElementById(id); if (el) _obs.observe(el); });
  } else {
    // Fallback for very old browsers
    _triggerScorecards();
  }
  // Hard timeout: always load within 45 s even if user never scrolls
  setTimeout(_triggerScorecards, 45000);
}

init();
