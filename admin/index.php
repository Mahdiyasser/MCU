<?php
// ============================================================
// S.H.I.E.L.D. NEXUS — MCU Database Management Interface
// ============================================================

define('PATH_ROOT',            __DIR__ . '/../');
define('PATH_MCU_JSON',        PATH_ROOT . 'assets/mcu.json');
define('PATH_STARS_JSON',      PATH_ROOT . 'assets/stars.json');
define('PATH_DATA_JSON',       PATH_ROOT . 'assets/data.json');
define('PATH_IMG_ARCHIVE',     PATH_ROOT . 'assets/image-archive.md');
define('PATH_IMG_MCU',         PATH_ROOT . 'assets/images/mcu/');
define('PATH_IMG_STARS',       PATH_ROOT . 'assets/images/stars/');
define('PATH_IMG_PLAT',        PATH_ROOT . 'assets/images/platforms/');

define('WEB_IMG_MCU',    '/assets/images/mcu/');
define('WEB_IMG_STARS',  '/assets/images/stars/');
define('WEB_IMG_PLAT',   '/assets/images/platforms/');

header('Content-Type: text/html; charset=UTF-8');

if (isset($_GET['api'])) {
    $action = $_GET['api'];

    // SSE sets its own headers — must not send application/json before it
    if ($action !== 'sse') {
        header('Content-Type: application/json');
    }

    // ─── LOCK DIR: use same directory as the file ─────────────
    function lockPath($filePath) {
        return $filePath . '.lock';
    }

    // ─── Acquire an exclusive file lock ───────────────────────
    // Returns the open lock handle on success, or false on timeout.
    function acquireLock($lockFile, $timeoutMs = 5000) {
        $fh = fopen($lockFile, 'c');
        if (!$fh) return false;
        $start   = microtime(true);
        $timeout = $timeoutMs / 1000;
        while (!flock($fh, LOCK_EX | LOCK_NB)) {
            if ((microtime(true) - $start) >= $timeout) {
                fclose($fh);
                return false;
            }
            usleep(5000); // 5 ms
        }
        return $fh;
    }

    // ─── Release lock and clean up lock file ──────────────────
    function releaseLock($fh, $lockFile) {
        if ($fh) {
            flock($fh, LOCK_UN);
            fclose($fh);
        }
        @unlink($lockFile);
    }

    // ─── Safe read: shared lock so reads don't race a write ───
    function readJson($path) {
        if (!file_exists($path)) return null;
        $lockFile = lockPath($path);
        $fh = fopen($lockFile, 'c');
        if ($fh && flock($fh, LOCK_SH)) {
            $contents = file_get_contents($path);
            flock($fh, LOCK_UN);
            fclose($fh);
            @unlink($lockFile);
        } else {
            if ($fh) fclose($fh);
            $contents = file_get_contents($path); // fallback
        }
        return json_decode($contents, true);
    }

    // ─── Atomic write: temp file + rename ─────────────────────
    // Uses exclusive lock on .lock file, writes to .tmp, then
    // renames atomically so a crash never leaves a half-written file.
    function writeJson($path, $data) {
        $lockFile = lockPath($path);
        $tmpFile  = $path . '.tmp';
        $fh       = acquireLock($lockFile);
        if (!$fh) return false;          // couldn't get lock

        $json   = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $result = file_put_contents($tmpFile, $json, LOCK_EX);
        if ($result !== false) {
            @chmod($tmpFile, 0777);
            rename($tmpFile, $path);     // atomic on same filesystem
            @chmod($path, 0777);
        } else {
            @unlink($tmpFile);
        }

        releaseLock($fh, $lockFile);
        return $result;
    }

    // ─── Broadcast SSE event to waiting clients ───────────────
    // Writes a tiny "version" file that SSE endpoint polls.
    function broadcastChange($dataset) {
        $versionFile = __DIR__ . '/.nexus_version';
        $lockFile    = $versionFile . '.lock';
        $fh          = acquireLock($lockFile);
        $state       = [];
        if (file_exists($versionFile)) {
            $state = json_decode(file_get_contents($versionFile), true) ?: [];
        }
        $state[$dataset]      = (int)($state[$dataset] ?? 0) + 1;
        $state['_ts']         = time();
        $state['_changed']    = $dataset;
        file_put_contents($versionFile, json_encode($state));
        @chmod($versionFile, 0777);
        releaseLock($fh, $lockFile);
    }

    // ─── Clean stale lock files older than 30 s ───────────────
    function cleanStaleLocks() {
        $pattern = __DIR__ . '/../assets/*.lock';
        $locks   = glob($pattern) ?: [];
        $also    = glob(__DIR__ . '/.nexus_version.lock') ?: [];
        foreach (array_merge($locks, $also) as $lf) {
            if (file_exists($lf) && (time() - filemtime($lf)) > 30) {
                @unlink($lf);
            }
        }
    }
    cleanStaleLocks();

    function getImgExt($dir, $id) {
        foreach (['jpg','jpeg','png','webp','gif'] as $ext) {
            if (file_exists($dir . $id . '.' . $ext)) return $ext;
        }
        return 'jpg';
    }

    // ─── Rebuild image-archive.md from scratch ───────────────
    function rebuildImageArchive() {
        $mcu   = readJson(PATH_MCU_JSON);
        $stars = readJson(PATH_STARS_JSON);
        $data  = readJson(PATH_DATA_JSON);

        $maintainer  = $data['meta']['maintainer'] ?? 'Mahdi Yasser';
        $today       = date('Y-m-d');

        $mcuCount    = 0;
        $starCount   = 0;
        $platCount   = 0;

        // MCU entries table
        $mcuRows = '';
        if ($mcu && !empty($mcu['entries'])) {
            $order = array_flip($mcu['release_order'] ?? []);
            usort($mcu['entries'], function($a, $b) use ($order) {
                return ($order[$a['id']] ?? 999) - ($order[$b['id']] ?? 999);
            });
            foreach ($mcu['entries'] as $i => $e) {
                $id    = $e['id'];
                $title = $e['title'] ?? '—';
                $ext   = getImgExt(PATH_IMG_MCU, $id);
                $name  = "$id.$ext";
                $path  = WEB_IMG_MCU . $name;
                $mcuRows .= '| ' . ($i+1) . ' | `' . $id . '` | ' . $title . ' | `' . $name . '` | `' . $path . "` |\n";
                $mcuCount++;
            }
        }

        // Stars table
        $starRows = '';
        if ($stars && !empty($stars['stars'])) {
            foreach ($stars['stars'] as $s) {
                $id   = $s['id'];
                $name = $s['name'] ?? '—';
                $ext  = getImgExt(PATH_IMG_STARS, $id);
                $fn   = "$id.$ext";
                $path = WEB_IMG_STARS . $fn;
                $starRows .= '| `' . $id . '` | ' . $name . ' | `' . $fn . '` | `' . $path . "` |\n";
                $starCount++;
            }
        }

        // Platforms table
        $platRows = '';
        $platforms = $data['streaming_platforms'] ?? [];
        foreach ($platforms as $p) {
            $pid  = $p['id'];
            $pname = $p['name'];
            $logo = $p['logo'] ?? '';
            $fn   = basename($logo);
            $platRows .= '| `' . $pid . '` | ' . $pname . ' | `' . $fn . '` | `' . $logo . "` |\n";
            $platCount++;
        }

        $total = $mcuCount + $starCount + $platCount;

        $md = <<<MD
# MCU Database — Image Archive

> **Maintainer:** $maintainer
> **Last Updated:** $today
> **Auto-generated by S.H.I.E.L.D. NEXUS CMS**
>
> Reference file for every image in the database.

---

## Directory Structure

```
/assets/images/
├── mcu/          → MCU title posters
├── stars/        → Cast & crew headshots
└── platforms/    → Streaming platform logos
```

---

## 1. MCU Titles — `/assets/images/mcu/`

| # | ID | Title | Image Name | Full Path |
|---|---|---|---|---|
$mcuRows
---

## 2. Stars (Cast & Crew) — `/assets/images/stars/`

| ID | Name | Image Name | Full Path |
|---|---|---|---|
$starRows
---

## 3. Platform Logos — `/assets/images/platforms/`

| ID | Platform | Image Name | Full Path |
|---|---|---|---|
$platRows
---

## Summary

| Category | Count |
|---|---|
| MCU Title Posters | $mcuCount |
| Star Headshots | $starCount |
| Platform Logos | $platCount |
| **Total** | **$total** |

---

*Last regenerated: $today by S.H.I.E.L.D. NEXUS CMS*
MD;

        $lockFile = PATH_IMG_ARCHIVE . '.lock';
        $tmpFile  = PATH_IMG_ARCHIVE . '.tmp';
        $fh = acquireLock($lockFile);
        file_put_contents($tmpFile, $md);
        rename($tmpFile, PATH_IMG_ARCHIVE);
        @chmod(PATH_IMG_ARCHIVE, 0777);
        releaseLock($fh, $lockFile);
    }

    // ─── LOAD endpoints ──────────────────────────────────────
    if ($action === 'load_mcu')   { echo json_encode(readJson(PATH_MCU_JSON));   exit; }
    if ($action === 'load_stars') { echo json_encode(readJson(PATH_STARS_JSON)); exit; }
    if ($action === 'load_data')  { echo json_encode(readJson(PATH_DATA_JSON));  exit; }

    if ($action === 'debug') {
        echo json_encode([
            '__DIR__'       => __DIR__,
            'mcu_exists'    => file_exists(PATH_MCU_JSON),
            'stars_exists'  => file_exists(PATH_STARS_JSON),
            'data_exists'   => file_exists(PATH_DATA_JSON),
            'archive_exists'=> file_exists(PATH_IMG_ARCHIVE),
        ], JSON_PRETTY_PRINT);
        exit;
    }

    // ─── POST: save MCU entry ─────────────────────────────────
    if ($action === 'save_mcu' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $db = readJson(PATH_MCU_JSON);
        $entry = $input['entry'];
        $oldId = $input['old_id'] ?? null;
        $newId = $entry['id'];

        if (!empty($input['image_b64'])) {
            $imgData = base64_decode(preg_replace('#^data:[^;]+;base64,#', '', $input['image_b64']));
            $ext = 'jpg';
            if (preg_match('#^data:image/(\w+);#', $input['image_b64'], $m)) $ext = $m[1] === 'jpeg' ? 'jpg' : $m[1];
            foreach (['jpg','jpeg','png','webp','gif'] as $e) {
                @unlink(PATH_IMG_MCU . $newId . '.' . $e);
                if ($oldId && $oldId !== $newId) @unlink(PATH_IMG_MCU . $oldId . '.' . $e);
            }
            file_put_contents(PATH_IMG_MCU . $newId . '.' . $ext, $imgData);
            @chmod(PATH_IMG_MCU . $newId . '.' . $ext, 0777);
            $entry['image'] = WEB_IMG_MCU . $newId . '.' . $ext;
        } elseif ($oldId && $oldId !== $newId) {
            $ext = getImgExt(PATH_IMG_MCU, $oldId);
            if (file_exists(PATH_IMG_MCU . $oldId . '.' . $ext)) {
                rename(PATH_IMG_MCU . $oldId . '.' . $ext, PATH_IMG_MCU . $newId . '.' . $ext);
                @chmod(PATH_IMG_MCU . $newId . '.' . $ext, 0777);
            }
            $entry['image'] = WEB_IMG_MCU . $newId . '.' . getImgExt(PATH_IMG_MCU, $newId);
        }

        $found = false;
        foreach ($db['entries'] as &$e) {
            if ($e['id'] === ($oldId ?? $newId)) { $e = $entry; $found = true; break; }
        }
        if (!$found) $db['entries'][] = $entry;

        // Sync ID in order arrays if changed
        if ($oldId && $oldId !== $newId) {
            $db['release_order']       = array_map(fn($x) => $x === $oldId ? $newId : $x, $db['release_order']);
            $db['chronological_order'] = array_map(fn($x) => $x === $oldId ? $newId : $x, $db['chronological_order']);
            $stars = readJson(PATH_STARS_JSON);
            foreach ($stars['stars'] as &$s) {
                $s['mcu_appearances'] = array_map(fn($x) => $x === $oldId ? $newId : $x, $s['mcu_appearances'] ?? []);
            }
            writeJson(PATH_STARS_JSON, $stars);
        }

        $stars = readJson(PATH_STARS_JSON);
        $castStarIds = array_values(array_unique(array_filter(array_map(fn($c) => $c['star_id'] ?? null, $entry['cast'] ?? []))));
        foreach ($stars['stars'] as &$s) {
            $apps = $s['mcu_appearances'] ?? [];
            if ($oldId && $oldId !== $newId) {
                $apps = array_map(fn($x) => $x === $oldId ? $newId : $x, $apps);
            }
            $apps = array_values(array_filter($apps, fn($x) => $x !== $newId));
            if (in_array($s['id'], $castStarIds, true)) $apps[] = $newId;
            $s['mcu_appearances'] = array_values(array_unique($apps));
        }
        writeJson(PATH_STARS_JSON, $stars);

        // Insert into order arrays if new entry
        if (!in_array($newId, $db['release_order'])) {
            $pos = ($entry['release_order'] ?? 0) - 1;
            if ($pos >= 0 && $pos < count($db['release_order'])) {
                array_splice($db['release_order'], $pos, 0, [$newId]);
            } else {
                $db['release_order'][] = $newId;
            }
        }
        if (!in_array($newId, $db['chronological_order'])) {
            $pos = ($entry['chronological_order'] ?? 0) - 1;
            if ($pos >= 0 && $pos < count($db['chronological_order'])) {
                array_splice($db['chronological_order'], $pos, 0, [$newId]);
            } else {
                $db['chronological_order'][] = $newId;
            }
        }

        // Recalculate position numbers
        $relFlipped = array_flip($db['release_order']);
        $chrFlipped = array_flip($db['chronological_order']);
        foreach ($db['entries'] as &$e2) {
            if (isset($relFlipped[$e2['id']])) $e2['release_order']       = $relFlipped[$e2['id']] + 1;
            if (isset($chrFlipped[$e2['id']])) $e2['chronological_order'] = $chrFlipped[$e2['id']] + 1;
        }

        writeJson(PATH_MCU_JSON, $db);
        rebuildImageArchive();
        broadcastChange('mcu');
        echo json_encode(['ok' => true]);
        exit;
    }

    // ─── POST: delete MCU entry ───────────────────────────────
    if ($action === 'delete_mcu' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $id = $input['id'];
        $db = readJson(PATH_MCU_JSON);

        // Remove the entry and its position from order arrays
        $db['entries']             = array_values(array_filter($db['entries'], fn($e) => $e['id'] !== $id));
        $db['release_order']       = array_values(array_filter($db['release_order'], fn($x) => $x !== $id));
        $db['chronological_order'] = array_values(array_filter($db['chronological_order'], fn($x) => $x !== $id));

        // Delete the title's image
        foreach (['jpg','jpeg','png','webp','gif'] as $ext) @unlink(PATH_IMG_MCU . $id . '.' . $ext);

        // Remove this title from every star's mcu_appearances
        $stars = readJson(PATH_STARS_JSON);
        foreach ($stars['stars'] as &$s) {
            $s['mcu_appearances'] = array_values(array_filter($s['mcu_appearances'] ?? [], fn($x) => $x !== $id));
        }
        unset($s);
        writeJson(PATH_STARS_JSON, $stars);

        // Re-ID all remaining MCU entries following release_order
        // Phase 1: rename images to tmp_* to avoid collisions
        $tempMap = [];
        foreach ($db['entries'] as &$e) {
            $tempId = 'tmp_' . $e['id'];
            $ext    = getImgExt(PATH_IMG_MCU, $e['id']);
            if (file_exists(PATH_IMG_MCU . $e['id'] . '.' . $ext)) {
                rename(PATH_IMG_MCU . $e['id'] . '.' . $ext, PATH_IMG_MCU . $tempId . '.' . $ext);
            }
            $tempMap[$e['id']] = $tempId;
            $e['id'] = $tempId;
        }
        unset($e);
        $db['release_order']       = array_map(fn($x) => $tempMap[$x] ?? ('tmp_' . $x), $db['release_order']);
        $db['chronological_order'] = array_map(fn($x) => $tempMap[$x] ?? ('tmp_' . $x), $db['chronological_order']);

        // Phase 2: assign sequential IDs based on release_order position
        $idMap = [];
        foreach ($db['release_order'] as $pos => $tmpId) {
            $idMap[$tmpId] = sprintf('mcu_%03d', $pos + 1);
        }

        foreach ($idMap as $tmpId => $finalId) {
            $ext = getImgExt(PATH_IMG_MCU, $tmpId);
            if (file_exists(PATH_IMG_MCU . $tmpId . '.' . $ext)) {
                rename(PATH_IMG_MCU . $tmpId . '.' . $ext, PATH_IMG_MCU . $finalId . '.' . $ext);
                @chmod(PATH_IMG_MCU . $finalId . '.' . $ext, 0777);
            }
        }

        foreach ($db['entries'] as &$e) {
            $finalId   = $idMap[$e['id']] ?? $e['id'];
            $e['id']   = $finalId;
            $ext       = getImgExt(PATH_IMG_MCU, $finalId);
            $e['image'] = WEB_IMG_MCU . $finalId . '.' . $ext;
        }
        unset($e);

        $db['release_order']       = array_map(fn($x) => $idMap[$x] ?? $x, $db['release_order']);
        $db['chronological_order'] = array_map(fn($x) => $idMap[$x] ?? $x, $db['chronological_order']);

        // Recalculate position numbers
        $relFlipped = array_flip($db['release_order']);
        $chrFlipped = array_flip($db['chronological_order']);
        foreach ($db['entries'] as &$e) {
            if (isset($relFlipped[$e['id']])) $e['release_order']       = $relFlipped[$e['id']] + 1;
            if (isset($chrFlipped[$e['id']])) $e['chronological_order'] = $chrFlipped[$e['id']] + 1;
        }
        unset($e);

        // Update mcu_appearances in stars with new IDs
        $stars = readJson(PATH_STARS_JSON);
        foreach ($stars['stars'] as &$s) {
            $s['mcu_appearances'] = array_map(function($x) use ($tempMap, $idMap) {
                $tmp = $tempMap[$x] ?? ('tmp_' . $x);
                return $idMap[$tmp] ?? $x;
            }, $s['mcu_appearances'] ?? []);
        }
        unset($s);
        writeJson(PATH_STARS_JSON, $stars);

        writeJson(PATH_MCU_JSON, $db);
        rebuildImageArchive();
        broadcastChange('mcu');
        echo json_encode(['ok' => true]);
        exit;
    }

    // ─── POST: reorder MCU ────────────────────────────────────
    if ($action === 'reorder_mcu' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input     = json_decode(file_get_contents('php://input'), true);
        $orderType = $input['order_type'];
        $newOrder  = $input['order'];
        $db        = readJson(PATH_MCU_JSON);

        // Phase 1: rename all to temp IDs
        $tempMap = [];
        foreach ($db['entries'] as &$e) {
            $tempId = 'tmp_' . $e['id'];
            $ext    = getImgExt(PATH_IMG_MCU, $e['id']);
            if (file_exists(PATH_IMG_MCU . $e['id'] . '.' . $ext)) {
                rename(PATH_IMG_MCU . $e['id'] . '.' . $ext, PATH_IMG_MCU . $tempId . '.' . $ext);
            }
            $tempMap[$e['id']] = $tempId;
            $e['id'] = $tempId;
        }
        $db['release_order']       = array_map(fn($x) => $tempMap[$x] ?? $x, $db['release_order']);
        $db['chronological_order'] = array_map(fn($x) => $tempMap[$x] ?? $x, $db['chronological_order']);
        $newOrder                  = array_map(fn($x) => $tempMap[$x] ?? ('tmp_' . $x), $newOrder);

        // Phase 2: assign final IDs
        $idMap = [];
        foreach ($newOrder as $pos => $tmpId) {
            $idMap[$tmpId] = sprintf('mcu_%03d', $pos + 1);
        }

        foreach ($idMap as $tmpId => $finalId) {
            $ext = getImgExt(PATH_IMG_MCU, $tmpId);
            if (file_exists(PATH_IMG_MCU . $tmpId . '.' . $ext)) {
                rename(PATH_IMG_MCU . $tmpId . '.' . $ext, PATH_IMG_MCU . $finalId . '.' . $ext);
                @chmod(PATH_IMG_MCU . $finalId . '.' . $ext, 0777);
            }
        }

        foreach ($db['entries'] as &$e) {
            $finalId   = $idMap[$e['id']] ?? $e['id'];
            $e['id']   = $finalId;
            $ext       = getImgExt(PATH_IMG_MCU, $finalId);
            $e['image'] = WEB_IMG_MCU . $finalId . '.' . $ext;
        }

        $db[$orderType]   = array_map(fn($x) => $idMap[$x] ?? $x, $newOrder);
        $otherType        = $orderType === 'release_order' ? 'chronological_order' : 'release_order';
        $db[$otherType]   = array_map(fn($x) => $idMap[$x] ?? $x, $db[$otherType]);

        $relPos = array_flip($db['release_order']);
        $chrPos = array_flip($db['chronological_order']);
        foreach ($db['entries'] as &$e) {
            $e['release_order']       = ($relPos[$e['id']] ?? 0) + 1;
            $e['chronological_order'] = ($chrPos[$e['id']] ?? 0) + 1;
        }

        $stars = readJson(PATH_STARS_JSON);
        foreach ($stars['stars'] as &$s) {
            $s['mcu_appearances'] = array_map(function($x) use ($tempMap, $idMap) {
                $tmp = $tempMap[$x] ?? ('tmp_' . $x);
                return $idMap[$tmp] ?? $x;
            }, $s['mcu_appearances'] ?? []);
        }
        writeJson(PATH_STARS_JSON, $stars);
        writeJson(PATH_MCU_JSON, $db);
        rebuildImageArchive();
        broadcastChange('mcu');
        echo json_encode(['ok' => true, 'id_map' => $idMap]);
        exit;
    }

    // ─── POST: save order arrays directly ────────────────────
    if ($action === 'save_order_arrays' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $db    = readJson(PATH_MCU_JSON);

        if (isset($input['release_order']))       $db['release_order']       = array_values($input['release_order']);
        if (isset($input['chronological_order'])) $db['chronological_order'] = array_values($input['chronological_order']);

        $relFlipped = array_flip($db['release_order']);
        $chrFlipped = array_flip($db['chronological_order']);
        foreach ($db['entries'] as &$e) {
            if (isset($relFlipped[$e['id']])) $e['release_order']       = $relFlipped[$e['id']] + 1;
            if (isset($chrFlipped[$e['id']])) $e['chronological_order'] = $chrFlipped[$e['id']] + 1;
        }

        writeJson(PATH_MCU_JSON, $db);
        rebuildImageArchive();
        broadcastChange('mcu');
        echo json_encode(['ok' => true]);
        exit;
    }

    // ─── POST: save Star ──────────────────────────────────────
    if ($action === 'save_star' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $db    = readJson(PATH_STARS_JSON);
        $star  = $input['star'];
        $oldId = $input['old_id'] ?? null;
        $newId = $star['id'];

        if (!empty($input['image_b64'])) {
            $imgData = base64_decode(preg_replace('#^data:[^;]+;base64,#', '', $input['image_b64']));
            $ext = 'jpg';
            if (preg_match('#^data:image/(\w+);#', $input['image_b64'], $m)) $ext = $m[1] === 'jpeg' ? 'jpg' : $m[1];
            foreach (['jpg','jpeg','png','webp','gif'] as $e) {
                @unlink(PATH_IMG_STARS . $newId . '.' . $e);
                if ($oldId && $oldId !== $newId) @unlink(PATH_IMG_STARS . $oldId . '.' . $e);
            }
            file_put_contents(PATH_IMG_STARS . $newId . '.' . $ext, $imgData);
            @chmod(PATH_IMG_STARS . $newId . '.' . $ext, 0777);
            $star['image'] = WEB_IMG_STARS . $newId . '.' . $ext;
        } elseif ($oldId && $oldId !== $newId) {
            $ext = getImgExt(PATH_IMG_STARS, $oldId);
            if (file_exists(PATH_IMG_STARS . $oldId . '.' . $ext)) {
                rename(PATH_IMG_STARS . $oldId . '.' . $ext, PATH_IMG_STARS . $newId . '.' . $ext);
                @chmod(PATH_IMG_STARS . $newId . '.' . $ext, 0777);
            }
            $star['image'] = WEB_IMG_STARS . $newId . '.' . getImgExt(PATH_IMG_STARS, $newId);
        }

        $found = false;
        foreach ($db['stars'] as &$s) {
            if ($s['id'] === ($oldId ?? $newId)) { $s = $star; $found = true; break; }
        }
        if (!$found) $db['stars'][] = $star;

        $mcu = readJson(PATH_MCU_JSON);
        $selectedAppearances = $star['mcu_appearances'] ?? [];
        foreach ($mcu['entries'] as &$e) {
            if (!isset($e['cast']) || !is_array($e['cast'])) $e['cast'] = [];
            foreach ($e['cast'] as &$c) {
                if ($oldId && $oldId !== $newId && ($c['star_id'] ?? '') === $oldId) $c['star_id'] = $newId;
            }
            unset($c);

            $isSelected = in_array($e['id'], $selectedAppearances, true);
            $hasCast = false;
            foreach ($e['cast'] as $c) {
                if (($c['star_id'] ?? '') === $newId) { $hasCast = true; break; }
            }

            if ($isSelected && !$hasCast) {
                $e['cast'][] = [
                    'star_id' => $newId,
                    'character' => $star['character'] ?? '',
                    'type' => 'supporting'
                ];
            } elseif (!$isSelected && $hasCast) {
                $e['cast'] = array_values(array_filter($e['cast'], fn($c) => ($c['star_id'] ?? '') !== $newId));
            }
        }
        unset($e);
        writeJson(PATH_MCU_JSON, $mcu);

        writeJson(PATH_STARS_JSON, $db);
        rebuildImageArchive();
        broadcastChange('stars');
        echo json_encode(['ok' => true]);
        exit;
    }

    // ─── POST: delete Star ────────────────────────────────────
    if ($action === 'delete_star' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input = json_decode(file_get_contents('php://input'), true);
        $id    = $input['id'];
        $db    = readJson(PATH_STARS_JSON);

        // Remove the star entry
        $db['stars'] = array_values(array_filter($db['stars'], fn($s) => $s['id'] !== $id));

        // Delete the star's image
        foreach (['jpg','jpeg','png','webp','gif'] as $ext) @unlink(PATH_IMG_STARS . $id . '.' . $ext);

        // Remove the star's full cast block from every MCU title + strip from mcu_appearances
        $mcu = readJson(PATH_MCU_JSON);
        foreach ($mcu['entries'] as &$e) {
            if (isset($e['cast']) && is_array($e['cast'])) {
                $e['cast'] = array_values(array_filter($e['cast'], fn($c) => ($c['star_id'] ?? '') !== $id));
            }
        }
        unset($e);
        writeJson(PATH_MCU_JSON, $mcu);

        // Re-ID all remaining stars so there are no gaps
        // Phase 1: rename images to tmp_* to avoid collisions
        $tempMap = [];
        foreach ($db['stars'] as &$s) {
            $tempId = 'tmp_' . $s['id'];
            $ext    = getImgExt(PATH_IMG_STARS, $s['id']);
            if (file_exists(PATH_IMG_STARS . $s['id'] . '.' . $ext)) {
                rename(PATH_IMG_STARS . $s['id'] . '.' . $ext, PATH_IMG_STARS . $tempId . '.' . $ext);
            }
            $tempMap[$s['id']] = $tempId;
            $s['id'] = $tempId;
        }
        unset($s);

        // Phase 2: assign sequential final IDs
        $idMap = [];
        foreach ($db['stars'] as $pos => &$s) {
            $finalId      = sprintf('star_%03d', $pos + 1);
            $idMap[$s['id']] = $finalId;
            $ext          = getImgExt(PATH_IMG_STARS, $s['id']);
            if (file_exists(PATH_IMG_STARS . $s['id'] . '.' . $ext)) {
                rename(PATH_IMG_STARS . $s['id'] . '.' . $ext, PATH_IMG_STARS . $finalId . '.' . $ext);
                @chmod(PATH_IMG_STARS . $finalId . '.' . $ext, 0777);
            }
            $s['id']    = $finalId;
            $s['image'] = WEB_IMG_STARS . $finalId . '.' . getImgExt(PATH_IMG_STARS, $finalId);
        }
        unset($s);

        // Update star_id references in all MCU cast blocks
        $mcu = readJson(PATH_MCU_JSON);
        foreach ($mcu['entries'] as &$e) {
            foreach ($e['cast'] as &$c) {
                $tmp          = $tempMap[$c['star_id']] ?? ('tmp_' . $c['star_id']);
                $c['star_id'] = $idMap[$tmp] ?? $c['star_id'];
            }
            unset($c);
        }
        unset($e);
        writeJson(PATH_MCU_JSON, $mcu);

        // Update mcu_appearances in stars to use new IDs (star_id keys already fixed above;
        // mcu_appearances holds MCU title IDs so they don't need renaming here)
        writeJson(PATH_STARS_JSON, $db);
        rebuildImageArchive();
        broadcastChange('stars');
        echo json_encode(['ok' => true]);
        exit;
    }

    // ─── POST: reorder Stars ──────────────────────────────────
    if ($action === 'reorder_stars' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input    = json_decode(file_get_contents('php://input'), true);
        $newOrder = $input['order'];
        $db       = readJson(PATH_STARS_JSON);

        $tempMap = [];
        foreach ($db['stars'] as &$s) {
            $tempId = 'tmp_' . $s['id'];
            $ext    = getImgExt(PATH_IMG_STARS, $s['id']);
            if (file_exists(PATH_IMG_STARS . $s['id'] . '.' . $ext)) {
                rename(PATH_IMG_STARS . $s['id'] . '.' . $ext, PATH_IMG_STARS . $tempId . '.' . $ext);
            }
            $tempMap[$s['id']] = $tempId;
            $s['id'] = $tempId;
        }

        $newOrderTmp = array_map(fn($x) => $tempMap[$x] ?? ('tmp_' . $x), $newOrder);
        $idMap = [];
        foreach ($newOrderTmp as $pos => $tmpId) {
            $idMap[$tmpId] = sprintf('star_%03d', $pos + 1);
        }

        foreach ($idMap as $tmpId => $finalId) {
            $ext = getImgExt(PATH_IMG_STARS, $tmpId);
            if (file_exists(PATH_IMG_STARS . $tmpId . '.' . $ext)) {
                rename(PATH_IMG_STARS . $tmpId . '.' . $ext, PATH_IMG_STARS . $finalId . '.' . $ext);
                @chmod(PATH_IMG_STARS . $finalId . '.' . $ext, 0777);
            }
        }

        $orderedStars = [];
        foreach ($newOrderTmp as $tmpId) {
            foreach ($db['stars'] as $s) {
                if ($s['id'] === $tmpId) {
                    $s['id']    = $idMap[$tmpId];
                    $ext        = getImgExt(PATH_IMG_STARS, $s['id']);
                    $s['image'] = WEB_IMG_STARS . $s['id'] . '.' . $ext;
                    $orderedStars[] = $s;
                    break;
                }
            }
        }
        $db['stars'] = $orderedStars;

        $mcu = readJson(PATH_MCU_JSON);
        foreach ($mcu['entries'] as &$e) {
            foreach ($e['cast'] as &$c) {
                $tmp          = $tempMap[$c['star_id']] ?? ('tmp_' . $c['star_id']);
                $c['star_id'] = $idMap[$tmp] ?? $c['star_id'];
            }
        }

        writeJson(PATH_STARS_JSON, $db);
        writeJson(PATH_MCU_JSON, $mcu);
        rebuildImageArchive();
        broadcastChange('stars');
        echo json_encode(['ok' => true, 'id_map' => $idMap]);
        exit;
    }

    // ─── POST: save data.json (Settings) ─────────────────────
    if ($action === 'save_data' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input   = json_decode(file_get_contents('php://input'), true);
        $current = readJson(PATH_DATA_JSON) ?? [];

        // Merge selectively — only allow specific top-level keys
        $allowed = ['meta', 'about', 'watch_order_types', 'content_types', 'streaming_platforms'];
        foreach ($allowed as $key) {
            if (isset($input[$key])) $current[$key] = $input[$key];
        }
        // Always update last_updated
        $current['meta']['last_updated'] = date('Y-m-d');

        writeJson(PATH_DATA_JSON, $current);

        // Rebuild archive in case platforms changed
        rebuildImageArchive();
        broadcastChange('data');
        echo json_encode(['ok' => true]);
        exit;
    }

    // ─── POST: save raw JSON file ─────────────────────────────
    if ($action === 'save_raw_json' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input   = json_decode(file_get_contents('php://input'), true);
        $file    = $input['file'] ?? '';
        $content = $input['content'] ?? null;

        $pathMap = [
            'data'  => PATH_DATA_JSON,
            'mcu'   => PATH_MCU_JSON,
            'stars' => PATH_STARS_JSON,
        ];

        if (!isset($pathMap[$file]) || $content === null) {
            http_response_code(400);
            echo json_encode(['ok' => false, 'error' => 'Invalid file or missing content']);
            exit;
        }

        writeJson($pathMap[$file], $content);
        broadcastChange($file);
        echo json_encode(['ok' => true]);
        exit;
    }

    // ─── GET: image health check ─────────────────────────────
    if ($action === 'health_check') {
        $mcu   = readJson(PATH_MCU_JSON);
        $stars = readJson(PATH_STARS_JSON);

        $issues = [];
        $stats  = [
            'mcu_ok' => 0, 'mcu_missing' => 0, 'mcu_orphan' => 0,
            'star_ok' => 0,'star_missing'=> 0, 'star_orphan'=> 0,
        ];

        // ── MCU: missing images ───────────────────────────────
        $mcuIds = [];
        foreach ($mcu['entries'] ?? [] as $e) {
            $id = $e['id'];
            $mcuIds[] = $id;
            $found = false;
            foreach (['jpg','jpeg','png','webp','gif'] as $ex) {
                if (file_exists(PATH_IMG_MCU . $id . '.' . $ex)) { $found = true; break; }
            }
            if ($found) { $stats['mcu_ok']++; }
            else {
                $stats['mcu_missing']++;
                $issues[] = ['type'=>'missing','dataset'=>'mcu','id'=>$id,'name'=>$e['title'] ?? $id];
            }
        }

        // ── MCU: orphaned image files ─────────────────────────
        $mcuFiles = glob(PATH_IMG_MCU . '*') ?: [];
        foreach ($mcuFiles as $file) {
            $base = pathinfo($file, PATHINFO_FILENAME);
            if (!in_array($base, $mcuIds) && !str_starts_with($base, 'tmp_')) {
                $stats['mcu_orphan']++;
                $issues[] = ['type'=>'orphan','dataset'=>'mcu','id'=>$base,'name'=>basename($file)];
            }
        }

        // ── Stars: missing images ─────────────────────────────
        $starIds = [];
        foreach ($stars['stars'] ?? [] as $s) {
            $id = $s['id'];
            $starIds[] = $id;
            $found = false;
            foreach (['jpg','jpeg','png','webp','gif'] as $ex) {
                if (file_exists(PATH_IMG_STARS . $id . '.' . $ex)) { $found = true; break; }
            }
            if ($found) { $stats['star_ok']++; }
            else {
                $stats['star_missing']++;
                $issues[] = ['type'=>'missing','dataset'=>'star','id'=>$id,'name'=>$s['name'] ?? $id];
            }
        }

        // ── Stars: orphaned image files ───────────────────────
        $starFiles = glob(PATH_IMG_STARS . '*') ?: [];
        foreach ($starFiles as $file) {
            $base = pathinfo($file, PATHINFO_FILENAME);
            if (!in_array($base, $starIds) && !str_starts_with($base, 'tmp_')) {
                $stats['star_orphan']++;
                $issues[] = ['type'=>'orphan','dataset'=>'star','id'=>$base,'name'=>basename($file)];
            }
        }

        $totalOk      = $stats['mcu_ok']      + $stats['star_ok'];
        $totalMissing = $stats['mcu_missing']  + $stats['star_missing'];
        $totalOrphan  = $stats['mcu_orphan']   + $stats['star_orphan'];

        echo json_encode([
            'ok'      => true,
            'issues'  => $issues,
            'stats'   => $stats,
            'summary' => ['ok'=>$totalOk, 'missing'=>$totalMissing, 'orphan'=>$totalOrphan],
        ]);
        exit;
    }

    // ─── GET: load image-archive.md ──────────────────────────
    if ($action === 'load_archive') {
        $content = file_exists(PATH_IMG_ARCHIVE) ? file_get_contents(PATH_IMG_ARCHIVE) : '';
        echo json_encode(['content' => $content]);
        exit;
    }

    // ─── POST: save image-archive.md (manual edit) ───────────
    if ($action === 'save_archive' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        $input   = json_decode(file_get_contents('php://input'), true);
        $content = $input['content'] ?? '';
        $lockFile = PATH_IMG_ARCHIVE . '.lock';
        $tmpFile  = PATH_IMG_ARCHIVE . '.tmp';
        $fh = acquireLock($lockFile);
        file_put_contents($tmpFile, $content);
        rename($tmpFile, PATH_IMG_ARCHIVE);
        @chmod(PATH_IMG_ARCHIVE, 0777);
        releaseLock($fh, $lockFile);
        broadcastChange('data');
        echo json_encode(['ok' => true]);
        exit;
    }

    // ─── POST: rebuild image-archive.md from scratch ─────────
    if ($action === 'rebuild_archive' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        rebuildImageArchive();
        broadcastChange('data');
        $content = file_exists(PATH_IMG_ARCHIVE) ? file_get_contents(PATH_IMG_ARCHIVE) : '';
        echo json_encode(['ok' => true, 'content' => $content]);
        exit;
    }

    // ─── GET: SSE — real-time change stream ──────────────────
    // Clients connect once; server polls the version file and pushes
    // 'change' events whenever another user saves something.
    // Works on any standard shared-host PHP with no extra deps.
    if ($action === 'sse') {
        // Disable all output buffering so events flush immediately
        while (ob_get_level()) ob_end_clean();

        header('Content-Type: text/event-stream');
        header('Cache-Control: no-cache');
        header('X-Accel-Buffering: no'); // for nginx proxies
        header('Connection: keep-alive');

        $versionFile  = __DIR__ . '/.nexus_version';
        $lastSeen     = (int)($_GET['since'] ?? 0);  // client passes last ts it saw
        $startTime    = time();
        $maxRuntime   = 25;  // seconds — safely under most shared-host 30 s limits
        $pollInterval = 800000; // 0.8 s in microseconds

        // Send a heartbeat comment immediately so browser knows connection is live
        echo ": nexus-sse-connected\n\n";
        @flush();

        while ((time() - $startTime) < $maxRuntime) {
            if (connection_aborted()) break;

            if (file_exists($versionFile)) {
                $state = json_decode(file_get_contents($versionFile), true) ?: [];
                $ts    = (int)($state['_ts'] ?? 0);
                if ($ts > $lastSeen) {
                    $lastSeen = $ts;
                    $payload  = json_encode([
                        'ts'      => $ts,
                        'changed' => $state['_changed'] ?? 'unknown',
                        'v'       => [
                            'mcu'   => $state['mcu']   ?? 0,
                            'stars' => $state['stars']  ?? 0,
                            'data'  => $state['data']   ?? 0,
                        ],
                    ]);
                    echo "event: change\n";
                    echo "data: {$payload}\n\n";
                    @flush();
                }
            }

            // Heartbeat every ~10 iterations to keep connection alive
            static $hbCount = 0;
            $hbCount++;
            if ($hbCount % 12 === 0) {
                echo ": hb\n\n";
                @flush();
            }

            usleep($pollInterval);
        }

        // Tell client to reconnect immediately; it sends its last `since` value
        echo "event: reconnect\ndata: {}\n\n";
        @flush();
        exit;
    }

    echo json_encode(['error' => 'Unknown action']);
    exit;
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
  <title>S.H.I.E.L.D. NEXUS</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Barlow:wght@300;400;500;600;700&family=Barlow+Condensed:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
  <link rel="stylesheet" href="style.css">
</head>
<body>

<!-- ═══ SIDEBAR ═══ -->
<aside id="sidebar">
  <div class="sidebar-logo">
    <div class="logo-emblem"><i class="fa-solid fa-shield-halved"></i></div>
    <div class="logo-text">
      <span class="logo-main">S.H.I.E.L.D.</span>
      <span class="logo-sub">NEXUS</span>
    </div>
  </div>
  <nav class="sidebar-nav">
    <div class="nav-section-label">CONTENT</div>
    <button class="nav-item active" data-tab="titles" onclick="switchTab('titles')">
      <i class="fa-solid fa-film"></i><span>Titles</span><span class="nav-count" id="nav-count-titles">—</span>
    </button>
    <button class="nav-item" data-tab="stars" onclick="switchTab('stars')">
      <i class="fa-solid fa-star"></i><span>Stars</span><span class="nav-count" id="nav-count-stars">—</span>
    </button>
    <div class="nav-section-label">TOOLS</div>
    <button class="nav-item" data-tab="reorder" onclick="switchTab('reorder')">
      <i class="fa-solid fa-arrows-up-down"></i><span>Reorder</span>
    </button>
    <button class="nav-item" data-tab="bulk-reorder" onclick="switchTab('bulk-reorder')">
      <i class="fa-solid fa-table-list"></i><span>Bulk Mapper</span>
    </button>
    <button class="nav-item" data-tab="order-edit" onclick="switchTab('order-edit')">
      <i class="fa-solid fa-list-ol"></i><span>Order Arrays</span>
    </button>
    <div class="nav-section-label">SYSTEM</div>
    <button class="nav-item" data-tab="mcu" onclick="switchTab('mcu')">
      <i class="fa-solid fa-shield-halved"></i><span>MCU</span>
    </button>
    <button class="nav-item" data-tab="settings" onclick="switchTab('settings')">
      <i class="fa-solid fa-gear"></i><span>Settings</span>
    </button>
    <button class="nav-item" data-tab="overview" onclick="switchTab('overview')">
      <i class="fa-solid fa-database"></i><span>Overview</span>
    </button>
    <button class="nav-item" data-tab="json-editor" onclick="switchTab('json-editor')">
      <i class="fa-solid fa-code"></i><span>JSON Editor</span>
    </button>
  </nav>
  <div class="sidebar-footer">
    <div class="save-status" id="save-status" onclick="openChangesModal()" title="Click to view unsaved changes">
      <i class="fa-solid fa-circle-check"></i><span id="save-status-text">All saved</span>
    </div>
  </div>
</aside>

<!-- ═══ MAIN CONTENT ═══ -->
<div id="main-content">
  <header id="topbar">
    <div class="topbar-left">
      <button class="sidebar-toggle" onclick="toggleSidebar()"><i class="fa-solid fa-bars"></i></button>
      <div class="breadcrumb" id="breadcrumb">Titles</div>
    </div>
    <div class="topbar-right">
      <div class="search-wrap">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="global-search" placeholder="Search…" oninput="handleGlobalSearch(this.value)">
      </div>
      <button class="topbar-btn btn-ghost-sm" id="btn-bust-cache" onclick="bustImageCache()" title="Bust image cache — force reload all images with new timestamp">
        <i class="fa-solid fa-rotate"></i><span class="btn-label"> Reload Images</span>
      </button>
      <button class="topbar-btn btn-ghost-sm" id="btn-reset-edits" onclick="resetUnsavedChanges()" title="Discard unsaved changes in MCU/Settings tabs">
        <i class="fa-solid fa-rotate-left"></i><span class="btn-label"> Reset</span>
      </button>
      <button class="topbar-btn btn-primary-sm" id="btn-add-new" onclick="openAddNew()">
        <i class="fa-solid fa-plus"></i><span class="btn-label"> Add New</span>
      </button>
    </div>
  </header>

  <!-- ══ TAB: TITLES ══ -->
  <section id="tab-titles" class="tab active">
    <div class="tab-toolbar">
      <div class="filter-chips">
        <button class="chip active" data-filter="all" onclick="filterTitles('all',this)">All</button>
        <button class="chip" data-filter="movie" onclick="filterTitles('movie',this)"><i class="fa-solid fa-film"></i> Movies</button>
        <button class="chip" data-filter="series" onclick="filterTitles('series',this)"><i class="fa-solid fa-tv"></i> Series</button>
        <button class="chip" data-filter="special_presentation" onclick="filterTitles('special_presentation',this)"><i class="fa-solid fa-wand-sparkles"></i> Specials</button>
      </div>
      <div class="view-toggles">
        <button class="view-btn active" id="view-grid" onclick="setView('grid')"><i class="fa-solid fa-grip"></i></button>
        <button class="view-btn" id="view-list" onclick="setView('list')"><i class="fa-solid fa-list"></i></button>
      </div>
    </div>
    <div id="titles-container" class="cards-grid"></div>
  </section>

  <!-- ══ TAB: STARS ══ -->
  <section id="tab-stars" class="tab">
    <div class="tab-toolbar">
      <span class="toolbar-info" id="stars-count-label">Loading…</span>
    </div>
    <div id="stars-container" class="cards-grid stars-grid-view"></div>
  </section>

  <!-- ══ TAB: REORDER ══ -->
  <section id="tab-reorder" class="tab">
    <div class="reorder-header">
      <div class="reorder-mode-group">
        <label class="mode-label">Dataset</label>
        <div class="toggle-group">
          <button class="tgl active" id="reo-titles-btn" onclick="setReorderDataset('titles',this)"><i class="fa-solid fa-film"></i> Titles</button>
          <button class="tgl" id="reo-stars-btn" onclick="setReorderDataset('stars',this)"><i class="fa-solid fa-star"></i> Stars</button>
        </div>
      </div>
      <div class="reorder-mode-group" id="reo-order-wrap">
        <label class="mode-label">Order</label>
        <div class="toggle-group">
          <button class="tgl active" id="reo-release-btn" onclick="setReorderType('release_order',this)">Release</button>
          <button class="tgl" id="reo-chrono-btn" onclick="setReorderType('chronological_order',this)">Chrono</button>
          <button class="tgl" id="reo-universe-btn" onclick="setReorderType('in_universe_year',this)">In-Universe</button>
        </div>
      </div>
      <button class="topbar-btn btn-ghost-sm" id="reo-auto-sort-btn" onclick="sortReorderByDate()"><i class="fa-solid fa-calendar-days"></i> <span class="btn-label">Auto Sort</span></button>
      <button class="topbar-btn btn-primary-sm" onclick="applyReorder()"><i class="fa-solid fa-floppy-disk"></i> <span class="btn-label">Apply &amp; Re-ID</span></button>
    </div>
    <p class="reorder-hint"><i class="fa-solid fa-circle-info"></i> Titles can auto-sort by release date or in-universe year; unparseable in-universe rows are highlighted. Stars auto-sort only by first MCU appearance release date, with alphabetic ties.</p>
    <div id="reorder-list" class="reorder-list"></div>
  </section>

  <!-- ══ TAB: BULK MAPPER ══ -->
  <section id="tab-bulk-reorder" class="tab">
    <div class="reorder-header">
      <div class="reorder-mode-group">
        <label class="mode-label">Dataset</label>
        <div class="toggle-group">
          <button class="tgl active" id="bulk-titles-btn" onclick="setBulkDataset('titles',this)"><i class="fa-solid fa-film"></i> Titles</button>
          <button class="tgl" id="bulk-stars-btn" onclick="setBulkDataset('stars',this)"><i class="fa-solid fa-star"></i> Stars</button>
        </div>
      </div>
      <div class="reorder-mode-group">
        <label class="mode-label">Map Field</label>
        <select class="form-select bulk-map-select" id="bulk-field-select" onchange="setBulkMapField(this.value)"></select>
      </div>
      <button class="topbar-btn btn-ghost-sm" onclick="toggleBulkSelectAll(true)"><i class="fa-solid fa-check-double"></i> <span class="btn-label">Select All</span></button>
      <button class="topbar-btn btn-ghost-sm" onclick="toggleBulkSelectAll(false)"><i class="fa-solid fa-xmark"></i> <span class="btn-label">Clear</span></button>
      <button class="topbar-btn btn-primary-sm" onclick="applyBulkMapping()"><i class="fa-solid fa-wand-magic-sparkles"></i> <span class="btn-label">Apply Mapping</span></button>
    </div>
    <p class="reorder-hint"><i class="fa-solid fa-circle-info"></i> Bulk Mapper now maps shared values onto many selected records at once. Reordering lives in the Reorder tab.</p>
    <div class="bulk-mapper-layout">
      <div class="bulk-source">
        <div class="bulk-col-title"><i class="fa-solid fa-layer-group"></i> Records</div>
        <div id="bulk-source-list" class="bulk-source-list"></div>
      </div>
      <div class="bulk-arrows"><i class="fa-solid fa-arrow-right-arrow-left"></i></div>
      <div class="bulk-target">
        <div class="bulk-col-title"><i class="fa-solid fa-diagram-project"></i> Mapping Value</div>
        <div id="bulk-target-list" class="bulk-target-list"></div>
      </div>
    </div>
  </section>

  <!-- ══ TAB: ORDER ARRAYS EDITOR ══ -->
  <section id="tab-order-edit" class="tab">
    <div class="reorder-header">
      <div class="reorder-mode-group">
        <label class="mode-label">Viewing</label>
        <div class="toggle-group">
          <button class="tgl active" id="oa-release-btn" onclick="setOrderArrayType('release_order',this)"><i class="fa-solid fa-list-ol"></i> Release</button>
          <button class="tgl" id="oa-chrono-btn" onclick="setOrderArrayType('chronological_order',this)"><i class="fa-solid fa-clock-rotate-left"></i> Chrono</button>
        </div>
      </div>
      <span class="order-array-status" id="oa-status"></span>
      <button class="topbar-btn btn-ghost-sm" onclick="resetOrderArray()"><i class="fa-solid fa-rotate-left"></i> <span class="btn-label">Reset</span></button>
      <button class="topbar-btn btn-primary-sm" onclick="saveOrderArrays()"><i class="fa-solid fa-floppy-disk"></i> <span class="btn-label">Save</span></button>
    </div>
    <p class="reorder-hint"><i class="fa-solid fa-circle-info"></i> Use arrows or the bolt button to jump a title to any numbered slot. Saving updates entry position numbers automatically.</p>
    <div id="order-array-list" class="reorder-list oa-list"></div>
  </section>

  <!-- ══ TAB: SETTINGS ══ -->
  <section id="tab-mcu" class="tab">
    <div class="settings-grid" id="mcu-grid"></div>
  </section>

  <!-- ══ TAB: SETTINGS ══ -->
  <section id="tab-settings" class="tab">
    <div class="settings-grid" id="settings-grid"></div>
  </section>

  <!-- ══ TAB: OVERVIEW ══ -->
  <section id="tab-overview" class="tab">
    <div class="overview-grid">
      <div class="stat-card"><i class="fa-solid fa-film stat-icon txt-red"></i><div class="stat-val" id="ov-movies">—</div><div class="stat-label">Movies</div></div>
      <div class="stat-card"><i class="fa-solid fa-tv stat-icon txt-gold"></i><div class="stat-val" id="ov-series">—</div><div class="stat-label">Series</div></div>
      <div class="stat-card"><i class="fa-solid fa-wand-sparkles stat-icon txt-blue"></i><div class="stat-val" id="ov-specials">—</div><div class="stat-label">Specials</div></div>
      <div class="stat-card"><i class="fa-solid fa-star stat-icon txt-red"></i><div class="stat-val" id="ov-stars">—</div><div class="stat-label">Stars</div></div>
      <div class="stat-card"><i class="fa-solid fa-shield-halved stat-icon txt-gold"></i><div class="stat-val" id="ov-total">—</div><div class="stat-label">Total Titles</div></div>
      <div class="stat-card"><i class="fa-solid fa-layer-group stat-icon txt-blue"></i><div class="stat-val" id="ov-phases">—</div><div class="stat-label">Phases</div></div>
    </div>
    <div class="overview-phase-table">
      <h3 class="section-heading"><i class="fa-solid fa-table-cells-large"></i> Phase Breakdown</h3>
      <div id="phase-table"></div>
    </div>
    <div class="overview-json-preview">
      <h3 class="section-heading"><i class="fa-solid fa-code"></i> JSON Health</h3>
      <div id="json-health"></div>
    </div>
    <div class="overview-json-preview overview-wide">
      <h3 class="section-heading"><i class="fa-solid fa-timeline"></i> Release Timeline</h3>
      <div id="overview-timeline" class="overview-timeline"></div>
    </div>
    <div class="overview-json-preview">
      <h3 class="section-heading"><i class="fa-solid fa-chart-pie"></i> Content Mix</h3>
      <div id="overview-mix" class="overview-mix"></div>
    </div>
    <div class="overview-json-preview">
      <h3 class="section-heading"><i class="fa-solid fa-user-group"></i> Cast Coverage</h3>
      <div id="overview-cast"></div>
    </div>
  </section>

  <!-- ══ TAB: JSON EDITOR ══ -->
  <section id="tab-json-editor" class="tab">
    <div id="json-editor-container" style="height:100%;display:flex;flex-direction:column"></div>
  </section>
</div>

<!-- ═══ MOBILE BOTTOM NAV ═══ -->
<nav id="mobile-nav">
  <button class="mob-nav-btn active" data-tab="titles" onclick="switchTab('titles')"><i class="fa-solid fa-film"></i><span>Titles</span></button>
  <button class="mob-nav-btn" data-tab="stars" onclick="switchTab('stars')"><i class="fa-solid fa-star"></i><span>Stars</span></button>
  <button class="mob-nav-btn" data-tab="reorder" onclick="switchTab('reorder')"><i class="fa-solid fa-arrows-up-down"></i><span>Reorder</span></button>
  <button class="mob-nav-btn" data-tab="settings" onclick="switchTab('settings')"><i class="fa-solid fa-gear"></i><span>Settings</span></button>
  <button class="mob-nav-btn" onclick="toggleMobileMenu()"><i class="fa-solid fa-ellipsis"></i><span>More</span></button>
</nav>

<!-- ═══ MOBILE MORE MENU ═══ -->
<div id="mobile-more-overlay" class="hidden" onclick="toggleMobileMenu()">
  <div class="mobile-more-menu" onclick="event.stopPropagation()">
    <div class="mobile-more-header">More Tools</div>
    <button class="mobile-more-item" onclick="toggleMobileMenu();switchTab('bulk-reorder')"><i class="fa-solid fa-table-list"></i> Bulk Mapper</button>
    <button class="mobile-more-item" onclick="toggleMobileMenu();switchTab('order-edit')"><i class="fa-solid fa-list-ol"></i> Order Arrays</button>
    <button class="mobile-more-item" onclick="toggleMobileMenu();switchTab('mcu')"><i class="fa-solid fa-shield-halved"></i> MCU</button>
    <button class="mobile-more-item" onclick="toggleMobileMenu();switchTab('overview')"><i class="fa-solid fa-database"></i> Overview</button>
  </div>
</div>

<!-- ═══ MODAL ═══ -->
<div id="modal-overlay" class="modal-overlay hidden" onclick="closeModal(event)">
  <div class="modal-box" onclick="event.stopPropagation()">
    <button class="modal-close" onclick="closeModal()"><i class="fa-solid fa-xmark"></i></button>
    <div id="modal-content"></div>
  </div>
</div>

<!-- ═══ FAST REORDER MODAL ═══ -->
<div id="fast-reorder-overlay" class="modal-overlay hidden" onclick="closeFastReorder(event)">
  <div class="modal-box fast-reorder-box" onclick="event.stopPropagation()">
    <button class="modal-close" onclick="closeFastReorder()"><i class="fa-solid fa-xmark"></i></button>
    <div class="fast-reorder-header"><i class="fa-solid fa-bolt txt-gold"></i> Fast Jump</div>
    <div class="fast-reorder-hint">Moving: <strong id="fast-reorder-item-name"></strong></div>
    <div id="fast-reorder-list" class="fast-reorder-list"></div>
  </div>
</div>

<!-- ═══ TOAST ═══ -->
<div id="toast-stack"></div>

<!-- ═══ CONFIRM ═══ -->
<div id="confirm-overlay" class="modal-overlay hidden">
  <div class="modal-box confirm-box">
    <div class="confirm-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
    <div id="confirm-message">Are you sure?</div>
    <div class="confirm-actions">
      <button class="btn-ghost-sm" onclick="confirmCancel()">Cancel</button>
      <button class="btn-danger" onclick="confirmOk()">Delete</button>
    </div>
  </div>
</div>

<script src="script.js"></script>
</body>
</html>
