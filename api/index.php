<?php
declare(strict_types=1);

/**
 * واجهة الخادم لموقع سيارات مجمع الثمامة: /api/index.php?r=<route>
 * GET  session | users | sync&since=N | stats-days | activity | driver-trips | push-key | guests-stats
 * POST login | logout | change-password | users.create | users.update | users.reset-password | write | location | stats-days.save
 *      driver-action | push-subscribe | push-unsubscribe | guests.import
 */

// لا تُعرض أخطاء PHP للزائر (قد تكشف مسارات الخادم)؛ تُسجَّل في سجل الأخطاء فقط
ini_set('display_errors', '0');

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/rules.php';
require __DIR__ . '/lib/activity.php';
require __DIR__ . '/lib/push.php';
require __DIR__ . '/lib/driver.php';
require __DIR__ . '/lib/drivers.php';

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
        'POST guests.import' => 'route_guests_import',
        'POST private-cars.import' => 'route_private_cars_import',
        'POST special-needs.import' => 'route_special_needs_import',
        'GET guests-stats' => 'route_guests_stats',
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
    // حساب السائق يُربط بسائق من قائمة السائقين (اختياري)، وسيارته يخصصها مشرف السيارات لسائقه
    $driverId = $role === 'driver' ? driver_id_of($body['driverId'] ?? null) : null;
    $exists = $pdo->prepare('SELECT 1 FROM users WHERE username = ?');
    $exists->execute([$username]);
    if ($exists->fetchColumn()) throw new ApiException(409, 'اسم المستخدم مستخدم مسبقًا', 'exists');
    $pdo->beginTransaction();
    try {
        $pdo->prepare('INSERT INTO users (username, display_name, role, active, must_change_password, password_hash, created_at, created_by)
            VALUES (?, ?, ?, 1, 1, ?, ?, ?)')
            ->execute([$username, $displayName, $role, password_hash($password, PASSWORD_DEFAULT), now_iso(), $admin['username']]);
        $id = (int)$pdo->lastInsertId();
        $link = $driverId !== null ? link_driver_account($pdo, (string)$id, $driverId, next_revision($pdo)) : ['to' => null];
        log_activity($pdo, $admin, 'user', 'user.create', "إنشاء حساب $username ($displayName) بدور " . ACTIVITY_ROLE_LABELS[$role] . ($link['to'] ? " للسائق {$link['to']}" : ''), $username, ['driver' => $link['to'] ?? '']);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    return ['user' => profile(user_row($pdo, $id))];
}

/** رقم سائق من الطلب: نص صالح، أو null (بلا سائق) */
function driver_id_of($value): ?string
{
    if ($value === null || $value === '') return null;
    if (!is_string($value) || !valid_doc_id($value)) throw new ApiException(400, 'اختر سائقًا من قائمة السائقين', 'invalid');
    return $value;
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
    // المدير لا يستطيع إيقاف نفسه أو سحب صلاحية المدير من نفسه
    if ((int)$row['id'] === (int)$admin['id'] && ((isset($fields['role']) && $fields['role'] !== 'admin') || (isset($fields['active']) && !$fields['active']))) {
        throw new ApiException(403, 'لا يمكنك إيقاف حسابك أو تغيير دورك', 'permission_denied');
    }
    $role = $fields['role'] ?? $row['role'];
    // ربط حساب السائق بسائق من القائمة (أو إلغاؤه)؛ الحساب الذي لم يعد سائقًا يُلغى ربطه
    $relink = array_key_exists('driverId', $changes) || ($row['role'] === 'driver' && $role !== 'driver');
    $driverId = $role === 'driver' && array_key_exists('driverId', $changes) ? driver_id_of($changes['driverId']) : null;
    $pdo->beginTransaction();
    try {
        $log = [];
        if ($fields) {
            $set = implode(', ', array_map(fn($field) => "$field = ?", array_keys($fields)));
            $pdo->prepare("UPDATE users SET $set WHERE id = ?")->execute([...array_values($fields), $row['id']]);
            $labels = [
                'display_name' => fn($value) => "الاسم: {$row['display_name']} ← $value",
                'role' => fn($value) => 'الدور: ' . (ACTIVITY_ROLE_LABELS[$row['role']] ?? $row['role']) . ' ← ' . (ACTIVITY_ROLE_LABELS[$value] ?? $value),
                'active' => fn($value) => $value ? 'تفعيل الحساب' : 'إيقاف الحساب',
            ];
            foreach ($fields as $field => $value) if ((string)$row[$field] !== (string)$value) $log[] = $labels[$field]($value);
        }
        if ($relink || isset($fields['role'])) {
            $link = $relink ? link_driver_account($pdo, (string)$row['id'], $driverId, next_revision($pdo)) : null;
            // تغيّر الدور: سيارة الحساب تتبع دوره الجديد
            if (!$relink) normalize_fleet_drivers($pdo, next_revision($pdo));
            if ($link && $link['from'] !== $link['to']) $log[] = 'السائق: ' . ($link['from'] ?? 'بلا سائق') . ' ← ' . ($link['to'] ?? 'بلا سائق');
        }
        if ($log) log_activity($pdo, $admin, 'user', 'user.update', "تعديل حساب {$row['username']}: " . implode('، ', $log), $row['username']);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
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
 * السائق لا يرى بيانات المرضى، لذلك المزامنة لموظفي المكتب فقط، وقائمة الضيوف للمدير والعيادة
 * بلا العمر والرقم الصحي (sync_collections وpublic_doc في rules.php).
 */
function route_sync(PDO $pdo): array
{
    $user = current_user($pdo);
    require_role($user, OFFICE_ROLES);
    $since = max(0, (int)($_GET['since'] ?? 0));
    $rev = current_revision($pdo);
    if ($since > $rev) $since = 0;
    $collections = sync_collections($user);
    $marks = implode(', ', array_fill(0, count($collections), '?'));
    $sql = "SELECT col, id, data FROM docs WHERE rev > ? AND rev <= ? AND col IN ($marks)" . ($since === 0 ? ' AND data IS NOT NULL' : '');
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$since, $rev, ...$collections]);
    $docs = [];
    // شقق السيارات الخاصة: علامة privateCar مع ضيوفها
    $privateUnits = private_car_units();
    foreach ($stmt as $row) $docs[] = ['col' => $row['col'], 'id' => $row['id'], 'data' => public_doc($row['col'], decode_doc($row['data']), $privateUnits)];
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
    // المستند المحفوظ (بما حُفظ قبله في نفس الدفعة): الموعد لطلبات السيارات الجديدة، والضيف والمستشفى لمواعيد العيادة.
    // بلا رقم: أي مستند من المجموعة (لمعرفة هل هي فارغة)
    $docOf = function (string $col, ?string $id) use ($pdo): ?array {
        if ($id === null) {
            $stmt = $pdo->prepare('SELECT data FROM docs WHERE col = ? AND data IS NOT NULL LIMIT 1');
            $stmt->execute([$col]);
        } else {
            $stmt = $pdo->prepare('SELECT data FROM docs WHERE col = ? AND id = ?');
            $stmt->execute([$col, $id]);
        }
        return decode_doc($stmt->fetchColumn() ?: null);
    };
    $pdo->beginTransaction();
    try {
        $rev = next_revision($pdo);
        $fleetChanged = false;
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
                // علامتا «أقل من 18 سنة» و«سيارة خاصة» تضيفهما المزامنة (public_doc) ولا تُحفظان
                if ($col === 'guests') unset($after['minor'], $after['privateCar'], $after['specialNeeds']);
            } elseif ($kind === 'update') {
                if ($before === null) throw new ApiException(409, 'تغيّر هذا العنصر أو حُذف من مستخدم آخر. حدّث الصفحة وحاول مرة أخرى.', 'conflict');
                $after = $before;
                foreach ((array)($op['set'] ?? []) as $field => $value) $after[(string)$field] = $value;
                foreach ((array)($op['unset'] ?? []) as $field) unset($after[(string)$field]);
                if ($col === 'guests') unset($after['minor'], $after['privateCar'], $after['specialNeeds']);
            } elseif ($kind === 'delete') {
                if ($before === null) continue;
                $after = null;
            } else {
                throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
            }
            if ($error = authorize_write($user, $col, $id, $before, $after, $docOf)) throw new ApiException(403, $error, 'permission_denied');
            // الوصف قبل الحفظ (يقرأ الموعد المرتبط بالطلب كما كان)، والتسجيل بعده في نفس المعاملة
            $entry = describe_write($pdo, $col, $id, $before, $after);
            save_doc($pdo, $col, $id, $after, $rev);
            if ($entry) log_activity($pdo, empty($entry[4]) ? $user : null, $entry[0], $entry[1], $entry[2], $id, $entry[3]);
            if ($col === 'requests') queue_request_pushes($pdo, $before, $after);
            if ($col === 'fleet' || $col === 'drivers') $fleetChanged = true;
            // شقة أُضيفت إلى السيارات الخاصة أو حُذفت منها: يُعاد إرسال ضيوفها بالعلامة الجديدة
            if ($col === 'privateCars') {
                private_car_units(true);
                $units = [];
                foreach ([$before, $after] as $car) if ($car) $units[unit_key($car['buildingNumber'] ?? '', $car['apartmentNumber'] ?? '')] = true;
                touch_unit_guests($pdo, $units, $rev);
            }
            // ربط صاحب احتياجات خاصة بضيف أو حذفه: يُعاد إرسال الضيف بالعلامة الجديدة
            if ($col === 'specialNeeds') {
                special_needs_index(true);
                $ids = $health = [];
                foreach ([$before, $after] as $entry) {
                    if (!$entry) continue;
                    if (!empty($entry['guestId'])) $ids[(string)$entry['guestId']] = true;
                    if (($key = health_key($entry['healthNumber'] ?? '')) !== '') $health[$key] = true;
                }
                touch_guests($pdo, $ids, $health, $rev);
            }
        }
        // اسم السائق ورقمه في السيارات، والسائق في سيارة واحدة، وحسابات السائقين تتبع سياراتهم
        if ($fleetChanged) normalize_fleet_drivers($pdo, $rev);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        push_queue(null, true);
        throw $error;
    }
    return ['rev' => $rev];
}

/** نفس المحتوى بغض النظر عن ترتيب الخانات (بلا خانة الترتيب _o) */
function same_doc(?array $a, ?array $b): bool
{
    if ($a === null || $b === null) return $a === $b;
    unset($a['_o'], $b['_o']);
    ksort($a);
    ksort($b);
    return $a === $b;
}

/**
 * رفع قائمة ضيوف المجمع من ملف Excel (المدير): الضيف الموجود بنفس الرقم يُحدَّث، والجديد يُضاف،
 * و«remove» ضيوف غير موجودين في الملف يُحذفون إن اختار المدير ذلك. كلها أو لا شيء، وعملية واحدة في السجل.
 */
function route_guests_import(PDO $pdo, array $body): array
{
    $user = current_user($pdo);
    require_role($user, ['admin']);
    $guests = $body['guests'] ?? null;
    $remove = $body['remove'] ?? [];
    if (!is_array($guests) || !array_is_list($guests) || count($guests) > 10000 || !is_array($remove) || !array_is_list($remove) || count($remove) > 10000) {
        throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
    }
    $pdo->beginTransaction();
    try {
        $rev = next_revision($pdo);
        $existing = [];
        foreach ($pdo->query("SELECT id, data FROM docs WHERE col = 'guests' AND data IS NOT NULL FOR UPDATE") as $row) $existing[(string)$row['id']] = decode_doc($row['data']);
        $added = $updated = $unchanged = $removed = 0;
        $seen = [];
        foreach ($guests as $index => $guest) {
            $id = is_array($guest) ? (string)($guest['id'] ?? '') : '';
            if (is_array($guest)) unset($guest['minor'], $guest['privateCar'], $guest['specialNeeds']);
            if (!valid_doc_id($id) || isset($seen[$id]) || !valid_guest($guest, $id)) {
                throw new ApiException(400, 'بيانات الضيف رقم ' . ($index + 1) . ' في الملف غير صالحة', 'invalid');
            }
            $seen[$id] = true;
            $before = $existing[$id] ?? null;
            $doc = $guest;
            $doc['_o'] = $before['_o'] ?? $index;
            if (same_doc($before, $doc)) {
                $unchanged += 1;
                continue;
            }
            save_doc($pdo, 'guests', $id, $doc, $rev);
            if ($before === null) $added += 1;
            else $updated += 1;
        }
        foreach ($remove as $id) {
            if (!is_string($id) || !isset($existing[$id]) || isset($seen[$id])) continue;
            save_doc($pdo, 'guests', $id, null, $rev);
            $removed += 1;
        }
        // ملف الضيوف أو قائمة الممرضات (kind: nurses)
        $nurses = ($body['kind'] ?? '') === 'nurses';
        $summary = ($nurses ? 'رفع قائمة الممرضات' : 'رفع قائمة الضيوف') . ": $added جديد، $updated تحديث، $unchanged بلا تغيير" . ($removed ? "، وحذف $removed غير موجودين في الملف" : '');
        log_activity($pdo, $user, 'guest', 'guest.import', $summary, '', ['changes' => (string)count($guests) . ($nurses ? ' ممرضة في الملف' : ' ضيف في الملف')]);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    return ['added' => $added, 'updated' => $updated, 'unchanged' => $unchanged, 'removed' => $removed];
}

/**
 * رفع قائمة السيارات الخاصة من ملف Excel (المدير): تحل محل القائمة الحالية كلها. ضيوف كل شقة فيها (صاحب السيارة
 * وعائلته) لا يُضاف لهم موعد، ويبقون في قائمة الضيوف. كلها أو لا شيء، وعملية واحدة في السجل.
 */
function route_private_cars_import(PDO $pdo, array $body): array
{
    $user = current_user($pdo);
    require_role($user, ['admin']);
    $entries = $body['entries'] ?? null;
    if (!is_array($entries) || !array_is_list($entries) || count($entries) > 5000) throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
    $pdo->beginTransaction();
    try {
        $rev = next_revision($pdo);
        $units = [];
        foreach ($pdo->query("SELECT id, data FROM docs WHERE col = 'privateCars' AND data IS NOT NULL FOR UPDATE") as $row) {
            $car = decode_doc($row['data']);
            if ($car) $units[unit_key($car['buildingNumber'] ?? '', $car['apartmentNumber'] ?? '')] = true;
            save_doc($pdo, 'privateCars', (string)$row['id'], null, $rev);
        }
        $stamp = base_convert((string)time(), 10, 36);
        $added = [];
        foreach ($entries as $index => $entry) {
            $id = "PC-$stamp-" . ($index + 1);
            $doc = is_array($entry) ? array_intersect_key($entry, array_flip(['name', 'plate', 'buildingNumber', 'apartmentNumber'])) : [];
            foreach ($doc as $field => $value) if (is_string($value)) $doc[$field] = trim($value);
            $doc = array_filter($doc, fn($value) => $value !== '');
            $doc = ['id' => $id] + $doc + ['_o' => $index];
            if (!valid_private_car($doc, $id)) throw new ApiException(400, 'بيانات السيارة الخاصة رقم ' . ($index + 1) . ' في الملف غير صالحة', 'invalid');
            save_doc($pdo, 'privateCars', $id, $doc, $rev);
            $key = unit_key($doc['buildingNumber'], $doc['apartmentNumber']);
            $units[$key] = true;
            $added[$key] = true;
        }
        // ضيوف الشقق القديمة والجديدة يُعاد إرسالهم بالعلامة الصحيحة
        private_car_units(true);
        touch_unit_guests($pdo, $units, $rev);
        $guests = 0;
        foreach ($pdo->query("SELECT data FROM docs WHERE col = 'guests' AND data IS NOT NULL") as $row) {
            if (guest_has_private_car(decode_doc($row['data']))) $guests += 1;
        }
        $summary = 'رفع قائمة السيارات الخاصة: ' . count($entries) . ' سيارة في ' . count($added) . " شقة، ويُمنع $guests ضيفًا يسكنون فيها من سيارات المجمع";
        log_activity($pdo, $user, 'guest', 'guest.private_cars', $summary, '', ['changes' => count($entries) . ' سيارة']);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    return ['cars' => count($entries), 'units' => count($added), 'guests' => $guests];
}

/** كلمات الاسم الإنجليزي للمطابقة (حرفان فأكثر) */
function name_tokens($name): array
{
    $words = preg_split('/[^a-z]+/', strtolower((string)$name), -1, PREG_SPLIT_NO_EMPTY) ?: [];
    return array_values(array_unique(array_filter($words, fn($word) => strlen($word) > 1)));
}

/**
 * ضيف القائمة لصاحب الاحتياجات الخاصة: برقمه الصحي، وإلا بالاسم الإنجليزي (كلمتان مشتركتان على الأقل) في نفس المبنى والشقة.
 * يعيد [رقم الضيف، طريقة المطابقة] أو [null، null].
 */
function match_special_need(array $entry, array $guests): array
{
    $health = health_key($entry['healthNumber'] ?? '');
    if ($health !== '') {
        foreach ($guests as $guest) if (health_key($guest['healthNumber'] ?? '') === $health) return [(string)$guest['id'], 'health'];
    }
    $unit = unit_key($entry['buildingNumber'] ?? '', $entry['apartmentNumber'] ?? '');
    $words = name_tokens($entry['name'] ?? '');
    $found = [];
    foreach ($guests as $guest) {
        if (unit_key($guest['buildingNumber'] ?? '', $guest['apartmentNumber'] ?? '') !== $unit) continue;
        $guestWords = array_merge(name_tokens($guest['nameEn'] ?? ''), name_tokens($guest['name'] ?? ''));
        if (count(array_intersect($words, $guestWords)) >= 2) $found[] = (string)$guest['id'];
    }
    return count($found) === 1 ? [$found[0], 'name'] : [null, null];
}

/**
 * رفع قائمة ذوي الاحتياجات الخاصة (المدير): تحل محل القائمة الحالية كلها، ويُطابق كل شخص بضيف من القائمة (الرقم الصحي
 * ثم الاسم والشقة). dryRun: المراجعة فقط بلا حفظ. صاحب الاحتياجات الخاصة مستثنى من منع السيارات الخاصة.
 */
function route_special_needs_import(PDO $pdo, array $body): array
{
    $user = current_user($pdo);
    require_role($user, ['admin']);
    $entries = $body['entries'] ?? null;
    if (!is_array($entries) || !array_is_list($entries) || count($entries) > 5000) throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
    $dryRun = ($body['dryRun'] ?? false) === true;
    $guests = [];
    foreach ($pdo->query("SELECT id, data FROM docs WHERE col = 'guests' AND data IS NOT NULL") as $row) {
        $guest = decode_doc($row['data']);
        if ($guest && ($guest['nurse'] ?? null) !== true) $guests[(string)$row['id']] = ['id' => (string)$row['id']] + $guest;
    }
    $units = private_car_units();
    $stamp = base_convert((string)time(), 10, 36);
    $docs = [];
    $rows = [];
    $counts = ['health' => 0, 'name' => 0, 'unmatched' => 0, 'privateCar' => 0];
    foreach ($entries as $index => $entry) {
        $id = "SN-$stamp-" . ($index + 1);
        $doc = is_array($entry) ? array_intersect_key($entry, array_flip(['name', 'gender', 'healthNumber', 'buildingNumber', 'apartmentNumber', 'mobile'])) : [];
        foreach ($doc as $field => $value) if (is_string($value)) $doc[$field] = trim($value);
        $doc = array_filter($doc, fn($value) => $value !== '' && $value !== null);
        [$guestId, $how] = match_special_need($doc, $guests);
        $doc = ['id' => $id] + $doc + ($guestId ? ['guestId' => $guestId] : []) + ['_o' => $index];
        if (!valid_special_need($doc, $id)) throw new ApiException(400, 'بيانات الشخص رقم ' . ($index + 1) . ' في الملف غير صالحة', 'invalid');
        $guest = $guestId ? $guests[$guestId] : null;
        $counts[$how ?? 'unmatched'] += 1;
        // يسكن في شقة لها سيارة خاصة: يُستثنى من المنع
        if ($guest && isset($units[unit_key($guest['buildingNumber'] ?? '', $guest['apartmentNumber'] ?? '')])) $counts['privateCar'] += 1;
        $docs[$id] = $doc;
        $rows[] = ['row' => $index, 'match' => $how, 'guestId' => $guestId, 'guestName' => $guest['name'] ?? null,
            'guestUnit' => $guest ? ($guest['buildingNumber'] ?? '') . '/' . ($guest['apartmentNumber'] ?? '') : null];
    }
    if ($dryRun) return ['rows' => $rows, 'counts' => $counts];
    $pdo->beginTransaction();
    try {
        $rev = next_revision($pdo);
        $ids = $health = [];
        foreach ($pdo->query("SELECT id, data FROM docs WHERE col = 'specialNeeds' AND data IS NOT NULL FOR UPDATE") as $row) {
            $old = decode_doc($row['data']);
            if (!empty($old['guestId'])) $ids[(string)$old['guestId']] = true;
            if (($key = health_key($old['healthNumber'] ?? '')) !== '') $health[$key] = true;
            save_doc($pdo, 'specialNeeds', (string)$row['id'], null, $rev);
        }
        foreach ($docs as $id => $doc) {
            save_doc($pdo, 'specialNeeds', $id, $doc, $rev);
            if (!empty($doc['guestId'])) $ids[$doc['guestId']] = true;
            if (($key = health_key($doc['healthNumber'] ?? '')) !== '') $health[$key] = true;
        }
        // ضيوف القائمة القديمة والجديدة يُعاد إرسالهم بالعلامة الصحيحة
        special_needs_index(true);
        touch_guests($pdo, $ids, $health, $rev);
        $matched = $counts['health'] + $counts['name'];
        $summary = 'رفع قائمة ذوي الاحتياجات الخاصة: ' . count($docs) . " شخصًا، طوبق منهم $matched بضيوف القائمة" . ($counts['privateCar'] ? "، ويُستثنى {$counts['privateCar']} يسكنون في شقق لها سيارة خاصة" : '');
        log_activity($pdo, $user, 'guest', 'guest.special_needs', $summary, '', ['changes' => count($docs) . ' شخصًا']);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    return ['rows' => $rows, 'counts' => $counts, 'saved' => count($docs)];
}

/** قائمة الضيوف كاملة مع العمر والرقم الصحي: للإحصائيات فقط (المدير ومشرف السيارات). */
function route_guests_stats(PDO $pdo): array
{
    require_role(current_user($pdo), GUEST_STATS_ROLES);
    $guests = [];
    foreach ($pdo->query("SELECT data FROM docs WHERE col = 'guests' AND data IS NOT NULL") as $row) {
        $guest = decode_doc($row['data']);
        if (!$guest) continue;
        unset($guest['_o']);
        $guests[] = $guest;
    }
    return ['guests' => $guests];
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
    if ($plate === '' || !valid_doc_id($plate)) throw new ApiException(400, NO_VEHICLE_MESSAGE, 'no_vehicle');
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
                // اسم السائق من قائمة السائقين (المرتبط بالحساب)، وإلا الاسم الظاهر للحساب
                'driver' => account_driver($pdo, (string)$user['id'])['name'] ?? $user['display_name'],
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
