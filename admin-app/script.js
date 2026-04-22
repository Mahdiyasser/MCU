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
   MODULE: Admin Controller
═══════════════════════════════════════════════════════════════════ */
const Admin = (() => {

  // ── STATE ──────────────────────────────────────────────────────────
  let _config      = null;
  let _avatarMode  = 'create';
  let _editingId   = null;
  let _avatarFile  = null;
  let _avatarAll   = [];
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

  function switchSection(id) {
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
    const sec = document.getElementById('section-' + id);
    if (sec) sec.classList.add('active');
    const btn = document.querySelector(`.nav-item[data-section="${id}"]`);
    if (btn) btn.classList.add('active');
    closeSidebar();
    if (id === 'avatars') renderAvatars();
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
    _config.base_url    = v('cfg-base-url');

    // Behaviour
    _config.behaviour.loader_min_delay_ms   = num('cfg-loader-delay');
    _config.behaviour.toast_duration_ms     = num('cfg-toast-dur');
    _config.behaviour.toast_fade_ms         = num('cfg-toast-fade');
    _config.behaviour.search_debounce_ms    = num('cfg-search-debounce');
    _config.behaviour.xp_bar_rerender_ms    = num('cfg-xp-rerender');
    _config.behaviour.xp_bar_animate_ms     = num('cfg-xp-animate');

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

    // Phase colors
    document.querySelectorAll('.phase-color-input').forEach(inp => {
      _config.ui.phase_colors[inp.dataset.phase] = inp.value;
    });

    // Author
    _config.author.name = v('cfg-author-name');
    _config.author.role = v('cfg-author-role');
    _config.author.bio  = v('cfg-author-bio');
    _config.author.links = collectAuthorLinks();

    // Timeline filters
    _config.ui.timeline_filters = collectTimelineFilters();

    // Progression
    _config.progression.xp_per_watched         = num('prog-xp-watched');
    _config.progression.phase_completion_bonus  = num('prog-phase-bonus');
    _config.progression.saga_completion_bonus   = num('prog-saga-bonus');
    _config.progression.ranks                   = collectRanks();
    _config.progression.achievements            = collectAchievements();

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
    set('ov-filter-count',       _config.ui?.timeline_filters?.length ?? '?');

    // File status badges (visual only — just mark as expected)
    ['logo','banner','me'].forEach(k => {
      const el = document.getElementById('fp-' + k + '-status');
      if (el) el.innerHTML = '<span class="fp-badge fp-badge--ok">OK</span>';
    });
    const fjson = document.getElementById('fp-json-status');
    if (fjson) fjson.innerHTML = '<span class="fp-badge fp-badge--ok">OK</span>';
  }

  // ── APP CONFIG ─────────────────────────────────────────────────────
  function renderAppConfig() {
    const c = _config;
    sv('cfg-app-name',    c.app?.name ?? '');
    sv('cfg-app-tagline', c.app?.tagline ?? '');
    sv('cfg-app-version', c.app?.version ?? '');
    sv('cfg-base-url',    c.base_url ?? '');

    sv('cfg-loader-delay',    c.behaviour?.loader_min_delay_ms ?? 600);
    sv('cfg-toast-dur',       c.behaviour?.toast_duration_ms ?? 2200);
    sv('cfg-toast-fade',      c.behaviour?.toast_fade_ms ?? 300);
    sv('cfg-search-debounce', c.behaviour?.search_debounce_ms ?? 200);
    sv('cfg-xp-rerender',     c.behaviour?.xp_bar_rerender_ms ?? 900);
    sv('cfg-xp-animate',      c.behaviour?.xp_bar_animate_ms ?? 300);

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

    // Author
    sv('cfg-author-name', c.author?.name ?? '');
    sv('cfg-author-role', c.author?.role ?? '');
    sv('cfg-author-bio',  c.author?.bio ?? '');
    renderAuthorLinks(c.author?.links || []);

    // Timeline filters
    renderTimelineFilters(c.ui?.timeline_filters || []);
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

  function renderAvatarGrid(filter = '') {
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

    grid.innerHTML = items.map(av => {
      const src = '/assets/app/avatars/' + encodeURIComponent(av.file) + '?t=' + Date.now();
      return `<div class="avatar-card" data-id="${esc(av.id)}" draggable="true">
        <div class="reorder-handle" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></div>
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

    // Wire drag-to-reorder
    let _dragSrc = null;
    grid.querySelectorAll('.avatar-card').forEach(card => {
      card.addEventListener('dragstart', e => {
        _dragSrc = card;
        e.dataTransfer.effectAllowed = 'move';
        setTimeout(() => card.style.opacity = '.4', 0);
      });
      card.addEventListener('dragend', () => {
        card.style.opacity = '';
        grid.querySelectorAll('.avatar-card').forEach(c => c.classList.remove('drag-over-top','drag-over-bot'));
      });
      card.addEventListener('dragover', e => {
        e.preventDefault();
        if (!_dragSrc || _dragSrc === card) return;
        const rect = card.getBoundingClientRect();
        const mid  = rect.top + rect.height / 2;
        card.classList.toggle('drag-over-top', e.clientY < mid);
        card.classList.toggle('drag-over-bot', e.clientY >= mid);
      });
      card.addEventListener('dragleave', () => card.classList.remove('drag-over-top','drag-over-bot'));
      card.addEventListener('drop', e => {
        e.preventDefault();
        if (!_dragSrc || _dragSrc === card) return;
        card.classList.remove('drag-over-top','drag-over-bot');
        const rect = card.getBoundingClientRect();
        const after = e.clientY >= rect.top + rect.height / 2;
        const srcId = _dragSrc.dataset.id;
        const tgtId = card.dataset.id;
        const srcIdx = _avatarAll.findIndex(a => a.id === srcId);
        const tgtIdx = _avatarAll.findIndex(a => a.id === tgtId);
        if (srcIdx === -1 || tgtIdx === -1) return;
        const [moved] = _avatarAll.splice(srcIdx, 1);
        const insertAt = after ? tgtIdx : tgtIdx;
        const newIdx = _avatarAll.findIndex(a => a.id === tgtId);
        _avatarAll.splice(after ? newIdx + 1 : newIdx, 0, moved);
        // Persist order to config immediately
        if (_config?.profile?.avatars?.items) _config.profile.avatars.items = [..._avatarAll];
        renderAvatarGrid(filter);
      });
    });
  }

  function filterAvatars(val) {
    renderAvatarGrid(val);
  }

  // Avatar Modal
  function openAvatarModal(mode, id, name, file) {
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
    renderRanks(prog.ranks || []);
    renderAchievements(prog.achievements || []);
  }

  function renderRanks(ranks) {
    const list = document.getElementById('ranks-list');
    list.innerHTML = '';
    ranks.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = 'rank-row';
      row.dataset.idx = i;
      row.innerHTML = `
        <div class="rank-num">${r.level ?? (i+1)}</div>
        <input type="text" class="form-input" placeholder="Name" value="${esc(r.name||'')}">
        <input type="number" class="form-input" placeholder="Min XP" value="${r.min_xp ?? 0}">
        <input type="text" class="form-input" placeholder="ID" value="${esc(r.id||'')}">
        <button class="btn-icon btn-icon--danger" onclick="this.closest('.rank-row').remove()" title="Remove"><i class="fa-solid fa-trash"></i></button>`;
      list.appendChild(row);
    });
  }

  function addRank() {
    const ranks = collectRanks();
    const nextLevel = (ranks[ranks.length - 1]?.level ?? 0) + 1;
    renderRanks([...ranks, { id: 'rank_new_' + nextLevel, name: '', min_xp: 0, level: nextLevel }]);
  }

  function collectRanks() {
    return Array.from(document.querySelectorAll('.rank-row')).map((row, i) => {
      const inps = row.querySelectorAll('input');
      return {
        id:      inps[3]?.value || 'rank_' + i,
        name:    inps[1]?.value || '',
        min_xp:  parseInt(inps[2]?.value) || 0,
        level:   i + 1
      };
    });
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

  function openAchModal(idx) {
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
          <label class="form-label">Icon (FA class)</label>
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
    _renderAchCards();
  }

  // Wire achievement modal buttons
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('ach-modal-close').addEventListener('click',  () => document.getElementById('achievement-modal').classList.add('hidden'));
    document.getElementById('ach-modal-cancel').addEventListener('click', () => document.getElementById('achievement-modal').classList.add('hidden'));
    document.getElementById('ach-modal-save').addEventListener('click',   _saveAchModal);
  });

  function addAchievement() { openAchModal(null); }

  function collectAchievements() { return _achData; }

  function renderReqPicker(row, type, existing) {
    const container = row.querySelector('.ach-req-picker');
    container.innerHTML = '';

    if (type === 'watched_min' || type === 'wishlist_min') {
      const label = type === 'wishlist_min' ? 'Minimum titles wishlisted' : 'Minimum titles watched';
      container.innerHTML = `
        <div class="req-picker-wrap">
          <label class="form-label">${label}</label>
          <input type="number" class="form-input ach-req-count" min="1" value="${existing.count ?? 1}" style="max-width:140px">
        </div>`;

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
      // Group titles by phase for organised display
      const byPhase = {};
      _refTitles.forEach(t => {
        if (!byPhase[t.phase]) byPhase[t.phase] = [];
        byPhase[t.phase].push(t);
      });

      container.innerHTML = `
        <div class="req-picker-wrap">
          <label class="form-label">Select Titles <small>(${sel.size} selected)</small></label>
          <input type="text" class="form-input title-search-input" placeholder="Filter titles…" style="margin-bottom:10px">
          <div class="titles-picker-body" data-picker="title_multi">
            ${Object.entries(byPhase).map(([phaseId, titles]) => {
              const phase = _refPhases.find(p => p.id === phaseId);
              return `<div class="titles-phase-group" data-phase="${esc(phaseId)}">
                <div class="titles-phase-header">
                  <span>${esc(phase?.name || phaseId)}</span>
                  <button type="button" class="btn-icon select-phase-btn" data-phase="${esc(phaseId)}" title="Select all in phase">
                    <i class="fa-solid fa-check-double"></i>
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
          <div class="titles-picker-summary ach-selected-summary"></div>
        </div>`;

      // Wire search filter
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

      // Wire checkboxes → update label active state + summary
      const updateSummary = () => {
        const checked = [...container.querySelectorAll('.title-checkbox:checked')].map(c => c.value);
        const summary = container.querySelector('.ach-selected-summary');
        summary.textContent = checked.length
          ? `${checked.length} title${checked.length>1?'s':''} selected`
          : 'No titles selected';
        container.querySelectorAll('.form-label small').forEach(s => {
          s.textContent = `(${checked.length} selected)`;
        });
      };
      container.querySelectorAll('.title-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
          cb.closest('.title-chip').classList.toggle('title-chip--active', cb.checked);
          updateSummary();
        });
      });

      // Select all in phase button
      container.querySelectorAll('.select-phase-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const grp  = container.querySelector(`.titles-phase-group[data-phase="${btn.dataset.phase}"]`);
          const cbs  = [...grp.querySelectorAll('.title-checkbox')];
          const allChecked = cbs.every(c => c.checked);
          cbs.forEach(c => {
            c.checked = !allChecked;
            c.closest('.title-chip').classList.toggle('title-chip--active', !allChecked);
          });
          updateSummary();
        });
      });

      updateSummary();
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
    Object.entries(uiText).forEach(([key, val]) => {
      const row = document.createElement('div');
      row.className = 'ui-text-row';
      row.innerHTML = `
        <span class="ui-text-key">${esc(key)}</span>
        <input type="text" class="form-input" data-uitext="${esc(key)}" value="${esc(val||'')}">`;
      list.appendChild(row);
    });
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
    saveAll,
    uploadAsset,
    addAuthorLink,
    addTimelineFilter,
    addRank,
    addAchievement,
    renderAvatars,
    filterAvatars,
    openAvatarModal,
    deleteAvatar,
  };

})();

/* ── BOOT ──────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => Admin.init());
