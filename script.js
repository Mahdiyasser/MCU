/* =====================================================
   MCU UNIVERSE — script.js
   Author: Mahdi Yasser
   ===================================================== */

'use strict';

// ─── Constants ───────────────────────────────────────
const STORAGE_KEY  = 'mcu_universe_v1';
const VIEW_PARAM   = 'share';
const BASE_URL     = 'https://mcu.mahdiyasser.site/';

// XP / Rank system
const RANKS = [
  { name: 'Civilian',      min: 0,    level: 1  },
  { name: 'Recruit',       min: 50,   level: 2  },
  { name: 'S.H.I.E.L.D. Agent', min: 150, level: 3 },
  { name: 'Avenger',       min: 300,  level: 4  },
  { name: 'Hero',          min: 500,  level: 5  },
  { name: 'Superhero',     min: 750,  level: 6  },
  { name: 'Guardian',      min: 1000, level: 7  },
  { name: 'Champion',      min: 1300, level: 8  },
  { name: 'Infinity Stone Holder', min: 1700, level: 9 },
  { name: 'Sorcerer Supreme', min: 2200, level: 10 },
  { name: 'Multiversal Legend', min: 3000, level: 11 },
];

const ACHIEVEMENTS = [
  { id: 'first_watch',  icon: '<i class="fa-solid fa-clapperboard"></i>', name: 'First Watch',      desc: 'Watch your first MCU title', req: s => s.watched.length >= 1 },
  { id: 'phase1',       icon: '<i class="fa-solid fa-1"></i>', name: 'Phase One Complete', desc: 'Watch all Phase 1 titles', req: s => phaseComplete(s,'phase_1') },
  { id: 'phase2',       icon: '<i class="fa-solid fa-2"></i>', name: 'Phase Two Complete', desc: 'Watch all Phase 2 titles', req: s => phaseComplete(s,'phase_2') },
  { id: 'phase3',       icon: '<i class="fa-solid fa-3"></i>', name: 'Phase Three Complete', desc: 'Watch all Phase 3 titles', req: s => phaseComplete(s,'phase_3') },
  { id: 'phase4',       icon: '<i class="fa-solid fa-4"></i>', name: 'Phase Four Complete', desc: 'Watch all Phase 4 titles', req: s => phaseComplete(s,'phase_4') },
  { id: 'phase5',       icon: '<i class="fa-solid fa-5"></i>', name: 'Phase Five Complete', desc: 'Watch all Phase 5 titles', req: s => phaseComplete(s,'phase_5') },
  { id: 'infinity_saga',icon: '<i class="fa-solid fa-infinity"></i>', name: 'Infinity Saga',    desc: 'Complete The Infinity Saga (Phases 1-3)', req: s => phaseComplete(s,'phase_1') && phaseComplete(s,'phase_2') && phaseComplete(s,'phase_3') },
  { id: 'avengers4',    icon: '<i class="fa-solid fa-shield-halved"></i>', name: 'Avengers Assemble', desc: 'Watch all 4 Avengers films', req: s => ['mcu_006','mcu_011','mcu_019','mcu_022'].every(id => s.watched.includes(id)) },
  { id: 'ironman3',     icon: '<i class="fa-solid fa-robot"></i>', name: 'Iron Man Trilogy', desc: 'Watch all Iron Man films', req: s => ['mcu_001','mcu_003','mcu_007'].every(id => s.watched.includes(id)) },
  { id: 'thor3',        icon: '<i class="fa-solid fa-bolt"></i>', name: 'God of Thunder',   desc: 'Watch all Thor films', req: s => ['mcu_004','mcu_008','mcu_017','mcu_035'].every(id => s.watched.includes(id)) },
  { id: 'cap3',         icon: '<i class="fa-solid fa-shield"></i>', name: 'First Avenger',    desc: 'Watch all Captain America films', req: s => ['mcu_005','mcu_009','mcu_013'].every(id => s.watched.includes(id)) },
  { id: 'got2',         icon: '<i class="fa-solid fa-rocket"></i>', name: 'Guardians',         desc: 'Watch all Guardians films', req: s => ['mcu_010','mcu_015','mcu_042'].every(id => s.watched.includes(id)) },
  { id: 'wishlist10',   icon: '<i class="fa-solid fa-thumbtack"></i>', name: 'Curator',           desc: 'Add 10 titles to wishlist', req: s => s.wishlist.length >= 10 },
  { id: 'halfway',      icon: '<i class="fa-solid fa-person-running"></i>', name: 'Halfway There',     desc: 'Watch at least 30 titles', req: s => s.watched.length >= 30 },
  { id: 'completionist',icon: '<i class="fa-solid fa-star"></i>', name: 'True Believer',     desc: 'Watch all released MCU titles', req: s => allReleasedWatched(s) },
];

// Phase color map
const PHASE_COLORS = { phase_1:'#e23636', phase_2:'#f97316', phase_3:'#eab308', phase_4:'#22c55e', phase_5:'#3b82f6', phase_6:'#a855f7' };
const TYPE_COLORS  = { movie: 'tag-movie', series: 'tag-series', special_presentation: 'tag-special', short: 'tag-special' };
const TYPE_LABELS  = { movie: 'Movie', series: 'Series', special_presentation: 'Special', short: 'Short' };

// ─── Global State ─────────────────────────────────────
let MCU_DATA    = null; // from data.json + mcu.json
let STARS_DATA  = null; // from stars.json
let USER_STATE  = null; // { name, watched[], wishlist[] }
let IS_VIEW_MODE = false;
let VIEW_STATE   = null;
let currentOrder  = 'release';
let currentFilter = 'all';
let activeTab     = 'home';
let searchTimeout = null;

// ─── Init ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  checkViewMode();
  loadUserState();
  render();
  initSearch();
  setupEventListeners();

  // Loader out
  setTimeout(() => {
    const loader = document.getElementById('loader');
    loader && loader.classList.add('fade-out');
  }, 600);
});

// ─── Data Loading ──────────────────────────────────────
async function loadData() {
  try {
    const [mcuRes, starsRes, dataRes] = await Promise.all([
      fetch('./assets/mcu.json'),
      fetch('./assets/stars.json'),
      fetch('./assets/data.json'),
    ]);
    const mcu   = await mcuRes.json();
    const stars = await starsRes.json();
    const data  = await dataRes.json();

    MCU_DATA   = { ...data, ...mcu };
    STARS_DATA = stars;
  } catch (e) {
    console.error('Failed to load data files:', e);
    // Fallback: graceful empty state
    MCU_DATA   = { entries: [], release_order: [], chronological_order: [], about: { phases: [] } };
    STARS_DATA = { stars: [] };
  }
}

// ─── View Mode (Shared URL) ────────────────────────────
function checkViewMode() {
  const params = new URLSearchParams(window.location.search);
  const shareData = params.get(VIEW_PARAM);
  if (!shareData) return;

  try {
    const decoded = JSON.parse(atob(shareData));
    IS_VIEW_MODE = true;
    VIEW_STATE   = decoded;
    injectViewModeBanner(decoded.name || 'Someone');
  } catch(e) {
    // invalid share link, ignore
  }
}

function injectViewModeBanner(name) {
  const banner = document.createElement('div');
  banner.className = 'view-mode-overlay';
  banner.innerHTML = `<i class="fa-solid fa-eye"></i> You're viewing <strong>${escapeHtml(name)}'s</strong> MCU journey — read only`;
  document.body.insertBefore(banner, document.getElementById('app'));
  document.body.style.paddingTop = 'calc(var(--header-h) + 44px)';
}

// ─── User State (localStorage) ────────────────────────
function loadUserState() {
  if (IS_VIEW_MODE) {
    USER_STATE = VIEW_STATE;
    return;
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      USER_STATE = JSON.parse(raw);
    } else {
      USER_STATE = { name: '', watched: [], wishlist: [] };
    }
  } catch(e) {
    USER_STATE = { name: '', watched: [], wishlist: [] };
  }
  // Ensure arrays exist
  if (!Array.isArray(USER_STATE.watched))  USER_STATE.watched  = [];
  if (!Array.isArray(USER_STATE.wishlist)) USER_STATE.wishlist = [];
}

function saveUserState() {
  if (IS_VIEW_MODE) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(USER_STATE));
  } catch(e) { console.error('Save failed:', e); }
}

// ─── Toggle Watch / Wishlist ──────────────────────────
function toggleWatched(id, evt) {
  if (IS_VIEW_MODE) { showToast('View-only mode', 'blue'); return; }
  if (evt) evt.stopPropagation();
  const i = USER_STATE.watched.indexOf(id);
  if (i === -1) {
    USER_STATE.watched.push(id);
    showToast('<i class="fa-solid fa-check"></i> Marked as watched', 'green');
  } else {
    USER_STATE.watched.splice(i, 1);
    showToast('Removed from watched', 'red');
  }
  saveUserState();
  updateAllUI();
}

function toggleWishlist(id, evt) {
  if (IS_VIEW_MODE) { showToast('View-only mode', 'blue'); return; }
  if (evt) evt.stopPropagation();
  const i = USER_STATE.wishlist.indexOf(id);
  if (i === -1) {
    USER_STATE.wishlist.push(id);
    showToast('<i class="fa-solid fa-bookmark"></i> Added to wishlist', 'gold');
  } else {
    USER_STATE.wishlist.splice(i, 1);
    showToast('Removed from wishlist', 'red');
  }
  saveUserState();
  updateAllUI();
}

// ─── Main Render ──────────────────────────────────────
function render() {
  renderHomeTab();
  renderTimelineTab();
  renderJourneyTab();
  renderWishlistTab();
  renderStarsTab();
  updateHeaderAvatar();
  updateWishlistBadge();
}

function updateAllUI() {
  updateStats();
  updateTimelineCards();
  updateJourneyTab();
  renderWishlistTab();
  updateWishlistBadge();
  updateHeaderAvatar();
}

// ─── HOME TAB ─────────────────────────────────────────
function renderHomeTab() {
  const total = MCU_DATA.entries.length;
  document.getElementById('hero-total').textContent = total;
  updateStats();
  renderPhaseOverview();
  renderCurrentlyWatching();
  renderUpcoming();
}

function updateStats() {
  const watched  = USER_STATE.watched.length;
  const wishlist = USER_STATE.wishlist.length;
  const total    = MCU_DATA.entries.length;
  const released = MCU_DATA.entries.filter(e => !isUpcoming(e)).length;
  const pct      = released > 0 ? Math.round((watched / released) * 100) : 0;

  setEl('stat-watched',    watched);
  setEl('stat-wishlist',   wishlist);
  setEl('stat-total-home', total);
  setEl('stat-pct',        pct + '%');
}

function renderPhaseOverview() {
  const container = document.getElementById('phase-overview');
  if (!container) return;

  const phases = MCU_DATA.about.phases;
  container.innerHTML = phases.map(p => {
    const entries   = MCU_DATA.entries.filter(e => e.phase === p.id);
    const released  = entries.filter(e => !isUpcoming(e));
    const watched   = released.filter(e => USER_STATE.watched.includes(e.id)).length;
    const pct       = released.length > 0 ? (watched / released.length) * 100 : 0;
    const color     = PHASE_COLORS[p.id] || '#e23636';

    return `<div class="phase-overview-card" data-phase="${p.id}" onclick="switchTab('timeline');setTimeout(()=>scrollToPhase('${p.id}'),200)">
      <div class="poc-num" style="color:${color}">${p.number}</div>
      <div class="poc-label">Phase</div>
      <div class="poc-progress">
        <div class="poc-progress-fill" style="width:${pct}%;background:${color}"></div>
      </div>
    </div>`;
  }).join('');
}

function renderCurrentlyWatching() {
  const container = document.getElementById('currently-watching-list');
  if (!container) return;
  const section   = document.getElementById('currently-watching-section');

  // "Currently watching" = unwatched, appearing after last watched in release order
  const releaseList = MCU_DATA.release_order || MCU_DATA.entries.map(e=>e.id);
  const lastWatchedIdx = releaseList.reduce((max, id, idx) => USER_STATE.watched.includes(id) ? idx : max, -1);
  const queue = releaseList.slice(lastWatchedIdx + 1).filter(id => {
    const e = getEntry(id);
    return e && !isUpcoming(e);
  }).slice(0, 10);

  if (queue.length === 0) {
    section && (section.style.display = 'none');
    return;
  }
  section && (section.style.display = '');
  container.innerHTML = queue.map(id => buildMiniCard(id)).join('');
}

function renderUpcoming() {
  const container = document.getElementById('upcoming-list');
  if (!container) return;
  const upcoming = MCU_DATA.entries.filter(isUpcoming).slice(0, 10);
  container.innerHTML = upcoming.map(e => buildMiniCard(e.id)).join('');
}

function buildMiniCard(id) {
  const e = getEntry(id);
  if (!e) return '';
  const watched  = USER_STATE.watched.includes(id);
  const wishlisted = USER_STATE.wishlist.includes(id);
  const upcoming = isUpcoming(e);
  const year = e.release_date ? e.release_date.split('-')[0] : '';

  return `<div class="mcu-card ${watched?'watched':''} ${wishlisted?'wishlisted':''}" onclick="openDetail('${id}')">
    <div style="position:relative">
      <img class="mcu-card-poster" src="${e.image}" alt="${escapeHtml(e.title)}" loading="lazy" onerror="this.style.background='var(--surface3)';this.src=''">
      <div class="mcu-card-badges">
        ${watched  ? '<div class="card-badge badge-watched"><i class="fa-solid fa-check"></i></div>' : ''}
        ${wishlisted && !watched ? '<div class="card-badge badge-wishlist"><i class="fa-solid fa-bookmark"></i></div>' : ''}
      </div>
      ${upcoming ? '<div class="mcu-card-upcoming-tag">Soon</div>' : ''}
    </div>
    <div class="mcu-card-body">
      <div class="mcu-card-title">${escapeHtml(e.title)}</div>
      <div class="mcu-card-meta"><span>${TYPE_LABELS[e.type]||e.type}</span><span>${year}</span></div>
    </div>
  </div>`;
}

// ─── TIMELINE TAB ─────────────────────────────────────
function renderTimelineTab() {
  const container = document.getElementById('timeline-phases');
  if (!container) return;
  container.innerHTML = buildTimelineHTML();
}

function buildTimelineHTML() {
  const phases  = MCU_DATA.about.phases;
  const orderList = currentOrder === 'release' ? MCU_DATA.release_order : MCU_DATA.chronological_order;

  return phases.map(p => {
    let entries = orderList
      .map(id => getEntry(id))
      .filter(e => e && e.phase === p.id);

    if (currentFilter !== 'all') {
      entries = entries.filter(e => e.type === currentFilter);
    }
    if (entries.length === 0) return '';

    const released = entries.filter(e => !isUpcoming(e));
    const watched  = released.filter(e => USER_STATE.watched.includes(e.id)).length;
    const color    = PHASE_COLORS[p.id] || '#e23636';
    const saga     = MCU_DATA.about.sagas.find(s => s.phases.includes(p.number));

    return `<div class="phase-group" id="phase-${p.id}">
      <div class="phase-group-header">
        <div class="phase-color-dot" style="background:${color}"></div>
        <div class="phase-group-title" style="color:${color}">${p.name.toUpperCase()}</div>
        <div class="phase-group-saga">${saga?.name||''}</div>
        <div class="phase-group-progress">${watched}/${released.length}</div>
      </div>
      <div class="phase-entries-grid">
        ${entries.map(e => buildFullCard(e)).join('')}
      </div>
    </div>`;
  }).join('');
}

function buildFullCard(e) {
  const watched    = USER_STATE.watched.includes(e.id);
  const wishlisted = USER_STATE.wishlist.includes(e.id);
  const upcoming   = isUpcoming(e);
  const year       = e.release_date ? e.release_date.split('-')[0] : '';

  return `<div class="mcu-card-full ${watched?'watched':''} ${wishlisted?'wishlisted':''} ${upcoming?'upcoming':''}"
    data-id="${e.id}" onclick="openDetail('${e.id}')">
    <div class="card-poster-wrap">
      <img class="mcu-card-poster" src="${e.image}" alt="${escapeHtml(e.title)}" loading="lazy" onerror="this.style.background='var(--surface3)';this.src=''">
      ${watched ? '<div class="card-watched-indicator"><i class="fa-solid fa-check"></i></div>' : ''}
      ${wishlisted && !watched ? '<div class="card-wish-indicator"><i class="fa-solid fa-bookmark"></i></div>' : ''}
      ${upcoming ? '<div class="mcu-card-upcoming-tag">Upcoming</div>' : ''}
      ${!upcoming ? `<div class="card-actions">
        <button class="card-action-btn watch-btn ${watched?'watched-active':''}" onclick="toggleWatched('${e.id}',event)" title="${watched?'Unmark':'Mark watched'}">
          <i class="fa-solid ${watched?'fa-check':'fa-eye'}"></i>
        </button>
        <button class="card-action-btn wish-btn ${wishlisted?'wished-active':''}" onclick="toggleWishlist('${e.id}',event)" title="${wishlisted?'Remove from wishlist':'Wishlist'}">
          <i class="fa-solid fa-bookmark"></i>
        </button>
      </div>` : ''}
    </div>
    <div class="mcu-card-body">
      <div class="mcu-card-title">${escapeHtml(e.title)}</div>
      <div class="card-type-row">
        <span class="card-type-label">${TYPE_LABELS[e.type]||e.type}</span>
        <span class="card-year">${year}</span>
      </div>
    </div>
  </div>`;
}

function updateTimelineCards() {
  // Re-render full timeline
  renderTimelineTab();
  renderPhaseOverview();
  renderCurrentlyWatching();
  renderUpcoming();
}

function setOrder(order) {
  currentOrder = order;
  document.getElementById('btn-release')?.classList.toggle('active', order === 'release');
  document.getElementById('btn-chrono')?.classList.toggle('active', order === 'chrono');
  renderTimelineTab();
}

function setTypeFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
  btn && btn.classList.add('active');
  renderTimelineTab();
}

function scrollToPhase(phaseId) {
  const el = document.getElementById(`phase-${phaseId}`);
  el && el.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── JOURNEY TAB ──────────────────────────────────────
function renderJourneyTab() {
  updateJourneyTab();
}

function updateJourneyTab() {
  renderXPBar();
  renderAchievements();
  renderJourneyStats();
  renderWatchQueue();
}

function calcXP() {
  return USER_STATE.watched.length * 10;
}

function getRank(xp) {
  let rank = RANKS[0];
  for (const r of RANKS) {
    if (xp >= r.min) rank = r;
  }
  return rank;
}

function getNextRank(xp) {
  for (const r of RANKS) {
    if (xp < r.min) return r;
  }
  return null;
}

function renderXPBar() {
  const xp       = calcXP();
  const rank     = getRank(xp);
  const nextRank = getNextRank(xp);

  const pct = nextRank
    ? Math.min(100, ((xp - rank.min) / (nextRank.min - rank.min)) * 100)
    : 100;

  setEl('journey-level-badge', `LVL ${rank.level}`);
  setEl('journey-rank-name',   rank.name.toUpperCase());
  setEl('journey-xp-label',    `${xp} XP`);
  setEl('journey-xp-next',     nextRank ? `Next: ${nextRank.name} (${nextRank.min} XP)` : 'MAX RANK');

  const bar = document.getElementById('xp-bar-inner');
  if (bar) setTimeout(() => { bar.style.width = pct + '%'; }, 300);
}

function renderAchievements() {
  const container = document.getElementById('achievements-grid');
  if (!container) return;
  container.innerHTML = ACHIEVEMENTS.map(a => {
    const unlocked = a.req(USER_STATE);
    return `<div class="achievement-card ${unlocked?'unlocked':'locked'}">
      <div class="achievement-icon">${a.icon}</div>

      <div class="achievement-name">${a.name}</div>
      <div class="achievement-desc">${a.desc}</div>
      ${unlocked ? '<div class="achievement-check"><i class="fa-solid fa-check"></i></div>' : ''}
    </div>`;
  }).join('');
}

function renderJourneyStats() {
  const container = document.getElementById('journey-stats-grid');
  if (!container) return;

  const total    = MCU_DATA.entries.length;
  const released = MCU_DATA.entries.filter(e => !isUpcoming(e)).length;
  const watched  = USER_STATE.watched.length;
  const movies   = MCU_DATA.entries.filter(e => e.type === 'movie' && USER_STATE.watched.includes(e.id)).length;
  const series   = MCU_DATA.entries.filter(e => e.type === 'series' && USER_STATE.watched.includes(e.id)).length;
  const xp       = calcXP();
  const mins     = MCU_DATA.entries
    .filter(e => USER_STATE.watched.includes(e.id) && e.runtime_minutes)
    .reduce((sum, e) => sum + e.runtime_minutes, 0);
  const hrs      = Math.round(mins / 60);

  container.innerHTML = [
    ['stat-num', watched,  'Watched'],
    ['stat-num', `${Math.round((watched/Math.max(released,1))*100)}%`, 'Complete'],
    ['stat-num', movies,   'Movies'],
    ['stat-num', series,   'Series'],
    ['stat-num', xp,       'Total XP'],
    ['stat-num', USER_STATE.wishlist.length, 'Wishlisted'],
    ['stat-num', hrs > 0 ? `${hrs}h` : '0h', 'Time Watched'],
    ['stat-num', ACHIEVEMENTS.filter(a => a.req(USER_STATE)).length, 'Achievements'],
  ].map(([cls, val, label]) =>
    `<div class="j-stat-card"><span class="${cls}">${val}</span><span class="j-stat-label">${label}</span></div>`
  ).join('');
}

function renderWatchQueue() {
  const container = document.getElementById('watch-queue');
  if (!container) return;

  const orderList = MCU_DATA.release_order || MCU_DATA.entries.map(e => e.id);
  const phases    = MCU_DATA.about.phases;

  container.innerHTML = phases.map(p => {
    const entries = orderList
      .map((id, idx) => ({ e: getEntry(id), idx: idx + 1 }))
      .filter(({e}) => e && e.phase === p.id && !isUpcoming(e));

    if (entries.length === 0) return '';
    const color = PHASE_COLORS[p.id] || '#e23636';

    return `<div class="queue-phase-group">
      <div class="queue-phase-title" style="color:${color}">${p.name}</div>
      ${entries.map(({e, idx}) => {
        const watched    = USER_STATE.watched.includes(e.id);
        const wishlisted = USER_STATE.wishlist.includes(e.id);
        return `<div class="queue-entry ${watched?'watched-entry':''}" onclick="openDetail('${e.id}')">
          <span class="queue-num">${idx}</span>
          <img class="queue-poster" src="${e.image}" alt="" loading="lazy" onerror="this.src=''">
          <div class="queue-info">
            <div class="queue-title">${escapeHtml(e.title)}</div>
            <div class="queue-meta">${TYPE_LABELS[e.type]||e.type} · ${e.release_date?.split('-')[0]||''}</div>
          </div>
          <div class="queue-actions" onclick="event.stopPropagation()">
            <button class="queue-btn watch-q ${watched?'active':''}" onclick="toggleWatched('${e.id}',event)" title="${watched?'Unmark':'Watched'}">
              <i class="fa-solid ${watched?'fa-check':'fa-eye'}"></i>
            </button>
            <button class="queue-btn wish-q ${wishlisted?'active':''}" onclick="toggleWishlist('${e.id}',event)" title="${wishlisted?'Remove':'Wishlist'}">
              <i class="fa-solid fa-bookmark"></i>
            </button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
  }).join('');
}

function openNextToWatch() {
  const releaseList = MCU_DATA.release_order || MCU_DATA.entries.map(e => e.id);
  const next = releaseList.find(id => {
    const e = getEntry(id);
    return e && !isUpcoming(e) && !USER_STATE.watched.includes(id);
  });
  if (next) openDetail(next);
  else showToast('<i class="fa-solid fa-champagne-glasses"></i> You\'ve watched everything!', 'gold');
}

// ─── WISHLIST TAB ─────────────────────────────────────
function renderWishlistTab() {
  const container = document.getElementById('wishlist-grid');
  const empty     = document.getElementById('wishlist-empty');
  if (!container) return;

  const list = USER_STATE.wishlist;
  if (list.length === 0) {
    container.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');
  container.innerHTML = list.map(id => buildFullCard(getEntry(id) || { id, title: id, image: '', type: 'movie', phase: 'phase_1', release_date: '' })).join('');
}

function updateWishlistBadge() {
  const badge = document.getElementById('wishlist-badge');
  const count = USER_STATE.wishlist.length;
  if (badge) {
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }
}

// ─── STARS TAB ────────────────────────────────────────
function renderStarsTab() {
  const container = document.getElementById('stars-grid');
  if (!container) return;
  container.innerHTML = STARS_DATA.stars.map(s => buildStarCard(s)).join('');
}

function buildStarCard(s) {
  const appearances = s.mcu_appearances?.length || 0;
  return `<div class="star-card" onclick="openStarDetail('${s.id}')">
    <img class="star-card-img" src="${s.image}" alt="${escapeHtml(s.name)}" loading="lazy" onerror="this.src=''">
    <div class="star-card-body">
      <div class="star-card-name">${escapeHtml(s.name)}</div>
      <div class="star-card-char">${escapeHtml(s.character||'')}</div>
      ${appearances > 0 ? `<div class="star-appearances">${appearances} appearance${appearances>1?'s':''}</div>` : ''}
    </div>
  </div>`;
}

function filterStars(query) {
  const container = document.getElementById('stars-grid');
  if (!container) return;
  const q = query.toLowerCase().trim();
  const filtered = q
    ? STARS_DATA.stars.filter(s =>
        s.name.toLowerCase().includes(q) ||
        (s.character||'').toLowerCase().includes(q))
    : STARS_DATA.stars;
  container.innerHTML = filtered.map(s => buildStarCard(s)).join('');
}

// ─── SEARCH ───────────────────────────────────────────
function initSearch() {
  const input = document.getElementById('global-search');
  const drop  = document.getElementById('search-results-drop');
  if (!input || !drop) return;

  input.addEventListener('input', () => {
    clearTimeout(searchTimeout);
    const q = input.value.trim();
    if (q.length < 2) { drop.classList.add('hidden'); return; }
    searchTimeout = setTimeout(() => renderSearchResults(q), 200);
  });

  input.addEventListener('focus', () => {
    const q = input.value.trim();
    if (q.length >= 2) renderSearchResults(q);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('#header-search-wrap')) drop.classList.add('hidden');
  });
}

function renderSearchResults(q) {
  const drop = document.getElementById('search-results-drop');
  if (!drop) return;
  q = q.toLowerCase();

  const mcuMatches = MCU_DATA.entries
    .filter(e => e.title.toLowerCase().includes(q))
    .slice(0, 6);

  const starMatches = STARS_DATA.stars
    .filter(s => s.name.toLowerCase().includes(q) || (s.character||'').toLowerCase().includes(q))
    .slice(0, 4);

  if (mcuMatches.length === 0 && starMatches.length === 0) {
    drop.innerHTML = '<div class="search-item"><div class="search-item-info"><div class="search-item-title" style="color:var(--text3)">No results found</div></div></div>';
    drop.classList.remove('hidden');
    return;
  }

  const html = [
    ...mcuMatches.map(e => {
      const tagClass = TYPE_COLORS[e.type] || 'tag-movie';
      return `<div class="search-item" onclick="openDetail('${e.id}');document.getElementById('global-search').value='';document.getElementById('search-results-drop').classList.add('hidden')">
        <img class="search-item-img" src="${e.image}" alt="" loading="lazy" onerror="this.src=''">
        <div class="search-item-info">
          <div class="search-item-title">${escapeHtml(e.title)}</div>
          <div class="search-item-sub">${e.release_date?.split('-')[0]||''}</div>
        </div>
        <span class="search-type-tag ${tagClass}">${TYPE_LABELS[e.type]||e.type}</span>
      </div>`;
    }),
    ...starMatches.map(s =>
      `<div class="search-item" onclick="openStarDetail('${s.id}');document.getElementById('global-search').value='';document.getElementById('search-results-drop').classList.add('hidden')">
        <img class="search-item-img star-thumb" src="${s.image}" alt="" loading="lazy" onerror="this.src=''">
        <div class="search-item-info">
          <div class="search-item-title">${escapeHtml(s.name)}</div>
          <div class="search-item-sub">${escapeHtml(s.character||'')}</div>
        </div>
        <span class="search-type-tag tag-star">Star</span>
      </div>`
    ),
  ].join('');

  drop.innerHTML = html;
  drop.classList.remove('hidden');
}

// ─── DETAIL PANEL ─────────────────────────────────────
function openDetail(id) {
  const e = getEntry(id);
  if (!e) return;

  const watched    = USER_STATE.watched.includes(id);
  const wishlisted = USER_STATE.wishlist.includes(id);
  const upcoming   = isUpcoming(e);
  const year       = e.release_date ? e.release_date.split('-')[0] : 'TBA';
  const phaseData  = MCU_DATA.about?.phases?.find(p => p.id === e.phase);
  const phaseColor = PHASE_COLORS[e.phase] || '#e23636';
  const tagClass   = TYPE_COLORS[e.type] || 'tag-movie';

  // Ratings
  const ratingsHtml = [
    e.ratings?.imdb      ? `<span class="detail-rating"><i class="fa-brands fa-imdb" style="color:#f5c518"></i> ${e.ratings.imdb}</span>` : '',
    e.ratings?.rotten_tomatoes ? `<span class="detail-rating"><i class="fa-solid fa-circle-dot" style="color:#fa320a"></i> ${e.ratings.rotten_tomatoes}%</span>` : '',
    e.ratings?.metacritic ? `<span class="detail-rating"><i class="fa-solid fa-gamepad" style="color:#ffcc33"></i> ${e.ratings.metacritic}</span>` : '',
  ].filter(Boolean).join('');

  // Cast
  const castHtml = (e.cast || []).map(c => {
    const star = c.star_id ? STARS_DATA.stars.find(s => s.id === c.star_id) : null;
    const img  = star ? star.image : '';
    const name = star ? star.name : (c.actor || 'Unknown');
    const char = c.character || '';
    return `<div class="cast-item" onclick="${star ? `openStarDetail('${star.id}')` : ''}">
      <img class="cast-img" src="${img}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.src=''">
      <div class="cast-name">${escapeHtml(name)}</div>
      <div class="cast-char">${escapeHtml(char)}</div>
    </div>`;
  }).join('');

  // Watch platforms
  const platformsHtml = (e.where_to_watch || []).map(w =>
    `<div class="detail-watch-platform">
      <img class="detail-platform-logo" src="${w.platform_id === 'disney_plus' ? '/assets/images/platforms/disney_plus.png' : '/assets/images/platforms/theaters.png'}" alt="${w.platform}" onerror="this.src=''">
      <a href="${w.url}" target="_blank" rel="noopener"><i class="fa-solid fa-play"></i> Watch on ${w.platform} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px;opacity:0.6"></i></a>
    </div>`
  ).join('');

  // External links
  const links = e.links || {};
  const extLinks = [
    links.imdb      ? `<a class="detail-ext-link" href="${links.imdb}" target="_blank"><i class="fa-brands fa-imdb"></i> IMDb</a>` : '',
    links.wikipedia ? `<a class="detail-ext-link" href="${links.wikipedia}" target="_blank"><i class="fa-brands fa-wikipedia-w"></i> Wiki</a>` : '',
    links.marvel    ? `<a class="detail-ext-link" href="${links.marvel}" target="_blank"><i class="fa-solid fa-star"></i> Marvel</a>` : '',
  ].filter(Boolean).join('');

  const content = `
    <div class="detail-hero">
      <img class="detail-poster" src="${e.image}" alt="${escapeHtml(e.title)}" onerror="this.src=''">
      <div class="detail-hero-info">
        <div class="detail-type-phase">
          <span class="detail-type-tag ${tagClass}">${TYPE_LABELS[e.type]||e.type}</span>
          <span class="detail-type-tag" style="background:rgba(255,255,255,0.08);color:var(--text3)">${phaseData?.name||''}</span>
          ${upcoming ? '<span class="detail-type-tag" style="background:rgba(245,197,24,0.15);color:var(--gold)">Upcoming</span>' : ''}
        </div>
        <h2 class="detail-title">${escapeHtml(e.title)}</h2>
        <div class="detail-meta-row">
          ${year !== 'TBA' ? `<span class="detail-meta-item"><i class="fa-regular fa-calendar"></i>${year}</span>` : ''}
          ${e.runtime_minutes ? `<span class="detail-meta-item"><i class="fa-regular fa-clock"></i>${Math.floor(e.runtime_minutes/60)}h ${e.runtime_minutes%60}m</span>` : ''}
          ${e.director ? `<span class="detail-meta-item"><i class="fa-solid fa-clapperboard"></i>${escapeHtml(e.director)}</span>` : ''}
          ${e.rating ? `<span class="detail-meta-item">${e.rating}</span>` : ''}
        </div>
        ${ratingsHtml ? `<div class="detail-rating-row">${ratingsHtml}</div>` : ''}
      </div>
    </div>
    ${!upcoming ? `<div class="detail-action-row">
      <button class="detail-btn watch-toggle ${watched?'active':''}" id="detail-watch-btn" onclick="toggleWatched('${id}',event);updateDetailWatchBtn('${id}')">
        <i class="fa-solid ${watched?'fa-check':'fa-eye'}"></i> ${watched ? 'Watched' : 'Mark Watched'}
      </button>
      <button class="detail-btn wish-toggle ${wishlisted?'active':''}" id="detail-wish-btn" onclick="toggleWishlist('${id}',event);updateDetailWishBtn('${id}')">
        <i class="fa-solid fa-bookmark"></i> ${wishlisted ? 'Wishlisted' : 'Wishlist'}
      </button>
      ${links.trailer ? `<a class="detail-btn trailer-btn" href="${links.trailer}" target="_blank" rel="noopener"><i class="fa-brands fa-youtube"></i> Trailer</a>` : ''}
    </div>` : `<div class="detail-action-row">
      <button class="detail-btn wish-toggle ${wishlisted?'active':''}" id="detail-wish-btn" onclick="toggleWishlist('${id}',event);updateDetailWishBtn('${id}')">
        <i class="fa-solid fa-bookmark"></i> ${wishlisted ? 'Wishlisted' : 'Wishlist'}
      </button>
      ${links.trailer ? `<a class="detail-btn trailer-btn" href="${links.trailer}" target="_blank" rel="noopener"><i class="fa-brands fa-youtube"></i> Trailer</a>` : ''}
    </div>`}
    <div class="detail-body">
      ${e.synopsis ? `<div>
        <div class="detail-section-title">Synopsis</div>
        <p class="detail-synopsis">${escapeHtml(e.synopsis)}</p>
      </div>` : ''}
      ${castHtml ? `<div>
        <div class="detail-section-title">Cast</div>
        <div class="detail-cast-row">${castHtml}</div>
      </div>` : ''}
      ${platformsHtml ? `<div>
        <div class="detail-section-title">Where to Watch</div>
        ${platformsHtml}
      </div>` : ''}
      ${extLinks ? `<div>
        <div class="detail-section-title">Links</div>
        <div class="detail-links-row">${extLinks}</div>
      </div>` : ''}
      ${e.in_universe_year ? `<div>
        <div class="detail-section-title">In-Universe Year</div>
        <p style="font-size:14px;color:var(--text2)">${escapeHtml(e.in_universe_year)}</p>
      </div>` : ''}
      ${e.post_credit_scenes > 0 ? `<div style="font-size:13px;color:var(--text3)"><i class="fa-solid fa-film txt-gold"></i> ${e.post_credit_scenes} post-credit scene${e.post_credit_scenes>1?'s':''}</div>` : ''}
    </div>`;

  document.getElementById('detail-content').innerHTML = content;
  openPanel('detail-panel');
}

function updateDetailWatchBtn(id) {
  const btn = document.getElementById('detail-watch-btn');
  if (!btn) return;
  const watched = USER_STATE.watched.includes(id);
  btn.classList.toggle('active', watched);
  btn.innerHTML = `<i class="fa-solid ${watched?'fa-check':'fa-eye'}"></i> ${watched ? 'Watched' : 'Mark Watched'}`;
}

function updateDetailWishBtn(id) {
  const btn = document.getElementById('detail-wish-btn');
  if (!btn) return;
  const wishlisted = USER_STATE.wishlist.includes(id);
  btn.classList.toggle('active', wishlisted);
  btn.innerHTML = `<i class="fa-solid fa-bookmark"></i> ${wishlisted ? 'Wishlisted' : 'Wishlist'}`;
}

// ─── STAR DETAIL PANEL ────────────────────────────────
function openStarDetail(starId) {
  const s = STARS_DATA.stars.find(x => x.id === starId);
  if (!s) return;

  const bio  = s.bio || '';
  const social = s.social_media || {};
  const links  = s.links || {};

  const socialHtml = [
    social.instagram ? `<a class="star-soc-btn" href="${social.instagram}" target="_blank"><i class="fa-brands fa-instagram"></i> Instagram</a>` : '',
    social.twitter   ? `<a class="star-soc-btn" href="${social.twitter}" target="_blank"><i class="fa-brands fa-x-twitter"></i> Twitter</a>` : '',
    social.facebook  ? `<a class="star-soc-btn" href="${social.facebook}" target="_blank"><i class="fa-brands fa-facebook"></i> Facebook</a>` : '',
    links.imdb       ? `<a class="star-soc-btn" href="${links.imdb}" target="_blank"><i class="fa-brands fa-imdb"></i> IMDb</a>` : '',
    links.wikipedia  ? `<a class="star-soc-btn" href="${links.wikipedia}" target="_blank"><i class="fa-brands fa-wikipedia-w"></i> Wiki</a>` : '',
  ].filter(Boolean).join('');

  const appearances = (s.mcu_appearances || [])
    .map(id => getEntry(id))
    .filter(Boolean);

  const appsHtml = appearances.map(e =>
    `<div class="star-app-card" onclick="closePanel('star-panel');setTimeout(()=>openDetail('${e.id}'),200)">
      <img class="star-app-poster" src="${e.image}" alt="${escapeHtml(e.title)}" loading="lazy" onerror="this.src=''">
      <div class="star-app-title">${escapeHtml(e.title)}</div>
    </div>`
  ).join('');

  const content = `
    <div class="star-detail-header">
      <img class="star-detail-img" src="${s.image}" alt="${escapeHtml(s.name)}" onerror="this.src=''">
      <div class="star-detail-info">
        <div class="star-detail-name">${escapeHtml(s.name)}</div>
        <div class="star-detail-char">${escapeHtml(s.character||'')}</div>
        <div class="star-detail-meta">${s.nationality||''} ${s.age ? `· Age ${s.age}` : ''}</div>
      </div>
    </div>
    <div class="star-detail-body">
      ${bio ? `<div>
        <div class="detail-section-title">Bio</div>
        <p style="font-size:13px;color:var(--text2);line-height:1.7">${escapeHtml(bio)}</p>
      </div>` : ''}
      ${appsHtml ? `<div>
        <div class="detail-section-title">MCU Appearances (${appearances.length})</div>
        <div class="star-appearances-grid">${appsHtml}</div>
      </div>` : ''}
      ${socialHtml ? `<div>
        <div class="detail-section-title">Links</div>
        <div class="star-social-links">${socialHtml}</div>
      </div>` : ''}
    </div>`;

  document.getElementById('star-content').innerHTML = content;
  openPanel('star-panel');
}

// ─── ACCOUNT PANEL ────────────────────────────────────
function openAccountPanel() {
  renderAccountContent();
  openPanel('account-panel');
}

function renderAccountContent() {
  const container = document.getElementById('account-content');
  if (!container) return;

  const name = USER_STATE.name;

  if (!name) {
    container.innerHTML = `<div class="account-setup">
      <div>
        <label class="acct-label">Your Name</label>
        <input class="acct-input" id="acct-name-input" placeholder="e.g. Tony Stark" maxlength="40">
      </div>
      <button class="acct-btn-primary" onclick="saveAccountName()">
        <i class="fa-solid fa-user-check"></i> Create Profile
      </button>
      ${IS_VIEW_MODE ? '<p style="font-size:12px;color:var(--text3);text-align:center">View-only mode — you are browsing someone else\'s journey</p>' : ''}
    </div>`;
  } else {
    const xp   = calcXP();
    const rank = getRank(xp);
    const watched  = USER_STATE.watched.length;
    const wishlist = USER_STATE.wishlist.length;
    const achievements = ACHIEVEMENTS.filter(a => a.req(USER_STATE)).length;

    container.innerHTML = `<div class="profile-display">
      <div class="profile-header">
        <div class="profile-avatar-lg">${name[0].toUpperCase()}</div>
        <div>
          <div class="profile-name">${escapeHtml(name)}</div>
          <div class="profile-sub">${rank.name} · Level ${rank.level} · ${xp} XP</div>
        </div>
      </div>
      <div class="profile-stats-row">
        <div class="ps-card"><span class="ps-num">${watched}</span><span class="ps-label">Watched</span></div>
        <div class="ps-card"><span class="ps-num">${wishlist}</span><span class="ps-label">Wishlist</span></div>
        <div class="ps-card"><span class="ps-num">${achievements}</span><span class="ps-label">Achievements</span></div>
      </div>
      ${!IS_VIEW_MODE ? `<button class="acct-btn-danger" onclick="resetAccount()">
        <i class="fa-solid fa-trash"></i> Reset All Data
      </button>` : ''}
    </div>`;
  }
}

function saveAccountName() {
  const input = document.getElementById('acct-name-input');
  const name  = input?.value.trim();
  if (!name) { showToast('Enter a name first', 'red'); return; }
  USER_STATE.name = name;
  saveUserState();
  updateHeaderAvatar();
  renderAccountContent();
  showToast(`Welcome, ${name}! <i class="fa-solid fa-bolt"></i>`, 'gold');
}

function resetAccount() {
  if (!confirm('This will delete ALL your watch history and wishlist. Are you sure?')) return;
  USER_STATE = { name: '', watched: [], wishlist: [] };
  saveUserState();
  updateAllUI();
  renderAccountContent();
  closePanel('account-panel');
  showToast('Data reset', 'red');
}

function updateHeaderAvatar() {
  const el = document.getElementById('hdr-avatar');
  if (!el) return;
  const name = USER_STATE.name;
  el.textContent = name ? name[0].toUpperCase() : '?';
}

// ─── SHARE PANEL ──────────────────────────────────────
function openSharePanel() {
  if (!USER_STATE.name) {
    openAccountPanel();
    showToast('Set your name first to share', 'gold');
    return;
  }
  renderShareContent();
  openPanel('share-panel');
}

function renderShareContent() {
  const container = document.getElementById('share-content');
  if (!container) return;

  const shareObj = {
    name:     USER_STATE.name,
    watched:  USER_STATE.watched,
    wishlist: USER_STATE.wishlist,
  };
  const encoded = btoa(JSON.stringify(shareObj));
  const url     = `${BASE_URL}?${VIEW_PARAM}=${encoded}`;

  container.innerHTML = `
    ${IS_VIEW_MODE ? `<div class="view-mode-banner"><i class="fa-solid fa-eye"></i> You're viewing someone else's journey</div>` : ''}
    <div class="detail-section-title">Your Share Link</div>
    <div class="share-url-box">
      <span class="share-url-text" id="share-url-text">${url}</span>
      <button class="share-copy-btn" onclick="copyShareUrl('${escapeHtml(url)}')">Copy</button>
    </div>
    <p class="share-note">Anyone with this link can view your MCU journey — they can't edit it. The link is generated from your current progress and updates each time you open this panel.</p>
  `;
}

function copyShareUrl(url) {
  navigator.clipboard.writeText(url).then(() => {
    showToast('<i class="fa-solid fa-copy"></i> Link copied!', 'blue');
  }).catch(() => {
    // Fallback
    const el = document.getElementById('share-url-text');
    if (el) {
      const range = document.createRange();
      range.selectNode(el);
      window.getSelection()?.addRange(range);
    }
    showToast('Select and copy the link', 'gold');
  });
}

// ─── PANELS ───────────────────────────────────────────
function openPanel(id) {
  document.getElementById(id)?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closePanel(id) {
  document.getElementById(id)?.classList.add('hidden');
  document.body.style.overflow = '';
}

// ─── TABS ─────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelector(`#tab-${tab}`)?.classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Lazy re-renders
  if (tab === 'journey') renderJourneyTab();
  if (tab === 'wishlist') renderWishlistTab();
}

// ─── MISC EVENT LISTENERS ─────────────────────────────
function setupEventListeners() {
  // Close panels on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['detail-panel','star-panel','account-panel','share-panel'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) closePanel(id);
      });
    }
  });
}

// ─── HELPERS ──────────────────────────────────────────
function getEntry(id) {
  return MCU_DATA.entries.find(e => e.id === id) || null;
}

function isUpcoming(e) {
  if (e.status === 'upcoming') return true;
  if (!e.release_date) return false;
  return new Date(e.release_date) > new Date();
}

function phaseComplete(state, phaseId) {
  const entries = MCU_DATA.entries.filter(e => e.phase === phaseId && !isUpcoming(e));
  return entries.length > 0 && entries.every(e => state.watched.includes(e.id));
}

function allReleasedWatched(state) {
  const released = MCU_DATA.entries.filter(e => !isUpcoming(e));
  return released.length > 0 && released.every(e => state.watched.includes(e.id));
}

function setEl(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ─── TOAST ────────────────────────────────────────────
function showToast(msg, type = '') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type ? 'toast-' + type : ''}`;
  toast.innerHTML = msg;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 300);
  }, 2200);
}
