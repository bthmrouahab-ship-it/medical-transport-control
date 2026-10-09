<?php
declare(strict_types=1);

/**
 * أساس الخادم: الإعداد، الاتصال بقاعدة البيانات، الجلسة، وردود JSON.
 * لا يُطبع أي شيء عند طلب هذا الملف مباشرة.
 */

const ROLES = ['admin', 'clinic', 'clinicLead', 'buildingSupervisor', 'buildingLead', 'fleetSupervisor', 'driver'];
const OFFICE_ROLES = ['admin', 'clinic', 'clinicLead', 'buildingSupervisor', 'buildingLead', 'fleetSupervisor'];
/** العيادة ومسؤولها (يوافق على المواعيد قبل ظهورها لمشرف المبنى) */
const CLINIC_ROLES = ['clinic', 'clinicLead'];
/** مشرف المبنى، ومسؤول مشرفي المباني (نفس الصلاحيات، ويتابع كل الطلبات لا طلباته فقط) */
const BUILDING_ROLES = ['buildingSupervisor', 'buildingLead'];
/** خروج تلقائي بعد ساعة بلا نشاط */
const IDLE_SECONDS = 3600;
/**
 * نسخة قاعدة البيانات (settings.schema): 2 = فصل السائقين عن السيارات (migrate_drivers في drivers.php)،
 * 3 = سجل السيارات في الخدمة ووقت تسجيل المواعيد للإحصائيات (migrate_tracking في tracking.php)
 */
const SCHEMA_VERSION = 4;
/** أقصى حجم لطلب واحد (رفع ملف إحصائيات كبير يُقسَّم على عدة طلبات) */
const MAX_BODY_BYTES = 8 * 1024 * 1024;

final class ApiException extends Exception
{
    public function __construct(public readonly int $status, string $message, public readonly string $errorCode = 'error')
    {
        parent::__construct($message);
    }
}

/** ملف الإعداد: خارج public_html إن أمكن، وإلا داخل api/. */
function config_paths(): array
{
    $paths = [];
    $root = $_SERVER['DOCUMENT_ROOT'] ?? '';
    if ($root !== '') $paths[] = dirname(rtrim($root, '/')) . '/althumama-config.php';
    $paths[] = dirname(__DIR__) . '/config.php';
    return $paths;
}

function load_config(): ?array
{
    foreach (config_paths() as $path) {
        if (is_file($path)) {
            $config = require $path;
            if (is_array($config)) return $config;
        }
    }
    return null;
}

function db(): PDO
{
    static $pdo = null;
    if ($pdo) return $pdo;
    $config = load_config();
    if (!$config) throw new ApiException(503, 'لم يُضبط الموقع بعد. افتح صفحة الإعداد /api/setup.php', 'not_configured');
    $pdo = connect_db($config['db']);
    // المواقع المضبوطة قبل إضافة جداول أو خانات أو تغيير شكل البيانات تُرقّى هنا مرة واحدة (خارج أي معاملة)
    try {
        $version = (int)$pdo->query("SELECT v FROM settings WHERE k = 'schema'")->fetchColumn();
    } catch (PDOException $error) {
        // جدول الإعدادات غير موجود (موقع قديم): يُرقّى. أي خطأ آخر (انقطاع مؤقت في قاعدة البيانات) يُرد كخطأ في الخادم،
        // ولا يُعاد ترحيل البيانات بسببه
        if ($error->getCode() !== '42S02') throw $error;
        $version = 0;
    }
    if ($version < SCHEMA_VERSION) upgrade_schema($pdo);
    return $pdo;
}

/** الجداول الجديدة (سجل العمليات، ثم إشعارات السائقين ولغتها)، ثم ترحيل البيانات. طلب واحد يرقّي، والطلبات معه تنتظره. */
function upgrade_schema(PDO $pdo): void
{
    $pdo->query("SELECT GET_LOCK('althumama_schema', 30)")->fetchColumn();
    try {
        ensure_schema($pdo);
        $version = (int)$pdo->query("SELECT v FROM settings WHERE k = 'schema'")->fetchColumn();
        if ($version < 2) migrate_drivers($pdo);
        if ($version < 3) migrate_tracking($pdo);
        $pdo->prepare("INSERT INTO settings (k, v) VALUES ('schema', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)")->execute([(string)SCHEMA_VERSION]);
    } finally {
        $pdo->query("SELECT RELEASE_LOCK('althumama_schema')")->fetchColumn();
    }
}

function connect_db(array $db): PDO
{
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $db['host'] ?? 'localhost', (int)($db['port'] ?? 3306), $db['name']);
    return new PDO($dsn, $db['user'], $db['password'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);
}

/** إنشاء الجداول إن لم تكن موجودة. */
function ensure_schema(PDO $pdo): void
{
    $options = 'ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
    $pdo->exec("CREATE TABLE IF NOT EXISTS users (
        id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        username VARCHAR(32) NOT NULL UNIQUE,
        display_name VARCHAR(60) NOT NULL,
        role VARCHAR(20) NOT NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        must_change_password TINYINT(1) NOT NULL DEFAULT 1,
        vehicle_plate VARCHAR(20) NULL,
        password_hash VARCHAR(255) NOT NULL,
        session_version INT UNSIGNED NOT NULL DEFAULT 1,
        created_at VARCHAR(30) NOT NULL,
        created_by VARCHAR(60) NOT NULL
    ) $options");
    // كل بيانات التشغيل: مجموعة (col) ومستند (id) ومحتواه JSON، ورقم مراجعة للمزامنة. data = NULL يعني محذوف.
    $pdo->exec("CREATE TABLE IF NOT EXISTS docs (
        col VARCHAR(32) NOT NULL,
        id VARCHAR(160) NOT NULL,
        data MEDIUMTEXT NULL,
        rev BIGINT UNSIGNED NOT NULL,
        PRIMARY KEY (col, id),
        KEY docs_rev (rev)
    ) $options");
    $pdo->exec("CREATE TABLE IF NOT EXISTS revision (
        id TINYINT UNSIGNED PRIMARY KEY,
        value BIGINT UNSIGNED NOT NULL
    ) $options");
    $pdo->exec("INSERT IGNORE INTO revision (id, value) VALUES (1, 0)");
    // سجل العمليات: كل عملية مع من نفّذها ووقتها (يكتبه الخادم فقط)
    $pdo->exec("CREATE TABLE IF NOT EXISTS activity (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        at VARCHAR(30) NOT NULL,
        user_id INT UNSIGNED NULL,
        user_name VARCHAR(60) NOT NULL,
        user_role VARCHAR(20) NOT NULL,
        type VARCHAR(20) NOT NULL,
        action VARCHAR(40) NOT NULL,
        ref VARCHAR(160) NOT NULL DEFAULT '',
        summary VARCHAR(500) NOT NULL,
        details TEXT NULL,
        KEY activity_at (at)
    ) $options");
    // حالة كل سيارة في الخدمة عند كل تغيير (متاحة، ولها سائق، وتخصيص الباص): وقت توفرها في الإحصائيات
    $pdo->exec("CREATE TABLE IF NOT EXISTS vehicle_events (
        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        at VARCHAR(30) NOT NULL,
        plate VARCHAR(40) NOT NULL,
        kind VARCHAR(30) NOT NULL DEFAULT '',
        available TINYINT(1) NOT NULL,
        has_driver TINYINT(1) NOT NULL,
        bus_role VARCHAR(20) NOT NULL DEFAULT '',
        driver VARCHAR(80) NOT NULL DEFAULT '',
        KEY vehicle_events_at (at),
        KEY vehicle_events_plate (plate, id)
    ) $options");
    $pdo->exec("CREATE TABLE IF NOT EXISTS login_attempts (
        k VARCHAR(120) PRIMARY KEY,
        failures INT UNSIGNED NOT NULL,
        first_at INT UNSIGNED NOT NULL,
        locked_until INT UNSIGNED NOT NULL DEFAULT 0
    ) $options");
    // إعدادات يولّدها الخادم مرة واحدة (مفاتيح إشعارات الهاتف)
    $pdo->exec("CREATE TABLE IF NOT EXISTS settings (
        k VARCHAR(40) PRIMARY KEY,
        v TEXT NOT NULL
    ) $options");
    // هواتف السائقين المسجلة لإشعارات الرحلات (المعرّف بصمة عنوان الاشتراك)
    $pdo->exec("CREATE TABLE IF NOT EXISTS push_subscriptions (
        id CHAR(64) PRIMARY KEY,
        user_id INT UNSIGNED NOT NULL,
        endpoint VARCHAR(1000) NOT NULL,
        p256dh VARCHAR(200) NOT NULL,
        auth VARCHAR(100) NOT NULL,
        lang VARCHAR(5) NOT NULL DEFAULT 'ar',
        created_at VARCHAR(30) NOT NULL,
        KEY push_user (user_id)
    ) $options");
    // صورة الاستمارة الورقية للشكوى أو ملف PDF (النسخة 4)، يرفعها مدير النظام
    $pdo->exec("CREATE TABLE IF NOT EXISTS complaint_files (
        id VARCHAR(160) PRIMARY KEY,
        mime VARCHAR(40) NOT NULL,
        size INT UNSIGNED NOT NULL,
        data LONGBLOB NOT NULL,
        created_at VARCHAR(30) NOT NULL,
        created_by INT UNSIGNED NOT NULL
    ) $options");
    // لغة الإشعارات أُضيفت بعد إنشاء الجدول في بعض المواقع
    if (!$pdo->query("SHOW COLUMNS FROM push_subscriptions LIKE 'lang'")->fetch()) {
        $pdo->exec("ALTER TABLE push_subscriptions ADD COLUMN lang VARCHAR(5) NOT NULL DEFAULT 'ar' AFTER auth");
    }
}

// ————— الطلب والرد —————

function send_json(int $status, array $body): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/**
 * يرسل الرد ويُنهي اتصال المتصفح، ثم يكمل الخادم عملًا بعده (مثل إرسال إشعارات السائقين).
 * الجلسة تُغلق أولًا حتى لا تنتظرها طلبات المستخدم التالية.
 */
function respond_early(int $status, array $body): void
{
    if (session_status() === PHP_SESSION_ACTIVE) session_write_close();
    ignore_user_abort(true);
    $json = (string)json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Content-Length: ' . strlen($json));
    echo $json;
    if (function_exists('fastcgi_finish_request')) {
        fastcgi_finish_request();
    } elseif (function_exists('litespeed_finish_request')) {
        litespeed_finish_request();
    } else {
        while (ob_get_level() > 0) ob_end_flush();
        flush();
    }
}

/** جسم الطلب JSON. الطلبات التي تغيّر البيانات تحتاج ترويسة خاصة لا يرسلها موقع آخر (حماية من CSRF). */
function read_body(): array
{
    if (($_SERVER['HTTP_X_REQUESTED_WITH'] ?? '') !== 'fetch') throw new ApiException(403, 'طلب غير مسموح', 'forbidden');
    $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
    if ($length > MAX_BODY_BYTES) throw new ApiException(413, 'حجم البيانات كبير جدًا', 'too_large');
    $raw = file_get_contents('php://input', false, null, 0, MAX_BODY_BYTES + 1);
    if ($raw === false || strlen($raw) > MAX_BODY_BYTES) throw new ApiException(413, 'حجم البيانات كبير جدًا', 'too_large');
    if ($raw === '') return [];
    $body = json_decode($raw, true);
    if (!is_array($body)) throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
    return $body;
}

// ————— الجلسة —————

function is_https(): bool
{
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https')
        || (($_SERVER['SERVER_PORT'] ?? '') === '443');
}

function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name('althumama_sid');
    // الجلسة تنتهي بإغلاق المتصفح (بلا مدة)، ولا يقرأ الكوكي أي سكربت
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'secure' => is_https(),
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    ini_set('session.use_strict_mode', '1');
    ini_set('session.gc_maxlifetime', (string)(IDLE_SECONDS + 600));
    session_start();
}

function end_session(): void
{
    start_session();
    $_SESSION = [];
    $params = session_get_cookie_params();
    setcookie(session_name(), '', ['expires' => time() - 3600] + array_intersect_key($params, array_flip(['path', 'domain', 'secure', 'httponly', 'samesite'])));
    session_destroy();
}

function user_row(PDO $pdo, int $id): ?array
{
    $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
    $stmt->execute([$id]);
    return $stmt->fetch() ?: null;
}

/** ملف المستخدم كما تعرفه الواجهة (UserProfile). */
function profile(array $row): array
{
    $profile = [
        'uid' => (string)$row['id'],
        'username' => $row['username'],
        'displayName' => $row['display_name'],
        'role' => $row['role'],
        'active' => (bool)$row['active'],
        'mustChangePassword' => (bool)$row['must_change_password'],
        'createdAt' => $row['created_at'],
        'createdBy' => $row['created_by'],
    ];
    if ($row['vehicle_plate'] !== null) $profile['vehiclePlate'] = $row['vehicle_plate'];
    return $profile;
}

/**
 * المستخدم الحالي. يُرفض الطلب إن انتهت الجلسة، أو أُوقف الحساب، أو غُيّرت كلمة المرور من المدير.
 * $allowPasswordChange: صفحات يسمح بها قبل تغيير كلمة المرور المؤقتة.
 */
function current_user(PDO $pdo, bool $required = true, bool $allowPasswordChange = false): ?array
{
    start_session();
    $id = $_SESSION['uid'] ?? null;
    $row = null;
    if ($id !== null) {
        $idle = time() - (int)($_SESSION['last'] ?? 0);
        $row = user_row($pdo, (int)$id);
        if ($idle > IDLE_SECONDS || !$row || !$row['active'] || (int)$row['session_version'] !== (int)($_SESSION['ver'] ?? 0)) {
            end_session();
            $row = null;
        } else {
            $_SESSION['last'] = time();
        }
    }
    if (!$row) {
        if ($required) throw new ApiException(401, 'انتهت الجلسة. سجّل الدخول مرة أخرى.', 'unauthenticated');
        return null;
    }
    if ($required && $row['must_change_password'] && !$allowPasswordChange) {
        throw new ApiException(403, 'غيّر كلمة المرور المؤقتة أولًا', 'must_change_password');
    }
    return $row;
}

function require_role(array $user, array $roles): void
{
    if (!in_array($user['role'], $roles, true)) throw new ApiException(403, 'ليست لديك صلاحية لتنفيذ هذا الإجراء.', 'permission_denied');
}

// ————— التحقق من المدخلات —————

function normalize_username(string $value): string
{
    return strtolower(trim($value));
}

function validate_username(string $username): ?string
{
    if (strlen($username) < 3 || strlen($username) > 32) return 'اسم المستخدم يجب أن يكون من 3 إلى 32 حرفًا';
    if (!preg_match('/^[a-z0-9][a-z0-9._-]*$/', $username)) return 'اسم المستخدم يقبل الأحرف الإنجليزية والأرقام والنقطة والشرطة فقط';
    return null;
}

function validate_password(string $password): ?string
{
    if (strlen($password) < 8) return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل';
    if (strlen($password) > 128) return 'كلمة المرور طويلة جدًا';
    if (!preg_match('/[A-Za-z]/', $password) || !preg_match('/\d/', $password)) return 'كلمة المرور يجب أن تحتوي على أحرف وأرقام';
    return null;
}

function validate_display_name(string $name): string
{
    $name = trim($name);
    $length = mb_strlen($name);
    if ($length < 2 || $length > 60) throw new ApiException(400, 'الاسم الظاهر يجب أن يكون من 2 إلى 60 حرفًا', 'invalid');
    return $name;
}

function now_iso(): string
{
    return gmdate('Y-m-d\TH:i:s.v\Z');
}
