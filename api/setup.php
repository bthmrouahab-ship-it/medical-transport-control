<?php
declare(strict_types=1);

/**
 * الإعداد الأول: يربط الموقع بقاعدة MySQL في Hostinger، وينشئ الجداول وحساب المدير.
 * بعد حفظ الإعداد تتوقف هذه الصفحة نهائيًا (لإعادة الإعداد احذف ملف الإعداد يدويًا).
 */

// لا تُعرض أخطاء PHP للزائر (قد تكشف مسارات الخادم)؛ تُسجَّل في سجل الأخطاء فقط
ini_set('display_errors', '0');

require __DIR__ . '/lib/bootstrap.php';

header('X-Frame-Options: DENY');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');

function page(string $title, string $body, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: text/html; charset=utf-8');
    echo '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        . '<meta name="robots" content="noindex"><title>' . htmlspecialchars($title) . '</title><style>'
        . 'body{font-family:system-ui,Tahoma,sans-serif;background:#f5f7fb;color:#10233f;margin:0;padding:24px}'
        . 'main{max-width:520px;margin:40px auto;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:28px}'
        . 'h1{font-size:22px;margin:0 0 6px}p{line-height:1.7;color:#475569}label{display:block;margin:14px 0 4px;font-weight:700;font-size:14px}'
        . 'input{width:100%;box-sizing:border-box;height:44px;border:1px solid #cbd5e1;border-radius:12px;padding:0 12px;font-size:15px}'
        . 'button,a.button{display:inline-block;margin-top:20px;background:#a61d2d;color:#fff;border:0;border-radius:12px;padding:12px 20px;font-weight:700;font-size:15px;text-decoration:none;cursor:pointer}'
        . '.error{background:#fef2f2;color:#b91c1c;padding:12px;border-radius:12px;font-weight:700}.hint{font-size:12px;color:#94a3b8;font-weight:400}'
        . 'fieldset{border:1px solid #e2e8f0;border-radius:14px;margin:16px 0 0;padding:4px 16px 16px}legend{font-weight:700;padding:0 6px}'
        . '</style></head><body><main><h1>' . htmlspecialchars($title) . '</h1>' . $body . '</main></body></html>';
    exit;
}

if (load_config()) {
    page('الموقع مضبوط مسبقًا', '<p>تم إعداد قاعدة البيانات من قبل، وهذه الصفحة متوقفة.</p><a class="button" href="/">فتح الموقع</a>', 403);
}

$error = '';
$values = ['db_name' => '', 'db_user' => ''];

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
    $values = ['db_name' => trim((string)($_POST['db_name'] ?? '')), 'db_user' => trim((string)($_POST['db_user'] ?? ''))];
    $dbPassword = (string)($_POST['db_password'] ?? '');
    $adminPassword = (string)($_POST['admin_password'] ?? '');
    $confirm = (string)($_POST['admin_confirm'] ?? '');
    try {
        if ($values['db_name'] === '' || $values['db_user'] === '') throw new RuntimeException('اكتب اسم قاعدة البيانات واسم مستخدمها');
        if ($adminPassword !== $confirm) throw new RuntimeException('تأكيد كلمة مرور المدير غير مطابق');
        if ($passwordError = validate_password($adminPassword)) throw new RuntimeException($passwordError);
        // قاعدة البيانات على نفس الخادم فقط، حتى لا يربط أحد الموقع بقاعدة بيانات خارجية
        $db = ['host' => 'localhost', 'port' => 3306, 'name' => $values['db_name'], 'user' => $values['db_user'], 'password' => $dbPassword];
        try {
            $pdo = connect_db($db);
        } catch (PDOException) {
            throw new RuntimeException('تعذر الاتصال بقاعدة البيانات. تأكد من الاسم واسم المستخدم وكلمة المرور.');
        }
        ensure_schema($pdo);
        $hasUsers = (bool)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
        if (!$hasUsers) {
            $pdo->prepare('INSERT INTO users (username, display_name, role, active, must_change_password, password_hash, created_at, created_by)
                VALUES (?, ?, ?, 1, 0, ?, ?, ?)')
                ->execute(['admin', 'مدير النظام', 'admin', password_hash($adminPassword, PASSWORD_DEFAULT), now_iso(), 'setup']);
        }
        $content = "<?php\n// إعداد موقع سيارات مجمع الثمامة (أنشأته صفحة الإعداد). لا تشارك هذا الملف.\nreturn " . var_export(['db' => $db], true) . ";\n";
        $saved = null;
        foreach (config_paths() as $path) {
            if (@file_put_contents($path, $content, LOCK_EX) !== false) {
                @chmod($path, 0640);
                $saved = $path;
                break;
            }
        }
        if (!$saved) throw new RuntimeException('تعذر حفظ ملف الإعداد. تأكد من صلاحيات الكتابة في مجلد الموقع.');
        $note = $hasUsers
            ? '<p>قاعدة البيانات تحتوي على حسابات سابقة، فلم يُنشأ حساب مدير جديد. ادخل بحسابك المعتاد.</p>'
            : '<p>تم إنشاء حساب المدير: اسم المستخدم <b dir="ltr">admin</b> وكلمة المرور التي اخترتها.</p>';
        page('تم الإعداد', '<p>تم ربط الموقع بقاعدة البيانات وإنشاء الجداول.</p>' . $note . '<a class="button" href="/">فتح الموقع وتسجيل الدخول</a>');
    } catch (RuntimeException $exception) {
        $error = $exception->getMessage();
    }
}

$field = fn(string $name, string $label, string $type = 'text', string $hint = '') =>
    '<label for="' . $name . '">' . $label . ($hint ? ' <span class="hint">' . $hint . '</span>' : '') . '</label>'
    . '<input dir="ltr" id="' . $name . '" name="' . $name . '" type="' . $type . '" autocomplete="off" required value="'
    . ($type === 'password' ? '' : htmlspecialchars($values[$name] ?? '')) . '">';

page('إعداد موقع سيارات مجمع الثمامة', '<p>أنشئ قاعدة بيانات MySQL من لوحة Hostinger (Databases ← MySQL Databases)، ثم اكتب بياناتها هنا. هذه الصفحة تُستخدم مرة واحدة فقط.</p>'
    . ($error ? '<p class="error">' . htmlspecialchars($error) . '</p>' : '')
    . '<form method="post"><fieldset><legend>قاعدة البيانات</legend>'
    . $field('db_name', 'اسم قاعدة البيانات', 'text', 'مثل u123456789_althumama')
    . $field('db_user', 'اسم مستخدم قاعدة البيانات', 'text', 'مثل u123456789_admin')
    . $field('db_password', 'كلمة مرور قاعدة البيانات', 'password')
    . '</fieldset><fieldset><legend>حساب المدير (admin)</legend>'
    . $field('admin_password', 'كلمة مرور المدير', 'password', '8 أحرف على الأقل، أحرف وأرقام')
    . $field('admin_confirm', 'تأكيد كلمة المرور', 'password')
    . '</fieldset><button type="submit">حفظ الإعداد</button></form>');
