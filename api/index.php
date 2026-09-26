<?php
declare(strict_types=1);

/**
 * واجهة الخادم لموقع سيارات مجمع الثمامة: /api/index.php?r=<route>
 * GET  session | users | sync&since=N | stats-days
 * POST login | logout | change-password | users.create | users.update | users.reset-password | write | location | stats-days.save
 */

// لا تُعرض أخطاء PHP للزائر (قد تكشف مسارات الخادم)؛ تُسجَّل في سجل الأخطاء فقط
ini_set('display_errors', '0');

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/rules.php';

/** محاولات خاطئة قبل الإيقاف: للحساب الواحد، ولعنوان الشبكة (موظفو المكتب قد يشتركون في عنوان واحد) */
const LOGIN_MAX_FAILURES = ['u' => 10, 'ip' => 50];
const LOGIN_WINDOW_SECONDS = 900;
const INVALID_LOGIN = 'اسم المستخدم أو كلمة المرور غير صحيحة';

try {
    $route = (string)($_GET['r'] ?? '');
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    $handlers = [
        'GET session' => 'route_session',
        'POST login' => 'route_login',
        'POST logout' => 'route_logout',
        'POST change-password' => 'route_change_password',
        'GET users' => 'route_users',
        'POST users.create' => 'route_users_create',
        'POST users.update' => 'route_users_update',
        'POST users.reset-password' => 'route_users_reset_password',
        'GET sync' => 'route_sync',
        'POST write' => 'route_write',
        'POST location' => 'route_location',
        'GET stats-days' => 'route_stats_days',
        'POST stats-days.save' => 'route_stats_days_save',
    ];
    $handler = $handlers["$method $route"] ?? null;
    if (!$handler) throw new ApiException(404, 'طلب غير معروف', 'not_found');
    $body = $method === 'POST' ? read_body() : [];
    send_json(200, $handler(db(), $body));
} catch (ApiException $error) {
    send_json($error->status, ['error' => $error->getMessage(), 'code' => $error->errorCode]);
} catch (Throwable $error) {
    error_log('[althumama] ' . $error);
    send_json(500, ['error' => 'حدث خطأ في الخادم. حاول مرة أخرى.', 'code' => 'server_error']);
}

// ————— الدخول والجلسة —————

function route_session(PDO $pdo): array
{
    $row = current_user($pdo, false);
    return ['user' => $row ? profile($row) : null];
}

function client_ip(): string
{
    return substr((string)($_SERVER['REMOTE_ADDR'] ?? 'unknown'), 0, 64);
}

/** يمنع تخمين كلمات المرور: 10 محاولات خاطئة لنفس الحساب خلال 15 دقيقة توقف دخوله 15 دقيقة. */
function login_locked(PDO $pdo, array $keys): bool
{
    $stmt = $pdo->prepare('SELECT MAX(locked_until) FROM login_attempts WHERE k IN (?, ?)');
    $stmt->execute($keys);
    return (int)$stmt->fetchColumn() > time();
}

function record_failure(PDO $pdo, array $keys): void
{
    $now = time();
    foreach ($keys as $key) {
        $stmt = $pdo->prepare('SELECT failures, first_at FROM login_attempts WHERE k = ?');
        $stmt->execute([$key]);
        $row = $stmt->fetch();
        $failures = ($row && $now - (int)$row['first_at'] < LOGIN_WINDOW_SECONDS) ? (int)$row['failures'] + 1 : 1;
        $firstAt = $failures === 1 ? $now : (int)$row['first_at'];
        $limit = LOGIN_MAX_FAILURES[strtok($key, ':')] ?? 10;
        $locked = $failures >= $limit ? $now + LOGIN_WINDOW_SECONDS : 0;
        $pdo->prepare('REPLACE INTO login_attempts (k, failures, first_at, locked_until) VALUES (?, ?, ?, ?)')
            ->execute([$key, $failures, $firstAt, $locked]);
    }
}

function route_login(PDO $pdo, array $body): array
{
    $username = normalize_username((string)($body['username'] ?? ''));
    $password = (string)($body['password'] ?? '');
    if ($username === '' || $password === '' || validate_username($username) || strlen($password) > 128) {
        throw new ApiException(400, INVALID_LOGIN, 'invalid_login');
    }
    ensure_schema($pdo);
    $keys = ['u:' . $username, 'ip:' . client_ip()];
    if (login_locked($pdo, $keys)) {
        throw new ApiException(429, 'تم إيقاف المحاولات مؤقتًا بسبب كثرة المحاولات الخاطئة. حاول بعد 15 دقيقة.', 'too_many_requests');
    }
    $stmt = $pdo->prepare('SELECT * FROM users WHERE username = ?');
    $stmt->execute([$username]);
    $row = $stmt->fetch() ?: null;
    // مقارنة بكلمة وهمية عند عدم وجود المستخدم حتى لا يكشف الوقت وجود الحساب
    $hash = $row['password_hash'] ?? '$2y$12$LwJvaQEaoJOk3CKtNkbcbOinzMLNyUDkK1NjAbGZ4V8jQrwW/tosK';
    if (!password_verify($password, $hash) || !$row) {
        record_failure($pdo, $keys);
        throw new ApiException(401, INVALID_LOGIN, 'invalid_login');
    }
    if (!$row['active']) throw new ApiException(403, 'هذا الحساب موقوف. تواصل مع مدير النظام.', 'disabled');
    $pdo->prepare('DELETE FROM login_attempts WHERE k = ?')->execute([$keys[0]]);
    if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $row['id']]);
    }
    start_session();
    session_regenerate_id(true);
    $_SESSION = ['uid' => (int)$row['id'], 'ver' => (int)$row['session_version'], 'last' => time()];
    return ['user' => profile($row)];
}

function route_logout(PDO $pdo): array
{
    end_session();
    return ['ok' => true];
}

function route_change_password(PDO $pdo, array $body): array
{
    $user = current_user($pdo, true, true);
    $current = (string)($body['current'] ?? '');
    $next = (string)($body['next'] ?? '');
    if (!password_verify($current, $user['password_hash'])) throw new ApiException(400, 'كلمة المرور الحالية غير صحيحة.', 'wrong_password');
    if ($error = validate_password($next)) throw new ApiException(400, $error, 'weak_password');
    if ($current === $next) throw new ApiException(400, 'اختر كلمة مرور مختلفة عن الحالية.', 'same_password');
    $version = (int)$user['session_version'] + 1;
    $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 0, session_version = ? WHERE id = ?')
        ->execute([password_hash($next, PASSWORD_DEFAULT), $version, $user['id']]);
    // الجلسات الأخرى لهذا الحساب تنتهي، وتبقى الجلسة الحالية
    session_regenerate_id(true);
    $_SESSION['ver'] = $version;
    return ['user' => profile(user_row($pdo, (int)$user['id']))];
}

// ————— المستخدمون (المدير) —————

function route_users(PDO $pdo): array
{
    require_role(current_user($pdo), ['admin']);
    $rows = $pdo->query('SELECT * FROM users ORDER BY username')->fetchAll();
    return ['users' => array_map('profile', $rows)];
}

function vehicle_exists(PDO $pdo, string $plate): bool
{
    $stmt = $pdo->prepare("SELECT 1 FROM docs WHERE col = 'fleet' AND id = ? AND data IS NOT NULL");
    $stmt->execute([$plate]);
    return (bool)$stmt->fetchColumn();
}

function route_users_create(PDO $pdo, array $body): array
{
    $admin = current_user($pdo);
    require_role($admin, ['admin']);
    $username = normalize_username((string)($body['username'] ?? ''));
    if ($error = validate_username($username)) throw new ApiException(400, $error, 'invalid');
    $displayName = validate_display_name((string)($body['displayName'] ?? ''));
    $role = (string)($body['role'] ?? '');
    if (!in_array($role, ROLES, true)) throw new ApiException(400, 'اختر دورًا صحيحًا', 'invalid');
    $password = (string)($body['password'] ?? '');
    if ($error = validate_password($password)) throw new ApiException(400, $error, 'invalid');
    $plate = $role === 'driver' ? trim((string)($body['vehiclePlate'] ?? '')) : null;
    if ($role === 'driver' && ($plate === '' || !vehicle_exists($pdo, $plate))) throw new ApiException(400, 'اختر السيارة المرتبطة بالسائق', 'invalid');
    $exists = $pdo->prepare('SELECT 1 FROM users WHERE username = ?');
    $exists->execute([$username]);
    if ($exists->fetchColumn()) throw new ApiException(409, 'اسم المستخدم مستخدم مسبقًا', 'exists');
    $pdo->prepare('INSERT INTO users (username, display_name, role, active, must_change_password, vehicle_plate, password_hash, created_at, created_by)
        VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?)')
        ->execute([$username, $displayName, $role, $plate, password_hash($password, PASSWORD_DEFAULT), now_iso(), $admin['username']]);
    return ['user' => profile(user_row($pdo, (int)$pdo->lastInsertId()))];
}

function target_user(PDO $pdo, array $body): array
{
    $row = user_row($pdo, (int)($body['uid'] ?? 0));
    if (!$row) throw new ApiException(404, 'المستخدم غير موجود', 'not_found');
    return $row;
}

function route_users_update(PDO $pdo, array $body): array
{
    $admin = current_user($pdo);
    require_role($admin, ['admin']);
    $row = target_user($pdo, $body);
    $changes = is_array($body['changes'] ?? null) ? $body['changes'] : [];
    $fields = [];
    if (array_key_exists('displayName', $changes)) $fields['display_name'] = validate_display_name((string)$changes['displayName']);
    if (array_key_exists('role', $changes)) {
        if (!in_array($changes['role'], ROLES, true)) throw new ApiException(400, 'اختر دورًا صحيحًا', 'invalid');
        $fields['role'] = $changes['role'];
    }
    if (array_key_exists('active', $changes)) {
        if (!is_bool($changes['active'])) throw new ApiException(400, 'قيمة غير صالحة', 'invalid');
        $fields['active'] = $changes['active'] ? 1 : 0;
    }
    if (array_key_exists('vehiclePlate', $changes)) {
        $plate = trim((string)$changes['vehiclePlate']);
        if (!vehicle_exists($pdo, $plate)) throw new ApiException(400, 'اختر السيارة المرتبطة بالسائق', 'invalid');
        $fields['vehicle_plate'] = $plate;
    }
    // المدير لا يستطيع إيقاف نفسه أو سحب صلاحية المدير من نفسه
    if ((int)$row['id'] === (int)$admin['id'] && ((isset($fields['role']) && $fields['role'] !== 'admin') || (isset($fields['active']) && !$fields['active']))) {
        throw new ApiException(403, 'لا يمكنك إيقاف حسابك أو تغيير دورك', 'permission_denied');
    }
    $role = $fields['role'] ?? $row['role'];
    $plate = $fields['vehicle_plate'] ?? $row['vehicle_plate'];
    if ($role === 'driver' && !$plate) throw new ApiException(400, 'اختر السيارة المرتبطة بالسائق', 'invalid');
    if ($fields) {
        $set = implode(', ', array_map(fn($field) => "$field = ?", array_keys($fields)));
        $pdo->prepare("UPDATE users SET $set WHERE id = ?")->execute([...array_values($fields), $row['id']]);
    }
    return ['user' => profile(user_row($pdo, (int)$row['id']))];
}

/** كلمة مرور مؤقتة جديدة: تتوقف القديمة فورًا وتنتهي كل جلسات المستخدم. */
function route_users_reset_password(PDO $pdo, array $body): array
{
    $admin = current_user($pdo);
    require_role($admin, ['admin']);
    $row = target_user($pdo, $body);
    if ((int)$row['id'] === (int)$admin['id']) throw new ApiException(400, 'غيّر كلمة مرورك من «تغيير كلمة المرور»', 'invalid');
    $password = (string)($body['password'] ?? '');
    if ($error = validate_password($password)) throw new ApiException(400, $error, 'invalid');
    $pdo->prepare('UPDATE users SET password_hash = ?, must_change_password = 1, session_version = session_version + 1 WHERE id = ?')
        ->execute([password_hash($password, PASSWORD_DEFAULT), $row['id']]);
    return ['user' => profile(user_row($pdo, (int)$row['id']))];
}

// ————— البيانات المشتركة —————

function current_revision(PDO $pdo): int
{
    return (int)$pdo->query('SELECT value FROM revision WHERE id = 1')->fetchColumn();
}

/** رقم مراجعة جديد لكل عملية حفظ؛ يرتّب الكتابات فتعرف المزامنة ما تغيّر منذ آخر مرة. */
function next_revision(PDO $pdo): int
{
    $pdo->exec('UPDATE revision SET value = value + 1 WHERE id = 1');
    return current_revision($pdo);
}

function encode_doc(array $data): string
{
    return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function decode_doc(?string $data): ?array
{
    if ($data === null) return null;
    $value = json_decode($data, true);
    return is_array($value) ? $value : null;
}

function valid_doc_id(string $id): bool
{
    return (bool)preg_match('/^[A-Za-z0-9._:-]{1,160}$/', $id);
}

function save_doc(PDO $pdo, string $col, string $id, ?array $data, int $rev): void
{
    $pdo->prepare('INSERT INTO docs (col, id, data, rev) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), rev = VALUES(rev)')
        ->execute([$col, $id, $data === null ? null : encode_doc($data), $rev]);
}

/**
 * التغييرات منذ مراجعة معيّنة (since=0: كل البيانات). المحذوف يرجع data = null.
 * السائق لا يرى بيانات المرضى، لذلك المزامنة لموظفي المكتب فقط.
 */
function route_sync(PDO $pdo): array
{
    require_role(current_user($pdo), OFFICE_ROLES);
    $since = max(0, (int)($_GET['since'] ?? 0));
    $rev = current_revision($pdo);
    if ($since > $rev) $since = 0;
    $marks = implode(', ', array_fill(0, count(SYNC_COLLECTIONS), '?'));
    $sql = "SELECT col, id, data FROM docs WHERE rev > ? AND rev <= ? AND col IN ($marks)" . ($since === 0 ? ' AND data IS NOT NULL' : '');
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$since, $rev, ...SYNC_COLLECTIONS]);
    $docs = [];
    foreach ($stmt as $row) $docs[] = ['col' => $row['col'], 'id' => $row['id'], 'data' => decode_doc($row['data'])];
    return ['rev' => $rev, 'full' => $since === 0, 'docs' => $docs];
}

/**
 * حفظ مجموعة عمليات دفعة واحدة (كلها أو لا شيء). كل عملية:
 * { col, id, op: "set", data } أو { col, id, op: "update", set: {...}, unset: [...] } أو { col, id, op: "delete" }
 */
function route_write(PDO $pdo, array $body): array
{
    $user = current_user($pdo);
    require_role($user, OFFICE_ROLES);
    $ops = $body['ops'] ?? null;
    if (!is_array($ops) || !array_is_list($ops) || count($ops) > 3000) throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
    $pdo->beginTransaction();
    try {
        $rev = next_revision($pdo);
        foreach ($ops as $op) {
            $col = (string)($op['col'] ?? '');
            $id = (string)($op['id'] ?? '');
            $kind = (string)($op['op'] ?? '');
            if (!in_array($col, SYNC_COLLECTIONS, true) || !valid_doc_id($id)) throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
            $stmt = $pdo->prepare('SELECT data FROM docs WHERE col = ? AND id = ? FOR UPDATE');
            $stmt->execute([$col, $id]);
            $before = decode_doc($stmt->fetchColumn() ?: null);
            if ($kind === 'set') {
                $after = $op['data'] ?? null;
                if (!is_array($after) || ($after && array_is_list($after))) throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
            } elseif ($kind === 'update') {
                if ($before === null) throw new ApiException(409, 'تغيّر هذا العنصر أو حُذف من مستخدم آخر. حدّث الصفحة وحاول مرة أخرى.', 'conflict');
                $after = $before;
                foreach ((array)($op['set'] ?? []) as $field => $value) $after[(string)$field] = $value;
                foreach ((array)($op['unset'] ?? []) as $field) unset($after[(string)$field]);
            } elseif ($kind === 'delete') {
                if ($before === null) continue;
                $after = null;
            } else {
                throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
            }
            if ($error = authorize_write($user, $col, $id, $before, $after)) throw new ApiException(403, $error, 'permission_denied');
            save_doc($pdo, $col, $id, $after, $rev);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    return ['rev' => $rev];
}

/** السائق يرسل موقع سيارته فقط (السيارة من حسابه، لا من الطلب). */
function route_location(PDO $pdo, array $body): array
{
    $user = current_user($pdo);
    require_role($user, ['driver']);
    $plate = (string)($user['vehicle_plate'] ?? '');
    if ($plate === '' || !valid_doc_id($plate)) throw new ApiException(400, 'لم يربط مدير النظام حسابك بسيارة بعد.', 'no_vehicle');
    $sharing = (bool)($body['sharing'] ?? false);
    $pdo->beginTransaction();
    try {
        $rev = next_revision($pdo);
        $stmt = $pdo->prepare("SELECT data FROM docs WHERE col = 'vehicleLocations' AND id = ? FOR UPDATE");
        $stmt->execute([$plate]);
        $before = decode_doc($stmt->fetchColumn() ?: null);
        if ($sharing) {
            $lat = $body['lat'] ?? null;
            $lng = $body['lng'] ?? null;
            if (!is_numeric($lat) || !is_numeric($lng) || abs((float)$lat) > 90 || abs((float)$lng) > 180) throw new ApiException(400, 'موقع غير صالح', 'invalid');
            $number = fn($value) => is_numeric($value) ? round((float)$value) : null;
            $after = [
                'plate' => $plate,
                'lat' => (float)$lat,
                'lng' => (float)$lng,
                'accuracy' => $number($body['accuracy'] ?? null),
                'speed' => $number($body['speed'] ?? null),
                'heading' => $number($body['heading'] ?? null),
                'driver' => $user['display_name'],
                'sharing' => true,
                'updatedAt' => now_iso(),
            ];
        } elseif ($before !== null) {
            $after = ['sharing' => false, 'updatedAt' => now_iso()] + $before;
        } else {
            $pdo->commit();
            return ['ok' => true];
        }
        save_doc($pdo, 'vehicleLocations', $plate, $after, $rev);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    return ['ok' => true];
}

// ————— الإحصائيات: رحلات ملفات Excel يومًا بيوم (بلا بيانات مرضى) —————

function route_stats_days(PDO $pdo): array
{
    require_role(current_user($pdo), ['admin', 'fleetSupervisor']);
    $days = [];
    foreach ($pdo->query("SELECT data FROM docs WHERE col = 'statsDays' AND data IS NOT NULL ORDER BY id") as $row) {
        if ($day = decode_doc($row['data'])) $days[] = $day;
    }
    return ['days' => $days];
}

function route_stats_days_save(PDO $pdo, array $body): array
{
    require_role(current_user($pdo), ['admin']);
    $days = $body['days'] ?? null;
    if (!is_array($days) || !array_is_list($days) || count($days) > 400) throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
    $pdo->beginTransaction();
    try {
        $rev = next_revision($pdo);
        foreach ($days as $day) {
            $valid = is_array($day) && !array_diff(array_keys($day), ['date', 'source', 'importedAt', 'trips'])
                && is_string($day['date'] ?? null) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $day['date'])
                && is_text($day['source'] ?? null, 200)
                && is_array($day['trips'] ?? null) && array_is_list($day['trips']) && count($day['trips']) <= 3000;
            if (!$valid) throw new ApiException(400, 'بيانات الإحصائيات غير صالحة', 'bad_request');
            save_doc($pdo, 'statsDays', $day['date'], $day, $rev);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    return ['saved' => count($days)];
}
