/**
 * MCU Universe Admin Dashboard — script.js
 * Modular frontend controller for admin panel.
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════
   MODULE: Toast Notifications
═══════════════════════════════════════════════════════════════════ */
const Toast = (() => {
  const wrap = () => document.getElementById('toast-wrap');

  function show(msg, type = 'info', duration = 2800) {
    const t = document.createElement('div');
    t.className = `toast toast--${type}`;
    const icon = type === 'ok' ? 'fa-circle-check' : type === 'err' ? 'fa-circle-xmark' : 'fa-circle-info';
    t.innerHTML = `<i class="fa-solid ${icon}"></i><span>${msg}</span>`;
    wrap().appendChild(t);
    const remove = () => {
      t.classList.add('toast--out');
      t.addEventListener('animationend', () => t.remove(), { once: true });
    };
    setTimeout(remove, duration);
    t.addEventListener('click', remove);
  }

  return { ok: (m) => show(m, 'ok'), err: (m) => show(m, 'err'), info: (m) => show(m, 'info') };
})();


/* ═══════════════════════════════════════════════════════════════════
   MODULE: Confirm Modal
═══════════════════════════════════════════════════════════════════ */
const Confirm = (() => {
  let _resolve = null;

  function show(msg, title = 'Confirm Action') {
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent   = msg;
    document.getElementById('confirm-modal').classList.remove('hidden');
    return new Promise(res => { _resolve = res; });
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('confirm-ok').addEventListener('click', () => {
      document.getElementById('confirm-modal').classList.add('hidden');
      _resolve && _resolve(true); _resolve = null;
    });
    document.getElementById('confirm-cancel').addEventListener('click', () => {
      document.getElementById('confirm-modal').classList.add('hidden');
      _resolve && _resolve(false); _resolve = null;
    });
  });

  return { show };
})();


/* ═══════════════════════════════════════════════════════════════════
   MODULE: API Layer
═══════════════════════════════════════════════════════════════════ */
const API = (() => {
  async function getConfig() {
    const r = await fetch('?action=get_config');
    return r.json();
  }

  async function saveConfig(data) {
    const r = await fetch('?action=save_config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return r.json();
  }

  async function uploadAsset(asset, file) {
    const fd = new FormData();
    fd.append('action', 'upload_asset');
    fd.append('asset', asset);
    fd.append('file', file);
    const r = await fetch('?action=upload_asset', { method: 'POST', body: fd });
    return r.json();
  }

  async function listAvatars() {
    const r = await fetch('?action=list_avatars');
    return r.json();
  }

  async function createAvatar(name, file, customId) {
    const fd = new FormData();
    fd.append('action', 'create_avatar');
    fd.append('name', name);
    fd.append('file', file);
    if (customId) fd.append('custom_id', customId);
    const r = await fetch('?action=create_avatar', { method: 'POST', body: fd });
    return r.json();
  }

  async function editAvatar(id, name, file, newId) {
    const fd = new FormData();
    fd.append('action', 'edit_avatar');
    fd.append('id', id);
    fd.append('name', name);
    if (file) fd.append('file', file);
    if (newId && newId !== id) fd.append('new_id', newId);
    const r = await fetch('?action=edit_avatar', { method: 'POST', body: fd });
    return r.json();
  }

  async function deleteAvatar(id) {
    const r = await fetch('?action=delete_avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id })
    });
    return r.json();
  }

  return { getConfig, saveConfig, uploadAsset, listAvatars, createAvatar, editAvatar, deleteAvatar };
})();


/* ═══════════════════════════════════════════════════════════════════
   MODULE: URL State
   Manages ?t= tab and ?t=...&id=... modal params.
   Valid tabs:   overview | config | avatars | prog | ui
   Valid id:     new | {avatarId}  (when t=avatar)
                 rank_new | {rankIdx}  (when t=prog)
                 achiv_new | {achIdx}  (when t=prog)
═══════════════════════════════════════════════════════════════════ */
const URLState = (() => {
  const VALID_TABS = new Set(['overview', 'config', 'avatars', 'prog', 'ui']);

  // URL shorthand → real section id
  const TAB_TO_SECTION = {
    overview: 'overview',
    config:   'app-config',
    avatars:  'avatars',
    prog:     'progression',
    ui:       'ui-text',
  };

  // real section id → URL shorthand (for set() calls from switchSection)
  const SECTION_TO_TAB = Object.fromEntries(
    Object.entries(TAB_TO_SECTION).map(([k, v]) => [v, k])
  );

  // ── read ──────────────────────────────────────────────────────────
  function get() {
    const sp  = new URLSearchParams(location.search);
    const tab = sp.get('t') || null;
    const id  = sp.get('id') || null;
    return { tab, id };
  }

  // ── write (pushState) ─────────────────────────────────────────────
  function set(tab, id = null) {
    const sp = new URLSearchParams();
    if (tab) sp.set('t', tab);
    if (id)  sp.set('id', id);
    const qs = sp.toString() ? '?' + sp.toString() : location.pathname;
    history.pushState({ tab, id }, '', qs);
  }

  // ── clear (tab only, no id) ───────────────────────────────────────
  function clearModal() {
    const sp = new URLSearchParams(location.search);
    const tab = sp.get('t');
    if (sp.has('id')) {
      // keep tab, drop id
      const newSp = new URLSearchParams();
      if (tab) newSp.set('t', tab);
      history.pushState({ tab, id: null }, '', '?' + newSp.toString());
    }
  }

  // ── human-like restore: types out the correction character-by-char ─
  // Shows a pill in the corner that "types" the corrected URL then fades
  function _humanRestore(correctedTab, correctedId) {
    // build target query string
    const sp = new URLSearchParams();
    sp.set('t', correctedTab);
    if (correctedId) sp.set('id', correctedId);
    const targetQS = '?' + sp.toString();

    const pill = document.createElement('div');
    pill.id = 'url-restore-pill';
    pill.style.cssText = `
      position:fixed;bottom:22px;left:50%;transform:translateX(-50%);
      background:var(--surface);border:1px solid var(--border2);
      border-radius:8px;padding:7px 14px;font-size:12px;font-family:monospace;
      color:var(--text2);z-index:9999;pointer-events:none;
      box-shadow:0 4px 20px rgba(0,0,0,.5);
      display:flex;align-items:center;gap:8px;white-space:nowrap;
    `;
    pill.innerHTML = `<i class="fa-solid fa-rotate-left" style="color:var(--accent);font-size:11px"></i><span id="url-restore-text"></span>`;
    document.body.appendChild(pill);

    const txt  = pill.querySelector('#url-restore-text');
    const full = location.pathname + targetQS;
    let   i    = 0;

    const typeNext = () => {
      if (i <= full.length) {
        txt.textContent = full.slice(0, i);
        i++;
        setTimeout(typeNext, 28 + Math.random() * 30);
      } else {
        // pause then fade out
        setTimeout(() => {
          pill.style.transition = 'opacity .35s ease';
          pill.style.opacity = '0';
          pill.addEventListener('transitionend', () => pill.remove(), { once: true });
        }, 900);
        // actually push the corrected state
        history.replaceState({ tab: correctedTab, id: correctedId }, '', targetQS);
      }
    };
    typeNext();
  }

  // ── validate + restore ────────────────────────────────────────────
  // Called after data is loaded. avatarItems/rankData/achData needed for id validation.
  function validateAndRestore({ avatarItems = [], rankData = [], achData = [] } = {}) {
    const { tab, id } = get();

    // No params at all — nothing to validate
    if (!tab && !id) return { tab: null, id: null };

    let correctedTab = tab;
    let correctedId  = id;
    let needsRestore = false;

    // 1. Validate tab
    if (tab && !VALID_TABS.has(tab)) {
      correctedTab = 'overview';
      correctedId  = null;
      needsRestore = true;
    }

    // 2. Validate id against tab context
    if (!needsRestore && id) {
      if (correctedTab === 'avatars') {
        // valid: "new" or an existing avatar id
        if (id !== 'new' && !avatarItems.find(a => a.id === id)) {
          correctedId  = null;
          needsRestore = true;
        }
      } else if (correctedTab === 'prog') {
        // valid: rank_new | rank_<idx> | achiv_new | achiv_<idx>
        const rankMatch  = id.match(/^rank_(\d+)$/);
        const achivMatch = id.match(/^achiv_(\d+)$/);
        if (id === 'rank_new' || id === 'achiv_new') {
          // always valid
        } else if (rankMatch) {
          const idx = parseInt(rankMatch[1]);
          if (idx >= rankData.length) { correctedId = null; needsRestore = true; }
        } else if (achivMatch) {
          const idx = parseInt(achivMatch[1]);
          if (idx >= achData.length) { correctedId = null; needsRestore = true; }
        } else {
          correctedId  = null;
          needsRestore = true;
        }
      } else {
        // other tabs don't support id param
        correctedId  = null;
        needsRestore = true;
      }
    }

    if (needsRestore) {
      _humanRestore(correctedTab, correctedId);
    }

    return { tab: correctedTab, id: correctedId };
  }

  return { get, set, clearModal, validateAndRestore, TAB_TO_SECTION, SECTION_TO_TAB };
})();


/* ═══════════════════════════════════════════════════════════════════
   MODULE: Admin Controller
═══════════════════════════════════════════════════════════════════ */
const Admin = (() => {

  // ── STATE ──────────────────────────────────────────────────────────
  let _config      = null;
  let _avatarMode  = 'create';
  let _editingId   = null;
  let _avatarFile  = null;
  let _avatarAll   = [];
  let _avatarBust  = Date.now(); // refreshed only after mutations
  let _refTitles   = [];
  let _refPhases   = [];
  let _refSagas    = [];

  // ── INIT ───────────────────────────────────────────────────────────
  async function init() {
    setupSidebar();
    setupSaveShortcut();
    await loadConfig();
    await loadRefData();
    renderAll();
    _applyURLState();

    // handle browser back/forward
    window.addEventListener('popstate', () => {
      // close any open modals silently (no URL push)
      ['avatar-modal','rank-modal','achievement-modal'].forEach(id => {
        document.getElementById(id)?.classList.add('hidden');
      });
      _avatarFile = null; _editingId = null; _rankEditingIdx = null; _achEditingIdx = null;
      _applyURLState();
    });
  }

  // ── URL STATE APPLY ────────────────────────────────────────────────
  async function _applyURLState() {
    const sp = new URLSearchParams(location.search);

    // No ?t at all on load → inject ?t=overview silently
    if (!sp.has('t') && !sp.has('id')) {
      history.replaceState({ tab: 'overview', id: null }, '', '?t=overview');
      switchSection('overview', { pushState: false });
      return;
    }

    const { tab, id } = URLState.validateAndRestore({
      avatarItems: _avatarAll,
      rankData:    _rankData,
      achData:     _achData,
    });

    const targetTab     = tab || 'overview';
    const targetSection = URLState.TAB_TO_SECTION[targetTab] || targetTab;

    // Switch section — for avatars we must await the grid load first
    // so the modal can reference _avatarAll
    if (targetTab === 'avatars' && id) {
      switchSection(targetSection, { pushState: false });
      if (_avatarAll.length === 0) await renderAvatars();
    } else {
      switchSection(targetSection, { pushState: false });
    }

    // Open modal if id is present — pass _noURLPush so we don't double-push
    if (id && targetTab === 'avatars') {
      if (id === 'new') {
        openAvatarModal('create', { _noURLPush: true });
      } else {
        const av = _avatarAll.find(a => a.id === id);
        if (av) openAvatarModal('edit', av.id, av.name, av.file, { _noURLPush: true });
      }
    } else if (id && targetTab === 'prog') {
      if (id === 'rank_new') {
        openRankModal(null, { _noURLPush: true });
      } else if (id === 'achiv_new') {
        openAchModal(null, { _noURLPush: true });
      } else {
        const rankMatch  = id.match(/^rank_(\d+)$/);
        const achivMatch = id.match(/^achiv_(\d+)$/);
        if (rankMatch)  openRankModal(parseInt(rankMatch[1]), { _noURLPush: true });
        if (achivMatch) openAchModal(parseInt(achivMatch[1]), { _noURLPush: true });
      }
    }
  }

  async function loadRefData() {
    const res = await fetch('?action=get_ref_data');
    const data = await res.json();
    if (!data.ok) { Toast.err('Could not load MCU reference data'); return; }
    _refTitles = data.titles || [];
    _refPhases = data.phases || [];
    _refSagas  = data.sagas  || [];
  }

  async function loadConfig() {
    const res = await API.getConfig();
    if (!res.ok) { Toast.err('Cannot load app.json: ' + res.error); return; }
    _config = res.data;
  }

  // ── SIDEBAR ────────────────────────────────────────────────────────
  function setupSidebar() {
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => switchSection(btn.dataset.section));
    });
    document.getElementById('sidebar-toggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
      document.getElementById('sidebar-overlay').classList.toggle('visible');
    });
    document.getElementById('sidebar-overlay').addEventListener('click', closeSidebar);
  }

  function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('visible');
  }

  function switchSection(id, { pushState = true } = {}) {
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const sec = document.getElementById('section-' + id);
    if (sec) sec.classList.add('active');
    const btn = document.querySelector(`.nav-item[data-section="${id}"]`);
    if (btn) btn.classList.add('active');
    closeSidebar();
    if (pushState) URLState.set(URLState.SECTION_TO_TAB[id] || id);
    if (id === 'avatars') { if (_avatarAll.length === 0) renderAvatars(); else renderAvatarGrid(_lastAvatarFilter); }
    if (id === 'overview') renderOverview();
  }

  // ── KEYBOARD SHORTCUT ──────────────────────────────────────────────
  function setupSaveShortcut() {
    document.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveAll(); }
    });
    document.getElementById('save-all-btn').addEventListener('click', saveAll);
  }

  // ── COLLECT CONFIG FROM DOM ────────────────────────────────────────
  function collectConfig() {
    if (!_config) return;

    // App identity
    _config.app.name    = v('cfg-app-name');
    _config.app.tagline = v('cfg-app-tagline');
    _config.app.version = v('cfg-app-version');
    _config.app.logo    = v('cfg-app-logo');
    _config.base_url    = v('cfg-base-url');

    // Data sources
    const dsGrid = document.querySelectorAll('.data-source-input');
    dsGrid.forEach(inp => {
      if (inp.dataset.ds) _config.app.data_sources[inp.dataset.ds] = inp.value;
    });

    // Behaviour
    _config.behaviour.loader_min_delay_ms   = num('cfg-loader-delay');
    _config.behaviour.toast_duration_ms     = num('cfg-toast-dur');
    _config.behaviour.toast_fade_ms         = num('cfg-toast-fade');
    _config.behaviour.search_debounce_ms    = num('cfg-search-debounce');
    _config.behaviour.xp_bar_rerender_ms    = num('cfg-xp-rerender');
    _config.behaviour.xp_bar_animate_ms     = num('cfg-xp-animate');
    _config.behaviour.bonus_check_delay_ms  = num('cfg-bonus-check-delay');
    _config.behaviour.tab_scroll_delay_ms   = num('cfg-tab-scroll-delay');
    if (!_config.behaviour.logo_click) _config.behaviour.logo_click = {};
    _config.behaviour.logo_click.clicks_required = num('cfg-lc-clicks');
    _config.behaviour.logo_click.window_ms        = num('cfg-lc-window');
    _config.behaviour.logo_click.bust_delay_ms    = num('cfg-lc-delay');

    // Storage
    _config.storage.key              = v('cfg-storage-key');
    _config.storage.img_cache_key    = v('cfg-img-cache-key');
    _config.storage.img_cache_ttl_minutes = num('cfg-img-cache-ttl');
    _config.storage.cbust_key        = v('cfg-cbust-key');

    // URL params
    _config.url_params.tab    = v('cfg-param-tab');
    _config.url_params.id     = v('cfg-param-id');
    _config.url_params.find   = v('cfg-param-find');
    _config.url_params.dl     = v('cfg-param-dl');
    _config.url_params.share  = v('cfg-param-share');
    _config.url_params['import'] = v('cfg-param-import');

    // Hero
    _config.ui.hero.eyebrow_badge = v('cfg-hero-eyebrow');
    _config.ui.hero.title_line1   = v('cfg-hero-title1');
    _config.ui.hero.title_line2   = v('cfg-hero-title2');
    _config.ui.hero.sub           = v('cfg-hero-sub');
    _config.ui.hero.cta_buttons   = collectCtaButtons();

    // Tabs
    _config.ui.tabs = collectTabs();

    // Panels (simple string array)
    _config.ui.panels = Array.from(document.querySelectorAll('.panel-row-input')).map(inp => inp.value.trim()).filter(Boolean);

    // Content types
    _config.ui.content_types = collectContentTypes();

    // Statuses
    _config.ui.statuses = collectStatuses();

    // Phase colors
    document.querySelectorAll('.phase-color-input').forEach(inp => {
      _config.ui.phase_colors[inp.dataset.phase] = inp.value;
    });

    // Author
    _config.author.name       = v('cfg-author-name');
    _config.author.role       = v('cfg-author-role');
    _config.author.bio        = v('cfg-author-bio');
    _config.author.avatar_img = v('cfg-author-avatar-img');
    _config.author.links      = collectAuthorLinks();

    // Timeline filters
    _config.ui.timeline_filters = collectTimelineFilters();

    // Avatars base path
    const abp = v('cfg-avatars-base-path');
    if (abp) _config.profile.avatars.base_path = abp;

    // Profile default state
    if (!_config.profile.default_state) _config.profile.default_state = {};
    _config.profile.default_state.name     = v('cfg-profile-default-name');
    _config.profile.default_state.bonus_xp = num('cfg-profile-bonus-xp');
    // watched / wishlist / earned_bonuses — stored as JSON arrays
    try { _config.profile.default_state.watched       = JSON.parse(document.getElementById('cfg-profile-default-watched')?.value || '[]'); } catch(e) { _config.profile.default_state.watched = []; }
    try { _config.profile.default_state.wishlist      = JSON.parse(document.getElementById('cfg-profile-default-wishlist')?.value || '[]'); } catch(e) { _config.profile.default_state.wishlist = []; }
    try { _config.profile.default_state.earned_bonuses = JSON.parse(document.getElementById('cfg-profile-default-earned')?.value || '[]'); } catch(e) { _config.profile.default_state.earned_bonuses = []; }
    const avatarVal = document.getElementById('cfg-profile-default-avatar')?.value?.trim();
    _config.profile.default_state.avatar = avatarVal || null;

    // Progression
    _config.progression.xp_per_watched         = num('prog-xp-watched');
    _config.progression.phase_completion_bonus  = num('prog-phase-bonus');
    _config.progression.saga_completion_bonus   = num('prog-saga-bonus');
    _config.progression.achievement_bonus       = num('prog-ach-bonus');
    _config.progression.ranks                   = collectRanks();
    _config.progression.achievements            = collectAchievements();

    // Phase bonuses
    document.querySelectorAll('.phase-bonus-input').forEach(inp => {
      _config.progression.phase_bonuses[inp.dataset.pb] = parseInt(inp.value) || 0;
    });
    // Saga bonuses
    document.querySelectorAll('.saga-bonus-input').forEach(inp => {
      _config.progression.saga_bonuses[inp.dataset.sb] = parseInt(inp.value) || 0;
    });

    // UI Text
    collectUIText();
  }

  // ── SAVE ALL ───────────────────────────────────────────────────────
  async function saveAll() {
    if (!_config) { Toast.err('Config not loaded'); return; }
    collectConfig();
    const res = await API.saveConfig(_config);
    if (res.ok) {
      Toast.ok('Saved successfully');
      renderOverview();
    } else {
      Toast.err('Save failed: ' + res.error);
    }
  }

  // ── RENDER ALL ─────────────────────────────────────────────────────
  function renderAll() {
    if (!_config) return;
    renderOverview();
    renderAppConfig();
    renderProgression();
    renderUIText();
    loadMediaPreviews();
  }

  // ── OVERVIEW ───────────────────────────────────────────────────────
  function renderOverview() {
    if (!_config) return;
    set('ov-avatar-count',       _config.profile?.avatars?.items?.length ?? '?');
    set('ov-achievement-count',  _config.progression?.achievements?.length ?? '?');
    set('ov-rank-count',         _config.progression?.ranks?.length ?? '?');
    set('ov-version',            _config.app?.version ?? '?');
    set('ov-titles-count',       _refTitles.length || '?');

    // File status badges (visual only — just mark as expected)
    ['logo','banner','me'].forEach(k => {
      const el = document.getElementById('fp-' + k + '-status');
      if (el) el.innerHTML = '<span class="fp-badge fp-badge--ok">OK</span>';
    });
    const fjson = document.getElementById('fp-json-status');
    if (fjson) fjson.innerHTML = '<span class="fp-badge fp-badge--ok">OK</span>';
  }

  // ── QUICK ACTIONS ──────────────────────────────────────────────────
  function scrollToCard(cardId) {
    const el = document.getElementById(cardId);
    if (!el) return;
    setTimeout(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  }

  async function quickAction(action) {
    switch (action) {
      case 'app-identity':
        switchSection('app-config');
        scrollToCard('card-app-identity');
        break;
      case 'hero':
        switchSection('app-config');
        scrollToCard('card-hero');
        break;
      case 'add-avatar':
        switchSection('avatars');
        if (_avatarAll.length === 0) await renderAvatars();
        openAvatarModal('create');
        break;
      case 'add-rank':
        switchSection('progression');
        openRankModal(null);
        scrollToCard('card-ranks');
        break;
      case 'add-achievement':
        switchSection('progression');
        openAchModal(null);
        scrollToCard('card-achievements');
        break;
    }
  }

  // ── APP CONFIG ─────────────────────────────────────────────────────
  function renderAppConfig() {
    const c = _config;
    sv('cfg-app-name',    c.app?.name ?? '');
    sv('cfg-app-tagline', c.app?.tagline ?? '');
    sv('cfg-app-version', c.app?.version ?? '');
    sv('cfg-app-logo',    c.app?.logo ?? '');
    sv('cfg-base-url',    c.base_url ?? '');

    sv('cfg-loader-delay',       c.behaviour?.loader_min_delay_ms ?? 600);
    sv('cfg-toast-dur',          c.behaviour?.toast_duration_ms ?? 2200);
    sv('cfg-toast-fade',         c.behaviour?.toast_fade_ms ?? 300);
    sv('cfg-search-debounce',    c.behaviour?.search_debounce_ms ?? 200);
    sv('cfg-xp-rerender',        c.behaviour?.xp_bar_rerender_ms ?? 900);
    sv('cfg-xp-animate',         c.behaviour?.xp_bar_animate_ms ?? 300);
    sv('cfg-bonus-check-delay',  c.behaviour?.bonus_check_delay_ms ?? 400);
    sv('cfg-tab-scroll-delay',   c.behaviour?.tab_scroll_delay_ms ?? 200);
    sv('cfg-lc-clicks',  c.behaviour?.logo_click?.clicks_required ?? 3);
    sv('cfg-lc-window',  c.behaviour?.logo_click?.window_ms ?? 3000);
    sv('cfg-lc-delay',   c.behaviour?.logo_click?.bust_delay_ms ?? 500);

    sv('cfg-storage-key',     c.storage?.key ?? '');
    sv('cfg-img-cache-key',   c.storage?.img_cache_key ?? '');
    sv('cfg-img-cache-ttl',   c.storage?.img_cache_ttl_minutes ?? 20);
    sv('cfg-cbust-key',       c.storage?.cbust_key ?? '');

    const p = c.url_params || {};
    sv('cfg-param-tab',    p.tab ?? '');
    sv('cfg-param-id',     p.id ?? '');
    sv('cfg-param-find',   p.find ?? '');
    sv('cfg-param-dl',     p.dl ?? '');
    sv('cfg-param-share',  p.share ?? '');
    sv('cfg-param-import', p['import'] ?? '');

    const h = c.ui?.hero || {};
    sv('cfg-hero-eyebrow', h.eyebrow_badge ?? '');
    sv('cfg-hero-title1',  h.title_line1 ?? '');
    sv('cfg-hero-title2',  h.title_line2 ?? '');
    sv('cfg-hero-sub',     h.sub ?? '');

    // Phase colors
    renderPhaseColors(c.ui?.phase_colors || {});

    // Tabs
    renderTabsEditor(c.ui?.tabs || []);

    // Hero CTA buttons
    renderCtaButtons(c.ui?.hero?.cta_buttons || []);

    // Panels
    renderPanelsEditor(c.ui?.panels || []);

    // Content types
    renderContentTypes(c.ui?.content_types || {});

    // Statuses
    renderStatuses(c.ui?.statuses || {});

    // Data sources
    renderDataSources(c.app?.data_sources || {});
    sv('cfg-avatars-base-path', c.profile?.avatars?.base_path ?? '');

    // Logo click
    sv('cfg-lc-clicks', c.behaviour?.logo_click?.clicks_required ?? 3);
    sv('cfg-lc-window', c.behaviour?.logo_click?.window_ms ?? 3000);
    sv('cfg-lc-delay',  c.behaviour?.logo_click?.bust_delay_ms ?? 500);

    // Profile default state
    sv('cfg-profile-default-name', c.profile?.default_state?.name ?? '');
    sv('cfg-profile-bonus-xp',     c.profile?.default_state?.bonus_xp ?? 0);
    const ds = c.profile?.default_state || {};
    sv('cfg-profile-default-watched',  JSON.stringify(ds.watched || []));
    sv('cfg-profile-default-wishlist', JSON.stringify(ds.wishlist || []));
    sv('cfg-profile-default-avatar',   ds.avatar || '');
    sv('cfg-profile-default-earned',   JSON.stringify(ds.earned_bonuses || []));

    // Author
    sv('cfg-author-name',       c.author?.name ?? '');
    sv('cfg-author-role',       c.author?.role ?? '');
    sv('cfg-author-bio',        c.author?.bio ?? '');
    sv('cfg-author-avatar-img', c.author?.avatar_img ?? '');
    renderAuthorLinks(c.author?.links || []);

    // Timeline filters
    renderTimelineFilters(c.ui?.timeline_filters || []);
  }

  // Tabs editor
  function renderTabsEditor(tabs) {
    const list = document.getElementById('tabs-editor-list');
    if (!list) return;
    list.innerHTML = '';
    tabs.forEach((tab, i) => {
      const row = document.createElement('div');
      row.className = 'tab-editor-row';
      row.dataset.idx = i;
      const hasHero  = tab.hero_title !== undefined || tab.hero_sub !== undefined;
      const hasBadge = tab.badge !== undefined;
      row.innerHTML = `
        <div class="tab-editor-header">
          <div class="tab-editor-icon-preview tab-icon-preview-${i}"><i class="${esc(tab.icon_fa||'fa-solid fa-circle')}"></i></div>
          <span class="tab-editor-id">${esc(tab.id)}</span>
        </div>
        <div class="tab-editor-fields">
          <div class="form-group">
            <label class="form-label">Label</label>
            <input type="text" class="form-input tab-label-input" data-ti="${i}" value="${esc(tab.label||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">Icon</label>
            <input type="text" class="form-input tab-icon-input" data-ti="${i}" value="${esc(tab.icon_fa||'')}">
          </div>
          ${hasHero ? `
          <div class="form-group">
            <label class="form-label">Hero Title</label>
            <input type="text" class="form-input tab-htitle-input" data-ti="${i}" value="${esc(tab.hero_title||'')}">
          </div>
          <div class="form-group">
            <label class="form-label">Hero Subtitle</label>
            <input type="text" class="form-input tab-hsub-input" data-ti="${i}" value="${esc(tab.hero_sub||'')}">
          </div>` : ''}
          ${hasBadge ? `
          <div class="form-group tab-badge-group">
            <label class="form-label">Count Badge</label>
            <label class="toggle-switch">
              <input type="checkbox" class="tab-badge-input" data-ti="${i}" ${tab.badge ? 'checked' : ''}>
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
              <span class="toggle-label">Show badge on tab icon</span>
            </label>
          </div>` : ''}
        </div>`;
      list.appendChild(row);
      row.querySelector('.tab-icon-input').addEventListener('input', e => {
        row.querySelector('.tab-editor-icon-preview').innerHTML = `<i class="${esc(e.target.value)}"></i>`;
      });
    });
  }

  function collectTabs() {
    const tabs = _config.ui?.tabs || [];
    return tabs.map((tab, i) => {
      const newTab     = Object.assign({}, tab);
      const labelInp   = document.querySelector(`.tab-label-input[data-ti="${i}"]`);
      const iconInp    = document.querySelector(`.tab-icon-input[data-ti="${i}"]`);
      const htitleInp  = document.querySelector(`.tab-htitle-input[data-ti="${i}"]`);
      const hsubInp    = document.querySelector(`.tab-hsub-input[data-ti="${i}"]`);
      const badgeInp   = document.querySelector(`.tab-badge-input[data-ti="${i}"]`);
      if (labelInp)  newTab.label      = labelInp.value;
      if (iconInp)   newTab.icon_fa    = iconInp.value;
      if (htitleInp) newTab.hero_title = htitleInp.value;
      if (hsubInp)   newTab.hero_sub   = hsubInp.value;
      if (badgeInp)  newTab.badge      = badgeInp.checked;
      return newTab;
    });
  }

  // Panels editor
  function renderPanelsEditor(panels) {
    // panels is a string[]
    const container = document.getElementById('tabs-editor-list')?.closest('.config-card')?.nextElementSibling;
    // We use a dedicated element: panels-list inside the Tabs card or separate
    // Actually the panels list is part of content just below the tabs card — skip for now
    // It's rendered dynamically inside the Tabs card section
  }

  // Hero CTA buttons
  function renderCtaButtons(buttons) {
    const list = document.getElementById('hero-cta-list');
    if (!list) return;
    list.innerHTML = '';
    (buttons || []).forEach((btn, i) => {
      const row = document.createElement('div');
      row.className = 'cta-btn-row';
      row.innerHTML = `
        <input type="text" class="form-input cta-label-input" placeholder="Label" value="${esc(btn.label||'')}">
        <input type="text" class="form-input cta-icon-input" placeholder="FA Icon" value="${esc(btn.icon_fa||'')}">
        <input type="text" class="form-input cta-tab-input" placeholder="Tab ID" value="${esc(btn.tab||'')}">
        <input type="text" class="form-input cta-style-input" placeholder="CSS class" value="${esc(btn.style||'')}">
        <button class="btn-icon btn-icon--danger" onclick="this.closest('.cta-btn-row').remove()" title="Remove"><i class="fa-solid fa-trash"></i></button>`;
      list.appendChild(row);
    });
  }

  function addCtaButton() {
    renderCtaButtons([...collectCtaButtons(), { label: '', icon_fa: '', tab: '', style: 'btn-primary' }]);
  }

  function collectCtaButtons() {
    return Array.from(document.querySelectorAll('.cta-btn-row')).map(row => {
      const inps = row.querySelectorAll('input');
      return { label: inps[0]?.value||'', icon_fa: inps[1]?.value||'', tab: inps[2]?.value||'', style: inps[3]?.value||'' };
    });
  }

  // Content types editor
  function renderContentTypes(types) {
    const grid = document.getElementById('content-types-grid');
    if (!grid) return;
    grid.innerHTML = '';
    Object.entries(types).forEach(([key, val]) => {
      const card = document.createElement('div');
      card.className = 'content-type-card';
      card.innerHTML = `
        <div class="content-type-card-header">
          <div class="form-group" style="flex:1;margin-bottom:0">
            <label class="form-label">Key (ID)</label>
            <input type="text" class="form-input ct-key-input" value="${esc(key)}" placeholder="e.g. movie">
          </div>
          <button class="btn-icon btn-icon--danger ct-delete-btn" title="Remove type"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="form-group">
          <label class="form-label">Label</label>
          <input type="text" class="form-input ct-label-input" value="${esc(val.label||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">CSS Class</label>
          <input type="text" class="form-input ct-class-input" value="${esc(val.css_class||'')}">
        </div>`;
      card.querySelector('.ct-delete-btn').addEventListener('click', () => card.remove());
      grid.appendChild(card);
    });
  }

  function addContentType() {
    const types = collectContentTypes();
    types['new_type_' + Date.now()] = { label: '', css_class: '' };
    renderContentTypes(types);
    // Focus the new key input
    const cards = document.querySelectorAll('#content-types-grid .content-type-card');
    const last = cards[cards.length - 1];
    if (last) last.querySelector('.ct-key-input')?.focus();
  }

  function collectContentTypes() {
    const result = {};
    document.querySelectorAll('#content-types-grid .content-type-card').forEach(card => {
      const key = card.querySelector('.ct-key-input')?.value?.trim();
      if (!key) return;
      result[key] = {
        label: card.querySelector('.ct-label-input')?.value || '',
        css_class: card.querySelector('.ct-class-input')?.value || ''
      };
    });
    return result;
  }

  // Statuses editor
  function renderStatuses(statuses) {
    const grid = document.getElementById('statuses-grid');
    if (!grid) return;
    grid.innerHTML = '';
    Object.entries(statuses).forEach(([key, val]) => {
      const card = document.createElement('div');
      card.className = 'status-card';
      card.innerHTML = `
        <div class="status-card-header">
          <div class="form-group" style="flex:1;margin-bottom:0">
            <label class="form-label">Key (ID)</label>
            <input type="text" class="form-input st-key-input" value="${esc(key)}" placeholder="e.g. released">
          </div>
          <button class="btn-icon btn-icon--danger st-delete-btn" title="Remove status"><i class="fa-solid fa-trash"></i></button>
        </div>
        <div class="form-group">
          <label class="form-label">Label</label>
          <input type="text" class="form-input status-label-input" value="${esc(val.label||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Color</label>
          <input type="text" class="form-input status-color-input" value="${esc(val.color||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Icon FA class</label>
          <input type="text" class="form-input status-icon-input" value="${esc(val.icon_fa||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Card Tag</label>
          <input type="text" class="form-input status-tag-input" value="${esc(val.card_tag||'')}">
        </div>`;
      card.querySelector('.st-delete-btn').addEventListener('click', () => card.remove());
      grid.appendChild(card);
    });
  }

  function addStatus() {
    const statuses = collectStatuses();
    statuses['new_status_' + Date.now()] = { label: '', color: '', icon_fa: null, card_tag: null };
    renderStatuses(statuses);
    const cards = document.querySelectorAll('#statuses-grid .status-card');
    const last = cards[cards.length - 1];
    if (last) last.querySelector('.st-key-input')?.focus();
  }

  function collectStatuses() {
    const result = {};
    document.querySelectorAll('#statuses-grid .status-card').forEach(card => {
      const key = card.querySelector('.st-key-input')?.value?.trim();
      if (!key) return;
      result[key] = {
        label:    card.querySelector('.status-label-input')?.value || '',
        color:    card.querySelector('.status-color-input')?.value || '',
        icon_fa:  card.querySelector('.status-icon-input')?.value  || null,
        card_tag: card.querySelector('.status-tag-input')?.value   || null
      };
    });
    return result;
  }

  // Data sources editor
  function renderDataSources(sources) {
    const grid = document.getElementById('data-sources-grid');
    if (!grid) return;
    grid.innerHTML = '';
    Object.entries(sources).forEach(([key, val]) => {
      const grp = document.createElement('div');
      grp.className = 'form-group';
      grp.innerHTML = `<label class="form-label">${esc(key)}</label>
        <input type="text" class="form-input data-source-input" data-ds="${esc(key)}" value="${esc(val||'')}">`;
      grid.appendChild(grp);
    });
  }

  // Phase colors
  function renderPhaseColors(colors) {
    const grid = document.getElementById('phase-color-grid');
    grid.innerHTML = '';
    Object.entries(colors).forEach(([phase, color]) => {
      const row = document.createElement('div');
      row.className = 'phase-color-row';
      row.innerHTML = `
        <label class="form-label">${phase.replace('_', ' ').toUpperCase()}</label>
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="color" class="phase-color-preview phase-color-input" data-phase="${phase}" value="${color}" title="${phase}">
          <input type="text" class="form-input" data-phase-text="${phase}" value="${color}" style="font-family:monospace;font-size:13px;">
        </div>`;
      grid.appendChild(row);
    });
    // Sync color picker ↔ text
    grid.querySelectorAll('.phase-color-input').forEach(inp => {
      const txt = grid.querySelector(`[data-phase-text="${inp.dataset.phase}"]`);
      inp.addEventListener('input', () => { if (txt) txt.value = inp.value; });
      if (txt) txt.addEventListener('input', () => { inp.value = txt.value; });
    });
  }

  // Author links
  function renderAuthorLinks(links) {
    const list = document.getElementById('author-links-list');
    list.innerHTML = '';
    links.forEach((lnk, i) => {
      const row = document.createElement('div');
      row.className = 'author-link-row';
      row.dataset.idx = i;
      row.innerHTML = `
        <input type="text" class="form-input" placeholder="Label" value="${esc(lnk.label||'')}">
        <input type="text" class="form-input" placeholder="URL" value="${esc(lnk.url||'')}">
        <input type="text" class="form-input" placeholder="FA Icon class" value="${esc(lnk.icon_fa||'')}">
        <button class="btn-icon btn-icon--danger" onclick="this.closest('.author-link-row').remove()" title="Remove"><i class="fa-solid fa-trash"></i></button>`;
      list.appendChild(row);
    });
  }

  function addAuthorLink() {
    renderAuthorLinks([...(collectAuthorLinks()), { label: '', url: '', icon_fa: '', style: '' }]);
  }

  function collectAuthorLinks() {
    return Array.from(document.querySelectorAll('.author-link-row')).map(row => {
      const inps = row.querySelectorAll('input[type="text"]');
      return { label: inps[0]?.value||'', url: inps[1]?.value||'', icon_fa: inps[2]?.value||'', style: '' };
    });
  }

  // Timeline filters
  function renderTimelineFilters(filters) {
    const list = document.getElementById('timeline-filters-list');
    list.innerHTML = '';
    filters.forEach((f, i) => {
      const row = document.createElement('div');
      row.className = 'tag-row';
      row.dataset.idx = i;
      row.innerHTML = `
        <input type="text" class="form-input" placeholder="value" value="${esc(f.value||'')}">
        <input type="text" class="form-input" placeholder="Label" value="${esc(f.label||'')}">
        <button class="btn-icon btn-icon--danger" onclick="this.closest('.tag-row').remove()" title="Remove"><i class="fa-solid fa-trash"></i></button>`;
      list.appendChild(row);
    });
  }

  function addTimelineFilter() {
    renderTimelineFilters([...collectTimelineFilters(), { value: '', label: '' }]);
  }

  function collectTimelineFilters() {
    return Array.from(document.querySelectorAll('.tag-row')).map(row => {
      const inps = row.querySelectorAll('input[type="text"]');
      return { value: inps[0]?.value||'', label: inps[1]?.value||'' };
    });
  }

  // ── MEDIA ──────────────────────────────────────────────────────────
  function loadMediaPreviews() {
    const bust = '?t=' + Date.now();
    const setPreview = (id, src) => {
      const img = document.getElementById(id);
      if (img) { img.src = src + bust; img.onerror = () => { img.src = ''; }; }
    };
    setPreview('preview-logo',   '/assets/app/logo.png');
    setPreview('preview-banner', '/assets/app/banner.png');
    setPreview('preview-me',     '/assets/app/me.png');
  }

  async function uploadAsset(assetKey, input) {
    const file = input.files[0];
    if (!file) return;
    Toast.info('Uploading…');
    const res = await API.uploadAsset(assetKey, file);
    if (res.ok) {
      Toast.ok(assetKey + ' updated');
      loadMediaPreviews();
    } else {
      Toast.err('Upload failed: ' + res.error);
    }
    input.value = '';
  }

  // ── AVATARS ────────────────────────────────────────────────────────
  async function renderAvatars(filter = '') {
    const res = await API.listAvatars();
    if (!res.ok) { Toast.err('Cannot load avatars'); return; }
    _avatarAll = res.items || [];
    renderAvatarGrid(filter);
  }

  let _lastAvatarFilter = '';

  function renderAvatarGrid(filter = '') {
    _lastAvatarFilter = filter;
    const grid  = document.getElementById('avatars-grid');
    const empty = document.getElementById('avatars-empty');
    const items = _avatarAll.filter(a =>
      !filter || a.name.toLowerCase().includes(filter.toLowerCase()) || a.id.includes(filter.toLowerCase())
    );

    if (items.length === 0) {
      grid.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');

    grid.innerHTML = items.map((av, idx) => {
      const src = '/assets/app/avatars/' + encodeURIComponent(av.file) + '?t=' + _avatarBust;
      const isFirst = idx === 0;
      const isLast  = idx === items.length - 1;
      return `<div class="avatar-card" data-id="${esc(av.id)}">
        <div class="reorder-arrows">
          <button class="reorder-arrow-btn" title="Move up" ${isFirst ? 'disabled' : ''} onclick="Admin.moveAvatar('${esc(av.id)}', -1)">
            <i class="fa-solid fa-chevron-up"></i>
          </button>
          <button class="reorder-arrow-btn" title="Move down" ${isLast ? 'disabled' : ''} onclick="Admin.moveAvatar('${esc(av.id)}', 1)">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
        </div>
        <div class="avatar-img-wrap">
          <img src="${src}" alt="${esc(av.name)}" onerror="this.style.display='none'">
        </div>
        <div class="avatar-name">${esc(av.name)}</div>
        <div class="avatar-id">${esc(av.id)}</div>
        <div class="avatar-actions">
          <button class="btn-icon" onclick="Admin.openAvatarModal('edit','${esc(av.id)}','${esc(av.name)}','${esc(av.file)}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon btn-icon--danger" onclick="Admin.deleteAvatar('${esc(av.id)}','${esc(av.name)}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>`;
    }).join('');
  }

  function moveAvatar(id, direction) {
    const idx = _avatarAll.findIndex(a => a.id === id);
    if (idx === -1) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= _avatarAll.length) return;
    const [moved] = _avatarAll.splice(idx, 1);
    _avatarAll.splice(newIdx, 0, moved);
    if (_config?.profile?.avatars?.items) _config.profile.avatars.items = [..._avatarAll];
    renderAvatarGrid(_lastAvatarFilter);
  }

    function filterAvatars(val) {
    renderAvatarGrid(val);
  }

  // Avatar Modal
  function openAvatarModal(mode, id, name, file, { _noURLPush = false } = {}) {
    _avatarMode = mode;
    _editingId  = id || null;
    _avatarFile = null;

    const modal   = document.getElementById('avatar-modal');
    const icon    = document.getElementById('avatar-modal-icon');
    const title   = document.getElementById('avatar-modal-title');
    const nameIn  = document.getElementById('avatar-name-input');
    const idIn    = document.getElementById('avatar-id-input');
    const idHint  = document.getElementById('avatar-id-hint');
    const imgLbl  = document.getElementById('avatar-img-label');
    const prev    = document.getElementById('avatar-preview');
    const prompt  = document.getElementById('avatar-upload-prompt');
    const fileIn  = document.getElementById('avatar-file-input');
    const curFile = document.getElementById('avatar-current-file');

    if (mode === 'create') {
      icon.innerHTML    = '<i class="fa-solid fa-user-plus"></i>';
      title.textContent = 'Add Avatar';
      nameIn.value      = '';
      idIn.value        = '';
      idIn.readOnly     = false;
      if (idHint) idHint.textContent = '(auto on create)';
      imgLbl.textContent = 'Avatar Image *';
      if (curFile) curFile.textContent = '';
    } else {
      icon.innerHTML    = '<i class="fa-solid fa-user-pen"></i>';
      title.textContent = 'Edit Avatar';
      nameIn.value      = name || '';
      idIn.value        = id  || '';
      idIn.readOnly     = false;
      if (idHint) idHint.textContent = '(editable)';
      imgLbl.textContent = 'Replace Image (optional)';
      if (curFile && file) curFile.textContent = 'Current file: ' + file;
    }

    // Auto-sync name → id on create
    nameIn.oninput = () => {
      if (mode === 'create') {
        idIn.value = 'av_' + nameIn.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      }
    };

    prev.classList.add('hidden');
    prompt.classList.remove('hidden');
    fileIn.value = '';
    modal.classList.remove('hidden');
    // push URL state (skip during restore to avoid double-push)
    if (!_noURLPush) URLState.set('avatars', mode === 'create' ? 'new' : id);
  }

  // File selection in avatar modal
  document.addEventListener('DOMContentLoaded', () => {
    const zone   = document.getElementById('avatar-upload-zone');
    const fileIn = document.getElementById('avatar-file-input');

    fileIn.addEventListener('change', () => {
      const f = fileIn.files[0];
      if (!f) return;
      _avatarFile = f;
      const url = URL.createObjectURL(f);
      const prev   = document.getElementById('avatar-preview');
      const prompt = document.getElementById('avatar-upload-prompt');
      prev.src = url;
      prev.classList.remove('hidden');
      prompt.classList.add('hidden');
    });

    // Drag-over on zone
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (!f) return;
      _avatarFile = f;
      const url = URL.createObjectURL(f);
      const prev   = document.getElementById('avatar-preview');
      const prompt = document.getElementById('avatar-upload-prompt');
      prev.src = url;
      prev.classList.remove('hidden');
      prompt.classList.add('hidden');
    });

    document.getElementById('avatar-modal-close').addEventListener('click',   closeAvatarModal);
    document.getElementById('avatar-modal-cancel').addEventListener('click',  closeAvatarModal);
    document.getElementById('avatar-modal-save').addEventListener('click',    saveAvatar);
  });

  function closeAvatarModal() {
    document.getElementById('avatar-modal').classList.add('hidden');
    _avatarFile = null; _editingId = null;
    URLState.clearModal();
  }

  async function saveAvatar() {
    const name     = document.getElementById('avatar-name-input').value.trim();
    const customId = document.getElementById('avatar-id-input').value.trim();
    if (!name) { Toast.err('Name is required'); return; }
    if (_avatarMode === 'create' && !_avatarFile) { Toast.err('Image is required'); return; }

    Toast.info('Saving…');
    let res;
    if (_avatarMode === 'create') {
      res = await API.createAvatar(name, _avatarFile, customId);
    } else {
      const newId = customId || _editingId;
      res = await API.editAvatar(_editingId, name, _avatarFile || null, newId);
    }

    if (res.ok) {
      Toast.ok(_avatarMode === 'create' ? 'Avatar added' : 'Avatar updated');
      closeAvatarModal();
      _avatarBust = Date.now();
      await renderAvatars();
      // Also reload config to keep in sync
      await loadConfig();
      renderOverview();
    } else {
      Toast.err('Save failed: ' + res.error);
    }
  }

  async function deleteAvatar(id, name) {
    const ok = await Confirm.show(`Delete avatar "${name}"? This cannot be undone.`, 'Delete Avatar');
    if (!ok) return;
    const res = await API.deleteAvatar(id);
    if (res.ok) {
      Toast.ok('Avatar deleted');
      _avatarBust = Date.now();
      await renderAvatars();
      await loadConfig();
      renderOverview();
    } else {
      Toast.err('Delete failed: ' + res.error);
    }
  }

  // ── PROGRESSION ────────────────────────────────────────────────────
  function renderProgression() {
    const prog = _config.progression || {};
    sv('prog-xp-watched',  prog.xp_per_watched ?? 30);
    sv('prog-phase-bonus', prog.phase_completion_bonus ?? 200);
    sv('prog-saga-bonus',  prog.saga_completion_bonus ?? 500);
    sv('prog-ach-bonus',   prog.achievement_bonus ?? 0);

    // Phase bonuses
    const phaseBonusGrid = document.getElementById('phase-bonus-grid');
    if (phaseBonusGrid) {
      phaseBonusGrid.innerHTML = '';
      const pb = prog.phase_bonuses || {};
      Object.entries(pb).forEach(([key, val]) => {
        const grp = document.createElement('div');
        grp.className = 'form-group';
        grp.innerHTML = `<label class="form-label">${esc(key.replace('_', ' ').toUpperCase())}</label>
          <input type="number" class="form-input phase-bonus-input" data-pb="${esc(key)}" value="${val ?? 0}" min="0">`;
        phaseBonusGrid.appendChild(grp);
      });
    }

    // Saga bonuses
    const sagaBonusGrid = document.getElementById('saga-bonus-grid');
    if (sagaBonusGrid) {
      sagaBonusGrid.innerHTML = '';
      const sb = prog.saga_bonuses || {};
      Object.entries(sb).forEach(([key, val]) => {
        const grp = document.createElement('div');
        grp.className = 'form-group';
        const label = _refSagas.find(s => s.id === key)?.name || key;
        grp.innerHTML = `<label class="form-label">${esc(label)}</label>
          <input type="number" class="form-input saga-bonus-input" data-sb="${esc(key)}" value="${val ?? 0}" min="0">`;
        sagaBonusGrid.appendChild(grp);
      });
    }

    renderRanks(prog.ranks || []);
    renderAchievements(prog.achievements || []);
  }

  let _rankData = [];
  let _rankEditingIdx = null;

  function renderRanks(ranks) {
    _rankData = ranks.map(r => Object.assign({}, r));
    _renderRankCards();
  }

  function _renderRankCards() {
    const list = document.getElementById('ranks-list');
    list.innerHTML = '';
    _rankData.forEach((r, i) => {
      const card = document.createElement('div');
      card.className = 'rank-card';
      card.innerHTML = `
        <div class="rank-card-level">${r.level ?? (i+1)}</div>
        <div class="rank-card-info">
          <div class="rank-card-name">${esc(r.name || 'Unnamed')}</div>
          <div class="rank-card-xp">${r.min_xp ?? 0} XP minimum</div>
          <div class="rank-card-id">${esc(r.id || '')}</div>
        </div>
        <div class="rank-card-actions">
          <button class="btn-icon" data-ri="${i}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="btn-icon btn-icon--danger" data-rd="${i}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>`;
      card.querySelector('[data-ri]').addEventListener('click', () => openRankModal(i));
      card.querySelector('[data-rd]').addEventListener('click', () => {
        _rankData.splice(i, 1);
        _rankData.forEach((r, idx) => r.level = idx + 1);
        _renderRankCards();
      });
      list.appendChild(card);
    });
  }

  function openRankModal(idx, { _noURLPush = false } = {}) {
    _rankEditingIdx = (idx === undefined || idx === null) ? null : idx;
    const r = _rankEditingIdx !== null ? _rankData[_rankEditingIdx]
            : { id: '', name: '', min_xp: 0, level: _rankData.length + 1 };
    document.getElementById('rank-modal-title').textContent = _rankEditingIdx !== null ? 'Edit Rank' : 'Add Rank';
    document.getElementById('rank-id-input').value    = r.id || '';
    document.getElementById('rank-name-input').value  = r.name || '';
    document.getElementById('rank-minxp-input').value = r.min_xp ?? 0;
    document.getElementById('rank-level-input').value = r.level ?? (_rankData.length + 1);
    document.getElementById('rank-modal').classList.remove('hidden');
    // push URL state (skip during restore to avoid double-push)
    if (!_noURLPush) URLState.set('prog', _rankEditingIdx !== null ? 'rank_' + _rankEditingIdx : 'rank_new');
  }

  function _saveRankModal() {
    const id    = document.getElementById('rank-id-input').value.trim();
    const name  = document.getElementById('rank-name-input').value.trim();
    const minxp = parseInt(document.getElementById('rank-minxp-input').value) || 0;
    let   level = parseInt(document.getElementById('rank-level-input').value) || (_rankData.length + 1);
    if (!name) { Toast.err('Rank name required'); return; }
    const obj = { id: id || 'rank_' + Date.now(), name, min_xp: minxp, level };
    if (_rankEditingIdx !== null) {
      _rankData[_rankEditingIdx] = obj;
    } else {
      _rankData.push(obj);
    }
    _rankData.sort((a, b) => (a.min_xp ?? 0) - (b.min_xp ?? 0));
    _rankData.forEach((r, i) => r.level = i + 1);
    document.getElementById('rank-modal').classList.add('hidden');
    _rankEditingIdx = null;
    URLState.clearModal();
    _renderRankCards();
  }

  function collectRanks() {
    return _rankData;
  }

  // ── ACHIEVEMENTS (modal-based) ─────────────────────────────────────
  let _achData        = [];   // live array of achievement objects
  let _achEditingIdx  = null; // null = new, number = editing existing

  function renderAchievements(achs) {
    _achData = achs.map(a => Object.assign({}, a)); // clone
    _renderAchCards();
  }

  function _renderAchCards() {
    const list = document.getElementById('achievements-list');
    list.innerHTML = '';
    _achData.forEach((a, i) => {
      const card = document.createElement('div');
      card.className = 'achievement-row';
      card.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 12px;';
      card.innerHTML = `
        <div class="ach-icon-preview"><i class="${esc(a.icon_fa||'fa-solid fa-star')}"></i></div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.name||'Unnamed')}</div>
          <div style="font-size:12px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(a.desc||'')} · <span style="color:var(--gold)">${a.bonus_xp ?? 0} XP</span></div>
        </div>
        <button class="btn-icon" data-idx="${i}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="btn-icon btn-icon--danger" data-del="${i}" title="Delete"><i class="fa-solid fa-trash"></i></button>`;
      card.querySelector('[data-idx]').addEventListener('click', () => openAchModal(i));
      card.querySelector('[data-del]').addEventListener('click', () => {
        _achData.splice(i, 1);
        _renderAchCards();
      });
      list.appendChild(card);
    });
  }

  function openAchModal(idx, { _noURLPush = false } = {}) {
    _achEditingIdx = (idx === undefined || idx === null) ? null : idx;
    const a = _achEditingIdx !== null ? _achData[_achEditingIdx] : { id:'', name:'', desc:'', icon_fa:'fa-solid fa-star', req:{ type:'watched_min', count:1 }, bonus_xp:0 };

    const modal = document.getElementById('achievement-modal');
    document.getElementById('ach-modal-title').textContent = _achEditingIdx !== null ? 'Edit Achievement' : 'Add Achievement';

    const body = document.getElementById('ach-modal-body');
    const reqType = a.req?.type || 'watched_min';
    body.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
        <div class="form-group">
          <label class="form-label">ID</label>
          <input type="text" class="form-input ach-id-input" value="${esc(a.id||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Display Name</label>
          <input type="text" class="form-input ach-name-input" value="${esc(a.name||'')}">
        </div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:10px;margin-bottom:10px">
        <div class="form-group">
          <label class="form-label">Description</label>
          <input type="text" class="form-input ach-desc" value="${esc(a.desc||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Icon</label>
          <input type="text" class="form-input ach-icon" value="${esc(a.icon_fa||'')}">
        </div>
        <div class="form-group">
          <label class="form-label">Bonus XP</label>
          <input type="number" class="form-input ach-bonus-xp" value="${a.bonus_xp ?? 0}">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Requirement Type</label>
        <select class="form-input ach-req-type">
          ${['watched_min','phase_complete','phases_all_complete','all_watched','wishlist_min','all_released_watched'].map(t =>
            `<option value="${t}" ${t===reqType?'selected':''}>${_reqTypeLabel(t)}</option>`
          ).join('')}
        </select>
      </div>
      <div class="ach-req-picker"></div>`;

    const sel = body.querySelector('.ach-req-type');
    sel.addEventListener('change', () => renderReqPicker(body, sel.value, {}));
    renderReqPicker(body, reqType, a.req || {});

    modal.classList.remove('hidden');
    // push URL state (skip during restore to avoid double-push)
    if (!_noURLPush) URLState.set('prog', _achEditingIdx !== null ? 'achiv_' + _achEditingIdx : 'achiv_new');
  }

  function _saveAchModal() {
    const body    = document.getElementById('ach-modal-body');
    const reqType = body.querySelector('.ach-req-type')?.value || 'watched_min';
    let req = { type: reqType };
    if (reqType === 'watched_min' || reqType === 'wishlist_min') {
      req.count = parseInt(body.querySelector('.ach-req-count')?.value) || 1;
    } else if (reqType === 'phase_complete') {
      const active = body.querySelector('.chip--active');
      req.phase_id = active ? active.dataset.id : '';
    } else if (reqType === 'phases_all_complete') {
      req.phase_ids = [...body.querySelectorAll('.chip--active')].map(c => c.dataset.id);
    } else if (reqType === 'all_watched') {
      req.mcu_ids = [...body.querySelectorAll('.title-checkbox:checked')].map(c => c.value);
    }

    const obj = {
      id:       body.querySelector('.ach-id-input')?.value   || '',
      name:     body.querySelector('.ach-name-input')?.value || '',
      desc:     body.querySelector('.ach-desc')?.value       || '',
      icon_fa:  body.querySelector('.ach-icon')?.value       || 'fa-solid fa-star',
      req,
      bonus_xp: parseInt(body.querySelector('.ach-bonus-xp')?.value) || 0
    };

    if (_achEditingIdx !== null) {
      _achData[_achEditingIdx] = obj;
    } else {
      _achData.push(obj);
    }
    document.getElementById('achievement-modal').classList.add('hidden');
    URLState.clearModal();
    _renderAchCards();
  }

  // Wire achievement modal buttons
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('ach-modal-close').addEventListener('click',  () => { document.getElementById('achievement-modal').classList.add('hidden'); _achEditingIdx = null; URLState.clearModal(); });
    document.getElementById('ach-modal-cancel').addEventListener('click', () => { document.getElementById('achievement-modal').classList.add('hidden'); _achEditingIdx = null; URLState.clearModal(); });
    document.getElementById('ach-modal-save').addEventListener('click',   _saveAchModal);

    // Wire rank modal buttons
    document.getElementById('rank-modal-close')?.addEventListener('click',  () => { document.getElementById('rank-modal').classList.add('hidden'); _rankEditingIdx = null; URLState.clearModal(); });
    document.getElementById('rank-modal-cancel')?.addEventListener('click', () => { document.getElementById('rank-modal').classList.add('hidden'); _rankEditingIdx = null; URLState.clearModal(); });
    document.getElementById('rank-modal-save')?.addEventListener('click',   _saveRankModal);

    // Backdrop click closes all modals
    ['confirm-modal','avatar-modal','rank-modal','achievement-modal'].forEach(id => {
      const overlay = document.getElementById(id);
      if (!overlay) return;
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.classList.add('hidden');
          if (id === 'avatar-modal')      { _avatarFile = null; _editingId = null; URLState.clearModal(); }
          if (id === 'rank-modal')        { _rankEditingIdx = null; URLState.clearModal(); }
          if (id === 'achievement-modal') { _achEditingIdx = null; URLState.clearModal(); }
          if (id === 'confirm-modal')     { _resolve && _resolve(false); _resolve = null; }
        }
      });
    });
  });

  function addAchievement() { openAchModal(null); }

  function collectAchievements() { return _achData; }

  function renderReqPicker(row, type, existing) {
    const container = row.querySelector('.ach-req-picker');
    container.innerHTML = '';

    if (type === 'watched_min' || type === 'wishlist_min') {
      const label = type === 'wishlist_min' ? 'Minimum titles wishlisted' : 'Minimum titles watched';
      const val   = existing.count ?? 1;
      container.innerHTML = `
        <div class="req-picker-wrap req-picker-count-row">
          <span class="req-count-label">${label}</span>
          <div class="req-count-stepper">
            <button type="button" class="req-count-btn req-count-dec" tabindex="-1">−</button>
            <input type="number" class="ach-req-count" min="1" value="${val}">
            <button type="button" class="req-count-btn req-count-inc" tabindex="-1">+</button>
          </div>
        </div>`;
      const inp = container.querySelector('.ach-req-count');
      container.querySelector('.req-count-dec').addEventListener('click', () => { inp.value = Math.max(1, (parseInt(inp.value)||1) - 1); });
      container.querySelector('.req-count-inc').addEventListener('click', () => { inp.value = (parseInt(inp.value)||1) + 1; });

    } else if (type === 'all_released_watched') {
      container.innerHTML = `<div class="req-picker-wrap"><p style="color:var(--text3);font-size:13px">No extra config needed — automatically checks all currently released titles.</p></div>`;

    } else if (type === 'phase_complete') {
      container.innerHTML = `
        <div class="req-picker-wrap">
          <label class="form-label">Select Phase</label>
          <div class="picker-chips" data-picker="phase_single">
            ${_refPhases.map(p => `
              <button type="button" class="chip ${existing.phase_id === p.id ? 'chip--active' : ''}" data-id="${esc(p.id)}">
                ${esc(p.name)}
              </button>`).join('')}
          </div>
        </div>`;
      _wireChipsSingle(container.querySelector('[data-picker]'));

    } else if (type === 'phases_all_complete') {
      const sel = new Set(existing.phase_ids || []);
      container.innerHTML = `
        <div class="req-picker-wrap">
          <label class="form-label">Select Phases <small>(pick multiple)</small></label>
          <div class="picker-chips" data-picker="phase_multi">
            ${_refPhases.map(p => `
              <button type="button" class="chip ${sel.has(p.id) ? 'chip--active' : ''}" data-id="${esc(p.id)}">
                ${esc(p.name)}
              </button>`).join('')}
          </div>
          <div class="picker-preset-row">
            <label class="form-label" style="margin-top:12px">Quick select by Saga</label>
            <div class="picker-saga-presets">
              ${_refSagas.map(s => `
                <button type="button" class="btn-outline btn-sm saga-preset-btn" data-saga="${esc(s.id)}">
                  <i class="fa-solid fa-layer-group"></i> ${esc(s.name)}
                </button>`).join('')}
            </div>
          </div>
        </div>`;
      _wireChipsMulti(container.querySelector('[data-picker]'));
      container.querySelectorAll('.saga-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const sagaId    = btn.dataset.saga;
          const phaseIds  = _refPhases.filter(p => p.saga === sagaId).map(p => p.id);
          const chips     = container.querySelectorAll('.chip');
          chips.forEach(c => {
            c.classList.toggle('chip--active', phaseIds.includes(c.dataset.id));
          });
        });
      });

    } else if (type === 'all_watched') {
      const sel = new Set(existing.mcu_ids || []);
      const byPhase = {};
      _refTitles.forEach(t => {
        if (!byPhase[t.phase]) byPhase[t.phase] = [];
        byPhase[t.phase].push(t);
      });

      container.innerHTML = `
        <div class="req-picker-wrap">
          <div class="titles-picker-toolbar">
            <input type="text" class="form-input title-search-input" placeholder="Search titles…">
            <button type="button" class="btn-outline btn-sm titles-select-all-btn">Select All</button>
            <button type="button" class="btn-outline btn-sm titles-clear-btn">Clear</button>
            <span class="titles-picker-counter">0 selected</span>
          </div>
          <div class="titles-picker-body" data-picker="title_multi">
            ${Object.entries(byPhase).map(([phaseId, titles]) => {
              const phase = _refPhases.find(p => p.id === phaseId);
              return `<div class="titles-phase-group" data-phase="${esc(phaseId)}">
                <div class="titles-phase-header">
                  <span>${esc(phase?.name || phaseId)}</span>
                  <button type="button" class="btn-icon select-phase-btn" data-phase="${esc(phaseId)}" title="Toggle all in phase">
                    <i class="fa-solid fa-check"></i>
                  </button>
                </div>
                ${titles.map(t => `
                  <label class="title-chip ${sel.has(t.id) ? 'title-chip--active' : ''}" data-id="${esc(t.id)}">
                    <input type="checkbox" class="title-checkbox" value="${esc(t.id)}" ${sel.has(t.id)?'checked':''}>
                    <span class="title-chip-type type-${esc(t.type)}">${esc(t.type[0].toUpperCase())}</span>
                    <span class="title-chip-name">${esc(t.title)}</span>
                  </label>`).join('')}
              </div>`;
            }).join('')}
          </div>
        </div>`;

      const updateCounter = () => {
        const n = container.querySelectorAll('.title-checkbox:checked').length;
        const counter = container.querySelector('.titles-picker-counter');
        if (counter) counter.textContent = `${n} selected`;
      };

      // Search filter
      container.querySelector('.title-search-input').addEventListener('input', (e) => {
        const q = e.target.value.toLowerCase();
        container.querySelectorAll('.title-chip').forEach(chip => {
          const match = chip.querySelector('.title-chip-name').textContent.toLowerCase().includes(q);
          chip.style.display = match ? '' : 'none';
        });
        container.querySelectorAll('.titles-phase-group').forEach(grp => {
          const visible = [...grp.querySelectorAll('.title-chip')].some(c => c.style.display !== 'none');
          grp.style.display = visible ? '' : 'none';
        });
      });

      // Checkbox change
      container.querySelectorAll('.title-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          cb.closest('.title-chip').classList.toggle('title-chip--active', cb.checked);
          updateCounter();
        });
      });

      // Select all
      container.querySelector('.titles-select-all-btn').addEventListener('click', () => {
        container.querySelectorAll('.title-checkbox').forEach(cb => {
          cb.checked = true;
          cb.closest('.title-chip').classList.add('title-chip--active');
        });
        updateCounter();
      });

      // Clear all
      container.querySelector('.titles-clear-btn').addEventListener('click', () => {
        container.querySelectorAll('.title-checkbox').forEach(cb => {
          cb.checked = false;
          cb.closest('.title-chip').classList.remove('title-chip--active');
        });
        updateCounter();
      });

      // Toggle phase
      container.querySelectorAll('.select-phase-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const grp = container.querySelector(`.titles-phase-group[data-phase="${btn.dataset.phase}"]`);
          const cbs = [...grp.querySelectorAll('.title-checkbox')];
          const allChecked = cbs.every(c => c.checked);
          cbs.forEach(c => {
            c.checked = !allChecked;
            c.closest('.title-chip').classList.toggle('title-chip--active', !allChecked);
          });
          updateCounter();
        });
      });

      updateCounter();
    }
  }

  function _wireChipsSingle(wrap) {
    wrap.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('chip--active'));
        chip.classList.add('chip--active');
      });
    });
  }

  function _wireChipsMulti(wrap) {
    wrap.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => chip.classList.toggle('chip--active'));
    });
  }

  function _reqTypeLabel(t) {
    return { watched_min: 'Watched Min Count', wishlist_min: 'Wishlist Min Count', phase_complete: 'Complete a Phase',
             phases_all_complete: 'Complete Multiple Phases', all_watched: 'All Specific Titles Watched',
             all_released_watched: 'All Released Titles Watched' }[t] || t;
  }

  // ── UI TEXT ────────────────────────────────────────────────────────
  function renderUIText() {
    const uiText = _config.ui_text || {};
    const list   = document.getElementById('ui-text-list');
    list.innerHTML = '';

    const total = Object.keys(uiText).length;

    // Inject toolbar once (idempotent)
    let toolbar = document.getElementById('ui-text-toolbar');
    if (!toolbar) {
      const card = list.closest('.config-card');
      toolbar = document.createElement('div');
      toolbar.id = 'ui-text-toolbar';
      toolbar.className = 'ui-text-toolbar';
      toolbar.innerHTML = `
        <input type="text" class="form-input" id="ui-text-search" placeholder="Search keys or values…">
        <div class="ui-text-count-badge" id="ui-text-count">${total} strings</div>`;
      card.insertBefore(toolbar, list);

      document.getElementById('ui-text-search').addEventListener('input', (e) => {
        _filterUIText(e.target.value.trim().toLowerCase());
      });
    } else {
      const badge = document.getElementById('ui-text-count');
      if (badge) badge.textContent = total + ' strings';
    }

    // Group keys by prefix (before first underscore or dot, max 2 segments)
    const groups = {};
    Object.entries(uiText).forEach(([key, val]) => {
      const parts = key.split(/[_.]/);
      const group = parts.length > 1 ? parts[0] : 'general';
      if (!groups[group]) groups[group] = [];
      groups[group].push([key, val]);
    });

    // Render each group
    const sortedGroups = Object.keys(groups).sort();
    sortedGroups.forEach(groupName => {
      const entries = groups[groupName];
      const groupEl = document.createElement('div');
      groupEl.className = 'ui-text-group';
      groupEl.dataset.group = groupName;

      const header = document.createElement('div');
      header.className = 'ui-text-group-header';
      header.innerHTML = `
        <span class="ui-text-group-name">${esc(groupName)}</span>
        <span class="ui-text-group-count">${entries.length}</span>`;
      groupEl.appendChild(header);

      const rowsContainer = document.createElement('div');
      rowsContainer.className = 'ui-text-list';

      entries.forEach(([key, val]) => {
        const row = document.createElement('div');
        row.className = 'ui-text-row';
        row.dataset.uitextKey = key;

        // Collapsed view
        const collapsed = document.createElement('div');
        collapsed.className = 'ui-text-row-collapsed';

        const badge = document.createElement('span');
        badge.className = 'ui-text-key-badge';
        badge.textContent = key;

        const preview = document.createElement('div');
        preview.className = 'ui-text-preview';
        if (val) {
          preview.innerHTML = val;
        } else {
          preview.innerHTML = '<em>empty</em>';
        }

        const editBtn = document.createElement('button');
        editBtn.className = 'ui-text-edit-btn';
        editBtn.title = 'Edit';
        editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';

        collapsed.appendChild(badge);
        collapsed.appendChild(preview);
        collapsed.appendChild(editBtn);

        // Expanded edit area
        const editArea = document.createElement('div');
        editArea.className = 'ui-text-inline-edit';
        const safeVal = (val || '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
        editArea.innerHTML = `
          <input type="text" class="form-input" data-uitext="${esc(key)}" value="${esc(val||'')}" placeholder="${esc(key)}">
          <div class="ui-text-char-count">${safeVal.length} chars</div>`;

        // Toggle open/close
        const toggle = () => {
          const isOpen = editArea.classList.contains('open');
          // Close all others first
          document.querySelectorAll('.ui-text-inline-edit.open').forEach(el => {
            el.classList.remove('open');
            el.closest('.ui-text-row')?.classList.remove('editing');
          });
          if (!isOpen) {
            editArea.classList.add('open');
            row.classList.add('editing');
            const inp = editArea.querySelector('input');
            inp.focus();
            inp.select();
          }
        };

        editBtn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
        collapsed.addEventListener('click', toggle);

        // Live preview + char counter update
        editArea.querySelector('input').addEventListener('input', (e) => {
          const rawVal = e.target.value;
          preview.innerHTML = rawVal || '<em>empty</em>';
          const counter = editArea.querySelector('.ui-text-char-count');
          if (counter) counter.textContent = rawVal.length + ' chars';
        });

        // Close on Enter
        editArea.querySelector('input').addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            editArea.classList.remove('open');
            row.classList.remove('editing');
          }
          if (e.key === 'Escape') {
            editArea.classList.remove('open');
            row.classList.remove('editing');
          }
        });

        row.appendChild(collapsed);
        row.appendChild(editArea);
        rowsContainer.appendChild(row);
      });

      groupEl.appendChild(rowsContainer);
      list.appendChild(groupEl);
    });
  }

  function _filterUIText(query) {
    const groups = document.querySelectorAll('.ui-text-group');
    let visible = 0;

    groups.forEach(group => {
      let groupVisible = 0;
      group.querySelectorAll('.ui-text-row').forEach(row => {
        const key  = row.dataset.uitextKey || '';
        const val  = row.querySelector('input[data-uitext]')?.value || '';
        const match = !query || key.toLowerCase().includes(query) || val.toLowerCase().includes(query);
        row.style.display = match ? '' : 'none';
        if (match) groupVisible++;
      });
      group.style.display = groupVisible > 0 ? '' : 'none';
      visible += groupVisible;
    });

    const badge = document.getElementById('ui-text-count');
    if (badge) badge.textContent = query ? `${visible} match${visible !== 1 ? 'es' : ''}` : `${document.querySelectorAll('.ui-text-row').length} strings`;
  }

  function collectUIText() {
    document.querySelectorAll('[data-uitext]').forEach(inp => {
      _config.ui_text[inp.dataset.uitext] = inp.value;
    });
  }

  // ── HELPERS ────────────────────────────────────────────────────────
  function v(id)       { return document.getElementById(id)?.value ?? ''; }
  function sv(id, val) { const el = document.getElementById(id); if (el) el.value = val; }
  function num(id)     { return parseInt(v(id)) || 0; }
  function set(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }
  function esc(str)    { return String(str).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

  // ── PUBLIC API ─────────────────────────────────────────────────────
  return {
    init,
    switchSection,
    quickAction,
    saveAll,
    uploadAsset,
    addAuthorLink,
    addTimelineFilter,
    openRankModal,
    openAchModal,
    addAchievement,
    renderAvatars,
    filterAvatars,
    openAvatarModal,
    deleteAvatar,
    moveAvatar,
    addCtaButton,
    addContentType,
    addStatus,
  };

})();

/* ── BOOT ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => Admin.init());
