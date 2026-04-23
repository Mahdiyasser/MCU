/* ════════════════════════════════════════════════════════════
   S.H.I.E.L.D. NEXUS — script.js
   Strategic Headquarters for Integrated Entity & Library Data
════════════════════════════════════════════════════════════ */

const CFG = {
  API_BASE: "index.php",
  IMG_MCU: "/assets/images/mcu/",
  IMG_STARS: "/assets/images/stars/",
  IMG_PLATFORMS: "/assets/images/platforms/",
};

// ─── REAL-TIME SYNC via SSE ─────────────────────────────────
// Connects to the server's SSE endpoint. When another user saves,
// the server pushes a 'change' event. We reload the changed dataset
// silently and update only what's needed — no full page reload.
const _SSE = {
  es:          null,
  lastTs:      0,
  retryDelay:  2000,
  retryTimer:  null,

  connect() {
    if (this.es) { this.es.close(); this.es = null; }
    clearTimeout(this.retryTimer);

    const url = `${CFG.API_BASE}?api=sse&since=${this.lastTs}`;
    this.es = new EventSource(url);

    this.es.addEventListener('change', (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.ts <= this.lastTs) return; // already have it
        this.lastTs = msg.ts;
        this._applyChange(msg.changed);
      } catch (_) {}
    });

    this.es.addEventListener('reconnect', () => {
      this.es.close();
      this.es = null;
      this.retryTimer = setTimeout(() => this.connect(), 100);
    });

    this.es.onerror = () => {
      this.es.close();
      this.es = null;
      this.retryTimer = setTimeout(() => this.connect(), this.retryDelay);
    };
  },

  // Called when WE just saved — bump lastTs so we don't echo our own save back.
  notifyOwnSave() {
    this.lastTs = Math.floor(Date.now() / 1000);
  },

  async _applyChange(dataset) {
    // Reload the changed dataset(s) from the server
    const reloaded = {};
    try {
      if (dataset === 'mcu' || dataset === 'stars') {
        if (dataset === 'mcu')   reloaded.mcu   = await api('load_mcu');
        if (dataset === 'stars') reloaded.stars  = await api('load_stars');
      } else if (dataset === 'data') {
        reloaded.data = await api('load_data');
      } else {
        // Unknown dataset — reload everything
        reloaded.mcu   = await api('load_mcu');
        reloaded.stars = await api('load_stars');
        reloaded.data  = await api('load_data');
      }
    } catch (_) { return; } // network error — skip silently

    // Detect if the user is currently viewing/editing an item
    // that is part of the changed dataset.
    const openItemId    = _SSE._getOpenItemId();
    const openIsChanged = openItemId && _SSE._itemBelongsTo(openItemId, dataset);

    // Apply the new data to global state
    if (reloaded.mcu)   MCU   = reloaded.mcu;
    if (reloaded.stars) STARS = reloaded.stars;
    if (reloaded.data)  DATA  = reloaded.data;

    // Silently re-render whatever tab is visible (preserves scroll & state)
    _SSE._refreshCurrentView(dataset);
    updateCounts();

    // If the user had an item open that was part of this change — notify them
    if (openIsChanged) {
      _SSE._notifyConflict(openItemId, dataset);
    }
  },

  // Return the id of the item currently open in the modal (edit or view), or null
  _getOpenItemId() {
    const overlay = document.getElementById('modal-overlay');
    if (!overlay || overlay.classList.contains('hidden')) return null;
    // Title edit form uses #f-id
    const titleId = document.getElementById('f-id');
    if (titleId && titleId.value) return titleId.value;
    // Star edit form uses #sf-id
    const starId  = document.getElementById('sf-id');
    if (starId && starId.value)   return starId.value;
    // Detail view — check data-item-id on modal-content
    const mc = document.getElementById('modal-content');
    return mc?.dataset?.itemId || null;
  },

  _itemBelongsTo(id, dataset) {
    if (dataset === 'mcu'   && id.startsWith('mcu_'))  return true;
    if (dataset === 'stars' && id.startsWith('star_')) return true;
    if (dataset === 'data') return true; // settings affect everything
    return false;
  },

  _refreshCurrentView(dataset) {
    const tab = currentTab;
    if ((dataset === 'mcu' || dataset === 'data') &&
        (tab === 'titles' || tab === 'reorder' || tab === 'bulk-reorder' ||
         tab === 'order-edit' || tab === 'overview' || tab === 'mcu')) {
      _SSE._refreshSilent(tab);
    }
    if ((dataset === 'stars' || dataset === 'data') &&
        (tab === 'stars' || tab === 'reorder' || tab === 'bulk-reorder' ||
         tab === 'overview')) {
      _SSE._refreshSilent(tab);
    }
    if (dataset === 'data' && tab === 'settings') {
      _SSE._refreshSilent(tab);
    }
  },

  _refreshSilent(tab) {
    // Re-render only the active tab's content without touching scroll or state
    const scroll = document.getElementById('main-content')?.scrollTop ?? 0;
    switch (tab) {
      case 'titles':       renderTitles();       break;
      case 'stars':        renderStars();        break;
      case 'reorder':      renderReorder();      break;
      case 'bulk-reorder': renderBulkMapper();   break;
      case 'order-edit':   renderOrderArrayEditor(); break;
      case 'overview':     renderOverview();     break;
      case 'mcu':          renderMcu();          break;
      case 'settings':     renderSettings();     break;
    }
    requestAnimationFrame(() => {
      const mc = document.getElementById('main-content');
      if (mc) mc.scrollTop = scroll;
    });
  },

  // Automatically update the open modal/form to the latest data,
  // then show an informational toast — no choice offered.
  _notifyConflict(itemId, dataset) {
    const isStar = itemId.startsWith('star_');

    // Refresh the modal content with the latest data silently
    const overlay = document.getElementById('modal-overlay');
    if (overlay && !overlay.classList.contains('hidden')) {
      // Determine if it's an edit form or a detail view
      const isEditTitle = !!document.getElementById('f-id');
      const isEditStar  = !!document.getElementById('sf-id');

      if (isEditTitle && !isStar) {
        openEditTitle(itemId, /* silent */ true);
      } else if (isEditStar && isStar) {
        openEditStar(itemId, /* silent */ true);
      } else {
        // Detail view — just reload it
        openDetailViewInternal(itemId, isStar ? 'star' : 'mcu');
      }
    }

    const label = isStar
      ? (STARS?.stars?.find(s => s.id === itemId)?.name || itemId)
      : (MCU?.entries?.find(e => e.id === itemId)?.title || itemId);

    toast(
      `<strong>${esc(label)}</strong> was updated by another user — your view has been refreshed.`,
      'warning',
      5000
    );
  },
};

let MCU = null;
let STARS = null;
let DATA = null;

let currentTab = "titles";
let titlesFilter = "all";
let titlesView = "grid";
let globalSearchVal = "";

// ─── DIRTY / UNSAVED CHANGES TRACKING ───────────────────────
// Tracks edits made in MCU/Settings tab forms that haven't been saved yet.
// Each entry: { tab, section, label, oldVal, newVal }
const _dirty = {
  changes: [],        // array of change descriptors
  // Snapshot of the settings/mcu form values when the tab was last rendered
  _mcuSnapshot: null,
  _settingsSnapshot: null,
  // Preserved innerHTML for the two editor grids (so edits survive tab switches)
  _mcuGridHTML: null,
  _settingsGridHTML: null,

  mark(tab, section, label) {
    // Add a change entry if not already present for this label
    if (!this.changes.find(c => c.tab === tab && c.label === label)) {
      this.changes.push({ tab, section, label });
    }
    this._updateStatus();
  },

  clear() {
    this.changes = [];
    this._mcuGridHTML = null;
    this._settingsGridHTML = null;
    this._updateStatus();
  },

  clearTab(tab) {
    this.changes = this.changes.filter(c => c.tab !== tab);
    if (tab === 'mcu') this._mcuGridHTML = null;
    if (tab === 'settings') this._settingsGridHTML = null;
    this._updateStatus();
  },

  hasChanges() {
    return this.changes.length > 0;
  },

  _updateStatus() {
    const el = document.getElementById("save-status");
    if (!el) return;
    if (this.hasChanges()) {
      el.className = "save-status unsaved";
      el.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> ${this.changes.length} unsaved change${this.changes.length !== 1 ? "s" : ""}`;
    } else {
      el.className = "save-status";
      el.innerHTML = `<i class="fa-solid fa-circle-check"></i> All saved`;
    }
  },
};

// ─── URL STATE TRACKER ──────────────────────────────────────
// ?tab={tab_name}
// ?tab={tab_name}&view={id}
// ?tab={tab_name}&edit={id}
// ?settings
// ?overview
// ?settings&imarc

function buildCleanUrl(params) {
  const base = window.location.pathname;
  const parts = [];
  Object.entries(params).forEach(([k, v]) => {
    if (v === true) parts.push(encodeURIComponent(k));
    else if (v !== undefined && v !== null && v !== false)
      parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  });
  return base + (parts.length ? "?" + parts.join("&") : "");
}

function pushState(params) {
  window.history.pushState(params, "", buildCleanUrl(params));
}

function replaceState(params) {
  window.history.replaceState(params, "", buildCleanUrl(params));
}

function readUrlState() {
  const p = new URL(window.location.href).searchParams;
  return {
    tab: p.has("tab") ? (p.get("tab") || "titles") : null,
    view: p.get("view") || null,
    edit: p.get("edit") || null,
    settings: p.has("settings"),
    overview: p.has("overview"),
    imarc: p.has("imarc"),
  };
}

function applyUrlState() {
  if (!MCU || !STARS) return;
  const state = readUrlState();

  const validTabs = ["titles","stars","reorder","bulk-reorder","order-edit","mcu","settings","overview","json-editor"];

  // Settings / Overview shortcuts
  if (state.settings) {
    switchTabInternal("settings");
    if (state.imarc) { setTimeout(() => openArchiveViewer(), 100); }
    return;
  }
  if (state.overview) { switchTabInternal("overview"); return; }

  // Tab-based
  const tab = state.tab || "titles";

  // Clean unknown tab param
  if (state.tab && !validTabs.includes(state.tab)) {
    replaceState({ tab: "titles" });
    switchTabInternal("titles");
    return;
  }

  switchTabInternal(tab);

  if (state.view) {
    const isStar = state.view.startsWith("star_");
    const exists = isStar
      ? STARS.stars.some(s => s.id === state.view)
      : MCU.entries.some(e => e.id === state.view);
    if (!exists) { replaceState({ tab }); return; }
    setTimeout(() => {
      openDetailViewInternal(state.view, isStar ? "star" : "mcu");
    }, 50);
  } else if (state.edit) {
    const isNewStar = state.edit === "new-star";
    const isNew     = state.edit === "new";
    const isStar    = isNewStar || state.edit.startsWith("star_");
    if (!isNew && !isNewStar) {
      const exists = isStar
        ? STARS.stars.some(s => s.id === state.edit)
        : MCU.entries.some(e => e.id === state.edit);
      if (!exists) { replaceState({ tab }); return; }
    }
    setTimeout(() => {
      if (isStar) openEditStar(isNewStar ? null : state.edit);
      else openEditTitle(isNew ? null : state.edit);
    }, 50);
  }
}

// Reorder state
let reorderDataset = "titles";
let reorderType = "release_order";
let reorderItems = [];

// Fast reorder state
let fastReorderSrcIdx = null;
let fastReorderCallback = null;
let fastReorderMode = "reorder";

// Bulk mapper state
let bulkDataset = "titles";
let bulkOrderType = "release_order";
let bulkItems = [];
let bulkOrder = [];
let bulkSelected = null;
let bulkActiveSlot = null;

// Confirm dialog
let confirmCallback = null;

// ─── IMAGE CACHE (never reload same URL twice) ────────────────
const _imgCache = new Map();

function cachedImgSrc(src) {
  if (!src) return src;
  if (!_imgCache.has(src)) _imgCache.set(src, src);
  return _imgCache.get(src);
}

// Returns an <img> tag that won't reload if already in cache
function imgTag(src, cls, alt, extraAttrs) {
  if (!src) return "";
  const cached = cachedImgSrc(src);
  return `<img class="${cls || ""}" src="${cached}" alt="${esc(alt || "")}" ${extraAttrs || ""} onerror="this.style.display='none'">`;
}

// Preload all images so tab switches feel instant
function preloadAllImages() {
  const urls = new Set();
  (MCU?.entries || []).forEach((e) => { if (e.image) urls.add(e.image); });
  (STARS?.stars || []).forEach((s) => { if (s.image) urls.add(s.image); });
  (DATA?.streaming_platforms || []).forEach((p) => { if (p.logo) urls.add(p.logo); });
  urls.forEach((url) => {
    if (!_imgCache.has(url)) {
      const img = new Image();
      img.src = url;
      _imgCache.set(url, url);
    }
  });
}

// ────────────────────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
  // If the URL is bare "/" with no query string, redirect to ?tab=titles
  if (!window.location.search) {
    window.history.replaceState({ tab: "titles" }, "", "?tab=titles");
  }
  loadAll();
  _SSE.connect();
  window.addEventListener("popstate", () => {
    closeModalSilent();
    applyUrlState();
  });
});

async function loadAll() {
  try {
    const [mcu, stars, data] = await Promise.all([
      api("load_mcu"),
      api("load_stars"),
      api("load_data"),
    ]);
    MCU = mcu;
    STARS = stars;
    DATA = data;

    preloadAllImages();
    updateCounts();
    applyUrlState();
  } catch (e) {
    toast("Failed to load database: " + e.message, "error");
  }
}

function closeModalSilent() {
  document.getElementById("modal-overlay").classList.add("hidden");
  document.getElementById("modal-content").innerHTML = "";
  document.querySelector(".modal-box")?.classList.remove("modal-content-wide");
  document.body.style.overflow = "";
}

// ────────────────────────────────────────────────────────────
// API HELPER
// ────────────────────────────────────────────────────────────
async function api(action, body = null) {
  const opts = { method: body ? "POST" : "GET" };
  if (body) {
    opts.headers = { "Content-Type": "application/json" };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${CFG.API_BASE}?api=${action}`, opts);
  const json = await res.json();
  if (json && json.error) throw new Error(json.error);
  return json;
}

// ────────────────────────────────────────────────────────────
// TAB NAVIGATION
// ────────────────────────────────────────────────────────────
function isMobile() {
  return window.matchMedia("(max-width: 768px)").matches;
}

function switchTab(tab) {
  // Block JSON Editor on mobile
  if (tab === "json-editor" && isMobile()) {
    showJsonEditorMobileBlock();
    return;
  }
  // Push URL state based on tab type
  if (tab === "settings") pushState({ settings: true });
  else if (tab === "overview") pushState({ overview: true });
  else pushState({ tab });
  switchTabInternal(tab);
}

function showJsonEditorMobileBlock() {
  const html = `
  <div class="modal-form" style="text-align:center;padding:2rem 1.5rem;">
    <div style="font-size:3rem;margin-bottom:1rem;">⚠️</div>
    <div class="modal-form-title" style="color:#e8b84b; justify-content: center;">JSON Editor Unavailable on Mobile</div>
    <div class="modal-form-sub" style="margin-top:0.75rem;line-height:1.6;max-width:320px;margin-left:auto;margin-right:auto;">
      The JSON Editor directly overwrites your data files on disk.
      Editing raw JSON on a mobile keyboard is extremely error-prone —
      a single typo or misplaced comma will corrupt the entire file.
    </div>
    <div style="margin-top:1.25rem;padding:0.85rem 1rem;background:rgba(232,184,75,0.1);border:1px solid rgba(232,184,75,0.3);border-radius:8px;font-size:0.85rem;color:#ccc;line-height:1.6;max-width:320px;margin-left:auto;margin-right:auto;">
      <strong style="color:#e8b84b;">To edit JSON safely:</strong><br>
      Open the editor on a desktop/laptop, make your changes there,
      validate the JSON, then save. Do not copy-paste raw JSON on mobile.
    </div>
    <div class="modal-actions" style="margin-top:1.5rem;justify-content:center;">
      <button class="btn-ghost-sm" onclick="closeModal()"><i class="fa-solid fa-xmark"></i> Dismiss</button>
    </div>
  </div>`;
  openModal(html);
}

function switchTabInternal(tab) {
  // Block JSON Editor on mobile even if navigated via URL
  if (tab === "json-editor" && isMobile()) {
    showJsonEditorMobileBlock();
    // Fall back to titles tab so the app still has an active tab
    tab = "titles";
  }

  currentTab = tab;

  document
    .querySelectorAll(".tab")
    .forEach((t) => t.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));

  const section = document.getElementById(`tab-${tab}`);
  if (section) section.classList.add("active");

  const navBtn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
  if (navBtn) navBtn.classList.add("active");

  // Sync mobile bottom nav
  document.querySelectorAll(".mob-nav-btn").forEach(b => b.classList.remove("active"));
  const mobBtn = document.querySelector(`.mob-nav-btn[data-tab="${tab}"]`);
  if (mobBtn) mobBtn.classList.add("active");

  const labels = {
    titles: "Titles",
    stars: "Stars",
    reorder: "Reorder",
    "bulk-reorder": "Bulk Mapper",
    "order-edit": "Order Arrays",
    mcu: "MCU",
    settings: "Settings",
    overview: "Overview",
    "json-editor": "JSON Editor",
  };
  document.getElementById("breadcrumb").textContent = labels[tab] || tab;

  renderCurrentTab();
}

function renderCurrentTab() {
  if (!MCU || !STARS) return;
  switch (currentTab) {
    case "titles":
      renderTitles();
      break;
    case "stars":
      renderStars();
      break;
    case "reorder":
      renderReorder();
      break;
    case "bulk-reorder":
      renderBulkMapper();
      break;
    case "order-edit":
      renderOrderArrayEditor();
      break;
    case "mcu":
      renderMcu();
      break;
    case "settings":
      renderSettings();
      break;
    case "overview":
      renderOverview();
      break;
    case "json-editor":
      if (isMobile()) { showJsonEditorMobileBlock(); break; }
      renderJsonEditor();
      break;
  }
}

// ────────────────────────────────────────────────────────────
// COUNTS & STATUS
// ────────────────────────────────────────────────────────────
function updateCounts() {
  document.getElementById("nav-count-titles").textContent = MCU.entries.length;
  document.getElementById("nav-count-stars").textContent = STARS.stars.length;
}

function setSaveStatus(state, msg) {
  const el = document.getElementById("save-status");
  if (!el) return;
  if (state === "" && !_dirty.hasChanges()) {
    el.className = "save-status";
    el.innerHTML = `<i class="fa-solid fa-circle-check"></i> All saved`;
  } else if (state === "saving") {
    el.className = "save-status saving";
    el.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> ${msg}`;
  } else if (state === "error") {
    el.className = "save-status error";
    el.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${msg}`;
  } else if (state === "") {
    // Has dirty changes — keep showing them
    _dirty._updateStatus();
  }
}

// ────────────────────────────────────────────────────────────
// SIDEBAR TOGGLE
// ────────────────────────────────────────────────────────────
function toggleSidebar() {
  const isMobile = window.innerWidth <= 1024;
  if (isMobile) {
    const sidebar = document.getElementById("sidebar");
    const isOpen = sidebar.classList.toggle("open");
    // Create/remove backdrop
    let backdrop = document.getElementById("sidebar-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "sidebar-backdrop";
      backdrop.onclick = () => closeSidebarDrawer();
      document.body.appendChild(backdrop);
    }
    backdrop.classList.toggle("visible", isOpen);
  } else {
    document.getElementById("sidebar").classList.toggle("collapsed");
    document.getElementById("main-content").classList.toggle("sidebar-collapsed");
  }
}

function closeSidebarDrawer() {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebar-backdrop")?.classList.remove("visible");
}

// Close drawer when a nav item is tapped on mobile
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      if (window.innerWidth <= 1024) closeSidebarDrawer();
    });
  });
});

// ────────────────────────────────────────────────────────────
// GLOBAL SEARCH
// ────────────────────────────────────────────────────────────
function handleGlobalSearch(val) {
  globalSearchVal = val.toLowerCase().trim();
  renderCurrentTab();
}

// ────────────────────────────────────────────────────────────
// TITLES TAB
// ────────────────────────────────────────────────────────────
function renderTitles() {
  const container = document.getElementById("titles-container");
  let entries = [...MCU.entries];

  if (titlesFilter !== "all") {
    entries = entries.filter((e) => e.type === titlesFilter);
  }

  if (globalSearchVal) {
    entries = entries.filter(
      (e) =>
        e.title.toLowerCase().includes(globalSearchVal) ||
        e.id.toLowerCase().includes(globalSearchVal) ||
        (e.director || "").toLowerCase().includes(globalSearchVal),
    );
  }

  const releasePos = Object.fromEntries(
    MCU.release_order.map((id, i) => [id, i]),
  );
  entries.sort((a, b) => (releasePos[a.id] ?? 999) - (releasePos[b.id] ?? 999));

  if (entries.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-film"></i><p>No titles found</p></div>`;
    return;
  }

  if (titlesView === "grid") {
    container.className = "cards-grid";
    container.innerHTML = entries.map((e) => titleCard(e)).join("");
  } else {
    container.className = "cards-grid list-view";
    container.innerHTML = entries
      .map((e, i) => titleListRow(e, i + 1))
      .join("");
  }
}

function titleCard(e) {
  const imgSrc = e.image || "";
  const year = e.release_date ? e.release_date.slice(0, 4) : "—";
  const status = titleStatusBadge(e.status);
  return `
  <div class="title-card" onclick="openDetailView('${e.id}','mcu')">
    ${
      imgSrc
        ? imgTag(
            imgSrc,
            "title-card-poster",
            e.title,
            `loading="lazy" onerror="this.parentNode.querySelector('.title-card-poster-placeholder').style.display='flex';this.style.display='none'"`,
          )
        : ""
    }
    <div class="title-card-poster-placeholder"${imgSrc ? ' style="display:none"' : ""}><i class="fa-solid fa-film"></i></div>
    <div class="title-card-actions">
      <button class="card-action-btn edit" onclick="event.stopPropagation();openEditTitle('${e.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
      <button class="card-action-btn delete" onclick="event.stopPropagation();deleteTitle('${e.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>
    <div class="title-card-body">
      <div class="title-card-id">${e.id}</div>
      <div class="title-card-name">${esc(e.title)}</div>
      <div class="title-card-meta">
        <span class="type-badge ${e.type}">${typeLabel(e.type)}</span>
        ${status}
        <span class="title-card-year">${year}</span>
      </div>
    </div>
  </div>`;
}

function titleListRow(e, n) {
  const imgSrc = e.image || "";
  const year = e.release_date ? e.release_date.slice(0, 4) : "—";
  const status = titleStatusBadge(e.status);
  return `
  <div class="title-list-row" onclick="openDetailView('${e.id}','mcu')">
    <span class="list-num">${n}</span>
    ${
      imgSrc
        ? imgTag(imgSrc, "list-poster", "", `loading="lazy"`)
        : `<div class="list-poster" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:14px"><i class="fa-solid fa-film"></i></div>`
    }
    <div class="list-info">
      <div class="list-title">${esc(e.title)}</div>
      <div class="list-meta">
        <span class="type-badge ${e.type}">${typeLabel(e.type)}</span>
        ${status}
        <span>${year}</span>
        <span>${esc(e.phase || "—")}</span>
        ${e.director ? `<span><i class="fa-solid fa-video" style="font-size:10px"></i> ${esc(e.director)}</span>` : ""}
      </div>
    </div>
    <span class="reo-id">${e.id}</span>
    <div class="list-actions">
      <button class="card-action-btn edit" onclick="event.stopPropagation();openEditTitle('${e.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
      <button class="card-action-btn delete" onclick="event.stopPropagation();deleteTitle('${e.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>
  </div>`;
}

function filterTitles(f, btn) {
  titlesFilter = f;
  document
    .querySelectorAll(".filter-chips .chip")
    .forEach((c) => c.classList.remove("active"));
  btn.classList.add("active");
  renderTitles();
}

function setView(v) {
  titlesView = v;
  document.getElementById("view-grid").classList.toggle("active", v === "grid");
  document.getElementById("view-list").classList.toggle("active", v === "list");
  if (!MCU || !STARS) return;
  renderTitles();
}

// ────────────────────────────────────────────────────────────
// STARS TAB
// ────────────────────────────────────────────────────────────
function renderStars() {
  const container = document.getElementById("stars-container");
  let stars = [...STARS.stars];

  if (globalSearchVal) {
    stars = stars.filter(
      (s) =>
        s.name.toLowerCase().includes(globalSearchVal) ||
        s.id.toLowerCase().includes(globalSearchVal) ||
        (s.character || "").toLowerCase().includes(globalSearchVal),
    );
  }

  document.getElementById("stars-count-label").textContent =
    `${stars.length} cast & crew members`;

  if (stars.length === 0) {
    container.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><i class="fa-solid fa-star"></i><p>No stars found</p></div>`;
    return;
  }

  container.innerHTML = stars.map((s) => starCard(s)).join("");
}

function starCard(s) {
  const imgSrc = s.image || "";
  return `
  <div class="star-card" onclick="openDetailView('${s.id}','star')">
    ${
      imgSrc
        ? imgTag(
            imgSrc,
            "star-photo",
            s.name,
            `loading="lazy" onerror="this.parentNode.querySelector('.star-photo-placeholder').style.display='flex';this.style.display='none'"`,
          )
        : ""
    }
    <div class="star-photo-placeholder"${imgSrc ? ' style="display:none"' : ""}><i class="fa-solid fa-user"></i></div>
    <div class="star-card-actions">
      <button class="card-action-btn edit" onclick="event.stopPropagation();openEditStar('${s.id}')" title="Edit"><i class="fa-solid fa-pen"></i></button>
      <button class="card-action-btn delete" onclick="event.stopPropagation();deleteStar('${s.id}')" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>
    <div class="star-card-body">
      <div class="star-card-id">${s.id}</div>
      <div class="star-card-name">${esc(s.name)}</div>
      <div class="star-card-char">${esc(s.character || "—")}</div>
    </div>
  </div>`;
}

// ────────────────────────────────────────────────────────────
// OPEN ADD NEW (context-aware)
// ────────────────────────────────────────────────────────────
function openAddNew() {
  if (currentTab === "stars") {
    openEditStar(null);
  } else {
    openEditTitle(null);
  }
}

// ────────────────────────────────────────────────────────────
// EDIT / ADD TITLE MODAL
// ────────────────────────────────────────────────────────────
function openEditTitle(id, silent = false) {
  if (!silent) {
    if (id) pushState({ tab: currentTab, edit: id });
    else pushState({ tab: currentTab, edit: "new" });
  }
  const isNew = !id;
  const entry = isNew ? newMcuEntry() : MCU.entries.find((e) => e.id === id);
  if (!entry) {
    toast("Entry not found", "error");
    return;
  }

  const phases = (DATA?.about?.phases || [])
    .map(
      (p) =>
        `<option value="${p.id}" ${entry.phase === p.id ? "selected" : ""}>${p.name}</option>`,
    )
    .join("");
  const allGenres = [
    "Action",
    "Adventure",
    "Comedy",
    "Crime",
    "Drama",
    "Fantasy",
    "Horror",
    "Mystery",
    "Romance",
    "Sci-Fi",
    "Thriller",
  ];
  const types = ["movie", "series", "special_presentation", "short"]
    .map(
      (t) =>
        `<option value="${t}" ${entry.type === t ? "selected" : ""}>${typeLabel(t)}</option>`,
    )
    .join("");
  const ratings = ["G", "PG", "PG-13", "R", "TV-G", "TV-PG", "TV-14", "TV-MA"]
    .map(
      (r) =>
        `<option value="${r}" ${entry.rating === r ? "selected" : ""}>${r}</option>`,
    )
    .join("");
  const statuses = [
    ["", "Not set"],
    ["released", "Released"],
    ["soon", "Soon"],
    ["upcoming", "Upcoming"],
    ["announced", "Announced"],
    ["cancelled", "Cancelled"],
  ]
    .map(
      ([value, label]) =>
        `<option value="${value}" ${(entry.status || "") === value ? "selected" : ""}>${label}</option>`,
    )
    .join("");

  const nextId = isNew ? getNextMcuId() : entry.id;

  const html = `
  <div class="modal-form">
    <div class="modal-form-title"><i class="fa-solid fa-film txt-red"></i> ${isNew ? "Add New Title" : "Edit Title"}</div>
    <div class="modal-form-sub">${isNew ? "Creating new MCU entry" : `Editing ${entry.id}`}</div>

    <div class="form-grid">
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-fingerprint"></i> ID</label>
        <input class="form-input id-field" id="f-id" value="${nextId}" placeholder="mcu_063" oninput="updateIdPreview()">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-tag"></i> Type</label>
        <select class="form-select" id="f-type" onchange="toggleSeriesFields()">${types}</select>
      </div>
      <div class="form-field form-col-full">
        <label class="form-label"><i class="fa-solid fa-heading"></i> Title</label>
        <input class="form-input" id="f-title" value="${esc(entry.title || "")}" placeholder="Iron Man">
      </div>

      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-calendar"></i> Release Date</label>
        <input class="form-input" type="date" id="f-release-date" value="${entry.release_date || ""}">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-signal"></i> Release Status</label>
        <select class="form-select" id="f-status">${statuses}</select>
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-layer-group"></i> Phase</label>
        <select class="form-select" id="f-phase">${phases}</select>
      </div>

      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-list-ol"></i> Release Order #</label>
        <input class="form-input" type="number" id="f-release-order" value="${entry.release_order || ""}" oninput="syncOrderFromEntry('release')">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-clock-rotate-left"></i> Chrono Order #</label>
        <input class="form-input" type="number" id="f-chrono-order" value="${entry.chronological_order || ""}" oninput="syncOrderFromEntry('chrono')">
      </div>

      <div class="form-field" id="f-runtime-wrap">
        <label class="form-label"><i class="fa-solid fa-stopwatch"></i> Runtime (min)</label>
        <input class="form-input" type="number" id="f-runtime" value="${entry.runtime_minutes || ""}">
      </div>
      <div class="form-field hidden" id="f-episodes-wrap">
        <label class="form-label"><i class="fa-solid fa-list"></i> Episodes</label>
        <input class="form-input" type="number" id="f-episodes" value="${entry.episodes || ""}">
      </div>
      <div class="form-field hidden" id="f-ep-runtime-wrap">
        <label class="form-label"><i class="fa-solid fa-stopwatch"></i> Min / Episode</label>
        <input class="form-input" type="number" id="f-ep-runtime" value="${entry.runtime_per_episode_minutes || ""}">
      </div>
      <div class="form-field hidden" id="f-season-wrap">
        <label class="form-label"><i class="fa-solid fa-tv"></i> Season #</label>
        <input class="form-input" type="number" id="f-season" value="${entry.season || ""}">
      </div>

      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-shield"></i> Rating</label>
        <select class="form-select" id="f-rating">${ratings}</select>
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-hourglass"></i> In-Universe Year</label>
        <input class="form-input" id="f-in-universe-year" value="${esc(entry.in_universe_year || "")}">
      </div>

      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-video"></i> Director</label>
        <input class="form-input" id="f-director" value="${esc(entry.director || "")}">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-pen-nib"></i> Writer</label>
        <input class="form-input" id="f-writer" value="${esc(entry.writer || "")}">
      </div>

      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-star-half-stroke"></i> IMDb</label>
        <input class="form-input" type="number" step="0.1" id="f-imdb" value="${entry.ratings?.imdb || ""}">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-tomato"></i> RT %</label>
        <input class="form-input" type="number" id="f-rt" value="${entry.ratings?.rotten_tomatoes || ""}">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-m"></i> Metacritic</label>
        <input class="form-input" type="number" id="f-metacritic" value="${entry.ratings?.metacritic || ""}">
      </div>

      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-sack-dollar"></i> Budget (USD)</label>
        <input class="form-input" type="number" id="f-budget" value="${entry.box_office?.budget_usd || ""}">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-chart-line"></i> Gross (USD)</label>
        <input class="form-input" type="number" id="f-gross" value="${entry.box_office?.worldwide_gross_usd || ""}">
      </div>

      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-camera-movie"></i> Post-Credit Scenes</label>
        <input class="form-input" type="number" id="f-post-credit" value="${entry.post_credit_scenes ?? ""}">
      </div>

      <div class="form-field form-col-full">
        <label class="form-label"><i class="fa-solid fa-align-left"></i> Synopsis</label>
        <textarea class="form-textarea" id="f-synopsis">${esc(entry.synopsis || "")}</textarea>
      </div>

      <div class="form-field form-col-full">
        <label class="form-label"><i class="fa-solid fa-tags"></i> Genres</label>
        <div class="genre-chips-wrap" id="genre-chips">
          ${allGenres.map((g) => `<button type="button" class="genre-chip ${(entry.genres || []).includes(g) ? "selected" : ""}" onclick="toggleGenre(this,'${g}')">${g}</button>`).join("")}
        </div>
        <div class="genre-input-wrap mt-8">
          <input class="form-input" id="genre-custom-input" placeholder="Add custom genre…">
          <button type="button" class="genre-add-btn" onclick="addCustomGenre()"><i class="fa-solid fa-plus"></i> Add</button>
        </div>
      </div>

      <!-- LINKS -->
      <div class="modal-section-divider form-col-full"><i class="fa-solid fa-link"></i> Links</div>
      <div class="form-field">
        <label class="form-label"><i class="fa-brands fa-imdb"></i> IMDb URL</label>
        <input class="form-input" id="f-imdb-url" value="${esc(entry.links?.imdb || "")}" placeholder="https://...">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-brands fa-wikipedia-w"></i> Wikipedia</label>
        <input class="form-input" id="f-wiki-url" value="${esc(entry.links?.wikipedia || "")}" placeholder="https://...">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-m"></i> Marvel</label>
        <input class="form-input" id="f-marvel-url" value="${esc(entry.links?.marvel || "")}" placeholder="https://...">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-brands fa-youtube"></i> Trailer</label>
        <input class="form-input" id="f-trailer-url" value="${esc(entry.links?.trailer || "")}" placeholder="https://...">
      </div>
      <!-- WHERE TO WATCH -->
      <div class="modal-section-divider form-col-full"><i class="fa-solid fa-play-circle"></i> Where to Watch</div>
      <div class="form-field form-col-full">
        <div class="wtw-rows" id="wtw-rows">
          ${(entry.where_to_watch || []).map((w, i) => wtwRow(w, i)).join("")}
        </div>
        <button type="button" class="add-cast-btn mt-8" onclick="addWtwRow()"><i class="fa-solid fa-plus"></i> Add Platform</button>
      </div>

      <!-- IMAGE -->
      <div class="modal-section-divider form-col-full"><i class="fa-solid fa-image"></i> Poster Image</div>
      <div class="form-field form-col-full">
        <div class="img-upload-area">
          <div class="img-preview-box">
            ${
              entry.image
                ? `<img id="img-preview" src="${cachedImgSrc(entry.image)}" alt="Poster">`
                : `<div class="img-preview-placeholder" id="img-preview"><i class="fa-solid fa-image"></i></div>`
            }
          </div>
          <div class="img-upload-controls">
            <label class="img-upload-btn"><i class="fa-solid fa-cloud-arrow-up"></i> Upload Image <input type="file" id="img-file-input" accept="image/*" style="display:none" onchange="previewImage(this,'img-preview')"></label>
            <div class="img-name-note" id="img-name-note">Will be saved as <strong id="img-name-preview">${nextId}.jpg</strong></div>
          </div>
        </div>
      </div>

      <!-- CAST -->
      <div class="modal-section-divider form-col-full"><i class="fa-solid fa-users"></i> Cast</div>
      <div class="form-field form-col-full">
        <div class="cast-section" id="cast-rows">
          ${(entry.cast || []).map((c, i) => castRow(c, i)).join("")}
        </div>
        <button type="button" class="add-cast-btn mt-8" onclick="addCastRow()"><i class="fa-solid fa-plus"></i> Add Cast Member</button>
      </div>

      <div class="developer-tools form-col-full">
        <button type="button" class="developer-tools-toggle" onclick="toggleDeveloperTools(this)">
          <i class="fa-solid fa-code"></i> Show Developer Tools
        </button>
        <div class="developer-tools-body hidden">
          <div class="modal-section-divider"><i class="fa-solid fa-code"></i> Full JSON Entry</div>
          <div class="form-field">
            <label class="form-label">Edit any field that does not have its own control above</label>
            <textarea class="form-textarea json-entry-editor" id="f-entry-json" spellcheck="false">${esc(JSON.stringify(entry, null, 2))}</textarea>
            <div class="json-editor-note">Changes here are saved too. Form fields above overwrite the same JSON keys, while any extra keys you add or edit here are preserved.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="modal-actions">
    <button class="btn-ghost-sm" onclick="closeModal()"><i class="fa-solid fa-xmark"></i> Cancel</button>
    <button class="btn-primary-sm" onclick="saveTitleFromForm('${id || ""}')"><i class="fa-solid fa-floppy-disk"></i> Save Title</button>
  </div>`;

  openModal(html);
  toggleSeriesFields();
}

// Sync order number fields in the edit modal (not saved yet, just UI feedback)
function syncOrderFromEntry(type) {
  // This is just a UI hint — actual sync happens on save
}

function toggleSeriesFields() {
  const type = document.getElementById("f-type")?.value;
  const isSeries = type === "series";
  toggle("f-episodes-wrap", isSeries);
  toggle("f-ep-runtime-wrap", isSeries);
  toggle("f-season-wrap", isSeries);
  toggle("f-runtime-wrap", !isSeries);
}

function castRow(c, i) {
  const starOpts = STARS.stars
    .map(
      (s) =>
        `<option value="${s.id}" ${c.star_id === s.id ? "selected" : ""}>${esc(s.name)}</option>`,
    )
    .join("");
  const typeOpts = ["lead", "supporting", "cameo", "voice", "uncredited"]
    .map(
      (t) =>
        `<option value="${t}" ${c.type === t ? "selected" : ""}>${t}</option>`,
    )
    .join("");
  return `
  <div class="cast-row" id="cast-row-${i}">
    <span class="cast-row-num">${i + 1}</span>
    <select class="form-select" data-cast-star style="flex:2">${starOpts}</select>
    <input class="form-input" data-cast-char value="${esc(c.character || "")}" placeholder="Character name" style="flex:3">
    <select class="form-select" data-cast-type style="flex:1">${typeOpts}</select>
    <button class="cast-remove" onclick="this.parentNode.remove()"><i class="fa-solid fa-xmark"></i></button>
  </div>`;
}

function addCastRow() {
  const container = document.getElementById("cast-rows");
  const i = container.children.length;
  const starOpts = STARS.stars
    .map((s) => `<option value="${s.id}">${esc(s.name)}</option>`)
    .join("");
  const typeOpts = ["lead", "supporting", "cameo", "voice", "uncredited"]
    .map((t) => `<option value="${t}">${t}</option>`)
    .join("");
  const div = document.createElement("div");
  div.className = "cast-row";
  div.id = `cast-row-${i}`;
  div.innerHTML = `
    <span class="cast-row-num">${i + 1}</span>
    <select class="form-select" data-cast-star style="flex:2">${starOpts}</select>
    <input class="form-input" data-cast-char value="" placeholder="Character name" style="flex:3">
    <select class="form-select" data-cast-type style="flex:1">${typeOpts}</select>
    <button class="cast-remove" onclick="this.parentNode.remove()"><i class="fa-solid fa-xmark"></i></button>`;
  container.appendChild(div);
}

function wtwRow(w, i) {
  const allPlatforms = DATA?.streaming_platforms || [];
  const platformOpts = allPlatforms
    .map((p) => `<option value="${p.id}" ${w.platform_id === p.id ? "selected" : ""}>${esc(p.name)}</option>`)
    .join("");
  const typeOpts = ["subscription","rental","purchase","free","unavailable","streaming","theater"]
    .map((t) => `<option value="${t}" ${w.type === t ? "selected" : ""}>${t}</option>`)
    .join("");
  return `
  <div class="wtw-row">
    <select class="form-select" data-wtw-platform style="flex:2">
      <option value="">— Platform ID —</option>
      ${platformOpts}
    </select>
    <input class="form-input" data-wtw-platform-id value="${esc(w.platform_id || "")}" placeholder="platform_id" style="flex:1">
    <select class="form-select" data-wtw-type style="flex:1">${typeOpts}</select>
    <input class="form-input" data-wtw-url value="${esc(w.url || "")}" placeholder="https://..." style="flex:3">
    <button class="cast-remove" onclick="this.parentNode.remove()"><i class="fa-solid fa-xmark"></i></button>
  </div>`;
}

function addWtwRow() {
  const container = document.getElementById("wtw-rows");
  const i = container.children.length;
  const div = document.createElement("div");
  div.innerHTML = wtwRow({ platform_id: "", url: "", type: "subscription" }, i);
  container.appendChild(div.firstElementChild);
  // Sync the select to the manual ID field
  const row = container.lastElementChild;
  const sel = row.querySelector("[data-wtw-platform]");
  const pidInput = row.querySelector("[data-wtw-platform-id]");
  sel.addEventListener("change", () => { if (sel.value) pidInput.value = sel.value; });
}

function updateIdPreview() {
  const id = document.getElementById("f-id")?.value || "";
  const el = document.getElementById("img-name-preview");
  if (el) el.textContent = id + ".jpg";
}

function toggleGenre(btn, genre) {
  btn.classList.toggle("selected");
}

function addCustomGenre() {
  const input = document.getElementById("genre-custom-input");
  const val = input.value.trim();
  if (!val) return;
  const wrap = document.getElementById("genre-chips");
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "genre-chip selected";
  btn.textContent = val;
  btn.onclick = () => btn.classList.toggle("selected");
  wrap.appendChild(btn);
  input.value = "";
}

function toggleDeveloperTools(btn) {
  const body = btn.closest(".developer-tools")?.querySelector(".developer-tools-body");
  if (!body) return;
  const isOpening = body.classList.contains("hidden");
  body.classList.toggle("hidden", !isOpening);
  btn.classList.toggle("open", isOpening);
  btn.innerHTML = isOpening
    ? '<i class="fa-solid fa-code"></i> Hide Developer Tools'
    : '<i class="fa-solid fa-code"></i> Show Developer Tools';
}

async function saveTitleFromForm(oldId) {
  const id = document.getElementById("f-id").value.trim();
  const title = document.getElementById("f-title").value.trim();
  if (!id || !title) {
    toast("ID and Title are required", "error");
    return;
  }

  // Warn if the ID collides with a different existing entry
  const idChanged = !oldId || id !== oldId;
  if (idChanged && MCU.entries.some(e => e.id === id)) {
    const idEl = document.getElementById("f-id");
    if (idEl) { idEl.style.borderColor = "var(--red)"; idEl.style.boxShadow = "0 0 0 2px rgba(220,53,69,0.22)"; }
    toast(`ID "${id}" is already used by another title — choose a unique ID`, "error");
    return;
  }

  const type = document.getElementById("f-type").value;
  const isSeries = type === "series";

  const genres = [
    ...document.querySelectorAll("#genre-chips .genre-chip.selected"),
  ].map((b) => b.textContent);

  const releaseOrderNum =
    parseInt(document.getElementById("f-release-order").value) || 0;
  const chronoOrderNum =
    parseInt(document.getElementById("f-chrono-order").value) || 0;

  const rawJson = document.getElementById("f-entry-json")?.value.trim();
  let baseEntry = {};
  if (rawJson) {
    try {
      baseEntry = JSON.parse(rawJson);
      if (!baseEntry || Array.isArray(baseEntry) || typeof baseEntry !== "object") {
        throw new Error("Full JSON Entry must be a JSON object");
      }
    } catch (e) {
      toast("Full JSON Entry has invalid JSON: " + e.message, "error");
      return;
    }
  } else if (oldId) {
    const existing = MCU.entries.find((e) => e.id === oldId);
    baseEntry = existing ? structuredClone(existing) : {};
  }

  const ratings = {
    ...(baseEntry.ratings || {}),
    imdb: parseFloat(document.getElementById("f-imdb").value) || null,
    rotten_tomatoes: parseInt(document.getElementById("f-rt").value) || null,
    metacritic: parseInt(document.getElementById("f-metacritic").value) || null,
  };

  const links = {
    ...(baseEntry.links || {}),
    imdb: document.getElementById("f-imdb-url").value,
    wikipedia: document.getElementById("f-wiki-url").value,
    marvel: document.getElementById("f-marvel-url").value,
    trailer: document.getElementById("f-trailer-url").value,
  };

  // Collect where_to_watch from UI rows
  const wtwRows = document.querySelectorAll("#wtw-rows .wtw-row");
  const watchList = [...wtwRows].map(row => {
    const platSel = row.querySelector("[data-wtw-platform]");
    const platId = row.querySelector("[data-wtw-platform-id]");
    const type = row.querySelector("[data-wtw-type]");
    const url = row.querySelector("[data-wtw-url]");
    const platform_id = (platId?.value || platSel?.value || "").trim();
    const platform = (DATA?.streaming_platforms || []).find(p => p.id === platform_id)?.name || platform_id;
    return {
      platform,
      platform_id,
      url: (url?.value || "").trim(),
      type: (type?.value || "subscription").trim(),
    };
  }).filter(w => w.platform_id && w.url);

  const entry = {
    ...baseEntry,
    id,
    title,
    type,
    phase: document.getElementById("f-phase").value,
    release_order: releaseOrderNum,
    chronological_order: chronoOrderNum,
    image: baseEntry.image || CFG.IMG_MCU + id + ".jpg",
    release_date: document.getElementById("f-release-date").value,
    in_universe_year: document.getElementById("f-in-universe-year").value,
    director: document.getElementById("f-director").value,
    writer: document.getElementById("f-writer").value,
    rating: document.getElementById("f-rating").value,
    genres,
    synopsis: document.getElementById("f-synopsis").value,
    cast: [],
    ratings,
    links,
    post_credit_scenes:
      parseInt(document.getElementById("f-post-credit").value) || 0,
    where_to_watch: watchList,
  };

  const status = document.getElementById("f-status").value;
  if (status) entry.status = status;
  else delete entry.status;

  if (isSeries) {
    entry.episodes = parseInt(document.getElementById("f-episodes").value) || 0;
    entry.runtime_per_episode_minutes =
      parseInt(document.getElementById("f-ep-runtime").value) || 0;
    entry.season = parseInt(document.getElementById("f-season").value) || 1;
  } else {
    entry.runtime_minutes =
      parseInt(document.getElementById("f-runtime").value) || 0;
    entry.box_office = {
      budget_usd: parseInt(document.getElementById("f-budget").value) || 0,
      worldwide_gross_usd:
        parseInt(document.getElementById("f-gross").value) || 0,
    };
  }

  let image_b64 = null;
  const fileInput = document.getElementById("img-file-input");
  if (fileInput && fileInput.files[0]) {
    image_b64 = await fileToBase64(fileInput.files[0]);
  }

  setSaveStatus("saving", "Saving…");
  try {
    const cast = await collectCastRowsForTitle(id, title);
    entry.cast = cast;
    await api("save_mcu", { entry, old_id: oldId || null, image_b64 });
    _SSE.notifyOwnSave();
    await loadAll();
    // Bust image cache for this entry so new uploads show up
    if (image_b64) _imgCache.delete(CFG.IMG_MCU + id + ".jpg");
    // If the ID changed, update the URL to reflect the new ID before closing
    if (oldId && id !== oldId) replaceState({ tab: currentTab, edit: id });
    closeModal();
    setSaveStatus("", "All saved");
    toast(`"${title}" saved successfully`, "success");
  } catch (e) {
    setSaveStatus("error", "Save failed");
    toast("Save error: " + e.message, "error");
  }
}

async function collectCastRowsForTitle(titleId, titleName) {
  const rows = [...document.querySelectorAll(".cast-row")];
  const cast = [];

  for (const row of rows) {
    const starSelect = row.querySelector("[data-cast-star]");
    const characterInput = row.querySelector("[data-cast-char]");
    const typeInput = row.querySelector("[data-cast-type]");
    let starId = starSelect?.value || "";
    const character = characterInput?.value || "";

    if (starId) {
      cast.push({
        star_id: starId,
        character,
        type: typeInput?.value || "supporting",
      });
    }
  }

  return cast;
}

function getNextMcuId() {
  if (!MCU || MCU.entries.length === 0) return "mcu_001";
  const max = Math.max(
    ...MCU.entries.map((e) => {
      const m = e.id.match(/mcu_(\d+)/);
      return m ? parseInt(m[1]) : 0;
    }),
  );
  return `mcu_${String(max + 1).padStart(3, "0")}`;
}

function newMcuEntry() {
  if (!MCU) return null;
  return {
    id: getNextMcuId(),
    title: "",
    type: "movie",
    phase: "phase_1",
    release_order: MCU.entries.length + 1,
    chronological_order: MCU.entries.length + 1,
    image: "",
    release_date: "",
    in_universe_year: "",
    runtime_minutes: 0,
    director: "",
    writer: "",
    rating: "PG-13",
    genres: [],
    synopsis: "",
    cast: [],
    box_office: { budget_usd: 0, worldwide_gross_usd: 0 },
    ratings: { imdb: null, rotten_tomatoes: null, metacritic: null },
    where_to_watch: [],
    links: { imdb: "", wikipedia: "", marvel: "", trailer: "" },
    post_credit_scenes: 0,
  };
}

function deleteTitle(id) {
  const entry = MCU.entries.find((e) => e.id === id);
  showConfirm(
    `Delete <strong>${esc(entry?.title || id)}</strong>?<br><small>This will also remove the image and all references.</small>`,
    async () => {
      try {
        setSaveStatus("saving", "Deleting…");
        await api("delete_mcu", { id });
        await loadAll();
        setSaveStatus("", "All saved");
        toast(`"${entry?.title}" deleted`, "warning");
      } catch (e) {
        setSaveStatus("error", "Delete failed");
        toast("Delete error: " + e.message, "error");
      }
    },
  );
}

// ────────────────────────────────────────────────────────────
// EDIT / ADD STAR MODAL
// ────────────────────────────────────────────────────────────
function openEditStar(id, silent = false) {
  if (!silent) {
    if (id) pushState({ tab: currentTab, edit: id });
    else pushState({ tab: currentTab, edit: "new-star" });
  }
  const isNew = !id;
  const star = isNew ? newStar() : STARS.stars.find((s) => s.id === id);
  if (!star) {
    toast("Star not found", "error");
    return;
  }

  const nextId = isNew ? getNextStarId() : star.id;

  const allTitles = MCU.entries;
  const appearances = star.mcu_appearances || [];

  // Build a merged appearances list: combine star.mcu_appearances AND any MCU entries
  // where this star appears in cast — so the display is always accurate
  const castAppearances = new Set(appearances);
  if (!isNew) {
    MCU.entries.forEach((e) => {
      if ((e.cast || []).some((c) => c.star_id === star.id)) {
        castAppearances.add(e.id);
      }
    });
  }
  const mergedAppearances = [...castAppearances];

  const html = `
  <div class="modal-form">
    <div class="modal-form-title"><i class="fa-solid fa-star txt-gold"></i> ${isNew ? "Add New Star" : "Edit Star"}</div>
    <div class="modal-form-sub">${isNew ? "Adding new cast/crew member" : `Editing ${star.id}`}</div>

    <div class="form-grid">
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-fingerprint"></i> ID</label>
        <input class="form-input id-field" id="sf-id" value="${nextId}" placeholder="star_075">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-user"></i> Full Name</label>
        <input class="form-input" id="sf-name" value="${esc(star.name || "")}" placeholder="Robert Downey Jr.">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-mask"></i> Main Character</label>
        <input class="form-input" id="sf-character" value="${esc(star.character || "")}" placeholder="Tony Stark / Iron Man">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-flag"></i> Nationality</label>
        <input class="form-input" id="sf-nationality" value="${esc(star.nationality || "")}">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-calendar-days"></i> Date of Birth</label>
        <input class="form-input" type="date" id="sf-dob" value="${star.born?.date || ""}">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-location-dot"></i> Place of Birth</label>
        <input class="form-input" id="sf-birth-place" value="${esc(star.born?.place || "")}">
      </div>

      <div class="form-field form-col-full">
        <label class="form-label"><i class="fa-solid fa-align-left"></i> Bio</label>
        <textarea class="form-textarea" id="sf-bio" style="min-height:100px">${esc(star.bio || "")}</textarea>
      </div>

      <!-- SOCIAL & LINKS -->
      <div class="modal-section-divider form-col-full"><i class="fa-solid fa-link"></i> Links & Social</div>
      <div class="form-field">
        <label class="form-label"><i class="fa-brands fa-instagram"></i> Instagram</label>
        <input class="form-input" id="sf-instagram" value="${esc(star.social_media?.instagram || "")}" placeholder="https://...">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-brands fa-x-twitter"></i> Twitter/X</label>
        <input class="form-input" id="sf-twitter" value="${esc(star.social_media?.twitter || "")}" placeholder="https://...">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-brands fa-facebook"></i> Facebook</label>
        <input class="form-input" id="sf-facebook" value="${esc(star.social_media?.facebook || "")}" placeholder="https://...">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-brands fa-imdb"></i> IMDb</label>
        <input class="form-input" id="sf-imdb" value="${esc(star.links?.imdb || "")}" placeholder="https://...">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-brands fa-wikipedia-w"></i> Wikipedia</label>
        <input class="form-input" id="sf-wiki" value="${esc(star.links?.wikipedia || "")}" placeholder="https://...">
      </div>
      <div class="form-field">
        <label class="form-label"><i class="fa-solid fa-globe"></i> Official Site</label>
        <input class="form-input" id="sf-official-site" value="${esc(star.links?.official_site || "")}" placeholder="https://...">
      </div>

      <!-- MCU APPEARANCES -->
      <div class="modal-section-divider form-col-full"><i class="fa-solid fa-film"></i> MCU Appearances</div>
      <div class="form-field form-col-full">
        <label class="form-label txt-muted">Click to toggle appearances. Checked items save to both star profile and are reflected in order arrays.</label>
        <div class="appearances-wrap">
          ${allTitles
            .map(
              (e) => `
            <button type="button" class="appearance-tag ${mergedAppearances.includes(e.id) ? "selected" : ""}"
              onclick="this.classList.toggle('selected')" data-appearance-id="${e.id}">
              ${e.id} — ${esc(e.title)}
            </button>`,
            )
            .join("")}
        </div>
      </div>

      <!-- IMAGE -->
      <div class="modal-section-divider form-col-full"><i class="fa-solid fa-image"></i> Photo</div>
      <div class="form-field form-col-full">
        <div class="img-upload-area">
          <div class="img-preview-box star-img-preview">
            ${
              star.image
                ? `<img id="star-img-preview" src="${cachedImgSrc(star.image)}" alt="">`
                : `<div class="img-preview-placeholder star-img-preview-placeholder" id="star-img-preview"><i class="fa-solid fa-user"></i></div>`
            }
          </div>
          <div class="img-upload-controls">
            <label class="img-upload-btn"><i class="fa-solid fa-cloud-arrow-up"></i> Upload Photo <input type="file" id="star-img-input" accept="image/*" style="display:none" onchange="previewImage(this,'star-img-preview')"></label>
            <div class="img-name-note">Will be saved as <strong>${nextId}.jpg</strong></div>
          </div>
        </div>
      </div>

      <div class="developer-tools form-col-full">
        <button type="button" class="developer-tools-toggle" onclick="toggleDeveloperTools(this)">
          <i class="fa-solid fa-code"></i> Show Developer Tools
        </button>
        <div class="developer-tools-body hidden">
          <div class="modal-section-divider"><i class="fa-solid fa-code"></i> Full JSON Star</div>
          <div class="form-field">
            <label class="form-label">Edit any star field that does not have its own control above</label>
            <textarea class="form-textarea json-entry-editor" id="sf-entry-json" spellcheck="false">${esc(JSON.stringify(star, null, 2))}</textarea>
            <div class="json-editor-note">Changes here are saved too. Form fields above overwrite the same JSON keys, while any extra keys you add or edit here are preserved.</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="modal-actions">
    <button class="btn-ghost-sm" onclick="closeModal()"><i class="fa-solid fa-xmark"></i> Cancel</button>
    <button class="btn-primary-sm" onclick="saveStarFromForm('${id || ""}')"><i class="fa-solid fa-floppy-disk"></i> Save Star</button>
  </div>`;

  openModal(html);
}

async function saveStarFromForm(oldId) {
  const id = document.getElementById("sf-id").value.trim();
  const name = document.getElementById("sf-name").value.trim();
  if (!id || !name) {
    toast("ID and Name are required", "error");
    return;
  }

  // Warn if the ID collides with a different existing star
  const idChanged = !oldId || id !== oldId;
  if (idChanged && STARS.stars.some(s => s.id === id)) {
    const idEl = document.getElementById("sf-id");
    if (idEl) { idEl.style.borderColor = "var(--red)"; idEl.style.boxShadow = "0 0 0 2px rgba(220,53,69,0.22)"; }
    toast(`ID "${id}" is already used by another star — choose a unique ID`, "error");
    return;
  }

  let appearances = [
    ...document.querySelectorAll("[data-appearance-id].selected"),
  ].map((b) => b.dataset.appearanceId);

  const rawJson = document.getElementById("sf-entry-json")?.value.trim();
  let baseStar = {};
  if (rawJson) {
    try {
      baseStar = JSON.parse(rawJson);
      if (!baseStar || Array.isArray(baseStar) || typeof baseStar !== "object") {
        throw new Error("Full JSON Star must be a JSON object");
      }
    } catch (e) {
      toast("Full JSON Star has invalid JSON: " + e.message, "error");
      return;
    }
  } else if (oldId) {
    const existing = STARS.stars.find((s) => s.id === oldId);
    baseStar = existing ? structuredClone(existing) : {};
  }

  const star = {
    ...baseStar,
    id,
    name,
    character: document.getElementById("sf-character").value,
    image: baseStar.image || CFG.IMG_STARS + id + ".jpg",
    nationality: document.getElementById("sf-nationality").value,
    born: {
      ...(baseStar.born || {}),
      date: document.getElementById("sf-dob").value,
      place: document.getElementById("sf-birth-place").value,
    },
    bio: document.getElementById("sf-bio").value,
    social_media: {
      ...(baseStar.social_media || {}),
      instagram: document.getElementById("sf-instagram").value,
      twitter: document.getElementById("sf-twitter").value,
      facebook: document.getElementById("sf-facebook").value,
    },
    links: {
      ...(baseStar.links || {}),
      imdb: document.getElementById("sf-imdb").value,
      wikipedia: document.getElementById("sf-wiki").value,
      official_site: document.getElementById("sf-official-site").value,
    },
    mcu_appearances: appearances,
  };

  let image_b64 = null;
  const fileInput = document.getElementById("star-img-input");
  if (fileInput && fileInput.files[0]) {
    image_b64 = await fileToBase64(fileInput.files[0]);
  }

  setSaveStatus("saving", "Saving…");
  try {
    await api("save_star", { star, old_id: oldId || null, image_b64 });
    _SSE.notifyOwnSave();
    if (image_b64) _imgCache.delete(CFG.IMG_STARS + id + ".jpg");
    await loadAll();
    // If the ID changed, update the URL to reflect the new ID before closing
    if (oldId && id !== oldId) replaceState({ tab: currentTab, edit: id });
    closeModal();
    setSaveStatus("", "All saved");
    toast(`"${name}" saved successfully`, "success");
  } catch (e) {
    setSaveStatus("error", "Save failed");
    toast("Save error: " + e.message, "error");
  }
}

function getNextStarId() {
  if (!STARS || STARS.stars.length === 0) return "star_001";
  const max = Math.max(
    ...STARS.stars.map((s) => {
      const m = s.id.match(/star_(\d+)/);
      return m ? parseInt(m[1]) : 0;
    }),
  );
  return `star_${String(max + 1).padStart(3, "0")}`;
}

function newStar() {
  return {
    id: getNextStarId(),
    name: "",
    character: "",
    image: "",
    born: { date: "", place: "" },
    nationality: "",
    bio: "",
    social_media: { instagram: "", twitter: "", facebook: "" },
    links: { wikipedia: "", imdb: "", official_site: null },
    mcu_appearances: [],
  };
}

function deleteStar(id) {
  const star = STARS.stars.find((s) => s.id === id);
  showConfirm(
    `Delete <strong>${esc(star?.name || id)}</strong>?<br><small>This will remove the photo and all cast references.</small>`,
    async () => {
      try {
        setSaveStatus("saving", "Deleting…");
        await api("delete_star", { id });
        await loadAll();
        setSaveStatus("", "All saved");
        toast(`"${star?.name}" deleted`, "warning");
      } catch (e) {
        setSaveStatus("error", "Delete failed");
        toast("Delete error: " + e.message, "error");
      }
    },
  );
}

// ────────────────────────────────────────────────────────────
// DETAIL VIEW MODAL
// ────────────────────────────────────────────────────────────
function openDetailView(id, type) {
  // Push URL state
  const tabParam = currentTab;
  if (type === "mcu") pushState({ tab: tabParam, view: id });
  else pushState({ tab: tabParam, view: id });
  openDetailViewInternal(id, type);
}

function openDetailViewInternal(id, type) {
  if (type === "mcu") {
    openTitleViewer(id);
  } else if (type === "star") {
    openStarViewer(id);
  }
}

function openTitleViewer(id, backStarId = null) {
  const entry = MCU.entries.find((e) => e.id === id);
  if (!entry) return;
  const backStar = backStarId ? STARS.stars.find((s) => s.id === backStarId) : null;

  const year = entry.release_date?.slice(0, 4) || "—";
  const phases = DATA?.about?.phases || [];
  const phaseLabel = phases.find(p => p.id === entry.phase)?.name || entry.phase || "—";

  // Cast rows with photos
  const castHtml = (entry.cast || [])
    .map((c) => {
      const star = STARS.stars.find((s) => s.id === c.star_id);
      if (!star) return "";
      const img = star.image
        ? `<img src="${cachedImgSrc(star.image)}" class="viewer-cast-photo" onerror="this.style.display='none'">`
        : `<div class="viewer-cast-photo viewer-cast-placeholder"><i class="fa-solid fa-user"></i></div>`;
      return `
      <div class="viewer-cast-card" onclick="openLinkedStarFromTitle('${id}','${star.id}')" title="View ${esc(star.name)}">
        ${img}
        <div class="viewer-cast-name">${esc(star.name)}</div>
        <div class="viewer-cast-char">${esc(c.character || "")}</div>
        <div class="viewer-cast-type">${esc(c.type || "")}</div>
      </div>`;
    })
    .join("");

  // Where to watch
  const wtwHtml = (entry.where_to_watch || []).length
    ? (entry.where_to_watch || []).map(w => {
        const plat = (DATA?.streaming_platforms || []).find(p => p.id === w.platform_id);
        const logo = plat?.logo
          ? `<img src="${esc(plat.logo)}" class="viewer-wtw-logo" onerror="this.style.display='none'">`
          : `<i class="fa-solid fa-play-circle viewer-wtw-icon"></i>`;
        const name = w.platform || plat?.name || w.platform_id || "Unknown";
        return `
        <a class="viewer-wtw-row" href="${esc(w.url || "#")}" target="_blank" rel="noopener">
          <div class="viewer-wtw-logo-wrap">${logo}</div>
          <div class="viewer-wtw-info">
            <div class="viewer-wtw-name">${esc(name)}</div>
            <div class="viewer-wtw-type">${esc(w.type || "")}</div>
          </div>
          <i class="fa-solid fa-external-link viewer-wtw-arrow"></i>
        </a>`;
      }).join("")
    : `<div class="viewer-no-data">No streaming info available</div>`;

  // Links
  const linksHtml = Object.entries(entry.links || {})
    .filter(([, v]) => v)
    .map(([k, v]) => {
      const icons = { imdb: "fa-brands fa-imdb", wikipedia: "fa-brands fa-wikipedia-w", marvel: "fa-solid fa-m", trailer: "fa-brands fa-youtube" };
      const labels = { imdb: "IMDb", wikipedia: "Wikipedia", marvel: "Marvel", trailer: "Trailer" };
      return `<a class="viewer-link-pill" href="${esc(v)}" target="_blank" rel="noopener"><i class="${icons[k] || 'fa-solid fa-link'}"></i> ${labels[k] || k}</a>`;
    }).join("");

  // Budget/box office
  const budget = entry.box_office?.budget_usd ? `$${(entry.box_office.budget_usd / 1e6).toFixed(0)}M` : null;
  const gross = entry.box_office?.worldwide_gross_usd ? `$${(entry.box_office.worldwide_gross_usd / 1e6).toFixed(0)}M` : null;

  const html = `
  <div class="title-viewer">
    <div class="viewer-hero">
      <div class="viewer-poster">
        ${entry.image
          ? imgTag(entry.image, "viewer-poster-img", entry.title, `onerror="this.style.display='none'"`)
          : `<div class="viewer-poster-placeholder"><i class="fa-solid fa-film"></i></div>`}
      </div>
      <div class="viewer-hero-info">
        <div class="viewer-id-badge">${entry.id}</div>
        <div class="viewer-title">${esc(entry.title)}</div>
        <div class="viewer-meta-row">
          <span class="type-badge ${entry.type}">${typeLabel(entry.type)}</span>
          ${titleStatusBadge(entry.status)}
          ${entry.rating ? `<span class="viewer-pill viewer-pill-dim">${entry.rating}</span>` : ""}
          <span class="viewer-pill viewer-pill-dim">${phaseLabel}</span>
          ${entry.ratings?.imdb ? `<span class="viewer-pill viewer-pill-gold"><i class="fa-brands fa-imdb"></i> ${entry.ratings.imdb}</span>` : ""}
          ${entry.ratings?.rotten_tomatoes ? `<span class="viewer-pill viewer-pill-red">🍅 ${entry.ratings.rotten_tomatoes}%</span>` : ""}
        </div>

        <div class="viewer-detail-grid">
          ${entry.release_date ? `<div class="viewer-detail-item"><span class="viewer-detail-label">Release</span><span class="viewer-detail-val">${esc(entry.release_date)}</span></div>` : ""}
          ${entry.in_universe_year ? `<div class="viewer-detail-item"><span class="viewer-detail-label">In-Universe Year</span><span class="viewer-detail-val">${esc(entry.in_universe_year)}</span></div>` : ""}
          ${entry.runtime_minutes ? `<div class="viewer-detail-item"><span class="viewer-detail-label">Runtime</span><span class="viewer-detail-val">${entry.runtime_minutes} min</span></div>` : ""}
          ${entry.episodes ? `<div class="viewer-detail-item"><span class="viewer-detail-label">Episodes</span><span class="viewer-detail-val">${entry.episodes}</span></div>` : ""}
          ${entry.director ? `<div class="viewer-detail-item"><span class="viewer-detail-label">Director</span><span class="viewer-detail-val">${esc(entry.director)}</span></div>` : ""}
          ${entry.writer ? `<div class="viewer-detail-item"><span class="viewer-detail-label">Writer</span><span class="viewer-detail-val">${esc(entry.writer)}</span></div>` : ""}
          ${entry.post_credit_scenes != null && entry.post_credit_scenes > 0 ? `<div class="viewer-detail-item"><span class="viewer-detail-label">Post-Credit Scenes</span><span class="viewer-detail-val">${entry.post_credit_scenes}</span></div>` : ""}
          ${budget ? `<div class="viewer-detail-item"><span class="viewer-detail-label">Budget</span><span class="viewer-detail-val">${budget}</span></div>` : ""}
          ${gross ? `<div class="viewer-detail-item"><span class="viewer-detail-label">Box Office</span><span class="viewer-detail-val">${gross}</span></div>` : ""}
        </div>

        ${(entry.genres || []).length ? `<div class="viewer-genres">${(entry.genres || []).map(g => `<span class="viewer-genre-tag">${esc(g)}</span>`).join("")}</div>` : ""}

        ${entry.synopsis ? `<div class="viewer-synopsis">${esc(entry.synopsis)}</div>` : ""}

        ${linksHtml ? `<div class="viewer-links">${linksHtml}</div>` : ""}
      </div>
    </div>

    ${(entry.cast || []).length ? `
    <div class="viewer-section">
      <div class="viewer-section-label"><i class="fa-solid fa-users"></i> Cast (${entry.cast.length})</div>
      <div class="viewer-cast-grid">${castHtml}</div>
    </div>` : ""}

    <div class="viewer-section">
      <div class="viewer-section-label"><i class="fa-solid fa-play-circle"></i> Where to Watch</div>
      <div class="viewer-wtw-list">${wtwHtml}</div>
    </div>

    <div class="modal-actions">
      ${backStar ? `<button class="btn-ghost-sm" onclick="openStarViewer('${backStar.id}')"><i class="fa-solid fa-arrow-left"></i> Back to ${esc(backStar.name)}</button>` : ""}
      <button class="btn-ghost-sm" onclick="closeModal()">Close</button>
      <button class="btn-primary-sm" onclick="closeModal();openEditTitle('${id}')"><i class="fa-solid fa-pen"></i> Edit</button>
    </div>
  </div>`;

  openModal(html);
}

function openLinkedTitleFromStar(starId, titleId) {
  pushState({ tab: currentTab, view: titleId });
  openTitleViewer(titleId, starId);
}

function openLinkedStarFromTitle(titleId, starId) {
  pushState({ tab: currentTab, view: starId });
  openStarViewer(starId, titleId);
}

function openStarViewer(id, backTitleId = null) {
  const star = STARS.stars.find((s) => s.id === id);
  if (!star) return;
  const backTitle = backTitleId ? MCU.entries.find((e) => e.id === backTitleId) : null;

  // Build merged appearances: combine mcu_appearances with cast references
  const castAppearanceIds = new Set(star.mcu_appearances || []);
  MCU.entries.forEach((e) => {
    if ((e.cast || []).some((c) => c.star_id === star.id)) {
      castAppearanceIds.add(e.id);
    }
  });

  // Sort appearances by release order
  const releaseOrder = MCU.release_order || [];
  const sortedIds = [...castAppearanceIds].sort((a, b) => {
    const ia = releaseOrder.indexOf(a), ib = releaseOrder.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const appHtml = sortedIds.map(aid => {
    const e = MCU.entries.find(x => x.id === aid);
    if (!e) return "";
    const year = e.release_date?.slice(0,4) || "—";
    const castEntry = (e.cast || []).find(c => c.star_id === star.id);
    const charName = castEntry?.character || "";
    return `
    <div class="viewer-appearance-row" onclick="openLinkedTitleFromStar('${star.id}','${e.id}')" title="Open ${esc(e.title)}">
      <div class="viewer-app-thumb">
        ${e.image
          ? `<img src="${cachedImgSrc(e.image)}" class="viewer-app-poster" onerror="this.style.display='none'">`
          : `<div class="viewer-app-poster viewer-app-poster-placeholder"><i class="fa-solid fa-film"></i></div>`}
      </div>
      <div class="viewer-app-info">
        <div class="viewer-app-title">${esc(e.title)}</div>
        <div class="viewer-app-meta">
          <span class="type-badge ${e.type}">${typeLabel(e.type)}</span>
          <span class="viewer-app-year">${year}</span>
          ${charName ? `<span class="viewer-app-char">as ${esc(charName)}</span>` : ""}
        </div>
      </div>
      <i class="fa-solid fa-chevron-right viewer-app-arrow"></i>
    </div>`;
  }).join("");

  // Social / external links
  const socialLinks = Object.entries(star.social_media || star.social || {}).filter(([,v]) => v)
    .map(([k, v]) => `<a class="viewer-link-pill" href="${esc(v)}" target="_blank" rel="noopener"><i class="fa-brands fa-${k}"></i> ${k}</a>`).join("");
  const extLinks = [
    star.links?.imdb ? `<a class="viewer-link-pill" href="${esc(star.links.imdb)}" target="_blank"><i class="fa-brands fa-imdb"></i> IMDb</a>` : "",
    star.links?.wikipedia ? `<a class="viewer-link-pill" href="${esc(star.links.wikipedia)}" target="_blank"><i class="fa-brands fa-wikipedia-w"></i> Wikipedia</a>` : "",
  ].filter(Boolean).join("");
  const allLinks = socialLinks + extLinks;

  const html = `
  <div class="star-viewer">
    <div class="viewer-hero">
      <div class="viewer-poster">
        ${star.image
          ? `<img src="${cachedImgSrc(star.image)}" class="viewer-poster-img viewer-poster-person" alt="${esc(star.name)}" onerror="this.style.display='none'">`
          : `<div class="viewer-poster-placeholder viewer-poster-person"><i class="fa-solid fa-user"></i></div>`}
      </div>
      <div class="viewer-hero-info">
        <div class="viewer-id-badge">${star.id}</div>
        <div class="viewer-title">${esc(star.name)}</div>
        <div class="viewer-meta-row">
          ${star.character ? `<span class="viewer-pill viewer-pill-gold"><i class="fa-solid fa-mask"></i> ${esc(star.character)}</span>` : ""}
          ${star.nationality ? `<span class="viewer-pill viewer-pill-dim"><i class="fa-solid fa-flag"></i> ${esc(star.nationality)}</span>` : ""}
        </div>

        <div class="viewer-detail-grid">
          ${star.born?.date ? `<div class="viewer-detail-item"><span class="viewer-detail-label">Born</span><span class="viewer-detail-val">${esc(star.born.date)}</span></div>` : ""}
          ${star.born?.place ? `<div class="viewer-detail-item"><span class="viewer-detail-label">Birthplace</span><span class="viewer-detail-val">${esc(star.born.place)}</span></div>` : ""}
          <div class="viewer-detail-item"><span class="viewer-detail-label">MCU Appearances</span><span class="viewer-detail-val">${castAppearanceIds.size}</span></div>
        </div>

        ${star.bio ? `<div class="viewer-synopsis">${esc(star.bio)}</div>` : ""}

        ${allLinks ? `<div class="viewer-links">${allLinks}</div>` : ""}
      </div>
    </div>

    ${sortedIds.length ? `
    <div class="viewer-section">
      <div class="viewer-section-label"><i class="fa-solid fa-film"></i> MCU Appearances (${sortedIds.length})</div>
      <div class="viewer-appearances-list">${appHtml}</div>
    </div>` : ""}

    <div class="modal-actions">
      ${backTitle ? `<button class="btn-ghost-sm" onclick="openTitleViewer('${backTitle.id}')"><i class="fa-solid fa-arrow-left"></i> Back to ${esc(backTitle.title)}</button>` : ""}
      <button class="btn-ghost-sm" onclick="closeModal()">Close</button>
      <button class="btn-primary-sm" onclick="closeModal();openEditStar('${id}')"><i class="fa-solid fa-pen"></i> Edit</button>
    </div>
  </div>`;

  openModal(html);
}

// ────────────────────────────────────────────────────────────
// REORDER TAB — Arrows + Fast Reorder (no drag)
// ────────────────────────────────────────────────────────────
function setReorderDataset(ds, btn) {
  reorderDataset = ds;
  document
    .querySelectorAll("#reo-titles-btn, #reo-stars-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  toggle("reo-order-wrap", ds === "titles");
  const autoBtn = document.getElementById("reo-auto-sort-btn");
  if (autoBtn) {
    autoBtn.innerHTML = ds === "stars"
      ? `<i class="fa-solid fa-film"></i> <span class="btn-label">Sort by First Appearance</span>`
      : `<i class="fa-solid fa-calendar-days"></i> <span class="btn-label">Auto Sort</span>`;
  }
  renderReorder();
}

function setReorderType(type, btn) {
  reorderType = type;
  document
    .querySelectorAll("#reo-release-btn, #reo-chrono-btn, #reo-universe-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderReorder();
}

function renderReorder() {
  if (reorderDataset === "titles") {
    const orderKey = reorderType === "in_universe_year" ? "chronological_order" : reorderType;
    const order = MCU[orderKey] || [];
    reorderItems = order
      .map((id) => MCU.entries.find((e) => e.id === id))
      .filter(Boolean);
    MCU.entries.forEach((e) => {
      if (!reorderItems.find((x) => x.id === e.id)) reorderItems.push(e);
    });
  } else {
    reorderItems = [...STARS.stars];
  }

  renderReorderList();
}

function renderReorderList() {
  const container = document.getElementById("reorder-list");
  const isTitle = reorderDataset === "titles";
  container.innerHTML = reorderItems
    .map((item, i) => {
      const img = item.image || "";
      const name = isTitle ? item.title : item.name;
      const subId = item.id;
      const isFirst = i === 0;
      const isLast = i === reorderItems.length - 1;
      const universe = isTitle ? parseInUniverseYear(item.in_universe_year) : null;
      const release = isTitle ? item.release_date || "—" : getStarFirstAppearanceInfo(item).date || "—";
      const unparseable = isTitle && reorderType === "in_universe_year" && item.in_universe_year && universe === null;
      return `
    <div class="reorder-row ${unparseable ? "reo-unparseable" : ""}" data-idx="${i}">
      <div class="reo-arrow-btns">
        <button class="reo-arrow-btn${isFirst ? " disabled" : ""}" onclick="moveReorderItem(${i}, -1)" title="Move Up" ${isFirst ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
        <button class="reo-arrow-btn${isLast ? " disabled" : ""}" onclick="moveReorderItem(${i}, 1)" title="Move Down" ${isLast ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>
      </div>
      <span class="reo-num">${i + 1}</span>
      ${
        img
          ? imgTag(img, "reo-thumb", "", `loading="lazy"`)
          : `<div class="reo-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:14px"><i class="${isTitle ? "fa-solid fa-film" : "fa-solid fa-user"}"></i></div>`
      }
      <span class="reo-title">${esc(name)}</span>
      ${isTitle ? `<span class="reo-badge type-badge ${item.type}">${typeLabel(item.type)}</span>` : ""}
      <span class="reo-date"><strong>Release</strong> ${esc(release)}</span>
      ${isTitle ? `<span class="reo-date ${unparseable ? "warn" : ""}"><strong>Universe</strong> ${esc(item.in_universe_year || "—")}</span>` : `<span class="reo-date"><strong>First Show</strong> ${esc(getStarFirstAppearanceInfo(item).title || "—")}</span>`}
      <span class="reo-id">${subId}</span>
      <button class="reo-fast-btn" onclick="openFastReorder(${i})" title="Jump to position"><i class="fa-solid fa-bolt"></i></button>
    </div>`;
    })
    .join("");
}

function moveReorderItem(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= reorderItems.length) return;
  const temp = reorderItems[idx];
  reorderItems[idx] = reorderItems[newIdx];
  reorderItems[newIdx] = temp;
  renderReorderList();
  // Scroll the moved item into view
  setTimeout(() => {
    const rows = document.querySelectorAll(".reorder-row");
    if (rows[newIdx])
      rows[newIdx].scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, 50);
}

// Fast Reorder modal
function openFastReorder(srcIdx) {
  fastReorderSrcIdx = srcIdx;
  fastReorderMode = "reorder";
  const item = reorderItems[srcIdx];
  const isTitle = reorderDataset === "titles";
  const name = isTitle ? item.title : item.name;
  document.getElementById("fast-reorder-item-name").textContent = name;

  const list = document.getElementById("fast-reorder-list");
  list.innerHTML = reorderItems
    .map((it, i) => {
      const itName = isTitle ? it.title : it.name;
      const isCurrent = i === srcIdx;
      return `
    <div class="fast-reorder-slot${isCurrent ? " current-slot" : ""}" onclick="${isCurrent ? "" : `doFastReorder(${i})`}">
      <span class="fast-slot-num">${i + 1}</span>
      <span class="fast-slot-name">${esc(itName)}</span>
      ${isCurrent ? '<span class="fast-slot-badge">current</span>' : ""}
    </div>`;
    })
    .join("");

  document.getElementById("fast-reorder-overlay").classList.remove("hidden");
}

function doFastReorder(targetIdx) {
  if (fastReorderSrcIdx === null || fastReorderSrcIdx === targetIdx) {
    closeFastReorder();
    return;
  }
  const mode = fastReorderMode;
  const items = mode === "order-array" ? oaItems : reorderItems;
  const item = items.splice(fastReorderSrcIdx, 1)[0];
  items.splice(targetIdx, 0, item);
  closeFastReorder();
  if (mode === "order-array") {
    renderOaList();
    const statusEl = document.getElementById("oa-status");
    if (statusEl) statusEl.textContent = `${oaItems.length} items — unsaved changes`;
  } else {
    renderReorderList();
  }
  toast(`Moved to position ${targetIdx + 1}`, "info");
}

function closeFastReorder(event) {
  if (event && event.target !== document.getElementById("fast-reorder-overlay"))
    return;
  document.getElementById("fast-reorder-overlay").classList.add("hidden");
  fastReorderSrcIdx = null;
  fastReorderMode = "reorder";
}

function sortReorderByDate() {
  if (reorderDataset === "titles") {
    if (reorderType === "in_universe_year") {
      reorderItems.sort((a, b) => {
        const ay = parseInUniverseYear(a.in_universe_year);
        const by = parseInUniverseYear(b.in_universe_year);
        if (ay === null && by === null) return (a.release_date || "").localeCompare(b.release_date || "") || a.title.localeCompare(b.title);
        if (ay === null) return 1;
        if (by === null) return -1;
        return ay - by || (a.release_date || "").localeCompare(b.release_date || "") || a.title.localeCompare(b.title);
      });
    } else {
      reorderItems.sort((a, b) =>
        (a.release_date || "").localeCompare(b.release_date || "") || a.title.localeCompare(b.title),
      );
    }
  } else {
    reorderItems.sort((a, b) => {
      const aa = getStarFirstAppearanceInfo(a);
      const bb = getStarFirstAppearanceInfo(b);
      return (aa.date || "9999-99-99").localeCompare(bb.date || "9999-99-99") || a.name.localeCompare(b.name);
    });
  }
  renderReorderList();
  toast(reorderDataset === "stars" ? "Sorted by first appearance" : "Sorted titles", "info");
}

function parseInUniverseYear(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw.replace(/[–—]/g, "-").replace(/\s+/g, " ").toUpperCase();
  const bce = normalized.match(/(\d{1,6})\s*BCE/);
  if (bce) return -parseInt(bce[1], 10);
  const ce = normalized.match(/\d{1,6}/);
  return ce ? parseInt(ce[0], 10) : null;
}

function getStarFirstAppearanceInfo(star) {
  const ids = new Set(star.mcu_appearances || []);
  MCU.entries.forEach((e) => {
    if ((e.cast || []).some((c) => c.star_id === star.id)) ids.add(e.id);
  });
  const matches = [...ids].map((id) => MCU.entries.find((e) => e.id === id)).filter(Boolean);
  matches.sort((a, b) => (a.release_date || "9999-99-99").localeCompare(b.release_date || "9999-99-99") || a.title.localeCompare(b.title));
  const first = matches[0];
  return first ? { date: first.release_date || "", title: first.title } : { date: "", title: "" };
}

async function applyReorder() {
  const ids = reorderItems.map((i) => i.id);
  setSaveStatus("saving", "Re-sequencing IDs…");
  try {
    if (reorderDataset === "titles") {
      const result = await api("reorder_mcu", {
        order_type: reorderType === "in_universe_year" ? "chronological_order" : reorderType,
        order: ids,
      });
      _SSE.notifyOwnSave();
      toast(
        `Re-ID complete. ${Object.keys(result.id_map || {}).length} IDs updated.`,
        "success",
      );
    } else {
      const result = await api("reorder_stars", { order: ids });
      _SSE.notifyOwnSave();
      toast(
        `Re-ID complete. ${Object.keys(result.id_map || {}).length} IDs updated.`,
        "success",
      );
    }
    _imgCache.clear();
    await loadAll();
    setSaveStatus("", "All saved");
    renderReorder();
  } catch (e) {
    setSaveStatus("error", "Reorder failed");
    toast("Reorder error: " + e.message, "error");
  }
}

// ────────────────────────────────────────────────────────────
// BULK MAPPER TAB
// ────────────────────────────────────────────────────────────
let bulkMapField = "phase";
let bulkSelectedIds = new Set();

function setBulkDataset(ds, btn) {
  bulkDataset = ds;
  document
    .querySelectorAll("#bulk-titles-btn, #bulk-stars-btn")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  bulkMapField = ds === "titles" ? "phase" : "nationality";
  bulkSelectedIds = new Set();
  initBulkMapper();
}

function setBulkMapField(field) {
  bulkMapField = field;
  renderBulkUI();
}

function renderBulkMapper() {
  initBulkMapper();
}

function initBulkMapper() {
  bulkItems = bulkDataset === "titles" ? [...MCU.entries] : [...STARS.stars];
  if (globalSearchVal) {
    bulkItems = bulkItems.filter((item) => {
      const hay = bulkDataset === "titles"
        ? `${item.title} ${item.id} ${item.phase || ""} ${item.type || ""}`
        : `${item.name} ${item.id} ${item.character || ""} ${item.nationality || ""}`;
      return hay.toLowerCase().includes(globalSearchVal);
    });
  }
  renderBulkUI();
}

function bulkFieldOptions() {
  return bulkDataset === "titles"
    ? [
        ["phase", "Phase"],
        ["type", "Content Type"],
        ["status", "Release Status"],
        ["in_universe_year", "In-Universe Year"],
      ]
    : [
        ["nationality", "Nationality"],
        ["character", "Main Character"],
      ];
}

function renderBulkUI() {
  const fieldSel = document.getElementById("bulk-field-select");
  if (fieldSel) {
    fieldSel.innerHTML = bulkFieldOptions()
      .map(([value, label]) => `<option value="${value}" ${bulkMapField === value ? "selected" : ""}>${label}</option>`)
      .join("");
  }

  const source = document.getElementById("bulk-source-list");
  const target = document.getElementById("bulk-target-list");
  if (!source || !target) return;

  source.innerHTML = bulkItems.map((item) => {
    const img = item.image || "";
    const name = bulkDataset === "titles" ? item.title : item.name;
    const current = getBulkFieldValue(item, bulkMapField) || "—";
    const checked = bulkSelectedIds.has(item.id);
    return `
    <label class="bulk-source-item bulk-map-row ${checked ? "selected" : ""}">
      <input type="checkbox" ${checked ? "checked" : ""} onchange="toggleBulkItem('${item.id}', this.checked)">
      ${img ? imgTag(img, "reo-thumb", "", `loading="lazy"`) : ""}
      <span class="bulk-map-main">
        <span class="bulk-map-name">${esc(name)}</span>
        <span class="bulk-map-current">${esc(item.id)} · current ${esc(bulkMapFieldLabel())}: ${esc(current)}</span>
      </span>
    </label>`;
  }).join("") || `<div class="empty-state"><i class="fa-solid fa-table-list"></i><p>No records found</p></div>`;

  target.innerHTML = `
    <div class="bulk-map-panel">
      <div class="bulk-map-count"><strong>${bulkSelectedIds.size}</strong> selected</div>
      <label class="form-label">Set ${esc(bulkMapFieldLabel())} To</label>
      ${bulkValueControl()}
      <div class="bulk-map-note">This applies the same mapped value to every selected ${bulkDataset === "titles" ? "title" : "star"}. It does not reorder or re-ID anything.</div>
    </div>`;
}

function bulkMapFieldLabel() {
  const found = bulkFieldOptions().find(([value]) => value === bulkMapField);
  return found ? found[1] : bulkMapField;
}

function getBulkFieldValue(item, field) {
  return field.split(".").reduce((acc, key) => acc?.[key], item);
}

function bulkValueControl() {
  if (bulkDataset === "titles" && bulkMapField === "phase") {
    const opts = (DATA?.about?.phases || []).map((p) => `<option value="${esc(p.id)}">${esc(p.name || p.id)}</option>`).join("");
    return `<select class="form-select" id="bulk-map-value">${opts}</select>`;
  }
  if (bulkDataset === "titles" && bulkMapField === "type") {
    const values = DATA?.content_types?.length ? DATA.content_types : ["movie", "series", "special_presentation", "short"];
    return `<select class="form-select" id="bulk-map-value">${values.map((v) => `<option value="${esc(v)}">${esc(typeLabel(v))}</option>`).join("")}</select>`;
  }
  if (bulkDataset === "titles" && bulkMapField === "status") {
    return `<select class="form-select" id="bulk-map-value">
      <option value="">Not set</option>
      <option value="released">Released</option>
      <option value="soon">Soon</option>
      <option value="upcoming">Upcoming</option>
      <option value="announced">Announced</option>
      <option value="cancelled">Cancelled</option>
    </select>`;
  }
  return `<input class="form-input" id="bulk-map-value" placeholder="Enter ${esc(bulkMapFieldLabel()).toLowerCase()}">`;
}

function toggleBulkItem(id, checked) {
  if (checked) bulkSelectedIds.add(id);
  else bulkSelectedIds.delete(id);
  renderBulkUI();
}

function toggleBulkSelectAll(selectAll) {
  bulkSelectedIds = selectAll ? new Set(bulkItems.map((i) => i.id)) : new Set();
  renderBulkUI();
}

async function applyBulkMapping() {
  const valueEl = document.getElementById("bulk-map-value");
  const value = valueEl?.value ?? "";
  const selected = bulkItems.filter((item) => bulkSelectedIds.has(item.id));
  if (!selected.length) {
    toast("Select at least one record to map", "warning");
    return;
  }

  setSaveStatus("saving", "Applying bulk mapping…");
  try {
    if (bulkDataset === "titles") {
      for (const item of selected) {
        const entry = structuredClone(item);
        if (bulkMapField === "status" && !value) delete entry.status;
        else entry[bulkMapField] = value;
        await api("save_mcu", { entry, old_id: item.id, image_b64: null });
      }
    } else {
      for (const item of selected) {
        const star = structuredClone(item);
        star[bulkMapField] = value;
        await api("save_star", { star, old_id: item.id, image_b64: null });
      }
    }
    await loadAll();
    setSaveStatus("", "All saved");
    toast(`Mapped ${selected.length} record${selected.length === 1 ? "" : "s"}`, "success");
    bulkSelectedIds = new Set();
    initBulkMapper();
  } catch (e) {
    setSaveStatus("error", "Bulk mapping failed");
    toast("Error: " + e.message, "error");
  }
}

// ────────────────────────────────────────────────────────────
// ORDER ARRAYS EDITOR TAB
// ────────────────────────────────────────────────────────────
let oaOrderType = "release_order";
let oaItems = [];

function setOrderArrayType(type, btn) {
  oaOrderType = type;
  document
    .querySelectorAll("#oa-release-btn, #oa-chrono-btn")
    .forEach((b) => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  renderOrderArrayEditor();
}

function renderOrderArrayEditor() {
  const order = MCU[oaOrderType] || [];
  oaItems = order
    .map((id) => MCU.entries.find((e) => e.id === id))
    .filter(Boolean);
  // Append any entries not in the order array at the end
  MCU.entries.forEach((e) => {
    if (!oaItems.find((x) => x.id === e.id)) oaItems.push(e);
  });

  const statusEl = document.getElementById("oa-status");
  if (statusEl) statusEl.textContent = `${oaItems.length} items`;

  renderOaList();
}

function renderOaList() {
  const container = document.getElementById("order-array-list");
  if (!container) return;
  container.innerHTML = oaItems
    .map((item, i) => {
      const img = item.image || "";
      const isFirst = i === 0;
      const isLast = i === oaItems.length - 1;
      return `
    <div class="reorder-row" data-idx="${i}">
      <div class="reo-arrow-btns">
        <button class="reo-arrow-btn${isFirst ? " disabled" : ""}" onclick="moveOaItem(${i}, -1)" title="Move Up" ${isFirst ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
        <button class="reo-arrow-btn${isLast ? " disabled" : ""}" onclick="moveOaItem(${i}, 1)" title="Move Down" ${isLast ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>
      </div>
      <span class="reo-num">${i + 1}</span>
      ${img ? imgTag(img, "reo-thumb", "", `loading="lazy"`) : `<div class="reo-thumb" style="display:flex;align-items:center;justify-content:center;color:var(--text-dim);font-size:14px"><i class="fa-solid fa-film"></i></div>`}
      <span class="reo-title">${esc(item.title)}</span>
      <span class="reo-badge type-badge ${item.type}">${typeLabel(item.type)}</span>
      <span class="reo-id">${item.id}</span>
      <button class="reo-fast-btn" onclick="openFastOrderArray(${i})" title="Jump to position"><i class="fa-solid fa-bolt"></i></button>
    </div>`;
    })
    .join("");
}

function openFastOrderArray(srcIdx) {
  fastReorderSrcIdx = srcIdx;
  fastReorderMode = "order-array";
  const item = oaItems[srcIdx];
  document.getElementById("fast-reorder-item-name").textContent = item.title;

  const list = document.getElementById("fast-reorder-list");
  list.innerHTML = oaItems
    .map((it, i) => {
      const isCurrent = i === srcIdx;
      return `
    <div class="fast-reorder-slot${isCurrent ? " current-slot" : ""}" onclick="${isCurrent ? "" : `doFastReorder(${i})`}">
      <span class="fast-slot-num">${i + 1}</span>
      <span class="fast-slot-name">${esc(it.title)}</span>
      ${isCurrent ? '<span class="fast-slot-badge">current</span>' : ""}
    </div>`;
    })
    .join("");

  document.getElementById("fast-reorder-overlay").classList.remove("hidden");
}

function moveOaItem(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= oaItems.length) return;
  const temp = oaItems[idx];
  oaItems[idx] = oaItems[newIdx];
  oaItems[newIdx] = temp;
  renderOaList();
  const statusEl = document.getElementById("oa-status");
  if (statusEl) statusEl.textContent = `${oaItems.length} items — unsaved changes`;
  setTimeout(() => {
    const rows = document.querySelectorAll("#order-array-list .reorder-row");
    if (rows[newIdx]) rows[newIdx].scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, 50);
}

function resetOrderArray() {
  oaOrderType = "release_order";
  document.querySelectorAll("#oa-release-btn, #oa-chrono-btn").forEach((b) => b.classList.remove("active"));
  const relBtn = document.getElementById("oa-release-btn");
  if (relBtn) relBtn.classList.add("active");
  renderOrderArrayEditor();
  animateOaRows();
  toast("Reset to current saved order", "info");
}

function animateOaRows() {
  const rows = document.querySelectorAll("#order-array-list .reorder-row");
  rows.forEach((row, i) => {
    row.style.opacity = "0";
    row.style.transform = "translateX(-10px)";
    row.style.transition = "none";
    // Stagger: 22ms per row, capped so it never exceeds ~700ms total
    const delay = Math.min(i * 22, 700);
    setTimeout(() => {
      row.style.transition = "opacity 0.2s ease, transform 0.2s ease";
      row.style.opacity = "1";
      row.style.transform = "translateX(0)";
    }, delay);
  });
}

async function saveOrderArrays() {
  const ids = oaItems.map((i) => i.id);
  const validIds = new Set(MCU.entries.map((e) => e.id));
  const bad = ids.filter((id) => !validIds.has(id));
  if (bad.length > 0) {
    toast(`Unknown IDs: ${bad.join(", ")}`, "error");
    return;
  }

  const payload = {};
  payload[oaOrderType] = ids;

  setSaveStatus("saving", "Saving order arrays…");
  try {
    await api("save_order_arrays", payload);
    _SSE.notifyOwnSave();
    await loadAll();
    setSaveStatus("", "All saved");
    toast("Order arrays saved. Entry position numbers updated.", "success");
  } catch (e) {
    setSaveStatus("error", "Save failed");
    toast("Error: " + e.message, "error");
  }
}

// ────────────────────────────────────────────────────────────
// SETTINGS TAB
// ────────────────────────────────────────────────────────────
function renderMcu() {
  currentTab = "mcu";
  const grid = document.getElementById("mcu-grid");
  if (_dirty._mcuGridHTML && _dirty.changes.some(c => c.tab === "mcu")) {
    if (grid) grid.innerHTML = _dirty._mcuGridHTML;
    return;
  }
  renderSettings();
}

function renderSettings() {
  const isMcuTab = currentTab === "mcu";
  const grid = document.getElementById(isMcuTab ? "mcu-grid" : "settings-grid");
  if (!grid || !DATA) return;

  // Preserve unsaved edits — if there are changes for this tab, restore saved HTML
  if (!isMcuTab && _dirty._settingsGridHTML && _dirty.changes.some(c => c.tab === "settings")) {
    grid.innerHTML = _dirty._settingsGridHTML;
    return;
  }

  const meta           = DATA.meta || {};
  const about          = DATA.about || {};
  const platforms      = DATA.streaming_platforms || [];
  const phases         = DATA.about?.phases || [];
  const sagas          = DATA.about?.sagas || [];
  const watchOrderTypes= DATA.watch_order_types || [];
  const contentTypes   = DATA.content_types || [];

  const mcuCount   = MCU?.entries?.length  || 0;
  const starCount  = STARS?.stars?.length  || 0;
  const movieCount = MCU?.entries?.filter(e => e.type === "movie").length || 0;
  const seriesCount= MCU?.entries?.filter(e => e.type === "series").length || 0;

  grid.innerHTML = `

  <!-- ── STATS BAR ── -->
  <div class="settings-stats-bar">
    <div class="settings-stat">
      <i class="fa-solid fa-shield-halved settings-stat-icon txt-red"></i>
      <span class="settings-stat-num txt-red">${mcuCount}</span>
      <span class="settings-stat-label">MCU Titles</span>
    </div>
    <div class="settings-stat-divider"></div>
    <div class="settings-stat">
      <i class="fa-solid fa-film settings-stat-icon txt-red"></i>
      <span class="settings-stat-num">${movieCount}</span>
      <span class="settings-stat-label">Movies</span>
    </div>
    <div class="settings-stat-divider"></div>
    <div class="settings-stat">
      <i class="fa-solid fa-tv settings-stat-icon txt-blue"></i>
      <span class="settings-stat-num">${seriesCount}</span>
      <span class="settings-stat-label">Series</span>
    </div>
    <div class="settings-stat-divider"></div>
    <div class="settings-stat">
      <i class="fa-solid fa-star settings-stat-icon txt-gold"></i>
      <span class="settings-stat-num txt-gold">${starCount}</span>
      <span class="settings-stat-label">Stars</span>
    </div>
    <div class="settings-stat-divider"></div>
    <div class="settings-stat">
      <i class="fa-solid fa-layer-group settings-stat-icon txt-blue"></i>
      <span class="settings-stat-num txt-blue">${phases.length}</span>
      <span class="settings-stat-label">Phases</span>
    </div>
    <div class="settings-stat-divider"></div>
    <div class="settings-stat">
      <i class="fa-solid fa-calendar-days settings-stat-icon txt-gold"></i>
      <span class="settings-stat-num" style="font-size:13px;letter-spacing:0">${esc(meta.last_updated || "—")}</span>
      <span class="settings-stat-label">Last Updated</span>
    </div>
  </div>

  <!-- ── META INFO ── -->
  <div class="settings-card">
    <div class="settings-card-header">
      <div class="settings-card-title"><i class="fa-solid fa-circle-info txt-blue"></i> Meta Information</div>
      <button class="settings-save-btn" onclick="saveSettingsMeta()"><i class="fa-solid fa-floppy-disk"></i> Save</button>
    </div>
    <div class="form-grid">
      <div class="form-field form-col-full">
        <label class="form-label">Database Title</label>
        <input class="form-input" id="s-meta-title" value="${esc(meta.title || "")}">
      </div>
      <div class="form-field form-col-full">
        <label class="form-label">Description</label>
        <textarea class="form-textarea settings-textarea" id="s-meta-desc">${esc(meta.description || "")}</textarea>
      </div>
      <div class="form-field">
        <label class="form-label">Maintainer</label>
        <input class="form-input" id="s-meta-maintainer" value="${esc(meta.maintainer || "")}">
      </div>
      <div class="form-field">
        <label class="form-label">Version</label>
        <input class="form-input" id="s-meta-version" value="${esc(meta.version || "")}">
      </div>
      <div class="form-field">
        <label class="form-label">Last Updated</label>
        <input class="form-input" type="date" id="s-meta-last-updated" value="${esc(meta.last_updated || "")}">
      </div>
      <div class="form-field">
        <label class="form-label">Total Phases</label>
        <input class="form-input" type="number" id="s-meta-total-phases" value="${meta.total_phases ?? ""}">
      </div>
      <div class="form-field">
        <label class="form-label">Base Image Path</label>
        <input class="form-input" id="s-meta-base-image-path" value="${esc(meta.base_image_path || "")}">
      </div>
      <div class="form-field">
        <label class="form-label">MCU Image Path</label>
        <input class="form-input" id="s-meta-mcu-image-path" value="${esc(meta.mcu_image_path || "")}">
      </div>
      <div class="form-field">
        <label class="form-label">Star Image Path</label>
        <input class="form-input" id="s-meta-star-image-path" value="${esc(meta.star_image_path || "")}">
      </div>
    </div>
  </div>

  <!-- ── UNIVERSE INFO ── -->
  <div class="settings-card">
    <div class="settings-card-header">
      <div class="settings-card-title"><i class="fa-solid fa-shield-halved txt-red"></i> Universe Info</div>
      <button class="settings-save-btn" onclick="saveSettingsAbout()"><i class="fa-solid fa-floppy-disk"></i> Save</button>
    </div>
    <div class="form-grid">
      <div class="form-field">
        <label class="form-label">Universe Name</label>
        <input class="form-input" id="s-universe" value="${esc(about.universe || "")}">
      </div>
      <div class="form-field">
        <label class="form-label">Studio</label>
        <input class="form-input" id="s-studio" value="${esc(about.studio || "")}">
      </div>
      <div class="form-field">
        <label class="form-label">Parent Company</label>
        <input class="form-input" id="s-parent" value="${esc(about.parent_company || "")}">
      </div>
      <div class="form-field">
        <label class="form-label">Founded</label>
        <input class="form-input" type="number" id="s-founded" value="${about.founded || ""}">
      </div>
      <div class="form-field">
        <label class="form-label">First Release</label>
        <input class="form-input" id="s-first-release" value="${esc(about.first_release || "")}">
      </div>
      <div class="form-field">
        <label class="form-label">Official Site</label>
        <input class="form-input" id="s-official-site" value="${esc(about.official_site || "")}">
      </div>
      <div class="form-field">
        <label class="form-label">Wikipedia</label>
        <input class="form-input" id="s-wikipedia" value="${esc(about.wikipedia || "")}">
      </div>
      <div class="form-field">
        <label class="form-label">IMDb</label>
        <input class="form-input" id="s-imdb" value="${esc(about.imdb || "")}">
      </div>
      <div class="form-field form-col-full">
        <label class="form-label">Long Description</label>
        <textarea class="form-textarea settings-textarea" id="s-desc-long">${esc(about.description_long || "")}</textarea>
      </div>
    </div>
  </div>

  <!-- ── PHASES EDITOR ── -->
  <div class="settings-card settings-card-full">
    <div class="settings-card-header">
      <div class="settings-card-title"><i class="fa-solid fa-layer-group txt-blue"></i> Phases</div>
      <div class="settings-card-actions">
        <button class="settings-ghost-btn" onclick="addPhase()"><i class="fa-solid fa-plus"></i> Add Phase</button>
        <button class="settings-save-btn" onclick="saveSettingsAbout()"><i class="fa-solid fa-floppy-disk"></i> Save</button>
      </div>
    </div>
    <div id="settings-phases" class="settings-phases-list">
      ${phases.map((p, i) => {
        const sagaOpts = sagas.map(s => `<option value="${esc(s.id)}" ${p.saga === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
        return `
      <div class="settings-phase-row" data-phidx="${i}">
        <div class="phase-row-num">${i + 1}</div>
        <div class="phase-row-fields">
          <div class="phase-field-pair">
            <div>
              <label class="form-label">Phase ID</label>
              <input class="form-input" data-ph-id value="${esc(p.id)}" placeholder="e.g. phase_1">
            </div>
            <div>
              <label class="form-label">Phase Name</label>
              <input class="form-input" data-ph-name value="${esc(p.name)}" placeholder="e.g. Phase One">
            </div>
            <div>
              <label class="form-label">Number</label>
              <input class="form-input" type="number" data-ph-number value="${p.number ?? ""}" placeholder="1">
            </div>
            <div>
              <label class="form-label">Saga</label>
              <select class="form-select" data-ph-saga><option value="">— None —</option>${sagaOpts}</select>
            </div>
          </div>
          <div class="phase-field-pair">
            <div>
              <label class="form-label">Start Year</label>
              <input class="form-input" type="number" data-ph-start-year value="${p.start_year ?? ""}" placeholder="2008">
            </div>
            <div>
              <label class="form-label">End Year</label>
              <input class="form-input" type="number" data-ph-end-year value="${p.end_year ?? ""}" placeholder="2012">
            </div>
            <div>
              <label class="form-label">Tagline</label>
              <input class="form-input" data-ph-tagline value="${esc(p.tagline || "")}" placeholder="e.g. Avengers Assembled">
            </div>
          </div>
        </div>
        <div class="phase-row-move">
          <button class="cast-remove" onclick="removePhase(${i})" title="Remove Phase"><i class="fa-solid fa-xmark"></i></button>
          <button class="reo-arrow-btn${i === 0 ? " disabled" : ""}" onclick="movePhase(${i}, -1)" title="Move Up" ${i === 0 ? "disabled" : ""}><i class="fa-solid fa-arrow-up"></i></button>
          <button class="reo-arrow-btn${i === phases.length - 1 ? " disabled" : ""}" onclick="movePhase(${i}, 1)" title="Move Down" ${i === phases.length - 1 ? "disabled" : ""}><i class="fa-solid fa-arrow-down"></i></button>
        </div>
      </div>`;}).join("")}
    </div>
    ${phases.length === 0 ? `<p class="settings-phases-empty">No phases defined. Click <strong>Add Phase</strong> to create one.</p>` : ""}
  </div>

  <!-- ── SAGAS EDITOR ── -->
  <div class="settings-card settings-card-full">
    <div class="settings-card-header">
      <div class="settings-card-title"><i class="fa-solid fa-infinity txt-gold"></i> Sagas</div>
      <div class="settings-card-actions">
        <button class="settings-ghost-btn" onclick="addSaga()"><i class="fa-solid fa-plus"></i> Add Saga</button>
        <button class="settings-save-btn" onclick="saveSettingsSagas()"><i class="fa-solid fa-floppy-disk"></i> Save</button>
      </div>
    </div>
    <div id="settings-sagas" class="settings-phases-list">
      ${sagas.map((s, i) => `
      <div class="settings-saga-row" data-sagaidx="${i}">
        <div class="phase-row-num">${i + 1}</div>
        <div class="phase-row-fields" style="flex:1">
          <div class="phase-field-pair">
            <div><label class="form-label">Saga ID</label><input class="form-input" data-saga-id value="${esc(s.id)}" placeholder="saga_001"></div>
            <div style="flex:2"><label class="form-label">Saga Name</label><input class="form-input" data-saga-name value="${esc(s.name)}" placeholder="The Infinity Saga"></div>
            <div><label class="form-label">Phases (comma-sep numbers)</label><input class="form-input" data-saga-phases value="${(s.phases || []).join(",")}" placeholder="1,2,3"></div>
          </div>
          <div class="phase-field-pair" style="margin-top:6px">
            <div style="flex:1"><label class="form-label">Description</label><textarea class="form-textarea" data-saga-desc style="min-height:56px">${esc(s.description || "")}</textarea></div>
          </div>
        </div>
        <button class="cast-remove" onclick="removeSaga(${i})" title="Remove Saga"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join("")}
    </div>
    ${sagas.length === 0 ? `<p class="settings-phases-empty">No sagas defined. Click <strong>Add Saga</strong> to create one.</p>` : ""}
  </div>

  <!-- ── WATCH ORDER TYPES ── -->
  <div class="settings-card settings-card-full">
    <div class="settings-card-header">
      <div class="settings-card-title"><i class="fa-solid fa-list-ol txt-blue"></i> Watch Order Types</div>
      <div class="settings-card-actions">
        <button class="settings-ghost-btn" onclick="addWatchOrderType()"><i class="fa-solid fa-plus"></i> Add</button>
        <button class="settings-save-btn" onclick="saveSettingsWatchOrderTypes()"><i class="fa-solid fa-floppy-disk"></i> Save</button>
      </div>
    </div>
    <div id="settings-watch-order-types" class="settings-phases-list">
      ${watchOrderTypes.map((w, i) => `
      <div class="settings-wot-row" data-wotidx="${i}">
        <div class="phase-row-num">${i + 1}</div>
        <div class="phase-row-fields" style="flex:1">
          <div class="phase-field-pair">
            <div><label class="form-label">ID</label><input class="form-input" data-wot-id value="${esc(w.id)}" placeholder="release_order"></div>
            <div style="flex:2"><label class="form-label">Name</label><input class="form-input" data-wot-name value="${esc(w.name)}" placeholder="Release Order"></div>
          </div>
          <div style="margin-top:6px"><label class="form-label">Description</label><textarea class="form-textarea" data-wot-desc style="min-height:56px">${esc(w.description || "")}</textarea></div>
        </div>
        <button class="cast-remove" onclick="removeWatchOrderType(${i})"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join("")}
    </div>
    ${watchOrderTypes.length === 0 ? `<p class="settings-phases-empty">No watch order types defined.</p>` : ""}
  </div>

  <!-- ── CONTENT TYPES ── -->
  <div class="settings-card settings-card-full">
    <div class="settings-card-header">
      <div class="settings-card-title"><i class="fa-solid fa-tag txt-red"></i> Content Types</div>
      <div class="settings-card-actions">
        <button class="settings-ghost-btn" onclick="addContentType()"><i class="fa-solid fa-plus"></i> Add</button>
        <button class="settings-save-btn" onclick="saveSettingsContentTypes()"><i class="fa-solid fa-floppy-disk"></i> Save</button>
      </div>
    </div>
    <div id="settings-content-types" class="settings-content-types-list" style="display:flex;flex-wrap:wrap;gap:8px;padding:16px 20px">
      ${contentTypes.map((ct, i) => `
      <div class="settings-ct-row" style="display:flex;align-items:center;gap:6px">
        <input class="form-input" data-ct-value value="${esc(ct)}" placeholder="e.g. movie" style="width:160px">
        <button class="cast-remove" onclick="this.parentNode.remove()" title="Remove"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join("")}
    </div>
  </div>

  <!-- ── STREAMING PLATFORMS ── -->
  <div class="settings-card settings-card-full">
    <div class="settings-card-header">
      <div class="settings-card-title"><i class="fa-solid fa-tv txt-gold"></i> Streaming Platforms</div>
      <div class="settings-card-actions">
        <button class="settings-ghost-btn" onclick="addPlatform()"><i class="fa-solid fa-plus"></i> Add</button>
        <button class="settings-save-btn" onclick="saveSettingsPlatforms()"><i class="fa-solid fa-floppy-disk"></i> Save</button>
      </div>
    </div>
    <div id="settings-platforms" class="settings-platforms-list">
      ${platforms.map((p, i) => `
      <div class="settings-platform-row" data-pidx="${i}">
        <div class="platform-row-logo">
          ${p.logo ? `<img src="${esc(p.logo)}" alt="${esc(p.name)}" onerror="this.style.display='none'">` : `<i class="fa-solid fa-tv"></i>`}
        </div>
        <div class="platform-row-fields">
          <div class="platform-field-pair">
            <div><label class="form-label">ID</label><input class="form-input" data-p-id value="${esc(p.id)}"></div>
            <div><label class="form-label">Name</label><input class="form-input" data-p-name value="${esc(p.name)}"></div>
          </div>
          <div class="platform-field-pair">
            <div><label class="form-label">Site URL</label><input class="form-input" data-p-url value="${esc(p.url || "")}"></div>
            <div><label class="form-label">Logo Path</label><input class="form-input" data-p-logo value="${esc(p.logo || "")}"></div>
          </div>
        </div>
        <button class="cast-remove" onclick="removePlatform(${i})" title="Remove"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join("")}
    </div>
  </div>

  <!-- ── HEALTH CHECK ── -->
  <div class="settings-card settings-card-full" id="health-check-card">
    <div class="settings-card-header">
      <div class="settings-card-title"><i class="fa-solid fa-heart-pulse txt-red"></i> Image Health Check</div>
      <button class="settings-save-btn" id="health-run-btn" onclick="runHealthCheck()">
        <i class="fa-solid fa-magnifying-glass"></i> Run Check
      </button>
    </div>
    <div id="health-check-body" class="health-check-idle">
      <i class="fa-solid fa-heart-pulse"></i>
      <span>Click <strong>Run Check</strong> to scan all image directories for missing or orphaned files.</span>
    </div>
  </div>

  <!-- ── CAST HEALTH CHECK ── -->
  <div class="settings-card settings-card-full" id="cast-health-card">
    <div class="settings-card-header">
      <div class="settings-card-title"><i class="fa-solid fa-users-slash txt-gold"></i> Cast Integrity Check</div>
      <button class="settings-save-btn" id="cast-health-run-btn" onclick="runCastHealthCheck()">
        <i class="fa-solid fa-magnifying-glass"></i> Run Check
      </button>
    </div>
    <div id="cast-health-body" class="health-check-idle">
      <i class="fa-solid fa-users-slash"></i>
      <span>Click <strong>Run Check</strong> to find stars whose <code>mcu_appearances</code> list a title they are not actually cast in.</span>
    </div>
  </div>

  <!-- ── REVERSE CAST INTEGRITY CHECK ── -->
  <div class="settings-card settings-card-full" id="reverse-cast-health-card">
    <div class="settings-card-header">
      <div class="settings-card-title"><i class="fa-solid fa-user-plus txt-blue"></i> Reverse Cast Integrity Check</div>
      <button class="settings-save-btn" id="reverse-cast-health-run-btn" onclick="runReverseCastHealthCheck()">
        <i class="fa-solid fa-magnifying-glass"></i> Run Check
      </button>
    </div>
    <div id="reverse-cast-health-body" class="health-check-idle">
      <i class="fa-solid fa-user-plus"></i>
      <span>Click <strong>Run Check</strong> to find stars who are in a title's cast but that title is missing from their <code>mcu_appearances</code>.</span>
    </div>
  </div>

  <!-- ── IMAGE ARCHIVE ── -->
  <div class="settings-card settings-card-full settings-archive-card">
    <div class="settings-card-header">
      <div class="settings-card-title"><i class="fa-solid fa-images txt-green"></i> Image Archive</div>
      <div class="settings-card-actions">
        <button class="settings-ghost-btn" onclick="rebuildArchive()"><i class="fa-solid fa-rotate"></i> Rebuild</button>
        <button class="settings-save-btn" onclick="openArchiveViewer()"><i class="fa-solid fa-up-right-from-square"></i> Viewer</button>
      </div>
    </div>
    <p class="settings-archive-desc">
      <code>assets/image-archive.md</code> — Auto-generated reference of every image in the database.
      Rebuilt automatically whenever titles, stars, or platforms are saved. Use <strong>Open Viewer</strong> to browse the rendered table or edit the raw Markdown source directly.
    </p>
    <div class="settings-archive-actions">
      <button class="settings-archive-big-btn" onclick="openArchiveViewer()">
        <i class="fa-solid fa-book-open"></i>
        <span>View &amp; Edit Image Archive</span>
        <i class="fa-solid fa-chevron-right"></i>
      </button>
    </div>
  </div>`;

  const cards = [...grid.children];
  if (isMcuTab) {
    cards.forEach((card, idx) => {
      if (idx > 5) card.remove();
    });
  } else {
    cards.forEach((card, idx) => {
      if (idx < 6) card.remove();
    });
  }

  // Attach dirty-tracking listeners to all inputs/selects/textareas in the grid
  const tabKey = isMcuTab ? "mcu" : "settings";
  grid.querySelectorAll("input, select, textarea").forEach(el => {
    el.addEventListener("input", () => {
      const section = el.closest(".settings-card")?.querySelector(".settings-card-title")?.textContent?.trim() || "Unknown";
      const label = el.closest(".form-field")?.querySelector(".form-label")?.textContent?.trim() || el.id || "field";
      _dirty.mark(tabKey, section, `${section} › ${label}`);
      // Snapshot the current grid HTML for preservation on tab switch
      if (isMcuTab) _dirty._mcuGridHTML = grid.innerHTML;
      else _dirty._settingsGridHTML = grid.innerHTML;
    });
    el.addEventListener("change", () => {
      const section = el.closest(".settings-card")?.querySelector(".settings-card-title")?.textContent?.trim() || "Unknown";
      const label = el.closest(".form-field")?.querySelector(".form-label")?.textContent?.trim() || el.id || "field";
      _dirty.mark(tabKey, section, `${section} › ${label}`);
      if (isMcuTab) _dirty._mcuGridHTML = grid.innerHTML;
      else _dirty._settingsGridHTML = grid.innerHTML;
    });
  });
}

// ────────────────────────────────────────────────────────────
// IMAGE ARCHIVE VIEWER
// ────────────────────────────────────────────────────────────
let _archiveContent = "";

async function openArchiveViewer() {
  pushState({ settings: true, imarc: true });
  openModal(`
  <div class="archive-viewer">
    <div class="archive-viewer-header">
      <div class="modal-form-title"><i class="fa-solid fa-images txt-green"></i> Image Archive</div>
      <div class="archive-viewer-tabs">
        <button class="archive-tab-btn active" id="arc-tab-preview" onclick="switchArchiveTab('preview')"><i class="fa-solid fa-eye"></i><span class="arc-btn-label"> Preview</span></button>
        <button class="archive-tab-btn" id="arc-tab-source" onclick="switchArchiveTab('source')"><i class="fa-solid fa-code"></i><span class="arc-btn-label"> Source</span></button>
      </div>
      <div class="archive-viewer-btns">
        <button class="btn-ghost-sm" onclick="rebuildArchiveInViewer()"><i class="fa-solid fa-rotate"></i> Rebuild</button>
        <button class="btn-primary-sm" onclick="saveArchive()"><i class="fa-solid fa-floppy-disk"></i> Save</button>
      </div>
    </div>
    <div class="archive-viewer-body">
      <div class="archive-panel" id="arc-panel-preview">
        <div class="archive-preview-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading…</div>
      </div>
      <div class="archive-panel hidden" id="arc-panel-source">
        <textarea class="archive-source-editor" id="arc-source-textarea" spellcheck="false" placeholder="Loading…"></textarea>
      </div>
    </div>
  </div>`);

  document.querySelector(".modal-box").classList.add("modal-content-wide");

  try {
    const res = await api("load_archive");
    _archiveContent = res.content || "";
    document.getElementById("arc-source-textarea").value = _archiveContent;
    document.getElementById("arc-panel-preview").innerHTML =
      `<div class="archive-md-render">${markdownToHtml(_archiveContent)}</div>`;
  } catch (e) {
    document.getElementById("arc-panel-preview").innerHTML =
      `<div class="archive-preview-loading txt-red"><i class="fa-solid fa-circle-xmark"></i> Failed to load archive: ${esc(e.message)}</div>`;
  }
}

function switchArchiveTab(tab) {
  const isPreview = tab === "preview";
  document.getElementById("arc-tab-preview").classList.toggle("active", isPreview);
  document.getElementById("arc-tab-source").classList.toggle("active", !isPreview);
  document.getElementById("arc-panel-preview").classList.toggle("hidden", !isPreview);
  document.getElementById("arc-panel-source").classList.toggle("hidden", isPreview);
}

async function saveArchive() {
  const content = document.getElementById("arc-source-textarea")?.value;
  if (content === undefined) { toast("Editor not open", "warning"); return; }
  try {
    await api("save_archive", { content });
    _SSE.notifyOwnSave();
    _archiveContent = content;
    document.getElementById("arc-panel-preview").innerHTML =
      `<div class="archive-md-render">${markdownToHtml(content)}</div>`;
    toast("Archive saved", "success");
  } catch (e) {
    toast("Save failed: " + e.message, "error");
  }
}

async function rebuildArchive() {
  setSaveStatus("saving", "Rebuilding archive…");
  try {
    const res = await api("rebuild_archive", {});
    _SSE.notifyOwnSave();
    _archiveContent = res.content || "";
    setSaveStatus("", "All saved");
    toast("Image archive rebuilt successfully", "success");
    if (document.getElementById("arc-source-textarea")) {
      document.getElementById("arc-source-textarea").value = _archiveContent;
      document.getElementById("arc-panel-preview").innerHTML =
        `<div class="archive-md-render">${markdownToHtml(_archiveContent)}</div>`;
    }
  } catch (e) {
    setSaveStatus("error", "Rebuild failed");
    toast("Rebuild error: " + e.message, "error");
  }
}

async function rebuildArchiveInViewer() {
  const previewEl = document.getElementById("arc-panel-preview");
  if (previewEl) previewEl.innerHTML = `<div class="archive-preview-loading"><i class="fa-solid fa-circle-notch fa-spin"></i> Rebuilding…</div>`;
  await rebuildArchive();
}

// ─── Lightweight Markdown → HTML renderer ────────────────────
function markdownToHtml(md) {
  if (!md) return "<em>Empty</em>";
  let html = md;

  // Escape HTML in code blocks first (preserve them)
  const codeBlocks = [];
  html = html.replace(/```[\s\S]*?```/g, (match) => {
    const inner = match.slice(3, -3).replace(/^[a-z]*\n/, "");
    const escaped = inner.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    codeBlocks.push(`<pre class="arc-code-block"><code>${escaped}</code></pre>`);
    return `\x00CODE${codeBlocks.length - 1}\x00`;
  });

  // Blockquotes — merge consecutive > lines into a single <blockquote>
  html = html.replace(/(^> .+$\n?)+/gm, (block) => {
    const lines = block.trim().split("\n").map(l => l.replace(/^> /, ""));
    return `<blockquote class="arc-bq">${lines.join("<br>")}</blockquote>`;
  });

  // Headers
  html = html.replace(/^### (.+)$/gm, "<h3 class=\"arc-h3\">$1</h3>");
  html = html.replace(/^## (.+)$/gm,  "<h2 class=\"arc-h2\">$1</h2>");
  html = html.replace(/^# (.+)$/gm,   "<h1 class=\"arc-h1\">$1</h1>");

  // Horizontal rule
  html = html.replace(/^---$/gm, "<hr class=\"arc-hr\">");

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  // Inline code
  html = html.replace(/`([^`]+)`/g, "<code class=\"arc-inline-code\">$1</code>");

  // Tables
  html = html.replace(/((?:^\|.+\|\n)+)/gm, (block) => {
    const lines = block.trim().split("\n").filter(Boolean);
    if (lines.length < 2) return block;
    const header = lines[0];
    const body   = lines.slice(2);
    const cells  = (row) => row.split("|").slice(1,-1).map(c => c.trim());
    const hCells = cells(header).map(c => `<th>${c}</th>`).join("");
    const bRows  = body.map(r => `<tr>${cells(r).map(c => `<td>${c}</td>`).join("")}</tr>`).join("");
    return `<div class="arc-table-wrap"><table class="arc-table"><thead><tr>${hCells}</tr></thead><tbody>${bRows}</tbody></table></div>`;
  });

  // Paragraphs (blank-line separated non-tagged content)
  html = html.replace(/\n{2,}/g, "</p><p>");
  html = `<p>${html}</p>`;
  html = html.replace(/<p>(<(?:h[1-3]|hr|pre|div|blockquote)[^>]*>)/g, "$1");
  html = html.replace(/(<\/(?:h[1-3]|hr|pre|div|blockquote)>)<\/p>/g, "$1");
  html = html.replace(/<p>\s*<\/p>/g, "");

  // Line breaks within paragraphs
  html = html.replace(/\n/g, "<br>");

  // Restore code blocks
  codeBlocks.forEach((block, i) => {
    html = html.replace(`\x00CODE${i}\x00`, block);
  });

  return html;
}

// ────────────────────────────────────────────────────────────
// IMAGE HEALTH CHECK
// ────────────────────────────────────────────────────────────
async function runHealthCheck() {
  const body = document.getElementById("health-check-body");
  const btn  = document.getElementById("health-run-btn");
  if (!body) return;

  body.className = "health-check-loading";
  body.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><span>Scanning image directories…</span>`;
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Scanning…`; }

  try {
    const res = await api("health_check");
    const { issues, stats, summary } = res;

    const allGood = issues.length === 0;

    const summaryHtml = `
    <div class="health-summary">
      <div class="health-summary-item ok">
        <div class="health-summary-top">
          <i class="fa-solid fa-circle-check"></i>
          <span class="health-summary-num">${summary.ok}</span>
        </div>
        <span class="health-summary-label">Images OK</span>
      </div>
      <div class="health-summary-item ${summary.missing > 0 ? 'err' : 'ok'}">
        <div class="health-summary-top">
          <i class="fa-solid fa-image-slash"></i>
          <span class="health-summary-num">${summary.missing}</span>
        </div>
        <span class="health-summary-label">Missing</span>
      </div>
      <div class="health-summary-item ${summary.orphan > 0 ? 'warn' : 'ok'}">
        <div class="health-summary-top">
          <i class="fa-solid fa-file-circle-question"></i>
          <span class="health-summary-num">${summary.orphan}</span>
        </div>
        <span class="health-summary-label">Orphaned</span>
      </div>
      <div class="health-summary-breakdown">
        <span><i class="fa-solid fa-film"></i> MCU: ${stats.mcu_ok} ok, ${stats.mcu_missing} missing, ${stats.mcu_orphan} orphaned</span>
        <span><i class="fa-solid fa-star"></i> Stars: ${stats.star_ok} ok, ${stats.star_missing} missing, ${stats.star_orphan} orphaned</span>
      </div>
    </div>`;

    if (allGood) {
      body.className = "health-check-results";
      body.innerHTML = summaryHtml + `
      <div class="health-all-good">
        <i class="fa-solid fa-circle-check"></i>
        <div class="health-all-good-text">
          <strong>All Images OK</strong>
          <span>Every entry has a matching image file and no orphaned files were found.</span>
        </div>
      </div>`;
    } else {
      const rows = issues.map(issue => {
        const isMissing = issue.type === "missing";
        const icon = isMissing
          ? `<i class="fa-solid fa-image-slash health-issue-icon missing"></i>`
          : `<i class="fa-solid fa-file-circle-question health-issue-icon orphan"></i>`;
        const badge = issue.dataset === "mcu"
          ? `<span class="health-ds-badge mcu"><i class="fa-solid fa-film"></i> MCU</span>`
          : `<span class="health-ds-badge star"><i class="fa-solid fa-star"></i> Star</span>`;
        const label = isMissing
          ? `No image file found for <strong>${esc(issue.name)}</strong>`
          : `File <code>${esc(issue.name)}</code> has no matching database entry`;
        return `
        <div class="health-issue-row ${isMissing ? 'missing' : 'orphan'}">
          ${icon}
          <div class="health-issue-info">
            <span class="health-issue-text">${label}</span>
            <span class="health-issue-id">${esc(issue.id)}</span>
          </div>
          ${badge}
        </div>`;
      }).join("");

      body.className = "health-check-results";
      body.innerHTML = summaryHtml + `
      <div class="health-issues-list">${rows}</div>`;
    }
  } catch (e) {
    body.className = "health-check-idle";
    body.innerHTML = `<i class="fa-solid fa-circle-xmark txt-red"></i><span>Health check failed: ${esc(e.message)}</span>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Run Check`; }
  }
}

// ────────────────────────────────────────────────────────────
// CAST INTEGRITY HEALTH CHECK
// ────────────────────────────────────────────────────────────
async function runCastHealthCheck() {
  const body = document.getElementById("cast-health-body");
  const btn  = document.getElementById("cast-health-run-btn");
  if (!body) return;

  body.className = "health-check-loading";
  body.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><span>Comparing cast lists with appearance records…</span>`;
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Scanning…`; }

  try {
    const res = await api("cast_health_check");
    const { issues } = res;
    const allGood = issues.length === 0;

    const summaryHtml = `
    <div class="health-summary">
      <div class="health-summary-item ${allGood ? 'ok' : 'err'}">
        <div class="health-summary-top">
          <i class="fa-solid fa-${allGood ? 'circle-check' : 'triangle-exclamation'}"></i>
          <span class="health-summary-num">${issues.length}</span>
        </div>
        <span class="health-summary-label">Phantom Appearances</span>
      </div>
      <div class="health-summary-breakdown">
        <span><i class="fa-solid fa-users"></i> Stars with mismatched appearances: ${new Set(issues.map(i => i.star_id)).size}</span>
        <span><i class="fa-solid fa-film"></i> Titles referenced but not in cast: ${new Set(issues.map(i => i.title_id)).size}</span>
      </div>
    </div>`;

    if (allGood) {
      body.className = "health-check-results";
      body.innerHTML = summaryHtml + `
      <div class="health-all-good">
        <i class="fa-solid fa-circle-check"></i>
        <div class="health-all-good-text">
          <strong>Cast Integrity OK</strong>
          <span>All <code>mcu_appearances</code> entries match their respective title cast lists.</span>
        </div>
      </div>`;
    } else {
      const rows = issues.map((issue, idx) => {
        const isTitleNotFound = issue.reason === 'title_not_found';
        const reasonLabel = isTitleNotFound
          ? `Title <code>${esc(issue.title_id)}</code> does not exist in MCU database`
          : `<strong>${esc(issue.star_name)}</strong> is in appearances for <strong>${esc(issue.title_name)}</strong> but is not in its cast`;
        const btns = isTitleNotFound
          ? `<button class="cast-health-fix-btn" id="cast-fix-btn-rem-${idx}"
               onclick="fixCastRemoveAppearance('${esc(issue.star_id)}','${esc(issue.title_id)}',${idx})">
               <i class="fa-solid fa-scissors"></i> Remove
             </button>`
          : `<button class="cast-health-fix-btn" id="cast-fix-btn-rem-${idx}"
               onclick="fixCastRemoveAppearance('${esc(issue.star_id)}','${esc(issue.title_id)}',${idx})">
               <i class="fa-solid fa-scissors"></i> Remove
             </button>
             <button class="cast-health-fix-btn cast-fix-alt" id="cast-fix-btn-add-${idx}"
               onclick="fixCastAddToCast('${esc(issue.star_id)}','${esc(issue.title_id)}',${idx})">
               <i class="fa-solid fa-user-plus"></i> Add to Cast
             </button>`;
        return `
        <div class="health-issue-row missing" id="cast-issue-row-${idx}">
          <i class="fa-solid fa-user-slash health-issue-icon missing"></i>
          <div class="health-issue-info">
            <span class="health-issue-text">${reasonLabel}</span>
            <span class="health-issue-id">${esc(issue.star_id)} → ${esc(issue.title_id)}</span>
          </div>
          <span class="health-ds-badge star"><i class="fa-solid fa-star"></i> Star</span>
          <div class="cast-fix-btn-group">${btns}</div>
        </div>`;
      }).join("");

      body.className = "health-check-results";
      body.innerHTML = summaryHtml + `
      <div class="health-issues-list cast-health-issues">${rows}</div>`;
    }
  } catch (e) {
    body.className = "health-check-idle";
    body.innerHTML = `<i class="fa-solid fa-circle-xmark txt-red"></i><span>Cast health check failed: ${esc(e.message)}</span>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Run Check`; }
  }
}

// Shared helper: mark a cast-issue-row as resolved
function _markCastRowFixed(rowIdx, label) {
  const row = document.getElementById(`cast-issue-row-${rowIdx}`);
  if (!row) return;
  row.style.opacity = "0.4";
  row.style.pointerEvents = "none";
  const txt = row.querySelector(".health-issue-text");
  if (txt) txt.innerHTML = `<s>${txt.innerHTML}</s> <span class="txt-green" style="font-size:11px"><i class="fa-solid fa-circle-check"></i> ${label}</span>`;
  row.querySelectorAll(".cast-health-fix-btn").forEach(b => { b.disabled = true; b.innerHTML = `<i class="fa-solid fa-circle-check"></i>`; });
}

// Option A: remove the phantom title from the star's mcu_appearances
async function fixCastRemoveAppearance(starId, titleId, rowIdx) {
  const btn = document.getElementById(`cast-fix-btn-rem-${rowIdx}`);
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`; }
  try {
    await api("fix_cast_appearance", { star_id: starId, title_id: titleId });
    _SSE.notifyOwnSave();
    _markCastRowFixed(rowIdx, "Removed from appearances");
    toast(`Removed ${titleId} from ${starId}'s appearances`, "success");
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-scissors"></i> Remove`; }
    toast("Fix failed: " + e.message, "error");
  }
}

// Option B: add the star to the title's cast list
async function fixCastAddToCast(starId, titleId, rowIdx) {
  const btn = document.getElementById(`cast-fix-btn-add-${rowIdx}`);
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`; }
  try {
    await api("fix_cast_add_to_cast", { star_id: starId, title_id: titleId });
    _SSE.notifyOwnSave();
    _markCastRowFixed(rowIdx, "Added to cast");
    toast(`Added ${starId} to cast of ${titleId}`, "success");
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-user-plus"></i> Add to Cast`; }
    toast("Fix failed: " + e.message, "error");
  }
}


// ────────────────────────────────────────────────────────────
// REVERSE CAST INTEGRITY CHECK
// Finds stars in a title's cast whose mcu_appearances is missing that title.
// Fix = add the title to their mcu_appearances.
// ────────────────────────────────────────────────────────────
async function runReverseCastHealthCheck() {
  const body = document.getElementById("reverse-cast-health-body");
  const btn  = document.getElementById("reverse-cast-health-run-btn");
  if (!body) return;

  body.className = "health-check-loading";
  body.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i><span>Scanning cast lists for missing appearance entries…</span>`;
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Scanning…`; }

  try {
    const res = await api("reverse_cast_health_check");
    const { issues } = res;
    const allGood = issues.length === 0;

    const summaryHtml = `
    <div class="health-summary">
      <div class="health-summary-item ${allGood ? 'ok' : 'err'}">
        <div class="health-summary-top">
          <i class="fa-solid fa-${allGood ? 'circle-check' : 'triangle-exclamation'}"></i>
          <span class="health-summary-num">${issues.length}</span>
        </div>
        <span class="health-summary-label">Missing Appearances</span>
      </div>
      <div class="health-summary-breakdown">
        <span><i class="fa-solid fa-users"></i> Stars with missing appearances: ${new Set(issues.map(i => i.star_id)).size}</span>
        <span><i class="fa-solid fa-film"></i> Titles whose cast members are affected: ${new Set(issues.map(i => i.title_id)).size}</span>
      </div>
    </div>`;

    if (allGood) {
      body.className = "health-check-results";
      body.innerHTML = summaryHtml + `
      <div class="health-all-good">
        <i class="fa-solid fa-circle-check"></i>
        <div class="health-all-good-text">
          <strong>Reverse Cast Integrity OK</strong>
          <span>Every star in a title's cast has that title in their <code>mcu_appearances</code>.</span>
        </div>
      </div>`;
    } else {
      const rows = issues.map((issue, idx) => {
        const reasonLabel = `<strong>${esc(issue.star_name)}</strong> is in the cast of <strong>${esc(issue.title_name)}</strong> but <code>${esc(issue.title_id)}</code> is missing from their appearances`;
        const btns = `<button class="cast-health-fix-btn cast-fix-alt" id="rcast-fix-btn-add-${idx}"
               onclick="fixReverseAddAppearance('${esc(issue.star_id)}','${esc(issue.title_id)}',${idx})">
               <i class="fa-solid fa-plus"></i> Add to Appearances
             </button>
             <button class="cast-health-fix-btn cast-fix-danger" id="rcast-fix-btn-rem-${idx}"
               onclick="fixReverseRemoveFromCast('${esc(issue.star_id)}','${esc(issue.title_id)}',${idx})">
               <i class="fa-solid fa-scissors"></i> Remove from Cast
             </button>`;
        return `
        <div class="health-issue-row orphan" id="rcast-issue-row-${idx}">
          <i class="fa-solid fa-user-plus health-issue-icon orphan"></i>
          <div class="health-issue-info">
            <span class="health-issue-text">${reasonLabel}</span>
            <span class="health-issue-id">${esc(issue.title_id)} → ${esc(issue.star_id)}</span>
          </div>
          <span class="health-ds-badge mcu"><i class="fa-solid fa-film"></i> MCU</span>
          <div class="cast-fix-btn-group">${btns}</div>
        </div>`;
      }).join("");

      body.className = "health-check-results";
      body.innerHTML = summaryHtml + `
      <div class="health-issues-list cast-health-issues">${rows}</div>`;
    }
  } catch (e) {
    body.className = "health-check-idle";
    body.innerHTML = `<i class="fa-solid fa-circle-xmark txt-red"></i><span>Reverse cast health check failed: ${esc(e.message)}</span>`;
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i> Run Check`; }
  }
}

// Shared helper: mark a rcast-issue-row as resolved
function _markRCastRowFixed(rowIdx, label) {
  const row = document.getElementById(`rcast-issue-row-${rowIdx}`);
  if (!row) return;
  row.style.opacity = "0.4";
  row.style.pointerEvents = "none";
  const txt = row.querySelector(".health-issue-text");
  if (txt) txt.innerHTML = `<s>${txt.innerHTML}</s> <span class="txt-green" style="font-size:11px"><i class="fa-solid fa-circle-check"></i> ${label}</span>`;
  row.querySelectorAll(".cast-health-fix-btn").forEach(b => { b.disabled = true; b.innerHTML = `<i class="fa-solid fa-circle-check"></i>`; });
}

// Option A: add the title to the star's mcu_appearances
async function fixReverseAddAppearance(starId, titleId, rowIdx) {
  const btn = document.getElementById(`rcast-fix-btn-add-${rowIdx}`);
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`; }
  try {
    await api("fix_reverse_cast_appearance", { star_id: starId, title_id: titleId });
    _SSE.notifyOwnSave();
    _markRCastRowFixed(rowIdx, "Added to appearances");
    toast(`Added ${titleId} to ${starId}'s appearances`, "success");
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-plus"></i> Add to Appearances`; }
    toast("Fix failed: " + e.message, "error");
  }
}

// Option B: remove the star from the title's cast
async function fixReverseRemoveFromCast(starId, titleId, rowIdx) {
  const btn = document.getElementById(`rcast-fix-btn-rem-${rowIdx}`);
  if (btn) { btn.disabled = true; btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i>`; }
  try {
    await api("fix_reverse_cast_remove_from_cast", { star_id: starId, title_id: titleId });
    _SSE.notifyOwnSave();
    _markRCastRowFixed(rowIdx, "Removed from cast");
    toast(`Removed ${starId} from cast of ${titleId}`, "success");
  } catch (e) {
    if (btn) { btn.disabled = false; btn.innerHTML = `<i class="fa-solid fa-scissors"></i> Remove from Cast`; }
    toast("Fix failed: " + e.message, "error");
  }
}



function markDuplicateInputs(inputs) {
  inputs.forEach(inp => {
    inp.style.borderColor = "";
    inp.style.boxShadow = "";
  });
  const vals = inputs.map(inp => inp.value.trim().toLowerCase());
  const counts = {};
  vals.forEach(v => { if (v) counts[v] = (counts[v] || 0) + 1; });
  const hasDups = vals.some(v => v && counts[v] > 1);
  if (hasDups) {
    inputs.forEach((inp, i) => {
      const v = vals[i];
      if (v && counts[v] > 1) {
        inp.style.borderColor = "var(--red)";
        inp.style.boxShadow = "0 0 0 2px rgba(220,53,69,0.22)";
      }
    });
  }
  return hasDups;
}

async function saveSettingsMeta() {
  const updated = {
    ...DATA,
    meta: {
      ...DATA.meta,
      title: document.getElementById("s-meta-title").value,
      description: document.getElementById("s-meta-desc").value,
      maintainer: document.getElementById("s-meta-maintainer").value,
      version: document.getElementById("s-meta-version").value,
      last_updated: document.getElementById("s-meta-last-updated").value || DATA.meta.last_updated,
      total_phases: parseInt(document.getElementById("s-meta-total-phases").value) || DATA.meta.total_phases,
      base_image_path: document.getElementById("s-meta-base-image-path").value,
      mcu_image_path: document.getElementById("s-meta-mcu-image-path").value,
      star_image_path: document.getElementById("s-meta-star-image-path").value,
    },
  };
  setSaveStatus("saving", "Saving…");
  try {
    await api("save_data", { meta: updated.meta });
    _SSE.notifyOwnSave();
    await loadAll();
    _dirty.clearTab("mcu");
    _dirty.clearTab("settings");
    setSaveStatus("", "All saved");
    toast("Meta saved", "success");
  } catch (e) {
    setSaveStatus("error", "Save failed");
    toast("Error: " + e.message, "error");
  }
}

async function saveSettingsAbout() {
  // Validate: no duplicate phase IDs
  const phaseIdInputs = [...document.querySelectorAll(".settings-phase-row [data-ph-id]")];
  if (markDuplicateInputs(phaseIdInputs)) {
    toast("Two or more phases share the same ID — fix the highlighted duplicates before saving", "error");
    return;
  }

  const phaseRows = document.querySelectorAll(".settings-phase-row");
  const phases = [...phaseRows].map(row => {
    const num = parseInt(row.querySelector("[data-ph-number]")?.value) || undefined;
    const startY = parseInt(row.querySelector("[data-ph-start-year]")?.value) || undefined;
    const endY   = parseInt(row.querySelector("[data-ph-end-year]")?.value) || undefined;
    return {
      id:         row.querySelector("[data-ph-id]").value.trim(),
      number:     num,
      name:       row.querySelector("[data-ph-name]").value.trim(),
      saga:       row.querySelector("[data-ph-saga]")?.value || undefined,
      start_year: startY,
      end_year:   endY,
      tagline:    row.querySelector("[data-ph-tagline]")?.value.trim() || undefined,
    };
  }).filter(p => p.id && p.name);

  const updated = {
    ...DATA.about,
    universe: document.getElementById("s-universe")?.value || DATA.about.universe,
    studio: document.getElementById("s-studio").value,
    parent_company: document.getElementById("s-parent").value,
    founded: parseInt(document.getElementById("s-founded").value) || DATA.about.founded,
    first_release: document.getElementById("s-first-release").value,
    official_site: document.getElementById("s-official-site").value,
    wikipedia: document.getElementById("s-wikipedia").value,
    imdb: document.getElementById("s-imdb").value,
    description_long: document.getElementById("s-desc-long")?.value || DATA.about.description_long,
    phases,
  };
  setSaveStatus("saving", "Saving…");
  try {
    await api("save_data", { about: updated });
    _SSE.notifyOwnSave();
    await loadAll();
    _dirty.clearTab("mcu");
    _dirty.clearTab("settings");
    setSaveStatus("", "All saved");
    toast("Universe info & phases saved", "success");
  } catch (e) {
    setSaveStatus("error", "Save failed");
    toast("Error: " + e.message, "error");
  }
}

function addPhase() {
  const container = document.getElementById("settings-phases");
  if (!container) return;
  const emptyMsg = container.parentNode.querySelector(".settings-phases-empty");
  if (emptyMsg) emptyMsg.remove();
  const i = container.children.length;
  const div = document.createElement("div");
  div.className = "settings-phase-row";
  div.dataset.phidx = i;
  div.innerHTML = `
    <div class="phase-row-num">${i + 1}</div>
    <div class="phase-row-fields" style="flex:1">
      <div class="phase-field-pair">
        <div><label class="form-label">Phase ID</label><input class="form-input" data-ph-id value="phase_${i + 1}" placeholder="e.g. phase_1"></div>
        <div><label class="form-label">Phase Name</label><input class="form-input" data-ph-name value="" placeholder="e.g. Phase One"></div>
        <div><label class="form-label">Number</label><input class="form-input" type="number" data-ph-number value="${i + 1}" placeholder="1" style="width:80px"></div>
        <div><label class="form-label">Saga</label><select class="form-select" data-ph-saga><option value="">— None —</option>${(DATA?.about?.sagas || []).map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("")}</select></div>
      </div>
      <div class="phase-field-pair" style="margin-top:6px">
        <div><label class="form-label">Start Year</label><input class="form-input" type="number" data-ph-start-year value="" placeholder="2008"></div>
        <div><label class="form-label">End Year</label><input class="form-input" type="number" data-ph-end-year value="" placeholder="2012"></div>
        <div style="flex:2"><label class="form-label">Tagline</label><input class="form-input" data-ph-tagline value="" placeholder="e.g. Avengers Assembled"></div>
      </div>
    </div>
    <div class="phase-row-move">
      <button class="cast-remove" onclick="removePhase(this)" title="Remove Phase"><i class="fa-solid fa-xmark"></i></button>
      <button class="reo-arrow-btn disabled" disabled title="Move Up"><i class="fa-solid fa-arrow-up"></i></button>
      <button class="reo-arrow-btn disabled" disabled title="Move Down"><i class="fa-solid fa-arrow-down"></i></button>
    </div>`;
  container.appendChild(div);
  refreshPhaseRowNumbers();
}

function removePhase(btnOrIdx) {
  const container = document.getElementById("settings-phases");
  if (!container) return;
  let row;
  if (typeof btnOrIdx === "number") {
    row = container.querySelectorAll(".settings-phase-row")[btnOrIdx];
  } else {
    row = btnOrIdx?.closest?.(".settings-phase-row");
  }
  if (!row) return;
  const label = row.querySelector("[data-ph-name]")?.value.trim() || "this phase";
  showConfirm(
    `Remove <strong>${esc(label)}</strong>?<br><small>Click Save after to make this permanent.</small>`,
    () => { row.remove(); refreshPhaseRowNumbers(); }
  );
}

function movePhase(idx, dir) {
  const container = document.getElementById("settings-phases");
  if (!container) return;
  const rows = [...container.querySelectorAll(".settings-phase-row")];
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= rows.length) return;
  if (dir === -1) {
    container.insertBefore(rows[idx], rows[newIdx]);
  } else {
    container.insertBefore(rows[newIdx], rows[idx]);
  }
  refreshPhaseRowNumbers();
}

function refreshPhaseRowNumbers() {
  const container = document.getElementById("settings-phases");
  if (!container) return;
  const rows = [...container.querySelectorAll(".settings-phase-row")];
  rows.forEach((row, i) => {
    row.dataset.phidx = i;
    const numEl = row.querySelector(".phase-row-num");
    if (numEl) numEl.textContent = i + 1;
    const btns = row.querySelectorAll(".phase-row-move .reo-arrow-btn");
    if (btns[0]) {
      btns[0].disabled = i === 0;
      btns[0].classList.toggle("disabled", i === 0);
      btns[0].setAttribute("onclick", `movePhase(${i}, -1)`);
    }
    if (btns[1]) {
      btns[1].disabled = i === rows.length - 1;
      btns[1].classList.toggle("disabled", i === rows.length - 1);
      btns[1].setAttribute("onclick", `movePhase(${i}, 1)`);
    }
    const removeBtn = row.querySelector(".cast-remove");
    if (removeBtn) removeBtn.setAttribute("onclick", `removePhase(${i})`);
  });
}

function addPlatform() {
  const container = document.getElementById("settings-platforms");
  const i = container.children.length;
  const div = document.createElement("div");
  div.className = "settings-platform-row";
  div.dataset.pidx = i;
  div.innerHTML = `
    <div class="form-grid" style="flex:1">
      <div class="form-field"><label class="form-label">ID</label><input class="form-input" data-p-id value="platform_${i + 1}"></div>
      <div class="form-field"><label class="form-label">Name</label><input class="form-input" data-p-name value=""></div>
      <div class="form-field"><label class="form-label">URL</label><input class="form-input" data-p-url value=""></div>
      <div class="form-field"><label class="form-label">Logo Path</label><input class="form-input" data-p-logo value=""></div>
    </div>
    <button class="cast-remove" onclick="this.parentNode.remove()"><i class="fa-solid fa-xmark"></i></button>`;
  container.appendChild(div);
}

function removePlatform(i) {
  const rows = document.querySelectorAll(".settings-platform-row");
  const row = rows[i];
  if (!row) return;
  const label = row.querySelector("[data-p-name]")?.value.trim() || `Platform ${i + 1}`;
  showConfirm(
    `Remove <strong>${esc(label)}</strong> from the list?<br><small>Click Save after to make this permanent.</small>`,
    () => { row.remove(); }
  );
}

async function saveSettingsPlatforms() {
  // Validate: no duplicate platform IDs
  const platformIdInputs = [...document.querySelectorAll(".settings-platform-row [data-p-id]")];
  if (markDuplicateInputs(platformIdInputs)) {
    toast("Two or more platforms share the same ID — fix the highlighted duplicates before saving", "error");
    return;
  }

  const rows = document.querySelectorAll(".settings-platform-row");
  const platforms = [...rows].map((row) => ({
    id: row.querySelector("[data-p-id]").value.trim(),
    name: row.querySelector("[data-p-name]").value.trim(),
    url: row.querySelector("[data-p-url]").value.trim(),
    logo: row.querySelector("[data-p-logo]").value.trim(),
  })).filter((p) => p.id && p.name);

  setSaveStatus("saving", "Saving…");
  try {
    await api("save_data", { streaming_platforms: platforms });
    _SSE.notifyOwnSave();
    await loadAll();
    _dirty.clearTab("mcu");
    _dirty.clearTab("settings");
    setSaveStatus("", "All saved");
    toast("Platforms saved", "success");
  } catch (e) {
    setSaveStatus("error", "Save failed");
    toast("Error: " + e.message, "error");
  }
}

// ────────────────────────────────────────────────────────────
// SAGAS CRUD
// ────────────────────────────────────────────────────────────
function addSaga() {
  const container = document.getElementById("settings-sagas");
  if (!container) return;
  const emptyMsg = container.parentNode.querySelector(".settings-phases-empty");
  if (emptyMsg) emptyMsg.remove();
  const i = container.children.length;
  const div = document.createElement("div");
  div.className = "settings-saga-row";
  div.dataset.sagaidx = i;
  div.innerHTML = `
    <div class="phase-row-num">${i + 1}</div>
    <div class="phase-row-fields" style="flex:1">
      <div class="phase-field-pair">
        <div><label class="form-label">Saga ID</label><input class="form-input" data-saga-id value="saga_${String(i + 1).padStart(3,"0")}" placeholder="saga_001"></div>
        <div style="flex:2"><label class="form-label">Saga Name</label><input class="form-input" data-saga-name value="" placeholder="The Infinity Saga"></div>
        <div><label class="form-label">Phases (comma-sep numbers)</label><input class="form-input" data-saga-phases value="" placeholder="1,2,3"></div>
      </div>
      <div class="phase-field-pair" style="margin-top:6px">
        <div style="flex:1"><label class="form-label">Description</label><textarea class="form-textarea" data-saga-desc style="min-height:56px"></textarea></div>
      </div>
    </div>
    <button class="cast-remove" onclick="this.parentNode.remove()" title="Remove Saga"><i class="fa-solid fa-xmark"></i></button>`;
  container.appendChild(div);
}

function removeSaga(i) {
  const rows = document.querySelectorAll(".settings-saga-row");
  const row = rows[i];
  if (!row) return;
  const label = row.querySelector("[data-saga-name]")?.value.trim() || `Saga ${i + 1}`;
  showConfirm(
    `Remove <strong>${esc(label)}</strong>?<br><small>Click Save after to make permanent.</small>`,
    () => { row.remove(); }
  );
}

async function saveSettingsSagas() {
  const rows = document.querySelectorAll(".settings-saga-row");
  const sagas = [...rows].map(row => {
    const phasesStr = row.querySelector("[data-saga-phases]")?.value || "";
    const phases = phasesStr.split(",").map(s => parseInt(s.trim())).filter(n => !isNaN(n));
    return {
      id:          row.querySelector("[data-saga-id]").value.trim(),
      name:        row.querySelector("[data-saga-name]").value.trim(),
      phases,
      description: row.querySelector("[data-saga-desc]")?.value.trim() || "",
    };
  }).filter(s => s.id && s.name);

  const sagaIdInputs = [...document.querySelectorAll(".settings-saga-row [data-saga-id]")];
  if (markDuplicateInputs(sagaIdInputs)) {
    toast("Two or more sagas share the same ID — fix duplicates before saving", "error");
    return;
  }

  const updatedAbout = { ...DATA.about, sagas };
  setSaveStatus("saving", "Saving…");
  try {
    await api("save_data", { about: updatedAbout });
    _SSE.notifyOwnSave();
    await loadAll();
    _dirty.clearTab("mcu");
    _dirty.clearTab("settings");
    setSaveStatus("", "All saved");
    toast("Sagas saved", "success");
  } catch (e) {
    setSaveStatus("error", "Save failed");
    toast("Error: " + e.message, "error");
  }
}

// ────────────────────────────────────────────────────────────
// WATCH ORDER TYPES CRUD
// ────────────────────────────────────────────────────────────
function addWatchOrderType() {
  const container = document.getElementById("settings-watch-order-types");
  if (!container) return;
  const emptyMsg = container.parentNode.querySelector(".settings-phases-empty");
  if (emptyMsg) emptyMsg.remove();
  const i = container.children.length;
  const div = document.createElement("div");
  div.className = "settings-wot-row";
  div.dataset.wotidx = i;
  div.innerHTML = `
    <div class="phase-row-num">${i + 1}</div>
    <div class="phase-row-fields" style="flex:1">
      <div class="phase-field-pair">
        <div><label class="form-label">ID</label><input class="form-input" data-wot-id value="" placeholder="release_order"></div>
        <div style="flex:2"><label class="form-label">Name</label><input class="form-input" data-wot-name value="" placeholder="Release Order"></div>
      </div>
      <div style="margin-top:6px"><label class="form-label">Description</label><textarea class="form-textarea" data-wot-desc style="min-height:56px"></textarea></div>
    </div>
    <button class="cast-remove" onclick="this.parentNode.remove()"><i class="fa-solid fa-xmark"></i></button>`;
  container.appendChild(div);
}

function removeWatchOrderType(i) {
  const rows = document.querySelectorAll(".settings-wot-row");
  const row = rows[i];
  if (!row) return;
  const label = row.querySelector("[data-wot-name]")?.value.trim() || `Watch Order Type ${i + 1}`;
  showConfirm(
    `Remove <strong>${esc(label)}</strong>?<br><small>Click Save after to make permanent.</small>`,
    () => { row.remove(); }
  );
}

async function saveSettingsWatchOrderTypes() {
  const rows = document.querySelectorAll(".settings-wot-row");
  const watch_order_types = [...rows].map(row => ({
    id:          row.querySelector("[data-wot-id]").value.trim(),
    name:        row.querySelector("[data-wot-name]").value.trim(),
    description: row.querySelector("[data-wot-desc]")?.value.trim() || "",
  })).filter(w => w.id && w.name);

  setSaveStatus("saving", "Saving…");
  try {
    await api("save_data", { watch_order_types });
    _SSE.notifyOwnSave();
    await loadAll();
    _dirty.clearTab("mcu");
    _dirty.clearTab("settings");
    setSaveStatus("", "All saved");
    toast("Watch order types saved", "success");
  } catch (e) {
    setSaveStatus("error", "Save failed");
    toast("Error: " + e.message, "error");
  }
}

// ────────────────────────────────────────────────────────────
// CONTENT TYPES CRUD
// ────────────────────────────────────────────────────────────
function addContentType() {
  const container = document.getElementById("settings-content-types");
  if (!container) return;
  const div = document.createElement("div");
  div.className = "settings-ct-row";
  div.style.cssText = "display:flex;align-items:center;gap:6px";
  div.innerHTML = `
    <input class="form-input" data-ct-value value="" placeholder="e.g. movie" style="width:160px">
    <button class="cast-remove" onclick="this.parentNode.remove()" title="Remove"><i class="fa-solid fa-xmark"></i></button>`;
  container.appendChild(div);
}

async function saveSettingsContentTypes() {
  const inputs = document.querySelectorAll("[data-ct-value]");
  const content_types = [...inputs].map(inp => inp.value.trim()).filter(Boolean);

  setSaveStatus("saving", "Saving…");
  try {
    await api("save_data", { content_types });
    _SSE.notifyOwnSave();
    await loadAll();
    _dirty.clearTab("mcu");
    _dirty.clearTab("settings");
    setSaveStatus("", "All saved");
    toast("Content types saved", "success");
  } catch (e) {
    setSaveStatus("error", "Save failed");
    toast("Error: " + e.message, "error");
  }
}

// ────────────────────────────────────────────────────────────
// JSON EDITOR TAB
// ────────────────────────────────────────────────────────────
let _jsonEditorFile = "data";

function renderJsonEditor() {
  const container = document.getElementById("json-editor-container");
  if (!container) return;
  container.innerHTML = `
  <div class="json-editor-layout">
    <div class="json-editor-toolbar">
      <div class="toggle-group">
        <button class="tgl ${_jsonEditorFile === "data" ? "active" : ""}" onclick="switchJsonEditorFile('data',this)"><i class="fa-solid fa-database"></i> data.json</button>
        <button class="tgl ${_jsonEditorFile === "mcu" ? "active" : ""}" onclick="switchJsonEditorFile('mcu',this)"><i class="fa-solid fa-film"></i> mcu.json</button>
        <button class="tgl ${_jsonEditorFile === "stars" ? "active" : ""}" onclick="switchJsonEditorFile('stars',this)"><i class="fa-solid fa-star"></i> stars.json</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn-ghost-sm" onclick="formatJsonEditor()"><i class="fa-solid fa-code"></i> Format</button>
        <button class="btn-ghost-sm" onclick="validateJsonEditor()"><i class="fa-solid fa-check-circle"></i> Validate</button>
        <button class="btn-primary-sm" onclick="saveJsonEditor()"><i class="fa-solid fa-floppy-disk"></i> Save to Disk</button>
      </div>
    </div>
    <div class="json-editor-info">
      <i class="fa-solid fa-circle-info"></i>
      Editing <strong>${_jsonEditorFile}.json</strong> directly. All changes will overwrite the file on disk. Be careful — invalid JSON will not be saved.
    </div>
    <textarea class="json-entry-editor json-fullfile-editor" id="json-editor-textarea" spellcheck="false" placeholder="Loading…"></textarea>
    <div class="json-editor-status" id="json-editor-status"></div>
  </div>`;
  loadJsonEditorContent();
}

function switchJsonEditorFile(file, btn) {
  _jsonEditorFile = file;
  document.querySelectorAll("#json-editor-container .tgl").forEach(b => b.classList.remove("active"));
  if (btn) btn.classList.add("active");
  loadJsonEditorContent();
  const info = document.querySelector(".json-editor-info strong");
  if (info) info.textContent = file + ".json";
}

async function loadJsonEditorContent() {
  const ta = document.getElementById("json-editor-textarea");
  if (!ta) return;
  ta.value = "Loading…";
  try {
    let data;
    if (_jsonEditorFile === "data")  data = await api("load_data");
    else if (_jsonEditorFile === "mcu")   data = await api("load_mcu");
    else if (_jsonEditorFile === "stars") data = await api("load_stars");
    ta.value = JSON.stringify(data, null, 2);
    setJsonEditorStatus("Loaded " + _jsonEditorFile + ".json", "ok");
  } catch (e) {
    ta.value = "";
    setJsonEditorStatus("Error loading: " + e.message, "error");
  }
}

function formatJsonEditor() {
  const ta = document.getElementById("json-editor-textarea");
  if (!ta) return;
  try {
    const parsed = JSON.parse(ta.value);
    ta.value = JSON.stringify(parsed, null, 2);
    setJsonEditorStatus("Formatted", "ok");
  } catch (e) {
    setJsonEditorStatus("Invalid JSON: " + e.message, "error");
  }
}

function validateJsonEditor() {
  const ta = document.getElementById("json-editor-textarea");
  if (!ta) return;
  try {
    JSON.parse(ta.value);
    setJsonEditorStatus("✓ Valid JSON", "ok");
  } catch (e) {
    setJsonEditorStatus("✗ Invalid JSON: " + e.message, "error");
  }
}

async function saveJsonEditor() {
  const ta = document.getElementById("json-editor-textarea");
  if (!ta) return;
  let parsed;
  try {
    parsed = JSON.parse(ta.value);
  } catch (e) {
    toast("Invalid JSON — fix errors before saving: " + e.message, "error");
    setJsonEditorStatus("✗ Invalid JSON: " + e.message, "error");
    return;
  }
  setSaveStatus("saving", "Saving…");
  try {
    await api("save_raw_json", { file: _jsonEditorFile, content: parsed });
    _SSE.notifyOwnSave();
    await loadAll();
    setSaveStatus("", "All saved");
    toast(_jsonEditorFile + ".json saved", "success");
    setJsonEditorStatus("Saved " + _jsonEditorFile + ".json", "ok");
  } catch (e) {
    setSaveStatus("error", "Save failed");
    toast("Save error: " + e.message, "error");
    setJsonEditorStatus("Save failed: " + e.message, "error");
  }
}

function setJsonEditorStatus(msg, type) {
  const el = document.getElementById("json-editor-status");
  if (!el) return;
  el.textContent = msg;
  el.className = "json-editor-status " + (type || "");
}

// ────────────────────────────────────────────────────────────
// OVERVIEW TAB
// ────────────────────────────────────────────────────────────
function renderOverview() {
  const entries = MCU.entries;
  const movies = entries.filter((e) => e.type === "movie").length;
  const series = entries.filter((e) => e.type === "series").length;
  const specials = entries.filter(
    (e) => e.type === "special_presentation",
  ).length;
  const total = entries.length;
  const phases = (DATA?.about?.phases || []).length;

  document.getElementById("ov-movies").textContent = movies;
  document.getElementById("ov-series").textContent = series;
  document.getElementById("ov-specials").textContent = specials;
  document.getElementById("ov-stars").textContent = STARS.stars.length;
  document.getElementById("ov-total").textContent = total;
  document.getElementById("ov-phases").textContent = phases;

  const phaseTable = document.getElementById("phase-table");
  const phaseMap = {};
  entries.forEach((e) => {
    phaseMap[e.phase] = (phaseMap[e.phase] || 0) + 1;
  });
  const phaseInfo = DATA?.about?.phases || [];
  phaseTable.innerHTML = phaseInfo
    .map((p) => {
      const count = phaseMap[p.id] || 0;
      const pct = total ? Math.round((count / total) * 100) : 0;
      return `
    <div class="phase-row">
      <span class="phase-row-name">${p.name}</span>
      <div class="phase-row-bar"><div class="phase-row-fill" style="width:${pct}%"></div></div>
      <span class="phase-row-count">${count} titles</span>
    </div>`;
    })
    .join("");

  const health = document.getElementById("json-health");
  const releaseLen = MCU.release_order.length;
  const chronoLen = MCU.chronological_order.length;
  const entriesLen = MCU.entries.length;
  const starsLen = STARS.stars.length;

  const relOk = releaseLen === entriesLen;
  const chrOk = chronoLen === entriesLen;

  health.innerHTML = `
  <div class="json-health-row">
    <i class="fa-solid fa-film json-health-icon ${relOk ? "json-ok" : "json-err"}"></i>
    <span class="json-health-label">MCU Entries</span>
    <span class="json-health-val">${entriesLen}</span>
  </div>
  <div class="json-health-row">
    <i class="fa-solid fa-list-ol json-health-icon ${relOk ? "json-ok" : "json-warn"}"></i>
    <span class="json-health-label">Release Order Entries</span>
    <span class="json-health-val">${relOk ? "✓ " : "⚠ "}${releaseLen}</span>
  </div>
  <div class="json-health-row">
    <i class="fa-solid fa-clock-rotate-left json-health-icon ${chrOk ? "json-ok" : "json-warn"}"></i>
    <span class="json-health-label">Chrono Order Entries</span>
    <span class="json-health-val">${chrOk ? "✓ " : "⚠ "}${chronoLen}</span>
  </div>
  <div class="json-health-row">
    <i class="fa-solid fa-star json-health-icon json-ok"></i>
    <span class="json-health-label">Stars</span>
    <span class="json-health-val">${starsLen}</span>
  </div>
  <div class="json-health-row">
    <i class="fa-solid fa-id-card json-health-icon json-ok"></i>
    <span class="json-health-label">Highest MCU ID</span>
    <span class="json-health-val">${getNextMcuId().replace("mcu_", "#")}</span>
  </div>
  <div class="json-health-row">
    <i class="fa-solid fa-id-card json-health-icon json-ok"></i>
    <span class="json-health-label">Highest Star ID</span>
    <span class="json-health-val">${getNextStarId().replace("star_", "#")}</span>
  </div>`;

  const byYear = {};
  entries.forEach((e) => {
    const year = (e.release_date || "").slice(0, 4) || "TBA";
    byYear[year] = (byYear[year] || 0) + 1;
  });
  const maxYearCount = Math.max(1, ...Object.values(byYear));
  const timeline = document.getElementById("overview-timeline");
  if (timeline) {
    timeline.innerHTML = Object.entries(byYear)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, count]) => `
        <div class="timeline-row">
          <span class="timeline-year">${esc(year)}</span>
          <div class="timeline-bar"><div style="width:${Math.max(8, Math.round((count / maxYearCount) * 100))}%"></div></div>
          <span class="timeline-count">${count}</span>
        </div>`)
      .join("");
  }

  const typeCounts = entries.reduce((acc, e) => {
    acc[e.type || "unknown"] = (acc[e.type || "unknown"] || 0) + 1;
    return acc;
  }, {});
  const mix = document.getElementById("overview-mix");
  if (mix) {
    mix.innerHTML = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => `
        <div class="overview-pill-row">
          <span>${esc(typeLabel(type))}</span>
          <strong>${count}</strong>
        </div>`)
      .join("");
  }

  const castLinkedTitles = entries.filter((e) => (e.cast || []).length).length;
  const starsWithAppearances = STARS.stars.filter((s) => (s.mcu_appearances || []).length || entries.some((e) => (e.cast || []).some((c) => c.star_id === s.id))).length;
  const cast = document.getElementById("overview-cast");
  if (cast) {
    cast.innerHTML = `
      <div class="json-health-row"><i class="fa-solid fa-film json-health-icon json-ok"></i><span class="json-health-label">Titles with cast links</span><span class="json-health-val">${castLinkedTitles}/${entriesLen}</span></div>
      <div class="json-health-row"><i class="fa-solid fa-star json-health-icon json-ok"></i><span class="json-health-label">Stars linked to titles</span><span class="json-health-val">${starsWithAppearances}/${starsLen}</span></div>
      <div class="json-health-row"><i class="fa-solid fa-calendar-days json-health-icon ${entries.some(e => !e.release_date) ? "json-warn" : "json-ok"}"></i><span class="json-health-label">Missing release dates</span><span class="json-health-val">${entries.filter(e => !e.release_date).length}</span></div>
      <div class="json-health-row"><i class="fa-solid fa-hourglass json-health-icon ${entries.some(e => e.in_universe_year && parseInUniverseYear(e.in_universe_year) === null) ? "json-warn" : "json-ok"}"></i><span class="json-health-label">Unparseable universe years</span><span class="json-health-val">${entries.filter(e => e.in_universe_year && parseInUniverseYear(e.in_universe_year) === null).length}</span></div>
    `;
  }
}

// ────────────────────────────────────────────────────────────
// MODAL
// ────────────────────────────────────────────────────────────
function openModal(html) {
  document.getElementById("modal-content").innerHTML = html;
  document.getElementById("modal-overlay").classList.remove("hidden");
  document.body.style.overflow = "hidden";
  // Wire up WTW select↔id sync for existing rows
  document.querySelectorAll(".wtw-row").forEach(row => {
    const sel = row.querySelector("[data-wtw-platform]");
    const pidInput = row.querySelector("[data-wtw-platform-id]");
    if (sel && pidInput) {
      // Init: if platform_id matches a platform option, select it
      if (!sel.value && pidInput.value) {
        const opt = [...sel.options].find(o => o.value === pidInput.value);
        if (opt) sel.value = opt.value;
      }
      sel.addEventListener("change", () => { if (sel.value) pidInput.value = sel.value; });
    }
  });
}

function closeModal(event) {
  if (event && event.target !== document.getElementById("modal-overlay"))
    return;
  document.getElementById("modal-overlay").classList.add("hidden");
  document.getElementById("modal-content").innerHTML = "";
  document.querySelector(".modal-box")?.classList.remove("modal-content-wide");
  document.body.style.overflow = "";
  // Push URL back to tab-only state on any close (X button or backdrop)
  if (currentTab === "settings") pushState({ settings: true });
  else if (currentTab === "overview") pushState({ overview: true });
  else pushState({ tab: currentTab });
}

// ────────────────────────────────────────────────────────────
// CONFIRM DIALOG
// ────────────────────────────────────────────────────────────
function showConfirm(message, callback) {
  document.getElementById("confirm-message").innerHTML = message;
  confirmCallback = callback;
  document.getElementById("confirm-overlay").classList.remove("hidden");
}

function confirmOk() {
  document.getElementById("confirm-overlay").classList.add("hidden");
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
}

function confirmCancel() {
  document.getElementById("confirm-overlay").classList.add("hidden");
  confirmCallback = null;
}

// ────────────────────────────────────────────────────────────
// TOAST
// ────────────────────────────────────────────────────────────
function toast(msg, type = "info", duration = 3000) {
  const icons = {
    success: "fa-circle-check",
    error: "fa-circle-xmark",
    info: "fa-circle-info",
    warning: "fa-triangle-exclamation",
  };
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `<i class="fa-solid ${icons[type] || 'fa-circle-info'}"></i> ${msg}`;
  document.getElementById("toast-stack").appendChild(el);
  setTimeout(() => {
    el.classList.add("hide");
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ────────────────────────────────────────────────────────────
// IMAGE CACHE BUSTING
// ────────────────────────────────────────────────────────────
function bustImageCache() {
  const ts = Date.now();
  // Clear our in-memory cache map
  _imgCache.clear();
  // Re-inject ?v=timestamp onto every visible img that points to our asset paths
  const assetPaths = [CFG.IMG_MCU, CFG.IMG_STARS, CFG.IMG_PLATFORMS];
  document.querySelectorAll("img").forEach(img => {
    const src = img.getAttribute("src");
    if (!src) return;
    if (!assetPaths.some(p => src.includes(p))) return;
    // Strip old ?v=... then append new one
    const clean = src.replace(/\?v=\d+/, "");
    img.src = clean + "?v=" + ts;
    _imgCache.set(clean, clean + "?v=" + ts);
  });
  toast("Image cache busted — all asset URLs refreshed", "success");
}

// ────────────────────────────────────────────────────────────
// RESET UNSAVED CHANGES
// ────────────────────────────────────────────────────────────
function resetUnsavedChanges() {
  if (!_dirty.hasChanges()) {
    toast("No unsaved changes to reset", "info");
    return;
  }
  showConfirm(
    `Discard all <strong>${_dirty.changes.length}</strong> unsaved change${_dirty.changes.length !== 1 ? "s" : ""}?<br><small>This will reload the MCU and Settings tabs from disk.</small>`,
    async () => {
      _dirty.clear();
      // Re-render MCU / Settings grids from fresh data
      if (currentTab === "mcu") renderMcu();
      else if (currentTab === "settings") renderSettings();
      toast("Unsaved changes discarded", "info");
    }
  );
}

// ────────────────────────────────────────────────────────────
// UNSAVED CHANGES DETAIL MODAL
// ────────────────────────────────────────────────────────────
function openChangesModal() {
  if (!_dirty.hasChanges()) return;
  const grouped = {};
  _dirty.changes.forEach(c => {
    const key = `${c.tab} › ${c.section}`;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(c.label);
  });
  const rows = Object.entries(grouped).map(([group, labels]) => `
    <div class="changes-group">
      <div class="changes-group-title"><i class="fa-solid fa-folder-open"></i> ${esc(group)}</div>
      <ul class="changes-list">
        ${labels.map(l => `<li>${esc(l)}</li>`).join("")}
      </ul>
    </div>`).join("");

  const html = `
  <div class="modal-form">
    <div class="modal-form-title"><i class="fa-solid fa-circle-exclamation txt-gold"></i> Unsaved Changes</div>
    <div class="modal-form-sub">${_dirty.changes.length} change${_dirty.changes.length !== 1 ? "s" : ""} pending — save each section to persist them</div>
    <div class="changes-modal-body">${rows}</div>
    <div class="modal-actions">
      <button class="btn-ghost-sm" onclick="closeModal()">Close</button>
      <button class="btn-danger" onclick="closeModal();resetUnsavedChanges()"><i class="fa-solid fa-rotate-left"></i> Discard All</button>
    </div>
  </div>`;
  openModal(html);
}

// ────────────────────────────────────────────────────────────
// UTILITIES
// ────────────────────────────────────────────────────────────
function esc(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function typeLabel(type) {
  const map = {
    movie: "Movie",
    series: "Series",
    special_presentation: "Special",
    short: "Short",
  };
  return map[type] || type;
}

function titleStatusBadge(status) {
  if (!status) return "";
  const label = statusLabel(status);
  const cls = String(status).toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  return `<span class="status-badge status-${cls}">${esc(label)}</span>`;
}

function statusLabel(status) {
  const map = {
    released: "Released",
    soon: "Soon",
    upcoming: "Upcoming",
    announced: "Announced",
    cancelled: "Cancelled",
  };
  return map[status] || String(status).replace(/_/g, " ");
}

function toggle(id, show) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle("hidden", !show);
}

function fileToBase64(file) {
  return new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = rej;
    reader.readAsDataURL(file);
  });
}

function toggleMobileMenu() {
  const overlay = document.getElementById("mobile-more-overlay");
  if (overlay) overlay.classList.toggle("hidden");
}

function previewImage(input, previewId) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const box = document.getElementById(previewId);
    if (!box) return;
    if (box.tagName === "IMG") {
      box.src = e.target.result;
    } else {
      const img = document.createElement("img");
      img.id = previewId;
      img.src = e.target.result;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.objectFit = "cover";
      box.parentNode.replaceChild(img, box);
    }
  };
  reader.readAsDataURL(file);
}
