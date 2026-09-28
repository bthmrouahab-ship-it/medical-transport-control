<?php
declare(strict_types=1);

/**
 * واجهة الخادم لموقع سيارات مجمع الثمامة: /api/index.php?r=<route>
 * GET  session | users | sync&since=N | stats-days | activity | driver-trips | push-key
 * POST login | logout | change-password | users.create | users.update | users.reset-password | write | location | stats-days.save
 *      driver-action | push-subscribe | push-unsubscribe
 */

// لا تُعرض أخطاء PHP للزائر (قد تكشف مسارات الخادم)؛ تُسجَّل في سجل الأخطاء فقط
ini_set('display_errors', '0');

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/rules.php';
require __DIR__ . '/lib/activity.php';
require __DIR__ . '/lib/push.php';
require __DIR__ . '/lib/driver.php';

/** محاولات خاطئة قبل الإيقاف: للحساب الواحد، ولعنوان الشبكة (موظفو المكتب قد يشتركون في عنوان واحد) */
const LOGIN_MAX_FAILURES = ['u' => 10, 'ip' => 50];
const LOGIN_WINDOW_SECONDS = 900;
const INVALID_LOGIN = 'اسم المستخدم أو كلمة المرور غير صحيحة';
/** السيارة تُعتبر واصلة إذا اقتربت من الوجهة هذه المسافة بالأمتار (نفس القيمة في shared/trips.ts). */
const ARRIVAL_RADIUS_M = 300;
/** موقع بدقة أسوأ من هذه (مثل تحديد الموقع من الشبكة بدل GPS) لا يُعتمد لاكتشاف الوصول. */
const ARRIVAL_MAX_ACCURACY_M = 200;

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
        'GET activity' => 'route_activity',
        'POST stats-days.save' => 'route_stats_days_save',
        'GET driver-trips' => 'route_driver_trips',
        'POST driver-action' => 'route_driver_action',
        'GET push-key' => 'route_push_key',
        'POST push-subscribe' => 'route_push_subscribe',
        'POST push-unsubscribe' => 'route_push_unsubscribe',
    ];
    $handler = $handlers["$method $route"] ?? null;
    if (!$handler) throw new ApiException(404, 'طلب غير معروف', 'not_found');
    $body = $method === 'POST' ? read_body() : [];
    $result = $handler(db(), $body);
    if (!push_queue()) send_json(200, $result);
    // إشعارات السائقين تُرسل بعد الرد، فلا ينتظرها مشرف السيارات
    respond_early(200, $result);
    try {
        flush_pushes(db());
    } catch (Throwable $error) {
        error_log('[althumama push] ' . $error);
    }
    exit;
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
        log_activity($pdo, null, 'session', 'session.failed', "محاولة دخول خاطئة باسم المستخدم $username", $username, ['ip' => client_ip()], $username);
        throw new ApiException(401, INVALID_LOGIN, 'invalid_login');
    }
    if (!$row['active']) {
        log_activity($pdo, $row, 'session', 'session.failed', 'محاولة دخول بحساب موقوف', $username, ['ip' => client_ip()]);
        throw new ApiException(403, 'هذا الحساب موقوف. تواصل مع مدير النظام.', 'disabled');
    }
    $pdo->prepare('DELETE FROM login_attempts WHERE k = ?')->execute([$keys[0]]);
    if (password_needs_rehash($row['password_hash'], PASSWORD_DEFAULT)) {
        $pdo->prepare('UPDATE users SET password_hash = ? WHERE id = ?')->execute([password_hash($password, PASSWORD_DEFAULT), $row['id']]);
    }
    start_session();
    session_regenerate_id(true);
    $_SESSION = ['uid' => (int)$row['id'], 'ver' => (int)$row['session_version'], 'last' => time()];
    log_activity($pdo, $row, 'session', 'session.login', 'تسجيل الدخول', $username, ['ip' => client_ip()]);
    return ['user' => profile($row)];
}

function route_logout(PDO $pdo): array
{
    $user = current_user($pdo, false);
    if ($user) log_activity($pdo, $user, 'session', 'session.logout', 'تسجيل الخروج', $user['username']);
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
    log_activity($pdo, $user, 'user', 'user.password', 'تغيير كلمة المرور', $user['username']);
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
    $created = user_row($pdo, (int)$pdo->lastInsertId());
    log_activity($pdo, $admin, 'user', 'user.create', "إنشاء حساب $username ($displayName) بدور " . ACTIVITY_ROLE_LABELS[$role] . ($plate ? " للسيارة $plate" : ''), $username, ['plate' => $plate ?? '']);
    return ['user' => profile($created)];
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
        $labels = [
            'display_name' => fn($value) => "الاسم: {$row['display_name']} ← $value",
            'role' => fn($value) => 'الدور: ' . (ACTIVITY_ROLE_LABELS[$row['role']] ?? $row['role']) . ' ← ' . (ACTIVITY_ROLE_LABELS[$value] ?? $value),
            'active' => fn($value) => $value ? 'تفعيل الحساب' : 'إيقاف الحساب',
            'vehicle_plate' => fn($value) => "السيارة: {$row['vehicle_plate']} ← $value",
        ];
        $changes = [];
        foreach ($fields as $field => $value) if ((string)$row[$field] !== (string)$value) $changes[] = $labels[$field]($value);
        if ($changes) log_activity($pdo, $admin, 'user', 'user.update', "تعديل حساب {$row['username']}: " . implode('، ', $changes), $row['username']);
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
    log_activity($pdo, $admin, 'user', 'user.reset_password', "إصدار كلمة مرور مؤقتة لحساب {$row['username']}", $row['username']);
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
            // الوصف قبل الحفظ (يقرأ الموعد المرتبط بالطلب كما كان)، والتسجيل بعده في نفس المعاملة
            $entry = describe_write($pdo, $col, $id, $before, $after);
            save_doc($pdo, $col, $id, $after, $rev);
            if ($entry) log_activity($pdo, empty($entry[4]) ? $user : null, $entry[0], $entry[1], $entry[2], $id, $entry[3]);
            if ($col === 'requests') queue_request_pushes($pdo, $before, $after);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        push_queue(null, true);
        throw $error;
    }
    return ['rev' => $rev];
}

function distance_m(float $lat1, float $lng1, float $lat2, float $lng2): float
{
    $dlat = deg2rad($lat2 - $lat1);
    $dlng = deg2rad($lng2 - $lng1);
    $a = sin($dlat / 2) ** 2 + cos(deg2rad($lat1)) * cos(deg2rad($lat2)) * sin($dlng / 2) ** 2;
    return 2 * 6371000 * asin(min(1.0, sqrt($a)));
}

/**
 * الطلبات التي في الطريق إلى وجهتها بهذه السيارة تُعلَّم «وصلت الوجهة» عندما تقترب منها،
 * فتظهر لمشرف السيارات وتصبح السيارة متاحة. يعيد عدد الطلبات التي وصلت.
 */
function detect_arrivals(PDO $pdo, string $plate, float $lat, float $lng, int $rev, ?array $user = null): int
{
    $like = fn(string $text) => '%' . addcslashes($text, '%_\\') . '%';
    $candidates = $pdo->prepare("SELECT id FROM docs WHERE col = 'requests' AND data LIKE ? AND data LIKE ?");
    $candidates->execute([$like('"vehiclePlate":' . json_encode($plate, JSON_UNESCAPED_UNICODE)), $like('"status":"تم استلام المريض"')]);
    $arrived = 0;
    foreach ($candidates->fetchAll(PDO::FETCH_COLUMN) as $id) {
        $lock = $pdo->prepare("SELECT data FROM docs WHERE col = 'requests' AND id = ? FOR UPDATE");
        $lock->execute([$id]);
        $doc = decode_doc($lock->fetchColumn() ?: null);
        if (!$doc || ($doc['vehiclePlate'] ?? null) !== $plate || ($doc['status'] ?? null) !== 'تم استلام المريض' || isset($doc['arrivedAt'])) continue;
        if (!is_numeric($doc['destLat'] ?? null) || !is_numeric($doc['destLng'] ?? null)) continue;
        if (distance_m($lat, $lng, (float)$doc['destLat'], (float)$doc['destLng']) > ARRIVAL_RADIUS_M) continue;
        $before = $doc;
        $doc['status'] = 'وصلت الوجهة';
        $doc['arrivedAt'] = now_iso();
        $doc['arrivalSource'] = 'gps';
        $entry = describe_write($pdo, 'requests', (string)$id, $before, $doc);
        save_doc($pdo, 'requests', (string)$id, $doc, $rev);
        if ($entry && $user) log_activity($pdo, $user, $entry[0], $entry[1], $entry[2], (string)$id, $entry[3]);
        $arrived += 1;
    }
    return $arrived;
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
        // بداية مشاركة الموقع وإيقافها (لا تُسجَّل كل نقطة موقع)
        $wasSharing = (bool)($before['sharing'] ?? false);
        if ($sharing !== $wasSharing) {
            log_activity($pdo, $user, 'location', $sharing ? 'location.start' : 'location.stop', ($sharing ? 'بدء' : 'إيقاف') . " مشاركة موقع السيارة $plate", $plate, ['plate' => $plate, 'driver' => $user['display_name']]);
        }
        $precise = $sharing && ($after['accuracy'] === null || $after['accuracy'] <= ARRIVAL_MAX_ACCURACY_M);
        $arrived = $precise ? detect_arrivals($pdo, $plate, (float)$after['lat'], (float)$after['lng'], $rev, $user) : 0;
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    return ['ok' => true, 'arrived' => $arrived];
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
    $user = current_user($pdo);
    require_role($user, ['admin']);
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
        if ($days) {
            $dates = array_column($days, 'date');
            sort($dates);
            $trips = array_sum(array_map(fn($day) => count($day['trips']), $days));
            log_activity($pdo, $user, 'stats', 'stats.import', 'استيراد ' . count($days) . " يوم ($trips رحلة) من " . $days[0]['source'] . " ({$dates[0]} إلى " . end($dates) . ')', $days[0]['source']);
        }
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    return ['saved' => count($days)];
}

// ————— سجل العمليات —————

/** العمليات في فترة (وقت ISO) من الأحدث، للمدير ومشرف السيارات. before: لتحميل الصفحة التالية. */
function route_activity(PDO $pdo): array
{
    require_role(current_user($pdo), ['admin', 'fleetSupervisor']);
    $iso = fn(string $key) => is_string($_GET[$key] ?? null) && strlen($_GET[$key]) <= 40 && strtotime($_GET[$key]) !== false ? $_GET[$key] : null;
    $limit = max(1, min(5000, (int)($_GET['limit'] ?? 500)));
    $where = [];
    $params = [];
    if ($since = $iso('since')) { $where[] = 'at >= ?'; $params[] = gmdate('Y-m-d\\TH:i:s.v\\Z', strtotime($since)); }
    if ($until = $iso('until')) { $where[] = 'at < ?'; $params[] = gmdate('Y-m-d\\TH:i:s.v\\Z', strtotime($until)); }
    if (is_numeric($_GET['before'] ?? null)) { $where[] = 'id < ?'; $params[] = (int)$_GET['before']; }
    $sql = 'SELECT id, at, user_id, user_name, user_role, type, action, ref, summary, details FROM activity'
        . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY id DESC LIMIT ' . ($limit + 1);
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $rows = $stmt->fetchAll();
    $more = count($rows) > $limit;
    $items = array_map(fn($row) => [
        'id' => (int)$row['id'],
        'at' => $row['at'],
        'userId' => $row['user_id'] === null ? null : (string)$row['user_id'],
        'userName' => $row['user_name'],
        'role' => $row['user_role'],
        'type' => $row['type'],
        'action' => $row['action'],
        'ref' => $row['ref'],
        'summary' => $row['summary'],
        'details' => $row['details'] ? (json_decode($row['details'], true) ?: (object)[]) : (object)[],
    ], array_slice($rows, 0, $limit));
    return ['items' => $items, 'more' => $more];
}
