<?php
/**
 * MCU Universe Admin Dashboard
 * index.php — UI + Backend API
 * Author: Built for Mahdi Yasser | VetroM
 */

// ─── PATH CONSTANTS ──────────────────────────────────────────────────────────
define('BASE_DIR',       dirname(__DIR__));
define('APP_DIR',        BASE_DIR . '/assets/app');
define('APP_JSON',       APP_DIR  . '/app.json');
define('AVATARS_DIR',    APP_DIR  . '/avatars');
define('LOGO_FILE',      APP_DIR  . '/logo.png');
define('BANNER_FILE',    APP_DIR  . '/banner.png');
define('ME_FILE',        APP_DIR  . '/me.png');

define('MCU_JSON',         BASE_DIR . '/assets/mcu.json');
define('DATA_JSON',        BASE_DIR . '/assets/data.json');

define('ALLOWED_IMG_MIME', ['image/png','image/jpeg','image/jpg','image/gif','image/webp']);
define('MAX_IMG_SIZE',     10 * 1024 * 1024); // 10 MB

// ─── UTILITY FUNCTIONS ───────────────────────────────────────────────────────
function json_response(array $data, int $code = 200): void {
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    exit;
}

function safe_read_json(string $path): ?array {
    if (!file_exists($path)) return null;
    $fp = fopen($path, 'r');
    if (!$fp) return null;
    if (!flock($fp, LOCK_SH)) { fclose($fp); return null; }
    $content = stream_get_contents($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    $decoded = json_decode($content, true);
    return (json_last_error() === JSON_ERROR_NONE) ? $decoded : null;
}

function atomic_write(string $path, string $content): bool {
    $dir  = dirname($path);
    $tmp  = $dir . '/.tmp_' . uniqid('', true) . '_' . basename($path);
    $fp   = fopen($tmp, 'w');
    if (!$fp) return false;
    if (!flock($fp, LOCK_EX)) { fclose($fp); @unlink($tmp); return false; }
    $written = fwrite($fp, $content);
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
    if ($written === false) { @unlink($tmp); return false; }
    if (!rename($tmp, $path)) { @unlink($tmp); return false; }
    @chmod($path, 0777);
    return true;
}

function atomic_write_upload(string $path, string $tmp_src): bool {
    if (!move_uploaded_file($tmp_src, $path)) return false;
    @chmod($path, 0777);
    return true;
}

function ensure_dir(string $path): void {
    if (!is_dir($path)) {
        mkdir($path, 0777, true);
        @chmod($path, 0777);
    }
}

function validate_image_upload(array $file): ?string {
    if ($file['error'] !== UPLOAD_ERR_OK) return 'Upload error code: ' . $file['error'];
    if ($file['size'] > MAX_IMG_SIZE) return 'File too large (max 10 MB)';
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime  = $finfo->file($file['tmp_name']);
    if (!in_array($mime, ALLOWED_IMG_MIME)) return 'Invalid file type: ' . $mime;
    return null;
}

function slugify(string $str): string {
    $str = strtolower(trim($str));
    $str = preg_replace('/[^a-z0-9]+/', '_', $str);
    return trim($str, '_');
}

// ─── API ROUTER ──────────────────────────────────────────────────────────────
$action = $_GET['action'] ?? $_POST['action'] ?? '';

if ($action !== '') {
    ensure_dir(AVATARS_DIR);

    switch ($action) {

        // ── READ app.json ──────────────────────────────────────────────────
        case 'get_config':
            $data = safe_read_json(APP_JSON);
            if ($data === null) json_response(['ok'=>false,'error'=>'Cannot read app.json'], 500);
            json_response(['ok'=>true,'data'=>$data]);

        // ── SAVE app.json ──────────────────────────────────────────────────
        case 'save_config':
            $body = file_get_contents('php://input');
            $parsed = json_decode($body, true);
            if (json_last_error() !== JSON_ERROR_NONE)
                json_response(['ok'=>false,'error'=>'Invalid JSON: '.json_last_error_msg()], 400);
            $out = json_encode($parsed, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            if (!atomic_write(APP_JSON, $out))
                json_response(['ok'=>false,'error'=>'Write failed — check permissions'], 500);
            json_response(['ok'=>true]);

        // ── UPLOAD single asset (logo / banner / me) ───────────────────────
        case 'upload_asset':
            $target_key = $_POST['asset'] ?? '';
            $map = ['logo'=>LOGO_FILE, 'banner'=>BANNER_FILE, 'me'=>ME_FILE];
            if (!isset($map[$target_key]))
                json_response(['ok'=>false,'error'=>'Unknown asset'], 400);
            if (empty($_FILES['file']))
                json_response(['ok'=>false,'error'=>'No file uploaded'], 400);
            $err = validate_image_upload($_FILES['file']);
            if ($err) json_response(['ok'=>false,'error'=>$err], 400);
            if (!atomic_write_upload($map[$target_key], $_FILES['file']['tmp_name']))
                json_response(['ok'=>false,'error'=>'Save failed'], 500);
            json_response(['ok'=>true,'path'=>'/assets/app/'.basename($map[$target_key])]);

        // ── LIST avatars (from app.json items, authoritative) ─────────────
        case 'list_avatars':
            $data = safe_read_json(APP_JSON);
            $items = $data['profile']['avatars']['items'] ?? [];
            json_response(['ok'=>true,'items'=>$items]);

        // ── CREATE avatar ──────────────────────────────────────────────────
        case 'create_avatar':
            $name = trim($_POST['name'] ?? '');
            if ($name === '') json_response(['ok'=>false,'error'=>'Name required'], 400);
            if (empty($_FILES['file'])) json_response(['ok'=>false,'error'=>'Image required'], 400);
            $err = validate_image_upload($_FILES['file']);
            if ($err) json_response(['ok'=>false,'error'=>$err], 400);

            $data = safe_read_json(APP_JSON);
            if ($data === null) json_response(['ok'=>false,'error'=>'Cannot read config'], 500);

            // Build ID — custom or auto-generate
            $custom_id = trim($_POST['custom_id'] ?? '');
            $existing_ids = array_column($data['profile']['avatars']['items'], 'id');
            if ($custom_id !== '') {
                $id = $custom_id;
                if (in_array($id, $existing_ids)) {
                    $suffix = 2;
                    while (in_array($id . '_' . $suffix, $existing_ids)) $suffix++;
                    $id = $id . '_' . $suffix;
                }
            } else {
                $base_id = 'av_' . slugify($name);
                $id = $base_id;
                $suffix = 2;
                while (in_array($id, $existing_ids)) $id = $base_id . '_' . ($suffix++);
            }

            // Build filename from name
            $ext      = strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION));
            $base_fn  = slugify($name) . '.' . $ext;
            $filename = $base_fn;
            $i = 2;
            while (file_exists(AVATARS_DIR . '/' . $filename)) {
                $filename = slugify($name) . '_' . ($i++) . '.' . $ext;
            }

            if (!atomic_write_upload(AVATARS_DIR . '/' . $filename, $_FILES['file']['tmp_name']))
                json_response(['ok'=>false,'error'=>'Save failed'], 500);

            $item = ['id'=>$id,'name'=>$name,'file'=>$filename];
            $data['profile']['avatars']['items'][] = $item;
            $out = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            if (!atomic_write(APP_JSON, $out)) {
                @unlink(AVATARS_DIR . '/' . $filename);
                json_response(['ok'=>false,'error'=>'Config write failed'], 500);
            }
            json_response(['ok'=>true,'item'=>$item]);

        // ── EDIT avatar ────────────────────────────────────────────────────
        case 'edit_avatar':
            $id   = trim($_POST['id'] ?? '');
            $name = trim($_POST['name'] ?? '');
            if ($id === '' || $name === '') json_response(['ok'=>false,'error'=>'ID and name required'], 400);

            $data = safe_read_json(APP_JSON);
            if ($data === null) json_response(['ok'=>false,'error'=>'Cannot read config'], 500);

            $items =& $data['profile']['avatars']['items'];
            $idx   = null;
            foreach ($items as $k => $it) { if ($it['id'] === $id) { $idx = $k; break; } }
            if ($idx === null) json_response(['ok'=>false,'error'=>'Avatar not found'], 404);

            $items[$idx]['name'] = $name;

            // Handle ID rename
            $new_id = trim($_POST['new_id'] ?? '');
            if ($new_id !== '' && $new_id !== $id) {
                $existing_ids = array_column($items, 'id');
                if (!in_array($new_id, $existing_ids) || $new_id === $id) {
                    $items[$idx]['id'] = $new_id;
                }
            }

            // Optional new image — also rename file to match new name
            if (!empty($_FILES['file']) && $_FILES['file']['error'] === UPLOAD_ERR_OK) {
                $err = validate_image_upload($_FILES['file']);
                if ($err) json_response(['ok'=>false,'error'=>$err], 400);
                $old_file = AVATARS_DIR . '/' . $items[$idx]['file'];
                $ext      = strtolower(pathinfo($_FILES['file']['name'], PATHINFO_EXTENSION));
                $new_fn   = slugify($name) . '.' . $ext;
                $i = 2;
                while (file_exists(AVATARS_DIR . '/' . $new_fn) && AVATARS_DIR . '/' . $new_fn !== $old_file) {
                    $new_fn = slugify($name) . '_' . ($i++) . '.' . $ext;
                }
                if (!atomic_write_upload(AVATARS_DIR . '/' . $new_fn, $_FILES['file']['tmp_name']))
                    json_response(['ok'=>false,'error'=>'Save failed'], 500);
                if (file_exists($old_file) && realpath($old_file) !== realpath(AVATARS_DIR . '/' . $new_fn)) @unlink($old_file);
                $items[$idx]['file'] = $new_fn;
            } else {
                // Rename existing file to match new name if name changed
                $old_file  = $items[$idx]['file'];
                $old_ext   = strtolower(pathinfo($old_file, PATHINFO_EXTENSION));
                $new_fn    = slugify($name) . '.' . $old_ext;
                if ($new_fn !== $old_file) {
                    $old_path = AVATARS_DIR . '/' . $old_file;
                    $new_path = AVATARS_DIR . '/' . $new_fn;
                    $i = 2;
                    while (file_exists($new_path) && realpath($new_path) !== realpath($old_path)) {
                        $new_fn   = slugify($name) . '_' . ($i++) . '.' . $old_ext;
                        $new_path = AVATARS_DIR . '/' . $new_fn;
                    }
                    if (file_exists($old_path) && !file_exists($new_path)) {
                        rename($old_path, $new_path);
                        @chmod($new_path, 0777);
                        $items[$idx]['file'] = $new_fn;
                    }
                }
            }

            $out = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            if (!atomic_write(APP_JSON, $out))
                json_response(['ok'=>false,'error'=>'Config write failed'], 500);
            json_response(['ok'=>true,'item'=>$items[$idx]]);

        // ── DELETE avatar ──────────────────────────────────────────────────
        case 'delete_avatar':
            $body = json_decode(file_get_contents('php://input'), true);
            $id   = $body['id'] ?? '';
            if ($id === '') json_response(['ok'=>false,'error'=>'ID required'], 400);

            $data = safe_read_json(APP_JSON);
            if ($data === null) json_response(['ok'=>false,'error'=>'Cannot read config'], 500);

            $items =& $data['profile']['avatars']['items'];
            $found = null;
            $new_items = [];
            foreach ($items as $it) {
                if ($it['id'] === $id) $found = $it;
                else $new_items[] = $it;
            }
            if ($found === null) json_response(['ok'=>false,'error'=>'Not found'], 404);
            $items = $new_items;

            $out = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
            if (!atomic_write(APP_JSON, $out))
                json_response(['ok'=>false,'error'=>'Config write failed'], 500);

            // Remove physical file
            $img = AVATARS_DIR . '/' . $found['file'];
            if (file_exists($img)) @unlink($img);
            json_response(['ok'=>true]);

        // ── GET reference data (titles, phases, sagas) for pickers ────────
        case 'get_ref_data':
            $mcu  = safe_read_json(MCU_JSON);
            $data = safe_read_json(DATA_JSON);
            if ($mcu === null || $data === null)
                json_response(['ok'=>false,'error'=>'Cannot read reference files'], 500);

            // Build flat title list: id + title + phase
            $titles = array_map(fn($e) => [
                'id'    => $e['id'],
                'title' => $e['title'],
                'type'  => $e['type'],
                'phase' => $e['phase'],
            ], $mcu['entries']);

            // Phases from data.json
            $phases = array_map(fn($p) => [
                'id'   => $p['id'],
                'name' => $p['name'],
                'saga' => $p['saga'],
            ], $data['about']['phases']);

            // Sagas from data.json
            $sagas = array_map(fn($s) => [
                'id'   => $s['id'],
                'name' => $s['name'],
            ], $data['about']['sagas']);

            json_response(['ok'=>true, 'titles'=>$titles, 'phases'=>$phases, 'sagas'=>$sagas]);

        default:
            json_response(['ok'=>false,'error'=>'Unknown action'], 400);
    }
}
// ─── END API — render HTML below ─────────────────────────────────────────────
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<title>MCU Admin — Control Panel</title>
<meta name="robots" content="noindex,nofollow">

<!-- Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@300;400;500;600;700&family=Barlow+Condensed:wght@400;500;600;700;800&display=swap" rel="stylesheet">

<!-- Font Awesome -->
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">

<link rel="stylesheet" href="style.css">
</head>
<body>

<!-- ═══ TOAST CONTAINER ════════════════════════════════════════════════════ -->
<div id="toast-wrap"></div>

<!-- ═══ CONFIRM MODAL ═════════════════════════════════════════════════════ -->
<div id="confirm-modal" class="modal-overlay hidden">
  <div class="modal-box">
    <div class="modal-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
    <h3 id="confirm-title">Confirm Action</h3>
    <p id="confirm-msg"></p>
    <div class="modal-actions">
      <button class="btn-outline" id="confirm-cancel">Cancel</button>
      <button class="btn-danger" id="confirm-ok">Confirm</button>
    </div>
  </div>
</div>

<!-- ═══ AVATAR MODAL ══════════════════════════════════════════════════════ -->
<div id="avatar-modal" class="modal-overlay hidden">
  <div class="modal-box">
    <button class="modal-close-btn" id="avatar-modal-close"><i class="fa-solid fa-xmark"></i></button>
    <div class="modal-icon" id="avatar-modal-icon"><i class="fa-solid fa-user-plus"></i></div>
    <h3 id="avatar-modal-title">Add Avatar</h3>
    <div class="avatar-modal-fields-row">
      <div class="form-group">
        <label class="form-label">Display Name</label>
        <input type="text" id="avatar-name-input" class="form-input" placeholder="e.g. Iron Man">
      </div>
      <div class="form-group">
        <label class="form-label">ID <small id="avatar-id-hint">(auto on create)</small></label>
        <input type="text" id="avatar-id-input" class="form-input" placeholder="av_iron_man">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" id="avatar-img-label">Avatar Image</label>
      <div class="upload-zone" id="avatar-upload-zone">
        <img id="avatar-preview" class="upload-preview hidden" alt="preview">
        <div class="upload-prompt" id="avatar-upload-prompt">
          <i class="fa-solid fa-cloud-arrow-up"></i>
          <span>Click or drag image here</span>
        </div>
        <input type="file" id="avatar-file-input" accept="image/*" class="upload-file-input">
      </div>
      <div id="avatar-current-file" style="margin-top:6px;font-family:monospace;font-size:11px;color:var(--text3)"></div>
    </div>
    <div class="modal-actions">
      <button class="btn-outline" id="avatar-modal-cancel">Cancel</button>
      <button class="btn-primary" id="avatar-modal-save">
        <i class="fa-solid fa-floppy-disk"></i> Save Avatar
      </button>
    </div>
  </div>
</div>

<!-- ═══ ACHIEVEMENT MODAL ══════════════════════════════════════════════════ -->
<div id="achievement-modal" class="modal-overlay hidden">
  <div class="modal-box">
    <button class="modal-close-btn" id="ach-modal-close"><i class="fa-solid fa-xmark"></i></button>
    <div class="modal-icon" id="ach-modal-icon" style="background:var(--gold-dim);color:var(--gold)"><i class="fa-solid fa-trophy"></i></div>
    <h3 id="ach-modal-title">Achievement</h3>
    <div id="ach-modal-body"></div>
    <div class="modal-actions">
      <button class="btn-outline" id="ach-modal-cancel">Cancel</button>
      <button class="btn-primary" id="ach-modal-save">
        <i class="fa-solid fa-floppy-disk"></i> Save
      </button>
    </div>
  </div>
</div>

<!-- ═══ SIDEBAR ═══════════════════════════════════════════════════════════ -->
<aside id="sidebar">
  <div class="sidebar-logo">
    <i class="fa-solid fa-shield-halved logo-icon"></i>
    <div class="logo-text">
      <span class="logo-title">MCU ADMIN</span>
      <span class="logo-sub">Control Panel</span>
    </div>
  </div>

  <nav class="sidebar-nav">
    <button class="nav-item active" data-section="overview">
      <i class="fa-solid fa-gauge-high"></i>
      <span>Overview</span>
    </button>
    <button class="nav-item" data-section="app-config">
      <i class="fa-solid fa-sliders"></i>
      <span>App Config</span>
    </button>
    <button class="nav-item" data-section="avatars">
      <i class="fa-solid fa-users"></i>
      <span>Avatars</span>
    </button>
    <button class="nav-item" data-section="progression">
      <i class="fa-solid fa-trophy"></i>
      <span>Progression</span>
    </button>
    <button class="nav-item" data-section="ui-text">
      <i class="fa-solid fa-font"></i>
      <span>UI Text</span>
    </button>
  </nav>

  <div class="sidebar-footer">
    <a href="../app/" class="sidebar-link">
      <i class="fa-solid fa-arrow-up-right-from-square"></i> View App
    </a>
  </div>
</aside>

<!-- ═══ MOBILE TOPBAR ═════════════════════════════════════════════════════ -->
<div id="topbar">
  <button id="sidebar-toggle"><i class="fa-solid fa-bars"></i></button>
  <div class="topbar-title">
    <i class="fa-solid fa-shield-halved"></i>
    MCU Admin
  </div>
  <button id="save-all-btn" class="btn-save-top" title="Save all changes">
    <i class="fa-solid fa-floppy-disk"></i>
  </button>
</div>
<div id="sidebar-overlay"></div>

<!-- ═══ MAIN CONTENT ══════════════════════════════════════════════════════ -->
<main id="main">

  <!-- ── OVERVIEW ──────────────────────────────────────────────────────── -->
  <section id="section-overview" class="content-section active">
    <div class="section-head">
      <h1 class="section-title">Overview</h1>
      <p class="section-sub">System status and quick actions</p>
    </div>

    <div class="overview-grid">
      <div class="stat-card">
        <i class="fa-solid fa-users stat-icon" style="color:var(--accent)"></i>
        <div class="stat-body">
          <div class="stat-num" id="ov-avatar-count">—</div>
          <div class="stat-label">Avatars</div>
        </div>
      </div>
      <div class="stat-card">
        <i class="fa-solid fa-trophy stat-icon" style="color:var(--gold)"></i>
        <div class="stat-body">
          <div class="stat-num" id="ov-achievement-count">—</div>
          <div class="stat-label">Achievements</div>
        </div>
      </div>
      <div class="stat-card">
        <i class="fa-solid fa-layer-group stat-icon" style="color:#22c55e"></i>
        <div class="stat-body">
          <div class="stat-num" id="ov-rank-count">—</div>
          <div class="stat-label">Ranks</div>
        </div>
      </div>
      <div class="stat-card">
        <i class="fa-solid fa-tag stat-icon" style="color:#3b82f6"></i>
        <div class="stat-body">
          <div class="stat-num" id="ov-version">—</div>
          <div class="stat-label">App Version</div>
        </div>
      </div>
      <div class="stat-card">
        <i class="fa-solid fa-film stat-icon" style="color:#a855f7"></i>
        <div class="stat-body">
          <div class="stat-num" id="ov-filter-count">—</div>
          <div class="stat-label">Filters</div>
        </div>
      </div>
    </div>

    <div class="quick-actions-card">
      <h2 class="card-title"><i class="fa-solid fa-bolt"></i> Quick Actions</h2>
      <div class="qa-grid">
        <button class="qa-btn" onclick="Admin.switchSection('app-config')">
          <i class="fa-solid fa-cube"></i>
          <span>App Identity</span>
        </button>
        <button class="qa-btn" onclick="Admin.switchSection('app-config')">
          <i class="fa-solid fa-image"></i>
          <span>Update Media</span>
        </button>
        <button class="qa-btn" onclick="Admin.switchSection('avatars')">
          <i class="fa-solid fa-user-plus"></i>
          <span>Add Avatar</span>
        </button>
        <button class="qa-btn" onclick="Admin.switchSection('progression')">
          <i class="fa-solid fa-trophy"></i>
          <span>Progression</span>
        </button>
        <button class="qa-btn" onclick="Admin.switchSection('ui-text')">
          <i class="fa-solid fa-font"></i>
          <span>UI Text</span>
        </button>
        <button class="qa-btn" onclick="Admin.saveAll()">
          <i class="fa-solid fa-floppy-disk"></i>
          <span>Save All</span>
        </button>
      </div>
    </div>

    <div class="info-card">
      <h2 class="card-title"><i class="fa-solid fa-circle-info"></i> File Paths</h2>
      <div class="file-path-list" id="file-path-list">
        <div class="fp-row"><span class="fp-label">app.json</span><code class="fp-path">/assets/app/app.json</code><span class="fp-badge" id="fp-json-status">—</span></div>
        <div class="fp-row"><span class="fp-label">logo.png</span><code class="fp-path">/assets/app/logo.png</code><span class="fp-badge" id="fp-logo-status">—</span></div>
        <div class="fp-row"><span class="fp-label">banner.png</span><code class="fp-path">/assets/app/banner.png</code><span class="fp-badge" id="fp-banner-status">—</span></div>
        <div class="fp-row"><span class="fp-label">me.png</span><code class="fp-path">/assets/app/me.png</code><span class="fp-badge" id="fp-me-status">—</span></div>
        <div class="fp-row"><span class="fp-label">avatars/</span><code class="fp-path">/assets/app/avatars/</code><span class="fp-badge fp-badge--ok">DIR</span></div>
      </div>
    </div>
  </section>

  <!-- ── APP CONFIG ─────────────────────────────────────────────────────── -->
  <section id="section-app-config" class="content-section">
    <div class="section-head">
      <h1 class="section-title">App Config</h1>
      <p class="section-sub">Core application settings from app.json</p>
    </div>

    <div class="config-card">
      <h2 class="card-title"><i class="fa-solid fa-cube"></i> App Identity</h2>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">App Name</label>
          <input type="text" class="form-input" id="cfg-app-name">
        </div>
        <div class="form-group">
          <label class="form-label">Tagline</label>
          <input type="text" class="form-input" id="cfg-app-tagline">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Version</label>
          <input type="text" class="form-input" id="cfg-app-version">
        </div>
        <div class="form-group">
          <label class="form-label">Base URL</label>
          <input type="text" class="form-input" id="cfg-base-url">
        </div>
      </div>
    </div>

    <div class="config-card">
      <h2 class="card-title"><i class="fa-solid fa-gear"></i> Behaviour Timings <small>(ms)</small></h2>
      <div class="form-row-3">
        <div class="form-group">
          <label class="form-label">Loader Min Delay</label>
          <input type="number" class="form-input" id="cfg-loader-delay">
        </div>
        <div class="form-group">
          <label class="form-label">Toast Duration</label>
          <input type="number" class="form-input" id="cfg-toast-dur">
        </div>
        <div class="form-group">
          <label class="form-label">Toast Fade</label>
          <input type="number" class="form-input" id="cfg-toast-fade">
        </div>
        <div class="form-group">
          <label class="form-label">Search Debounce</label>
          <input type="number" class="form-input" id="cfg-search-debounce">
        </div>
        <div class="form-group">
          <label class="form-label">XP Bar Rerender</label>
          <input type="number" class="form-input" id="cfg-xp-rerender">
        </div>
        <div class="form-group">
          <label class="form-label">XP Bar Animate</label>
          <input type="number" class="form-input" id="cfg-xp-animate">
        </div>
      </div>
    </div>

    <div class="config-card">
      <h2 class="card-title"><i class="fa-solid fa-database"></i> Storage Keys</h2>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Main Storage Key</label>
          <input type="text" class="form-input" id="cfg-storage-key">
        </div>
        <div class="form-group">
          <label class="form-label">Image Cache Key</label>
          <input type="text" class="form-input" id="cfg-img-cache-key">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Cache TTL (minutes)</label>
          <input type="number" class="form-input" id="cfg-img-cache-ttl">
        </div>
        <div class="form-group">
          <label class="form-label">Cache Bust Key</label>
          <input type="text" class="form-input" id="cfg-cbust-key">
        </div>
      </div>
    </div>

    <div class="config-card">
      <h2 class="card-title"><i class="fa-solid fa-link"></i> URL Parameters</h2>
      <div class="form-row-3">
        <div class="form-group">
          <label class="form-label">Tab param</label>
          <input type="text" class="form-input" id="cfg-param-tab">
        </div>
        <div class="form-group">
          <label class="form-label">ID param</label>
          <input type="text" class="form-input" id="cfg-param-id">
        </div>
        <div class="form-group">
          <label class="form-label">Find param</label>
          <input type="text" class="form-input" id="cfg-param-find">
        </div>
        <div class="form-group">
          <label class="form-label">Download param</label>
          <input type="text" class="form-input" id="cfg-param-dl">
        </div>
        <div class="form-group">
          <label class="form-label">Share param</label>
          <input type="text" class="form-input" id="cfg-param-share">
        </div>
        <div class="form-group">
          <label class="form-label">Import param</label>
          <input type="text" class="form-input" id="cfg-param-import">
        </div>
      </div>
    </div>

    <div class="config-card">
      <h2 class="card-title"><i class="fa-solid fa-wand-sparkles"></i> Hero Section</h2>
      <div class="form-group hero-eyebrow-wide">
        <label class="form-label">Eyebrow Badge</label>
        <input type="text" class="form-input" id="cfg-hero-eyebrow">
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Title Line 1</label>
          <input type="text" class="form-input" id="cfg-hero-title1">
        </div>
        <div class="form-group">
          <label class="form-label">Title Line 2</label>
          <input type="text" class="form-input" id="cfg-hero-title2">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Subtitle <small>(use {total} for count)</small></label>
        <input type="text" class="form-input" id="cfg-hero-sub">
      </div>
    </div>

    <div class="config-card">
      <h2 class="card-title"><i class="fa-solid fa-palette"></i> Phase Colors</h2>
      <div class="phase-color-grid" id="phase-color-grid"></div>
    </div>

    <div class="config-card">
      <h2 class="card-title"><i class="fa-solid fa-user-pen"></i> Author Info</h2>
      <div class="author-media-row">
        <div class="author-media-card">
          <div class="author-media-label"><i class="fa-solid fa-circle-user"></i> Author Photo</div>
          <div class="author-media-wrap">
            <img id="preview-me" class="is-round" alt="Author Photo">
          </div>
          <label class="btn-outline media-upload-btn author-media-upload-btn">
            <i class="fa-solid fa-cloud-arrow-up"></i> Replace
            <input type="file" class="hidden" id="file-me" accept="image/*" onchange="Admin.uploadAsset('me', this)">
          </label>
          <code style="font-size:11px;color:var(--text3)">/assets/app/me.png</code>
        </div>
        <div class="author-media-card">
          <div class="author-media-label"><i class="fa-solid fa-image"></i> Logo</div>
          <div class="author-media-wrap">
            <img id="preview-logo" alt="Logo">
          </div>
          <label class="btn-outline media-upload-btn author-media-upload-btn">
            <i class="fa-solid fa-cloud-arrow-up"></i> Replace
            <input type="file" class="hidden" id="file-logo" accept="image/*" onchange="Admin.uploadAsset('logo', this)">
          </label>
          <code style="font-size:11px;color:var(--text3)">/assets/app/logo.png</code>
        </div>
        <div class="author-media-card">
          <div class="author-media-label"><i class="fa-solid fa-panorama"></i> Banner</div>
          <div class="author-media-wrap">
            <img id="preview-banner" alt="Banner">
          </div>
          <label class="btn-outline media-upload-btn author-media-upload-btn">
            <i class="fa-solid fa-cloud-arrow-up"></i> Replace
            <input type="file" class="hidden" id="file-banner" accept="image/*" onchange="Admin.uploadAsset('banner', this)">
          </label>
          <code style="font-size:11px;color:var(--text3)">/assets/app/banner.png</code>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Name</label>
          <input type="text" class="form-input" id="cfg-author-name">
        </div>
        <div class="form-group">
          <label class="form-label">Role</label>
          <input type="text" class="form-input" id="cfg-author-role">
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Bio</label>
        <textarea class="form-input form-textarea" id="cfg-author-bio" rows="2"></textarea>
      </div>
      <div id="author-links-list" class="author-links-list"></div>
      <button class="btn-outline btn-sm mt-2" onclick="Admin.addAuthorLink()">
        <i class="fa-solid fa-plus"></i> Add Link
      </button>
    </div>

    <div class="config-card">
      <h2 class="card-title"><i class="fa-solid fa-filter"></i> Timeline Filters</h2>
      <div id="timeline-filters-list" class="tag-list"></div>
      <button class="btn-outline btn-sm mt-2" onclick="Admin.addTimelineFilter()">
        <i class="fa-solid fa-plus"></i> Add Filter
      </button>
    </div>

    <div class="save-bar">
      <button class="btn-primary btn-lg" onclick="Admin.saveAll()">
        <i class="fa-solid fa-floppy-disk"></i> Save App Config
      </button>
    </div>
  </section>

  <!-- ── MEDIA ASSETS ───────────────────────────────────────────────────── -->
  <section id="section-media" class="content-section">
    <div class="section-head">
      <h1 class="section-title">Media Assets</h1>
      <p class="section-sub">Upload logo, banner, and author photo</p>
    </div>

    <div class="media-grid">
      <div class="media-card" data-asset="logo">
        <div class="media-label"><i class="fa-solid fa-image"></i> Logo</div>
        <div class="media-preview-wrap">
          <img id="preview-logo" class="media-preview" alt="Logo">
          <div class="media-drop-hint hidden" id="hint-logo">Drop image here</div>
        </div>
        <div class="media-info">
          <code>/assets/app/logo.png</code>
        </div>
        <label class="btn-outline media-upload-btn">
          <i class="fa-solid fa-cloud-arrow-up"></i> Replace
          <input type="file" class="hidden" id="file-logo" accept="image/*" onchange="Admin.uploadAsset('logo', this)">
        </label>
      </div>

      <div class="media-card" data-asset="banner">
        <div class="media-label"><i class="fa-solid fa-panorama"></i> Banner</div>
        <div class="media-preview-wrap">
          <img id="preview-banner" class="media-preview media-preview--wide" alt="Banner">
          <div class="media-drop-hint hidden" id="hint-banner">Drop image here</div>
        </div>
        <div class="media-info">
          <code>/assets/app/banner.png</code>
          <small>Recommended: 1200×630</small>
        </div>
        <label class="btn-outline media-upload-btn">
          <i class="fa-solid fa-cloud-arrow-up"></i> Replace
          <input type="file" class="hidden" id="file-banner" accept="image/*" onchange="Admin.uploadAsset('banner', this)">
        </label>
      </div>

      <div class="media-card" data-asset="me">
        <div class="media-label"><i class="fa-solid fa-circle-user"></i> Author Photo</div>
        <div class="media-preview-wrap">
          <img id="preview-me" class="media-preview media-preview--round" alt="Author">
          <div class="media-drop-hint hidden" id="hint-me">Drop image here</div>
        </div>
        <div class="media-info">
          <code>/assets/app/me.png</code>
          <small>Square recommended</small>
        </div>
        <label class="btn-outline media-upload-btn">
          <i class="fa-solid fa-cloud-arrow-up"></i> Replace
          <input type="file" class="hidden" id="file-me" accept="image/*" onchange="Admin.uploadAsset('me', this)">
        </label>
      </div>
    </div>
  </section>

  <!-- ── AVATARS ─────────────────────────────────────────────────────────── -->
  <section id="section-avatars" class="content-section">
    <div class="section-head">
      <h1 class="section-title">Avatars</h1>
      <p class="section-sub">Manage profile avatars</p>
    </div>

    <div class="avatars-toolbar">
      <input type="text" id="avatar-search" placeholder="Search avatars…" oninput="Admin.filterAvatars(this.value)" class="form-input toolbar-search">
      <button class="btn-primary" onclick="Admin.openAvatarModal('create')">
        <i class="fa-solid fa-plus"></i> Add Avatar
      </button>
    </div>

    <div id="avatars-grid" class="avatars-grid"></div>
    <div id="avatars-empty" class="empty-state hidden">
      <i class="fa-solid fa-users-slash"></i>
      <p>No avatars found.</p>
    </div>
  </section>

  <!-- ── PROGRESSION ─────────────────────────────────────────────────────── -->
  <section id="section-progression" class="content-section">
    <div class="section-head">
      <h1 class="section-title">Progression</h1>
      <p class="section-sub">XP values, ranks, and achievements</p>
    </div>

    <div class="config-card">
      <h2 class="card-title"><i class="fa-solid fa-star"></i> XP Values</h2>
      <div class="form-row-3">
        <div class="form-group">
          <label class="form-label">XP per Watched</label>
          <input type="number" class="form-input" id="prog-xp-watched">
        </div>
        <div class="form-group">
          <label class="form-label">Phase Completion Bonus</label>
          <input type="number" class="form-input" id="prog-phase-bonus">
        </div>
        <div class="form-group">
          <label class="form-label">Saga Completion Bonus</label>
          <input type="number" class="form-input" id="prog-saga-bonus">
        </div>
      </div>
    </div>

    <div class="config-card">
      <h2 class="card-title"><i class="fa-solid fa-ranking-star"></i> Ranks</h2>
      <div id="ranks-list" class="ranks-list"></div>
      <button class="btn-outline btn-sm mt-2" onclick="Admin.addRank()">
        <i class="fa-solid fa-plus"></i> Add Rank
      </button>
    </div>

    <div class="config-card">
      <h2 class="card-title"><i class="fa-solid fa-trophy"></i> Achievements</h2>
      <div id="achievements-list" class="achievements-admin-list"></div>
      <button class="btn-outline btn-sm mt-2" onclick="Admin.addAchievement()">
        <i class="fa-solid fa-plus"></i> Add Achievement
      </button>
    </div>
      <button class="btn-primary btn-lg" onclick="Admin.saveAll()">
        <i class="fa-solid fa-floppy-disk"></i> Save Progression
      </button>
    </div>
  </section>

  <!-- ── UI TEXT ─────────────────────────────────────────────────────────── -->
  <section id="section-ui-text" class="content-section">
    <div class="section-head">
      <h1 class="section-title">UI Text</h1>
      <p class="section-sub">Toast messages and interface copy</p>
    </div>

    <div class="config-card">
      <h2 class="card-title"><i class="fa-solid fa-comment-dots"></i> Toast Messages & Labels</h2>
      <div id="ui-text-list" class="ui-text-list"></div>
    </div>

    <div class="save-bar">
      <button class="btn-primary btn-lg" onclick="Admin.saveAll()">
        <i class="fa-solid fa-floppy-disk"></i> Save UI Text
      </button>
    </div>
  </section>

</main>

<script src="script.js"></script>
</body>
</html>
