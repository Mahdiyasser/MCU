/* =====================================================
   MCU UNIVERSE — script.js
   Author: Mahdi Yasser
   ===================================================== */

'use strict';

// ─── Image URL Cache ──────────────────────────────────
// Deduplicates image requests: a URL will not be fetched more than once
// within a configurable window. Both the TTL and the localStorage key are
// driven by app.json > cache — safe defaults used until loadData() hydrates them.
let IMG_CACHE_TTL    = 20 * 60 * 1000; // overridden by app.json storage.img_cache_ttl_minutes
let IMG_CACHE_LS_KEY = 'mcu_img_cache'; // overridden by app.json storage.img_cache_key
let _imgCacheMap     = new Map();       // url -> { ts, stamped }

// Load persisted cache from localStorage on startup
(function _loadImgCache() {
  try {
    const raw = localStorage.getItem(IMG_CACHE_LS_KEY);
    if (raw) {
      const obj = JSON.parse(raw);
      const now = Date.now();
      // Hydrate map, dropping already-expired entries so localStorage stays lean
      for (const [url, entry] of Object.entries(obj)) {
        if ((now - entry.ts) < IMG_CACHE_TTL) _imgCacheMap.set(url, entry);
      }
    }
  } catch(e) {}
})();

function _saveImgCache() {
  try {
    const obj = {};
    for (const [url, entry] of _imgCacheMap) obj[url] = entry;
    localStorage.setItem(IMG_CACHE_LS_KEY, JSON.stringify(obj));
  } catch(e) {}
}

function cachedImgUrl(url) {
  if (!url) return url;
  const now   = Date.now();
  const entry = _imgCacheMap.get(url);
  if (entry && (now - entry.ts) < IMG_CACHE_TTL) {
    // Still within the 20-minute window — return the exact same stamped URL
    // so the browser serves it from cache.
    return entry.stamped;
  }
  // First load or TTL expired: stamp it, persist it, return the stamped URL.
  const stamped = url + (url.includes('?') ? '&' : '?') + '_cb=' + now;
  _imgCacheMap.set(url, { ts: now, stamped });
  _saveImgCache();
  return stamped;
}

// ─── Cache Bust (full) ────────────────────────────────
// localStorage key driven by app.json > cache.cbust_ls_key
let CBUST_KEY = 'last_cbust';

function recordCacheBust() {
  try { localStorage.setItem(CBUST_KEY, String(Date.now())); } catch(e) {}
}

function getLastCacheBust() {
  try { return parseInt(localStorage.getItem(CBUST_KEY) || '0', 10); } catch(e) { return 0; }
}

// Full cache bust: clears the in-memory image cache, then hard-reloads.
// Only called from user gesture (logo triple-click) — never auto-triggered
// while the user is actively on the page.
function fullCacheBust() {
  _imgCacheMap.clear();
  try { localStorage.removeItem(IMG_CACHE_LS_KEY); } catch(e) {}
  recordCacheBust();
  // Hard reload bypasses all browser/service-worker caches
  window.location.reload(true);
}

// ─── Logo Triple-Click Handler ────────────────────────
// Clicks required, window, and bust delay are all driven by app.json > logo_click
let _logoClickRequired = 3;    // app.json > behaviour.logo_click.clicks_required
let _logoClickWindow   = 3000; // app.json > behaviour.logo_click.window_ms
let _logoBustDelay     = 500;  // app.json > behaviour.logo_click.bust_delay_ms
let _logoClickTimes = [];

function _handleLogoClick() {
  const now = Date.now();
  _logoClickTimes = _logoClickTimes.filter(t => now - t < _logoClickWindow);
  _logoClickTimes.push(now);
  if (_logoClickTimes.length >= _logoClickRequired) {
    _logoClickTimes = [];
    showToast(t('toast_cache_bust'), 'gold');
    setTimeout(fullCacheBust, _logoBustDelay);
  }
}

// ─── Constants (hydrated from app.json after load) ───
let STORAGE_KEY  = 'mcu_universe_v1';   // app.json > storage.key
let VIEW_PARAM   = 'share';             // app.json > url_params.share
let IMPORT_PARAM = 'import';            // app.json > url_params.import
let BASE_URL     = 'https://mcu.mahdiyasser.site/app/'; // app.json > base_url
// Timing constants — all driven by app.json > timings
let TOAST_DURATION_MS    = 2200; // app.json > behaviour.toast_duration_ms
let TOAST_FADE_MS        = 300;  // app.json > behaviour.toast_fade_ms
let BONUS_CHECK_DELAY_MS = 400;  // app.json > behaviour.bonus_check_delay_ms
let XP_BAR_RERENDER_MS   = 900;  // app.json > behaviour.xp_bar_rerender_ms
let XP_BAR_ANIMATE_MS    = 300;  // app.json > behaviour.xp_bar_animate_ms
let SEARCH_DEBOUNCE_MS   = 200;  // app.json > behaviour.search_debounce_ms
let TAB_SCROLL_DELAY_MS  = 200;  // app.json > behaviour.tab_scroll_delay_ms
let LOADER_MIN_DELAY_MS  = 600;  // app.json > behaviour.loader_min_delay_ms
let XP_PER_WATCHED = 50;               // app.json > progression.xp_per_watched
let PHASE_COMPLETION_BONUS  = 200;     // app.json > progression.phase_completion_bonus
let SAGA_COMPLETION_BONUS   = 500;     // app.json > progression.saga_completion_bonus
let ACHIEVEMENT_BONUS       = 100;     // app.json > progression.achievement_bonus
let PHASE_BONUSES           = {};      // app.json > progression.phase_bonuses
let SAGA_BONUSES            = {};      // app.json > progression.saga_bonuses
let ACHIEVEMENT_BONUS_MAP   = {};      // built from app.json achievements[].bonus_xp

// XP / Rank system — loaded from app.json
let RANKS            = [];
let ACHIEVEMENTS     = [];
let PHASE_COLORS     = {};
let TYPE_COLORS      = {};
let TYPE_LABELS      = {};
let STATUSES         = {};  // app.json > statuses
let TIMELINE_FILTERS = [];  // app.json > timeline_filters
let APP_CONFIG       = null; // full app.json
let AVATARS          = [];
let AVATAR_BASE      = '/assets/app/avatars/';
let TABS             = [];  // app.json > ui.tabs
let PANELS           = ['detail-panel','star-panel','account-panel','share-panel','import-panel']; // app.json > ui.panels
let LOGO_PATH        = '/assets/app/logo.png'; // app.json > app.logo
let DEFAULT_USER_STATE = { name: '', watched: [], wishlist: [], avatar: null, bonus_xp: 0, earned_bonuses: [] }; // app.json > profile.default_state
let HERO_CONFIG      = {};  // app.json > ui.hero
let AUTHOR_CONFIG    = {};  // app.json > author
let UI_TEXT          = {};  // app.json > ui_text

// ─── UI Text helper ───────────────────────────────────
// Returns a ui_text string by key, with optional {placeholder} substitution.
// Falls back to the key itself if not found so nothing breaks during dev.
function t(key, vars) {
  let str = UI_TEXT[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replaceAll('{' + k + '}', v);
    }
  }
  return str;
}

// Converts an app.json achievement req object into a live function
function buildAchievementReq(req) {
  switch (req.type) {
    case 'watched_min':
      return s => s.watched.length >= req.count;
    case 'wishlist_min':
      return s => s.wishlist.length >= req.count;
    case 'phase_complete':
      return s => phaseComplete(s, req.phase_id);
    case 'phases_all_complete':
      return s => req.phase_ids.every(pid => phaseComplete(s, pid));
    case 'all_watched':
      return s => req.mcu_ids.every(id => s.watched.includes(id));
    case 'all_released_watched':
      return s => allReleasedWatched(s);
    default:
      return () => false;
  }
}

// ─── Global State ─────────────────────────────────────
let MCU_DATA             = null; // from data.json + mcu.json
let STARS_DATA           = null; // from stars.json
let STREAMING_PLATFORMS  = {};   // keyed by platform_id — hydrated from data.json > streaming_platforms
let USER_STATE  = null; // { name, watched[], wishlist[] }
let IS_VIEW_MODE = false;
let VIEW_STATE   = null;
let currentOrder  = 'release';
let currentFilter = 'all';
let activeTab     = 'home';
let searchTimeout = null;

// ─── URL / Modal Navigation ───────────────────────────
let _modalStack   = []; // stack of { type: 'title'|'star'|'profile'|'share', id }
let _suppressPopState = false;

function pushModalState(type, id) {
  const params = new URLSearchParams(window.location.search);
  // Build dl= from current modal if one is open
  if (_modalStack.length > 0) {
    const prev = _modalStack[_modalStack.length - 1];
    params.set('dl', prev.id || prev.type);
  } else {
    params.delete('dl');
  }
  if (id) params.set('id', id);
  else { params.delete('id'); params.set('id', type); }
  _modalStack.push({ type, id });
  history.pushState({ modal: type, id, stack: [..._modalStack] }, '', '?' + params.toString());
}

function popModalState() {
  _modalStack.pop();
  if (_modalStack.length > 0) {
    const prev = _modalStack[_modalStack.length - 1];
    const params = new URLSearchParams(window.location.search);
    params.set('id', prev.id || prev.type);
    params.delete('dl');
    history.replaceState({ modal: prev.type, id: prev.id, stack: [..._modalStack] }, '', '?' + params.toString());
  } else {
    clearModalFromUrl();
  }
}

function clearModalFromUrl() {
  _modalStack = [];
  const params = new URLSearchParams(window.location.search);
  params.delete('id');
  params.delete('dl');
  const qs = params.toString();
  history.replaceState({}, '', qs ? '?' + qs : window.location.pathname);
}

function syncTabToUrl(tab) {
  const params = new URLSearchParams(window.location.search);
  params.set('t', tab);
  params.delete('id');
  params.delete('dl');
  params.delete('find');
  _modalStack = [];
  history.pushState({ tab }, '', '?' + params.toString());
}

function syncSearchToUrl(q) {
  const params = new URLSearchParams(window.location.search);
  if (q && q.length >= 2) params.set('find', q);
  else params.delete('find');
  history.replaceState({}, '', '?' + params.toString());
}

function readUrlOnLoad() {
  const params = new URLSearchParams(window.location.search);
  const tab    = params.get('t');
  const id     = params.get('id');
  const find   = params.get('find');
  const dl     = params.get('dl');

  if (tab && (TABS.length ? TABS.map(t => t.id) : ['home','timeline','journey','wishlist','stars']).includes(tab)) {
    switchTabSilent(tab);
  } else if (!tab) {
    // No t= in URL — normalise to ?t=home so the URL is consistent whether
    // the user landed fresh or navigated back to the home tab.
    params.set('t', 'home');
    history.replaceState({ tab: 'home' }, '', '?' + params.toString());
  }

  if (find) {
    const input = document.getElementById('global-search');
    if (input) {
      input.value = find;
      renderSearchResults(find);
    }
  }

  if (id) {
    // Restore deep link backing modal first
    if (dl) {
      const dlEntry = getEntry(dl);
      const dlStar  = STARS_DATA?.stars.find(s => s.id === dl);
      if (dlEntry) { _modalStack.push({ type: 'title', id: dl }); openDetailSilent(dl); }
      else if (dlStar) { _modalStack.push({ type: 'star', id: dl }); openStarDetailSilent(dl); }
    }
    // Now open the primary modal
    if (id === 'profile') openAccountPanelSilent();
    else if (id === 'share') openSharePanelSilent();
    else {
      const entry = getEntry(id);
      const star  = STARS_DATA?.stars.find(s => s.id === id);
      if (entry) openDetailSilent(id);
      else if (star) openStarDetailSilent(id);
    }
  }
}

// ─── Init ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  await loadData();
  checkViewMode();
  loadUserState();
  recomputeBonusXP();
  saveUserState();
  render();
  initSearch();
  setupEventListeners();

  // Restore URL state
  readUrlOnLoad();

  // Preload all images during the loading screen so they're ready when it lifts.
  // This runs concurrently — the loader waits for it but the user sees the spinner
  // the whole time, so perceived load time is unchanged.
  const _preloadDone = preloadAssets();

  // Loader out — wait for preload OR 600ms, whichever is longer
  const _minDelay = new Promise(r => setTimeout(r, LOADER_MIN_DELAY_MS));
  Promise.all([_preloadDone, _minDelay]).then(() => {
    const loader = document.getElementById('loader');
    loader && loader.classList.add('fade-out');
    // Show import panel if triggered by ?import= link
    if (window._pendingImport) {
      openImportPanel(window._pendingImport);
    }
  });
});

// ─── Asset Preloader ───────────────────────────────────
// Called during the loading screen. Preloads every MCU entry poster,
// every star photo, and every avatar image in parallel.
// Returns a Promise that resolves when all images have settled.
// Individual failures are silently ignored — no broken-image errors here.
async function preloadAssets() {
  const urls = new Set();

  // MCU entry posters
  if (MCU_DATA?.entries) {
    for (const e of MCU_DATA.entries) {
      if (e.image) urls.add(e.image);
    }
  }

  // Star photos
  if (STARS_DATA?.stars) {
    for (const s of STARS_DATA.stars) {
      if (s.image) urls.add(s.image);
    }
  }

  // Avatar images
  for (const av of AVATARS) {
    if (av.file) urls.add(AVATAR_BASE + av.file);
  }

  // Run each raw URL through cachedImgUrl() — this stamps it with ?_cb=<ts>,
  // registers it in _imgCacheMap, and persists to localStorage. Subsequent
  // render calls within the TTL get back the exact same stamped URL so the
  // browser serves it from cache instead of fetching again.
  const stampedUrls = [...urls].map(url => cachedImgUrl(url));

  // Kick off all preloads in parallel; allSettled so we never throw
  await Promise.allSettled(stampedUrls.map(url => new Promise(resolve => {
    const img = new Image();
    img.onload  = resolve;
    img.onerror = resolve;
    img.src     = url;
  })));
}

// ─── Data Loading ──────────────────────────────────────
async function loadData() {
  try {
    const appRes = await fetch('/assets/app/app.json');
    const app    = await appRes.json();

    // ── app.app ──────────────────────────────────────────
    const src = app.app?.data_sources || { mcu: '/assets/mcu.json', stars: '/assets/stars.json', data: '/assets/data.json' };
    if (app.app?.logo) LOGO_PATH = app.app.logo;

    const [mcuRes, starsRes, dataRes] = await Promise.all([
      fetch(src.mcu),
      fetch(src.stars),
      fetch(src.data),
    ]);
    const mcu   = await mcuRes.json();
    const stars = await starsRes.json();
    const data  = await dataRes.json();

    MCU_DATA   = { ...data, ...mcu };
    STARS_DATA = stars;
    APP_CONFIG = app;

    // Build streaming platform lookup from data.json > streaming_platforms
    if (Array.isArray(data.streaming_platforms)) {
      data.streaming_platforms.forEach(p => { STREAMING_PLATFORMS[p.id] = p; });
    }

    // ── app.storage ──────────────────────────────────────
    if (app.storage?.key)                  STORAGE_KEY      = app.storage.key;
    if (app.storage?.img_cache_key)        IMG_CACHE_LS_KEY = app.storage.img_cache_key;
    if (app.storage?.img_cache_ttl_minutes) IMG_CACHE_TTL   = app.storage.img_cache_ttl_minutes * 60 * 1000;
    if (app.storage?.cbust_key)            CBUST_KEY        = app.storage.cbust_key;

    // ── app.url_params ───────────────────────────────────
    if (app.url_params?.share)  VIEW_PARAM   = app.url_params.share;
    if (app.url_params?.import) IMPORT_PARAM = app.url_params.import;

    // ── app.base_url ─────────────────────────────────────
    if (app.base_url) BASE_URL = app.base_url;

    // ── app.behaviour ────────────────────────────────────
    const beh = app.behaviour || {};
    if (beh.loader_min_delay_ms)  LOADER_MIN_DELAY_MS  = beh.loader_min_delay_ms;
    if (beh.toast_duration_ms)    TOAST_DURATION_MS    = beh.toast_duration_ms;
    if (beh.toast_fade_ms)        TOAST_FADE_MS        = beh.toast_fade_ms;
    if (beh.bonus_check_delay_ms) BONUS_CHECK_DELAY_MS = beh.bonus_check_delay_ms;
    if (beh.xp_bar_rerender_ms)   XP_BAR_RERENDER_MS   = beh.xp_bar_rerender_ms;
    if (beh.xp_bar_animate_ms)    XP_BAR_ANIMATE_MS    = beh.xp_bar_animate_ms;
    if (beh.search_debounce_ms)   SEARCH_DEBOUNCE_MS   = beh.search_debounce_ms;
    if (beh.tab_scroll_delay_ms)  TAB_SCROLL_DELAY_MS  = beh.tab_scroll_delay_ms;
    if (beh.logo_click?.clicks_required) _logoClickRequired = beh.logo_click.clicks_required;
    if (beh.logo_click?.window_ms)       _logoClickWindow   = beh.logo_click.window_ms;
    if (beh.logo_click?.bust_delay_ms)   _logoBustDelay     = beh.logo_click.bust_delay_ms;
    // Expose to inline onclick handlers in HTML strings
    window._TAB_SCROLL_DELAY = TAB_SCROLL_DELAY_MS;

    // ── app.progression ──────────────────────────────────
    const prog = app.progression || {};
    if (prog.xp_per_watched)         XP_PER_WATCHED        = prog.xp_per_watched;
    if (prog.phase_completion_bonus) PHASE_COMPLETION_BONUS = prog.phase_completion_bonus;
    if (prog.saga_completion_bonus)  SAGA_COMPLETION_BONUS  = prog.saga_completion_bonus;
    if (prog.achievement_bonus)      ACHIEVEMENT_BONUS      = prog.achievement_bonus;
    if (prog.phase_bonuses)          PHASE_BONUSES          = prog.phase_bonuses;
    if (prog.saga_bonuses)           SAGA_BONUSES           = prog.saga_bonuses;

    RANKS = (prog.ranks || []).map(r => ({ name: r.name, min: r.min_xp, level: r.level }));

    ACHIEVEMENTS = (prog.achievements || []).map(a => ({
      id:       a.id,
      icon:     `<i class="${a.icon_fa}"></i>`,
      name:     a.name,
      desc:     a.desc,
      bonus_xp: a.bonus_xp || 0,
      req:      buildAchievementReq(a.req),
    }));

    ACHIEVEMENT_BONUS_MAP = Object.fromEntries(
      (prog.achievements || []).filter(a => a.bonus_xp).map(a => [a.id, a.bonus_xp])
    );

    // ── app.ui ───────────────────────────────────────────
    const ui = app.ui || {};
    PHASE_COLORS     = ui.phase_colors || {};
    TYPE_COLORS      = Object.fromEntries(Object.entries(ui.content_types || {}).map(([k,v]) => [k, v.css_class]));
    TYPE_LABELS      = Object.fromEntries(Object.entries(ui.content_types || {}).map(([k,v]) => [k, v.label]));
    STATUSES         = ui.statuses || {};
    TIMELINE_FILTERS = ui.timeline_filters || [
      { value: 'all',    label: 'All' },
      { value: 'movie',  label: 'Movies' },
      { value: 'series', label: 'Series' },
      { value: 'special_presentation', label: 'Specials' },
    ];
    if (ui.tabs)   TABS   = ui.tabs;
    if (ui.panels) PANELS = ui.panels;
    if (ui.hero)   HERO_CONFIG = ui.hero;

    // ── app.profile ──────────────────────────────────────
    const prof = app.profile || {};
    if (prof.default_state)       DEFAULT_USER_STATE = prof.default_state;
    if (prof.avatars?.items)      AVATARS            = prof.avatars.items;
    if (prof.avatars?.base_path)  AVATAR_BASE        = prof.avatars.base_path;

    // ── app.author ───────────────────────────────────────
    if (app.author) AUTHOR_CONFIG = app.author;

    // ── app.ui_text ──────────────────────────────────────
    if (app.ui_text) UI_TEXT = app.ui_text;

  } catch (e) {
    console.error('Failed to load data files:', e);
    // Fallback: graceful empty state
    MCU_DATA     = { entries: [], release_order: [], chronological_order: [], about: { phases: [] } };
    STARS_DATA   = { stars: [] };
    RANKS        = [{ name: 'Civilian', min: 0, level: 1 }];
    ACHIEVEMENTS = [];
    PHASE_COLORS = {};
    TYPE_COLORS  = {};
    TYPE_LABELS  = {};
    STATUSES     = {};
    TIMELINE_FILTERS = [];
  }
}

// ─── View Mode (Shared URL) ────────────────────────────
function checkViewMode() {
  const params = new URLSearchParams(window.location.search);
  const shareData  = params.get(VIEW_PARAM);
  const importData = params.get(IMPORT_PARAM);

  if (importData) {
    try {
      const decoded = JSON.parse(atob(importData));
      // Schedule the import panel to open after render
      window._pendingImport = decoded;
    } catch(e) {
      // invalid import link, ignore
    }
    return;
  }

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
      USER_STATE = { ...DEFAULT_USER_STATE };
    }
  } catch(e) {
    USER_STATE = { ...DEFAULT_USER_STATE };
  }
  // Ensure fields exist (backwards-compat with old saved states)
  if (!Array.isArray(USER_STATE.watched))       USER_STATE.watched       = [];
  if (!Array.isArray(USER_STATE.wishlist))      USER_STATE.wishlist      = [];
  if (!Array.isArray(USER_STATE.earned_bonuses)) USER_STATE.earned_bonuses = [];
  if (!USER_STATE.avatar)                       USER_STATE.avatar        = null;
  if (typeof USER_STATE.bonus_xp !== 'number')  USER_STATE.bonus_xp      = 0;
}

function saveUserState() {
  if (IS_VIEW_MODE) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(USER_STATE));
  } catch(e) { console.error('Save failed:', e); }
}

// ─── RECOMPUTE BONUS XP ───────────────────────────────
// Recalculates bonus_xp from scratch based on earned_bonuses and
// current bonus values from app.json. Fixes stale XP on import,
// handles edited bonus values, and newly added bonuses.
function recomputeBonusXP() {
  if (!Array.isArray(USER_STATE.earned_bonuses)) USER_STATE.earned_bonuses = [];
  let total = 0;
  for (const key of USER_STATE.earned_bonuses) {
    if (key.startsWith('achievement:')) {
      const achId = key.slice('achievement:'.length);
      const ach = ACHIEVEMENTS.find(a => a.id === achId);
      if (ach && ach.bonus_xp) total += ach.bonus_xp;
    } else if (key.startsWith('phase:')) {
      const phaseId = key.slice('phase:'.length);
      total += PHASE_BONUSES[phaseId] ?? PHASE_COMPLETION_BONUS;
    } else if (key.startsWith('saga:')) {
      const sagaId = key.slice('saga:'.length);
      total += SAGA_BONUSES[sagaId] ?? SAGA_COMPLETION_BONUS;
    }
  }
  // Also check for newly unlocked achievements not yet in earned_bonuses
  for (const a of ACHIEVEMENTS) {
    if (!a.bonus_xp) continue;
    const bonusKey = `achievement:${a.id}`;
    if (!USER_STATE.earned_bonuses.includes(bonusKey) && a.req(USER_STATE)) {
      USER_STATE.earned_bonuses.push(bonusKey);
      total += a.bonus_xp;
    }
  }

  // Also check for completed phases not yet in earned_bonuses
  const phases = MCU_DATA?.about?.phases ?? [];
  for (const phase of phases) {
    const bonusKey   = `phase:${phase.id}`;
    const phaseBonus = PHASE_BONUSES[phase.id] ?? PHASE_COMPLETION_BONUS;
    if (!USER_STATE.earned_bonuses.includes(bonusKey) && phaseComplete(USER_STATE, phase.id)) {
      USER_STATE.earned_bonuses.push(bonusKey);
      total += phaseBonus;
    }
  }

  // Also check for completed sagas not yet in earned_bonuses
  const sagas = MCU_DATA?.about?.sagas ?? [];
  for (const saga of sagas) {
    const bonusKey  = `saga:${saga.id}`;
    const sagaBonus = SAGA_BONUSES[saga.id] ?? SAGA_COMPLETION_BONUS;
    const sagaDone  = saga.phases.map(n => `phase_${n}`).every(pid => phaseComplete(USER_STATE, pid));
    if (!USER_STATE.earned_bonuses.includes(bonusKey) && sagaDone) {
      USER_STATE.earned_bonuses.push(bonusKey);
      total += sagaBonus;
    }
  }

  USER_STATE.bonus_xp = total;
}

// ─── Toggle Watch / Wishlist ──────────────────────────
function toggleWatched(id, evt) {
  if (IS_VIEW_MODE) { showToast(t('toast_view_only'), 'blue'); return; }
  if (evt) evt.stopPropagation();
  const i = USER_STATE.watched.indexOf(id);
  if (i === -1) {
    USER_STATE.watched.push(id);
    showToast(t('toast_marked_watched'), 'green');
    // Award bonus XP for milestones triggered by this watch
    setTimeout(() => checkAndAwardBonuses(id), BONUS_CHECK_DELAY_MS);
  } else {
    USER_STATE.watched.splice(i, 1);
    showToast(t('toast_removed_watched'), 'red');
  }
  saveUserState();
  updateAllUI();
}

// ─── BONUS XP ENGINE ──────────────────────────────────
function awardBonusXP(bonusKey, amount, label, icon) {
  if (USER_STATE.earned_bonuses.includes(bonusKey)) return; // already earned
  USER_STATE.earned_bonuses.push(bonusKey);
  USER_STATE.bonus_xp = (USER_STATE.bonus_xp || 0) + amount;
  saveUserState();
  // Staggered toast so it appears after the "marked as watched" toast
  setTimeout(() => {
    showToast(
      `<i class="${icon}"></i> <strong>+${amount} XP</strong> — ${label}`,
      'gold'
    );
  }, 800);
  // Re-render XP bar with new total
  setTimeout(() => renderXPBar(), XP_BAR_RERENDER_MS);
}

function checkAndAwardBonuses(watchedId) {
  const entry     = getEntry(watchedId);
  if (!entry) return;
  const phaseId   = entry.phase;
  const phaseData = MCU_DATA.about?.phases?.find(p => p.id === phaseId);
  const saga      = MCU_DATA.about?.sagas?.find(s => s.phases.includes(phaseData?.number));

  // ── Achievement bonuses ──────────────────────────────
  for (const a of ACHIEVEMENTS) {
    if (!a.bonus_xp) continue;
    const bonusKey = `achievement:${a.id}`;
    if (!USER_STATE.earned_bonuses.includes(bonusKey) && a.req(USER_STATE)) {
      awardBonusXP(bonusKey, a.bonus_xp, a.name, a.icon.match(/class="([^"]+)"/)?.[1] || 'fa-solid fa-trophy');
    }
  }

  // ── Phase completion bonus ───────────────────────────
  if (phaseId && phaseData) {
    const bonusKey  = `phase:${phaseId}`;
    const phaseBonus = PHASE_BONUSES[phaseId] ?? PHASE_COMPLETION_BONUS;
    if (!USER_STATE.earned_bonuses.includes(bonusKey) && phaseComplete(USER_STATE, phaseId)) {
      awardBonusXP(
        bonusKey,
        phaseBonus,
        `${phaseData.name} Complete!`,
        'fa-solid fa-layer-group'
      );
    }
  }

  // ── Saga completion bonus ────────────────────────────
  if (saga) {
    const bonusKey  = `saga:${saga.id}`;
    const sagaBonus = SAGA_BONUSES[saga.id] ?? SAGA_COMPLETION_BONUS;
    const sagaPhaseIds = saga.phases.map(num => `phase_${num}`);
    const sagaDone = sagaPhaseIds.every(pid => phaseComplete(USER_STATE, pid));
    if (!USER_STATE.earned_bonuses.includes(bonusKey) && sagaDone) {
      awardBonusXP(
        bonusKey,
        sagaBonus,
        `${saga.name} Complete!`,
        'fa-solid fa-infinity'
      );
    }
  }
}

function toggleWishlist(id, evt) {
  if (IS_VIEW_MODE) { showToast(t('toast_view_only'), 'blue'); return; }
  if (evt) evt.stopPropagation();
  const i = USER_STATE.wishlist.indexOf(id);
  if (i === -1) {
    USER_STATE.wishlist.push(id);
    showToast(t('toast_added_wishlist'), 'gold');
  } else {
    USER_STATE.wishlist.splice(i, 1);
    showToast(t('toast_removed_wishlist'), 'red');
  }
  saveUserState();
  updateAllUI();
}

// ─── Main Render ──────────────────────────────────────
function render() {
  buildBottomNav();
  buildTimelineFilters();
  buildTabHeroes();
  renderHomeTab();
  renderTimelineTab();
  renderJourneyTab();
  renderWishlistTab();
  renderStarsTab();
  updateHeaderAvatar();
  updateWishlistBadge();
}

// Builds bottom nav dynamically from app.json tabs
function buildBottomNav() {
  const nav = document.getElementById('bottom-nav');
  if (!nav || !TABS.length) return;
  nav.innerHTML = TABS.map(t => {
    const badgeHtml = t.badge
      ? `<span id="${t.id}-badge" class="nav-badge hidden">0</span>`
      : '';
    return `<button class="nav-btn${t.id === activeTab ? ' active' : ''}" data-tab="${t.id}" onclick="switchTab('${t.id}')">
  <i class="${t.icon_fa}"></i>
  <span>${escapeHtml(t.label)}</span>
  ${badgeHtml}
</button>`;
  }).join('');
}

// Builds the filter-row buttons dynamically from app.json timeline_filters
function buildTimelineFilters() {
  const filterRow = document.querySelector('.filter-row');
  if (!filterRow || !TIMELINE_FILTERS.length) return;
  filterRow.innerHTML = TIMELINE_FILTERS.map((f, i) => {
    const active = i === 0 ? 'active' : '';
    return `<button class="filter-btn ${active}" data-filter="${f.value}" onclick="setTypeFilter('${f.value}',this)">${f.label}</button>`;
  }).join('');
}

function updateAllUI() {
  updateStats();
  updateTimelineCards();
  updateJourneyTab();
  renderWishlistTab();
  updateWishlistBadge();
  updateHeaderAvatar();
}

// Renders tab-hero-mini h1/p from app.json tabs[].hero_title / hero_sub
function buildTabHeroes() {
  if (!TABS.length) return;
  TABS.forEach(t => {
    if (!t.hero_title) return;
    const section = document.getElementById(`tab-${t.id}`);
    if (!section) return;
    const mini = section.querySelector('.tab-hero-mini');
    if (!mini) return;
    const h1 = mini.querySelector('h1');
    const p  = mini.querySelector('p');
    if (h1) h1.textContent = t.hero_title;
    if (p && t.hero_sub) p.textContent = t.hero_sub;
  });
}

// ─── HOME TAB ─────────────────────────────────────────
function renderHomeTab() {
  const total = MCU_DATA.entries.length;
  document.getElementById('hero-total').textContent = total;
  updateStats();
  renderPhaseOverview();
  renderCurrentlyWatching();
  renderUpcoming();
  renderHeroCopy();
  renderAuthorCard();
}

function renderHeroCopy() {
  const h = HERO_CONFIG;
  if (!h || !Object.keys(h).length) return;
  const badge = document.querySelector('.phase-badge');
  if (badge && h.eyebrow_badge) badge.textContent = h.eyebrow_badge;
  const title = document.querySelector('.hero-title');
  if (title && h.title_line1) title.innerHTML = `${escapeHtml(h.title_line1)}<br>${escapeHtml(h.title_line2||'')}`;
  // hero.sub — supports {total} placeholder
  if (h.sub) {
    const subEl = document.querySelector('.hero-sub');
    if (subEl) {
      const total = MCU_DATA?.entries?.length || 0;
      subEl.innerHTML = escapeHtml(h.sub).replace('{total}', `<strong id="hero-total">${total}</strong>`);
    }
  }
  // hero.cta_buttons
  if (Array.isArray(h.cta_buttons) && h.cta_buttons.length) {
    const ctaRow = document.querySelector('.hero-cta-row');
    if (ctaRow) {
      ctaRow.innerHTML = h.cta_buttons.map(b =>
        `<button class="${escapeHtml(b.style)}" onclick="switchTab('${escapeHtml(b.tab)}')">
          <i class="${escapeHtml(b.icon_fa)}"></i> ${escapeHtml(b.label)}
        </button>`
      ).join('');
    }
  }
  // Update logo src from app.json logo_path
  const logoImg = document.querySelector('.header-logo-img');
  if (logoImg && LOGO_PATH) logoImg.src = LOGO_PATH;
}

function renderAuthorCard() {
  const a = AUTHOR_CONFIG;
  if (!a || !Object.keys(a).length) return;
  const card = document.querySelector('.about-footer-card');
  if (!card) return;
  const linksHtml = (a.links || []).map(l =>
    `<a href="${l.url}" target="_blank" class="afc-btn ${l.style||''}"><i class="${l.icon_fa}"></i> ${escapeHtml(l.label)}</a>`
  ).join('');
  card.innerHTML = `
    <div class="afc-left">
      <img src="${a.avatar_img}" alt="${escapeHtml(a.name)}" class="afc-avatar afc-avatar-img">
      <div class="afc-text">
        <span class="afc-name">${escapeHtml(a.name)}</span>
        <span class="afc-role">${escapeHtml(a.role)}</span>
        <span class="afc-bio">${escapeHtml(a.bio)}</span>
      </div>
    </div>
    <div class="afc-links">${linksHtml}</div>`;
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

    return `<div class="phase-overview-card" data-phase="${p.id}" onclick="switchTab('timeline');setTimeout(()=>scrollToPhase('${p.id}'),window._TAB_SCROLL_DELAY||200)">
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
  const watched    = USER_STATE.watched.includes(id);
  const wishlisted = USER_STATE.wishlist.includes(id);
  const statusKey  = getStatus(e);
  const statusCfg  = STATUSES[statusKey] || {};
  const year       = e.release_date ? e.release_date.split('-')[0] : '';
  const statusTag  = statusCfg.card_tag
    ? `<div class="mcu-card-upcoming-tag" style="color:${statusCfg.color || 'var(--gold)'}">${statusCfg.card_tag}</div>`
    : '';

  return `<div class="mcu-card ${watched?'watched':''} ${wishlisted?'wishlisted':''}" onclick="openDetail('${id}')">
    <div style="position:relative">
      <img class="mcu-card-poster" src="${cachedImgUrl(e.image)}" alt="${escapeHtml(e.title)}" loading="lazy" onerror="this.style.background='var(--surface3)';this.src=''">
      <div class="mcu-card-badges">
        ${watched  ? '<div class="card-badge badge-watched"><i class="fa-solid fa-check"></i></div>' : ''}
        ${wishlisted && !watched ? '<div class="card-badge badge-wishlist"><i class="fa-solid fa-bookmark"></i></div>' : ''}
      </div>
      ${statusTag}
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
  const statusKey  = getStatus(e);
  const upcoming   = statusKey !== 'released';
  const statusCfg  = STATUSES[statusKey] || {};
  const year       = e.release_date ? e.release_date.split('-')[0] : '';
  const statusTag  = statusCfg.card_tag
    ? `<div class="mcu-card-upcoming-tag" style="color:${statusCfg.color || 'var(--gold)'}">${statusCfg.card_tag}</div>`
    : '';

  return `<div class="mcu-card-full ${watched?'watched':''} ${wishlisted?'wishlisted':''} ${upcoming?'upcoming':''}"
    data-id="${e.id}" onclick="openDetail('${e.id}')">
    <div class="card-poster-wrap">
      <img class="mcu-card-poster" src="${cachedImgUrl(e.image)}" alt="${escapeHtml(e.title)}" loading="lazy" onerror="this.style.background='var(--surface3)';this.src=''">
      ${watched ? '<div class="card-watched-indicator"><i class="fa-solid fa-check"></i></div>' : ''}
      ${wishlisted && !watched ? '<div class="card-wish-indicator"><i class="fa-solid fa-bookmark"></i></div>' : ''}
      ${statusTag}
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
  return (USER_STATE.watched.length * XP_PER_WATCHED) + (USER_STATE.bonus_xp || 0);
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
  if (bar) setTimeout(() => { bar.style.width = pct + '%'; }, XP_BAR_ANIMATE_MS);
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
      ${a.bonus_xp ? `<div class="achievement-xp-badge ${unlocked?'earned':''}">+${a.bonus_xp} XP</div>` : ''}
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
    ['stat-num', USER_STATE.bonus_xp || 0, 'Bonus XP'],
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
          <img class="queue-poster" src="${cachedImgUrl(e.image)}" alt="" loading="lazy" onerror="this.src=''">
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
  else showToast(t('toast_all_watched'), 'gold');
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
  const countEl = document.getElementById('stars-tab-count');
  if (countEl) countEl.textContent = t('stars_tab_count', { count: STARS_DATA.stars.length });
}

function buildStarCard(s) {
  const appearances = s.mcu_appearances?.length || 0;
  return `<div class="star-card" onclick="openStarDetail('${s.id}')">
    <img class="star-card-img" src="${cachedImgUrl(s.image)}" alt="${escapeHtml(s.name)}" loading="lazy" onerror="this.src=''">
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
    syncSearchToUrl(q);
    if (q.length < 2) { drop.classList.add('hidden'); return; }
    searchTimeout = setTimeout(() => renderSearchResults(q), SEARCH_DEBOUNCE_MS);
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
        <img class="search-item-img" src="${cachedImgUrl(e.image)}" alt="" loading="lazy" onerror="this.src=''">
        <div class="search-item-info">
          <div class="search-item-title">${escapeHtml(e.title)}</div>
          <div class="search-item-sub">${e.release_date?.split('-')[0]||''}</div>
        </div>
        <span class="search-type-tag ${tagClass}">${TYPE_LABELS[e.type]||e.type}</span>
      </div>`;
    }),
    ...starMatches.map(s =>
      `<div class="search-item" onclick="openStarDetail('${s.id}');document.getElementById('global-search').value='';document.getElementById('search-results-drop').classList.add('hidden')">
        <img class="search-item-img star-thumb" src="${cachedImgUrl(s.image)}" alt="" loading="lazy" onerror="this.src=''">
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
  _buildDetailContent(id);
  pushModalState('title', id);
  const hasBack = _modalStack.length > 1;
  document.getElementById('detail-back-btn')?.classList.toggle('hidden', !hasBack);
  // Close star panel if open
  document.getElementById('star-panel')?.classList.add('hidden');
  openPanel('detail-panel');
}

function openDetailSilent(id) {
  _buildDetailContent(id);
  _modalStack.push({ type: 'title', id });
  const hasBack = _modalStack.length > 1;
  document.getElementById('detail-back-btn')?.classList.toggle('hidden', !hasBack);
  openPanel('detail-panel');
}

function _buildDetailContent(id) {
  const e = getEntry(id);
  if (!e) return;

  const watched    = USER_STATE.watched.includes(id);
  const wishlisted = USER_STATE.wishlist.includes(id);
  const statusKey  = getStatus(e);
  const upcoming   = statusKey !== 'released';
  const statusCfg  = STATUSES[statusKey] || {};
  const year       = e.release_date ? e.release_date.split('-')[0] : 'TBA';
  const phaseData  = MCU_DATA.about?.phases?.find(p => p.id === e.phase);
  const phaseColor = PHASE_COLORS[e.phase] || '#e23636';
  const tagClass   = TYPE_COLORS[e.type] || 'tag-movie';
  const statusBadge = (upcoming && statusCfg.label)
    ? `<span class="detail-type-tag" style="background:rgba(255,255,255,0.07);color:${statusCfg.color||'var(--gold)'}">
        ${statusCfg.icon_fa ? `<i class="${statusCfg.icon_fa}" style="margin-right:4px"></i>` : ''}${statusCfg.label}
       </span>`
    : '';

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
    return `<div class="cast-item" onclick="${star ? `openStarDetail('${star.id}')` : ''}${star ? '' : ''}">
      <img class="cast-img" src="${img}" alt="${escapeHtml(name)}" loading="lazy" onerror="this.src=''">
      <div class="cast-name">${escapeHtml(name)}</div>
      <div class="cast-char">${escapeHtml(char)}</div>
    </div>`;
  }).join('');

  // Watch platforms — logo resolved from data.json > streaming_platforms via STREAMING_PLATFORMS map
  const platformsHtml = (e.where_to_watch || []).map(w => {
    const platformDef = STREAMING_PLATFORMS[w.platform_id] || {};
    const logoSrc     = platformDef.logo || '';
    return `<div class="detail-watch-platform">
      <img class="detail-platform-logo" src="${logoSrc}" alt="${w.platform}" onerror="this.style.display='none'">
      <a href="${w.url}" target="_blank" rel="noopener"><i class="fa-solid fa-play"></i> Watch on ${w.platform} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px;opacity:0.6"></i></a>
    </div>`;
  }).join('');

  // External links
  const links = e.links || {};
  const extLinks = [
    links.imdb      ? `<a class="detail-ext-link" href="${links.imdb}" target="_blank"><i class="fa-brands fa-imdb"></i> IMDb</a>` : '',
    links.wikipedia ? `<a class="detail-ext-link" href="${links.wikipedia}" target="_blank"><i class="fa-brands fa-wikipedia-w"></i> Wiki</a>` : '',
    links.marvel    ? `<a class="detail-ext-link" href="${links.marvel}" target="_blank"><i class="fa-solid fa-star"></i> Marvel</a>` : '',
  ].filter(Boolean).join('');

  const content = `
    <div class="detail-hero">
      <img class="detail-poster" src="${cachedImgUrl(e.image)}" alt="${escapeHtml(e.title)}" onerror="this.src=''">
      <div class="detail-hero-info">
        <div class="detail-type-phase">
          <span class="detail-type-tag ${tagClass}">${TYPE_LABELS[e.type]||e.type}</span>
          <span class="detail-type-tag" style="background:rgba(255,255,255,0.08);color:var(--text3)">${phaseData?.name||''}</span>
          ${statusBadge}
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
    </div>
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
      ${e.genres?.length ? `<div>
        <div class="detail-section-title"><i class="fa-solid fa-tags" style="color:var(--text3);margin-right:6px"></i>Genres</div>
        <div class="detail-genres-row">${e.genres.map(g => `<span class="detail-genre-tag">${escapeHtml(g)}</span>`).join('')}</div>
      </div>` : ''}
      ${e.writer ? `<div>
        <div class="detail-section-title"><i class="fa-solid fa-pen-nib" style="color:var(--text3);margin-right:6px"></i>Writer${e.writer.includes(',') ? 's' : ''}</div>
        <p style="font-size:13px;color:var(--text2)">${escapeHtml(e.writer)}</p>
      </div>` : ''}
      ${e.box_office?.worldwide_gross_usd ? `<div>
        <div class="detail-section-title"><i class="fa-solid fa-sack-dollar" style="color:var(--text3);margin-right:6px"></i>Box Office</div>
        <div class="detail-boxoffice-row">
          ${e.box_office.budget_usd ? `<div class="detail-bo-item"><span class="detail-bo-label"><i class="fa-solid fa-coins"></i> Budget</span><span class="detail-bo-val">$${(e.box_office.budget_usd/1e6).toFixed(0)}M</span></div>` : ''}
          <div class="detail-bo-item"><span class="detail-bo-label"><i class="fa-solid fa-globe"></i> Worldwide</span><span class="detail-bo-val txt-gold">$${(e.box_office.worldwide_gross_usd/1e6).toFixed(0)}M</span></div>
          ${e.box_office.budget_usd ? `<div class="detail-bo-item"><span class="detail-bo-label"><i class="fa-solid fa-arrow-trend-up"></i> ROI</span><span class="detail-bo-val" style="color:var(--green)">${((e.box_office.worldwide_gross_usd/e.box_office.budget_usd)*100).toFixed(0)}%</span></div>` : ''}
        </div>
      </div>` : ''}
      ${e.in_universe_year ? `<div>
        <div class="detail-section-title"><i class="fa-solid fa-hourglass" style="color:var(--text3);margin-right:6px"></i>In-Universe Year</div>
        <p style="font-size:14px;color:var(--text2)">${escapeHtml(e.in_universe_year)}</p>
      </div>` : ''}
      ${e.post_credit_scenes > 0 ? `<div style="font-size:13px;color:var(--text3)"><i class="fa-solid fa-film txt-gold"></i> ${e.post_credit_scenes} post-credit scene${e.post_credit_scenes>1?'s':''}</div>` : ''}
    </div>`;

  document.getElementById('detail-content').innerHTML = content;
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
  _buildStarContent(starId);
  pushModalState('star', starId);
  const hasBack = _modalStack.length > 1;
  document.getElementById('star-back-btn')?.classList.toggle('hidden', !hasBack);
  document.getElementById('detail-panel')?.classList.add('hidden');
  openPanel('star-panel');
}

function openStarDetailSilent(starId) {
  _buildStarContent(starId);
  _modalStack.push({ type: 'star', id: starId });
  const hasBack = _modalStack.length > 1;
  document.getElementById('star-back-btn')?.classList.toggle('hidden', !hasBack);
  openPanel('star-panel');
}

function _buildStarContent(starId) {
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
    `<div class="star-app-card" onclick="openDetail('${e.id}')">
      <img class="star-app-poster" src="${cachedImgUrl(e.image)}" alt="${escapeHtml(e.title)}" loading="lazy" onerror="this.src=''">
      <div class="star-app-title">${escapeHtml(e.title)}</div>
    </div>`
  ).join('');

  const content = `
    <div class="star-detail-header">
      <img class="star-detail-img" src="${cachedImgUrl(s.image)}" alt="${escapeHtml(s.name)}" onerror="this.src=''">
      <div class="star-detail-info">
        <div class="star-detail-name">${escapeHtml(s.name)}</div>
        <div class="star-detail-char">${escapeHtml(s.character||'')}</div>
        <div class="star-detail-meta">
          ${s.nationality ? `<span><i class="fa-solid fa-earth-americas" style="opacity:.5;margin-right:4px"></i>${escapeHtml(s.nationality)}</span>` : ''}
          ${s.born?.date ? `<span><i class="fa-regular fa-calendar" style="opacity:.5;margin-right:4px"></i>Age ${new Date().getFullYear() - new Date(s.born.date).getFullYear()}</span>` : ''}
          ${s.born?.place ? `<span><i class="fa-solid fa-location-dot" style="opacity:.5;margin-right:4px"></i>${escapeHtml(s.born.place)}</span>` : ''}
        </div>
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
}

// Back button: navigate back in modal stack
function modalGoBack() {
  if (_modalStack.length < 2) return;
  _suppressPopState = true;
  const current = _modalStack.pop();
  const prev    = _modalStack[_modalStack.length - 1];

  // Close current panel
  if (current.type === 'title') {
    document.getElementById('detail-panel')?.classList.add('hidden');
  } else if (current.type === 'star') {
    document.getElementById('star-panel')?.classList.add('hidden');
  }

  // Reopen previous
  if (prev.type === 'title') {
    _buildDetailContent(prev.id);
    document.getElementById('detail-panel')?.classList.remove('hidden');
  } else if (prev.type === 'star') {
    _buildStarContent(prev.id);
    document.getElementById('star-panel')?.classList.remove('hidden');
  }

  // Update URL
  const params = new URLSearchParams(window.location.search);
  params.set('id', prev.id || prev.type);
  params.delete('dl');
  history.replaceState({ modal: prev.type, id: prev.id, stack: [..._modalStack] }, '', '?' + params.toString());

  // Update back button visibility
  const stillHasBack = _modalStack.length > 1;
  document.getElementById('detail-back-btn')?.classList.toggle('hidden', !stillHasBack);
  document.getElementById('star-back-btn')?.classList.toggle('hidden', !stillHasBack);
  _suppressPopState = false;
}


function buildAvatarImgHtml(avatarId, size, fallbackName) {
  if (avatarId) {
    const av = AVATARS.find(a => a.id === avatarId);
    if (av) {
      return `<img src="${cachedImgUrl(AVATAR_BASE + av.file)}" alt="${escapeHtml(av.name)}" style="width:${size}px;height:${size}px;border-radius:50%;object-fit:cover;display:block;" onerror="this.style.display='none'">`;
    }
  }
  return fallbackName ? fallbackName[0].toUpperCase() : '?';
}

function buildAvatarPicker() {
  const current = USER_STATE.avatar;
  const items = AVATARS.map(av => {
    const selected = av.id === current ? 'av-item--selected' : '';
    return `<button class="av-item ${selected}" onclick="selectAvatar('${av.id}')" title="${escapeHtml(av.name)}">
      <img src="${cachedImgUrl(AVATAR_BASE + av.file)}" alt="${escapeHtml(av.name)}" loading="lazy" onerror="this.style.opacity='0.3'">
    </button>`;
  }).join('');
  return `<div class="av-picker-wrap">
    <div class="acct-label" style="margin-bottom:8px"><i class="fa-solid fa-id-card"></i> Choose Avatar</div>
    <div class="av-picker-grid">${items}</div>
  </div>`;
}

function selectAvatar(id) {
  USER_STATE.avatar = (USER_STATE.avatar === id) ? null : id;
  saveUserState();
  updateHeaderAvatar();
  // Refresh the avatar display and picker in place without full re-render
  const wrap = document.getElementById('profile-avatar-lg-wrap');
  if (wrap) wrap.innerHTML = buildAvatarImgHtml(USER_STATE.avatar, 64, USER_STATE.name);
  document.querySelectorAll('.av-item').forEach(el => {
    el.classList.toggle('av-item--selected', el.getAttribute('onclick').includes(`'${id}'`) && USER_STATE.avatar === id);
  });
}

// ─── ACCOUNT PANEL ────────────────────────────────────
function openAccountPanel() {
  renderAccountContent();
  pushModalState('profile', null);
  openPanel('account-panel');
}

function openAccountPanelSilent() {
  renderAccountContent();
  _modalStack.push({ type: 'profile', id: null });
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
    const avatarHtml = buildAvatarImgHtml(USER_STATE.avatar, 64, name);
    const avatarPickerHtml = IS_VIEW_MODE ? '' : buildAvatarPicker();

    container.innerHTML = `<div class="profile-display">
      <div class="profile-header">
        <div class="profile-avatar-lg" id="profile-avatar-lg-wrap">${avatarHtml}</div>
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
      ${avatarPickerHtml}
      ${!IS_VIEW_MODE ? `<button class="acct-btn-danger" onclick="resetAccount()">
        <i class="fa-solid fa-trash"></i> Reset All Data
      </button>` : ''}
    </div>`;
  }
}

function saveAccountName() {
  const input = document.getElementById('acct-name-input');
  const name  = input?.value.trim();
  if (!name) { showToast(t('toast_enter_name'), 'red'); return; }
  USER_STATE.name = name;
  saveUserState();
  updateHeaderAvatar();
  renderAccountContent();
  showToast(t('toast_welcome', { name }), 'gold');
}

function resetAccount() {
  if (!confirm(t('confirm_reset'))) return;
  USER_STATE = { name: '', watched: [], wishlist: [], avatar: null, bonus_xp: 0, earned_bonuses: [] };
  saveUserState();
  updateAllUI();
  renderAccountContent();
  closePanel('account-panel');
  showToast(t('toast_data_reset'), 'red');
}

function updateHeaderAvatar() {
  const el = document.getElementById('hdr-avatar');
  if (!el) return;
  const name   = USER_STATE.name;
  const avatar = USER_STATE.avatar;
  if (avatar) {
    const av = AVATARS.find(a => a.id === avatar);
    if (av) {
      el.innerHTML = `<img src="${cachedImgUrl(AVATAR_BASE + av.file)}" alt="${escapeHtml(av.name)}" style="width:36px;height:36px;border-radius:50%;object-fit:cover;display:block;">`;
      return;
    }
  }
  el.innerHTML = '';
  el.textContent = name ? name[0].toUpperCase() : '?';
}

// ─── SHARE PANEL ──────────────────────────────────────
function openSharePanel() {
  if (!USER_STATE.name) {
    openAccountPanel();
    showToast(t('toast_set_name_first'), 'gold');
    return;
  }
  renderShareContent();
  pushModalState('share', null);
  openPanel('share-panel');
}

function openSharePanelSilent() {
  renderShareContent();
  _modalStack.push({ type: 'share', id: null });
  openPanel('share-panel');
}

function renderShareContent() {
  const container = document.getElementById('share-content');
  if (!container) return;

  const shareObj = {
    name:     USER_STATE.name,
    watched:  USER_STATE.watched,
    wishlist: USER_STATE.wishlist,
    avatar:   USER_STATE.avatar || null,
  };
  const encoded     = btoa(JSON.stringify(shareObj));
  const shareUrl    = `${BASE_URL}?${VIEW_PARAM}=${encoded}`;
  const importUrl   = `${BASE_URL}?${IMPORT_PARAM}=${encoded}`;

  container.innerHTML = `
    ${IS_VIEW_MODE ? `<div class="view-mode-banner"><i class="fa-solid fa-eye"></i> You're viewing someone else's journey</div>` : ''}

    <span class="share-section-title"><i class="fa-solid fa-eye"></i> &nbsp;View-Only Link</span>
    <div class="share-url-box">
      <span class="share-url-text" id="share-url-text">${shareUrl}</span>
      <button class="share-copy-btn" onclick="copyToClipboard('${escapeHtml(shareUrl)}', 'share-url-text')">Copy</button>
    </div>
    <p class="share-note" style="margin-bottom:20px">Anyone with this link can view your MCU journey — read only, no changes.</p>

    <div class="share-section-divider">or</div>

    <span class="share-section-title"><i class="fa-solid fa-cloud-arrow-down"></i> &nbsp;Copy Profile Link</span>
    <div class="share-url-box">
      <span class="share-url-text" id="import-url-text">${importUrl}</span>
      <button class="share-copy-btn share-copy-btn--green" onclick="copyToClipboard('${escapeHtml(importUrl)}', 'import-url-text')">Copy</button>
    </div>
    <p class="share-note">Anyone who opens this link will be prompted to <strong style="color:var(--text)">load your profile as their own</strong> — perfect for syncing between devices.</p>
  `;
}

function copyToClipboard(url, fallbackElId) {
  navigator.clipboard.writeText(url).then(() => {
    showToast(t('toast_link_copied'), 'blue');
  }).catch(() => {
    const el = document.getElementById(fallbackElId);
    if (el) {
      const range = document.createRange();
      range.selectNode(el);
      window.getSelection()?.addRange(range);
    }
    showToast(t('toast_select_copy'), 'gold');
  });
}

// Keep old name for any external callers
function copyShareUrl(url) { copyToClipboard(url, 'share-url-text'); }

// ─── IMPORT PANEL ─────────────────────────────────────
function openImportPanel(profileData) {
  const container = document.getElementById('import-content');
  if (!container) return;

  const name     = profileData.name || 'Unknown';
  const watched  = (profileData.watched  || []).length;
  const wishlist = (profileData.wishlist || []).length;
  const hasExisting = USER_STATE.watched.length > 0 || USER_STATE.wishlist.length > 0 || USER_STATE.name;
  const avatarHtml  = buildAvatarImgHtml(profileData.avatar || null, 52, name);
  const avatarBg    = profileData.avatar ? 'transparent' : '';

  container.innerHTML = `
    <div class="import-profile-card">
      <div class="import-profile-avatar" style="background:${avatarBg || 'var(--green)'}">${avatarHtml}</div>
      <div class="import-profile-info">
        <div class="import-profile-name">${escapeHtml(name)}</div>
        <div class="import-profile-sub">${watched} watched &nbsp;·&nbsp; ${wishlist} wishlisted</div>
      </div>
    </div>
    ${hasExisting ? `<div class="import-warning">
      <i class="fa-solid fa-triangle-exclamation"></i>
      <span>You already have a profile on this device. Importing will <strong>replace</strong> your current watch history and wishlist.</span>
    </div>` : ''}
    <div class="import-btn-row">
      <button class="acct-btn-green" onclick="confirmImport(${escapeHtml(JSON.stringify(profileData))})">
        <i class="fa-solid fa-cloud-arrow-down"></i> Import Profile
      </button>
      <button class="acct-btn-ghost" onclick="dismissImport()">
        <i class="fa-solid fa-xmark"></i> Dismiss
      </button>
    </div>
  `;

  openPanel('import-panel');
}

function confirmImport(profileData) {
  USER_STATE = {
    name:          profileData.name          || '',
    watched:       Array.isArray(profileData.watched)       ? profileData.watched       : [],
    wishlist:      Array.isArray(profileData.wishlist)      ? profileData.wishlist      : [],
    avatar:        profileData.avatar        || null,
    bonus_xp:      typeof profileData.bonus_xp === 'number' ? profileData.bonus_xp     : 0,
    earned_bonuses: Array.isArray(profileData.earned_bonuses) ? profileData.earned_bonuses : [],
  };
  recomputeBonusXP();
  saveUserState();
  updateAllUI();
  closePanel('import-panel');
  // Clean the URL so refreshing doesn't re-trigger the import
  window.history.replaceState({}, '', window.location.pathname);
  window._pendingImport = null;
  showToast(t('toast_imported', { name: escapeHtml(USER_STATE.name || 'back') }), 'green');
}

function dismissImport() {
  closePanel('import-panel');
  window.history.replaceState({}, '', window.location.pathname);
  window._pendingImport = null;
}

// ─── PANELS ───────────────────────────────────────────
function openPanel(id) {
  document.getElementById(id)?.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closePanel(id) {
  document.getElementById(id)?.classList.add('hidden');
  // Only clear overflow if all panels closed
  const panels = PANELS;
  const anyOpen = panels.some(p => !document.getElementById(p)?.classList.contains('hidden'));
  if (!anyOpen) document.body.style.overflow = '';
  if (!_suppressPopState) clearModalFromUrl();
}

// ─── TABS ─────────────────────────────────────────────
function switchTab(tab) {
  switchTabSilent(tab);
  syncTabToUrl(tab);
}

function switchTabSilent(tab) {
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
  // Logo triple-click → full cache bust
  const logoEl = document.querySelector('.header-logo');
  if (logoEl) logoEl.addEventListener('click', _handleLogoClick);

  // Close panels on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      PANELS.forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) closePanel(id);
      });
    }
  });

  // Browser back/forward
  window.addEventListener('popstate', e => {
    if (_suppressPopState) return;
    // Close all panels
    _suppressPopState = true;
    PANELS.forEach(id => {
      document.getElementById(id)?.classList.add('hidden');
    });
    document.body.style.overflow = '';
    _modalStack = [];

    const params = new URLSearchParams(window.location.search);
    const tab = params.get('t');
    const id  = params.get('id');
    const validTabs = TABS.length ? TABS.map(t => t.id) : ['home','timeline','journey','wishlist','stars'];
    if (tab && validTabs.includes(tab)) switchTabSilent(tab);
    if (id) {
      if (id === 'profile') openAccountPanelSilent();
      else if (id === 'share') openSharePanelSilent();
      else {
        const entry = getEntry(id);
        const star  = STARS_DATA?.stars.find(s => s.id === id);
        if (entry) openDetailSilent(id);
        else if (star) openStarDetailSilent(id);
      }
    }
    _suppressPopState = false;
  });
}

// ─── HELPERS ──────────────────────────────────────────
function getEntry(id) {
  return MCU_DATA.entries.find(e => e.id === id) || null;
}

// Returns the status key for an entry: uses e.status if present in STATUSES,
// otherwise falls back to date-comparison (future date → 'upcoming', past → 'released').
function getStatus(e) {
  if (e.status && STATUSES[e.status]) return e.status;
  if (!e.release_date) return 'upcoming';
  return new Date(e.release_date) > new Date() ? 'upcoming' : 'released';
}

// Thin wrapper — kept so callers don't all need updating
function isUpcoming(e) {
  return getStatus(e) !== 'released';
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
    setTimeout(() => toast.remove(), TOAST_FADE_MS);
  }, TOAST_DURATION_MS);
}
