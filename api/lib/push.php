<?php
declare(strict_types=1);

/**
 * إشعارات الهاتف (Web Push) لتطبيق السائق: رحلة جديدة، وإلغاء رحلة، ونفي مشرف المبنى لما سجّله السائق.
 * مجانية عبر خدمة الإشعارات في المتصفح نفسه (Google لأندرويد وApple للآيفون)، والمحتوى مشفّر (RFC 8291)
 * فلا تقرؤه تلك الخدمات. مفاتيح الموقع (VAPID، RFC 8292) يولّدها الخادم مرة واحدة وتُحفظ في جدول settings.
 */

/** مدة بقاء الإشعار في خدمة الإشعارات إن كان الهاتف مغلقًا (ثوانٍ) */
const PUSH_TTL_SECONDS = 3600;
/** خدمات الإشعارات المعروفة: لا يُقبل عنوان اشتراك غيرها (حتى لا يرسل الخادم طلبات إلى عناوين أخرى) */
const PUSH_HOSTS = ['.googleapis.com', '.push.apple.com', '.push.services.mozilla.com', '.notify.windows.com'];

function b64url_encode(string $data): string
{
    return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
}

function b64url_decode(string $data): string
{
    $decoded = base64_decode(strtr($data, '-_', '+/') . str_repeat('=', (4 - strlen($data) % 4) % 4), true);
    return $decoded === false ? '' : $decoded;
}

function new_ec_key(): OpenSSLAsymmetricKey
{
    $key = openssl_pkey_new(['curve_name' => 'prime256v1', 'private_key_type' => OPENSSL_KEYTYPE_EC]);
    if ($key === false) throw new RuntimeException('تعذر إنشاء مفتاح التشفير (openssl)');
    return $key;
}

/** المفتاح العام بصيغة النقطة غير المضغوطة (65 بايت) كما تستعملها المتصفحات. */
function ec_public_raw(OpenSSLAsymmetricKey $key): string
{
    $ec = openssl_pkey_get_details($key)['ec'];
    return "\x04" . str_pad($ec['x'], 32, "\0", STR_PAD_LEFT) . str_pad($ec['y'], 32, "\0", STR_PAD_LEFT);
}

/** نقطة P-256 غير مضغوطة إلى مفتاح عام يفهمه openssl. */
function ec_public_key(string $raw): OpenSSLAsymmetricKey
{
    $der = hex2bin('3059301306072a8648ce3d020106082a8648ce3d030107034200') . $raw;
    $key = openssl_pkey_get_public("-----BEGIN PUBLIC KEY-----\n" . chunk_split(base64_encode($der), 64, "\n") . "-----END PUBLIC KEY-----\n");
    if ($key === false) throw new RuntimeException('مفتاح اشتراك غير صالح');
    return $key;
}

/** مفاتيح VAPID للموقع: ['private' => PEM، 'public' => base64url]. تُنشأ عند أول استعمال. */
function vapid_keys(PDO $pdo): array
{
    $read = function () use ($pdo): ?array {
        $stmt = $pdo->prepare("SELECT v FROM settings WHERE k = 'vapid'");
        $stmt->execute();
        $value = json_decode((string)$stmt->fetchColumn(), true);
        return is_array($value) && isset($value['private'], $value['public']) ? $value : null;
    };
    if ($keys = $read()) return $keys;
    $key = new_ec_key();
    openssl_pkey_export($key, $pem);
    $keys = ['private' => $pem, 'public' => b64url_encode(ec_public_raw($key))];
    // إن سبق طلب آخر إلى إنشائها تبقى مفاتيحه هو
    $pdo->prepare("INSERT IGNORE INTO settings (k, v) VALUES ('vapid', ?)")->execute([json_encode($keys)]);
    return $read() ?? $keys;
}

/** توقيع ECDSA من صيغة DER إلى r||s (64 بايت) كما يطلبه JWT. */
function der_to_raw_signature(string $der): string
{
    $offset = 2 + ((ord($der[1]) & 0x80) ? (ord($der[1]) & 0x7f) : 0);
    $raw = '';
    for ($part = 0; $part < 2; $part++) {
        $length = ord($der[$offset + 1]);
        $raw .= str_pad(ltrim(substr($der, $offset + 2, $length), "\0"), 32, "\0", STR_PAD_LEFT);
        $offset += 2 + $length;
    }
    return $raw;
}

/** إثبات هوية الموقع لخدمة الإشعارات (JWT موقّع بـ ES256، صالح 12 ساعة). */
function vapid_jwt(string $audience, string $privatePem, string $subject): string
{
    $header = b64url_encode(json_encode(['typ' => 'JWT', 'alg' => 'ES256']));
    $claims = b64url_encode(json_encode(['aud' => $audience, 'exp' => time() + 12 * 3600, 'sub' => $subject], JSON_UNESCAPED_SLASHES));
    if (!openssl_sign("$header.$claims", $der, $privatePem, OPENSSL_ALGO_SHA256)) throw new RuntimeException('تعذر توقيع طلب الإشعار');
    return "$header.$claims." . b64url_encode(der_to_raw_signature($der));
}

/** تشفير محتوى الإشعار لهاتف واحد (aes128gcm) بمفتاحي اشتراكه. */
function encrypt_push(string $payload, string $userPublicB64, string $authB64): string
{
    $userPublic = b64url_decode($userPublicB64);
    $auth = b64url_decode($authB64);
    if (strlen($userPublic) !== 65 || $userPublic[0] !== "\x04" || strlen($auth) !== 16) throw new RuntimeException('مفاتيح اشتراك غير صالحة');
    $local = new_ec_key();
    $localPublic = ec_public_raw($local);
    $shared = openssl_pkey_derive(ec_public_key($userPublic), $local);
    if ($shared === false) throw new RuntimeException('تعذر حساب مفتاح التشفير');
    $ikm = hash_hkdf('sha256', $shared, 32, "WebPush: info\0" . $userPublic . $localPublic, $auth);
    $salt = random_bytes(16);
    $key = hash_hkdf('sha256', $ikm, 16, "Content-Encoding: aes128gcm\0", $salt);
    $nonce = hash_hkdf('sha256', $ikm, 12, "Content-Encoding: nonce\0", $salt);
    $cipher = openssl_encrypt($payload . "\x02", 'aes-128-gcm', $key, OPENSSL_RAW_DATA, $nonce, $tag);
    return $salt . pack('N', 4096) . chr(65) . $localPublic . $cipher . $tag;
}

/** عنوان اشتراك مقبول: https من خدمة إشعارات معروفة. */
function valid_push_endpoint(string $endpoint): bool
{
    if (strlen($endpoint) > 1000 || !str_starts_with($endpoint, 'https://')) return false;
    $host = strtolower((string)parse_url($endpoint, PHP_URL_HOST));
    foreach (PUSH_HOSTS as $suffix) {
        if (str_ends_with($host, $suffix)) return true;
    }
    return false;
}

// ————— الإشعارات المنتظرة: تُجمع أثناء الحفظ وتُرسل بعد نجاحه وبعد الرد على المستخدم —————

/** يضيف إشعارًا لسائقي سيارة (أو يعيد القائمة المنتظرة بلا معامل، أو يفرغها بـ reset). */
function push_queue(?array $item = null, bool $reset = false): array
{
    static $queue = [];
    if ($reset) $queue = [];
    if ($item) $queue[] = $item;
    return $queue;
}

/** نصوص الإشعارات بلغات تطبيق السائق (نفس اللغات في client/src/lib/driverI18n.ts). */
const PUSH_TEXT = [
    'ar' => [
        'dir' => 'rtl', 'new' => 'رحلة جديدة', 'group' => 'رحلة مجمّعة جديدة · %d ضيوف', 'cancel' => 'أُلغيت رحلة',
        'deniedArrival' => 'لم يؤكد مشرف المبنى وصولك', 'deniedArrivalBody' => 'رحلة %s: تأكد من مكان الاستلام وتواصل مع مشرف السيارات',
        'deniedPickup' => 'لم يؤكد مشرف المبنى استلام الضيف', 'deniedPickupBody' => 'رحلة %s: تواصل مع مشرف السيارات',
        'home' => 'مبنى %s، شقة %s',
    ],
    'en' => [
        'dir' => 'ltr', 'new' => 'New trip', 'group' => 'New grouped trip · %d guests', 'cancel' => 'Trip cancelled',
        'deniedArrival' => 'The building supervisor did not confirm your arrival', 'deniedArrivalBody' => 'Trip of %s: check the pickup place and contact the fleet supervisor',
        'deniedPickup' => 'The building supervisor did not confirm the pickup', 'deniedPickupBody' => 'Trip of %s: contact the fleet supervisor',
        'home' => 'Building %s, Apt %s',
    ],
    'ur' => [
        'dir' => 'rtl', 'new' => 'نیا ٹرپ', 'group' => 'نیا مشترکہ ٹرپ · %d مہمان', 'cancel' => 'ٹرپ منسوخ ہو گیا',
        'deniedArrival' => 'بلڈنگ سپروائزر نے آپ کی آمد کی تصدیق نہیں کی', 'deniedArrivalBody' => '%s کا ٹرپ: پک اپ کی جگہ چیک کریں اور گاڑیوں کے سپروائزر سے رابطہ کریں',
        'deniedPickup' => 'بلڈنگ سپروائزر نے مہمان کو لینے کی تصدیق نہیں کی', 'deniedPickupBody' => '%s کا ٹرپ: گاڑیوں کے سپروائزر سے رابطہ کریں',
        'home' => 'بلڈنگ %s، فلیٹ %s',
    ],
];
/** وجهات الرحلات غير الطبية بالإنجليزية (نفس NON_MEDICAL_DESTINATIONS في shared/transport.ts) */
const NON_MEDICAL_EN = [
    'الجامعة' => 'University', 'المدرسة' => 'School', 'أنصار جاليري المطار القديم' => 'Ansar Gallery, Old Airport',
    'جامعة الدوحة للعلوم والتكنولوجيا' => 'University of Doha for Science and Technology',
    'جامعة أوريكس' => 'Oryx University (Liverpool John Moores University)', 'جامعة لوسيل' => 'Lusail University',
    'المدرسة الفلسطينية' => 'Palestinian School', 'معهد النور' => 'Al Noor Center',
];

/** اسم الوجهة: كما كتبته العيادة بالعربية، وبالإنجليزية من دليل المستشفيات (للإنجليزية والأردية). */
function place_name(PDO $pdo, array $appointment, string $lang): string
{
    $clinic = (string)($appointment['clinic'] ?? '');
    if ($lang === 'ar') return $clinic;
    if (isset(NON_MEDICAL_EN[trim($clinic)])) return NON_MEDICAL_EN[trim($clinic)];
    static $names = null;
    if ($names === null) {
        $names = [];
        foreach ($pdo->query("SELECT id, data FROM docs WHERE col = 'hospitals' AND data IS NOT NULL") as $row) {
            $hospital = decode_doc($row['data']);
            if (!empty($hospital['nameEn'])) $names[$row['id']] = $hospital['nameEn'];
        }
    }
    return $names[(string)($appointment['hospitalId'] ?? '')] ?? $clinic;
}

/** اسم الضيف: كما في الموعد بالعربية، وبالإنجليزية والأردية اسمه الإنجليزي من قائمة ضيوف المجمع إن وُجد. */
function guest_name(PDO $pdo, array $appointment, string $lang): string
{
    $name = trim((string)($appointment['patientName'] ?? ''));
    $guestId = (string)($appointment['guestId'] ?? '');
    if ($lang === 'ar' || $guestId === '' || !valid_doc_id($guestId)) return $name;
    static $english = [];
    if (!array_key_exists($guestId, $english)) {
        $stmt = $pdo->prepare("SELECT data FROM docs WHERE col = 'guests' AND id = ?");
        $stmt->execute([$guestId]);
        $guest = decode_doc($stmt->fetchColumn() ?: null);
        $english[$guestId] = trim((string)($guest['nameEn'] ?? ''));
    }
    return $english[$guestId] !== '' ? $english[$guestId] : $name;
}

/** بيانات الرحلة في الإشعار (يُكتب نصها بلغة كل هاتف عند الإرسال). */
function push_trip_text(PDO $pdo, array $request): array
{
    return [
        // رقم الطلب: رابط الإشعار يفتح التطبيق على الرحلة (trip_url)
        'id' => (string)($request['id'] ?? ''),
        'appointment' => appointment_doc($pdo, (string)($request['appointmentId'] ?? '')) ?? [],
        'from' => empty($request['fromAppointmentId']) ? null : appointment_doc($pdo, (string)$request['fromAppointmentId']),
        'returning' => ($request['direction'] ?? '') === 'عودة',
        'nurse' => !empty($request['nurseOnly']),
    ];
}

/** الضيف والوقت ومن أين إلى أين بلغة الهاتف. */
function push_trip_parts(PDO $pdo, array $trip, string $lang): array
{
    $appointment = $trip['appointment'];
    $home = sprintf(PUSH_TEXT[$lang]['home'], $appointment['buildingNumber'] ?? '', $appointment['apartmentNumber'] ?? '');
    $place = place_name($pdo, $appointment, $lang);
    $route = $trip['from'] ? place_name($pdo, $trip['from'], $lang) . " ← $place" : ($trip['returning'] ? "$place ← $home" : "$home ← $place");
    if ($lang === 'en') $route = str_replace('←', '→', $route);
    // عودة الـ Nurse فقط: الراكب الـ Nurse مرافقة الضيف
    $name = guest_name($pdo, $appointment, $lang);
    if (!empty($trip['nurse'])) $name = "Nurse · $name";
    return ['name' => $name, 'time' => (string)($appointment['appointmentAt'] ?? ''), 'route' => $route];
}

/** إشعارات السائق الناتجة عن عملية كتابة واحدة على طلب (تُرسل بعد الحفظ). */
function queue_request_pushes(PDO $pdo, ?array $before, ?array $after): void
{
    // إزالة ضيف من رحلة جارية: تُلغى رحلته عند سائق السيارة
    if ($after && empty($after['vehiclePlate']) && !empty($before['vehiclePlate']) && in_array($before['status'] ?? null, DRIVER_ACTIVE_STATUSES, true)) {
        push_queue(['plate' => (string)$before['vehiclePlate'], 'type' => 'cancel', 'trip' => push_trip_text($pdo, $before)]);
        return;
    }
    $plate = (string)(($after ?? $before)['vehiclePlate'] ?? '');
    if ($plate === '') return;
    // نفي مشرف المبنى لما سجّله السائق (يعيد الطلب إلى «تم إرسال السيارة» أو «وصلت السيارة»)
    foreach (['arrival', 'pickup'] as $kind) {
        if ($after && ($after["{$kind}Check"] ?? null) === 'denied' && ($before["{$kind}Check"] ?? null) === 'pending') {
            push_queue(['plate' => $plate, 'type' => "denied-$kind", 'trip' => push_trip_text($pdo, $after)]);
            return;
        }
    }
    // تغيير السيارة المرسلة: الرحلة تُلغى عند سائق السيارة السابقة وتصل إلى سائق الجديدة (ولو بعد استلام الضيف)
    $previous = (string)($before['vehiclePlate'] ?? '');
    if ($after && $previous !== '' && $previous !== $plate && in_array($before['status'] ?? null, DRIVER_ACTIVE_STATUSES, true)) {
        push_queue(['plate' => $previous, 'type' => 'cancel', 'trip' => push_trip_text($pdo, $before)]);
        if (in_array($after['status'] ?? null, DRIVER_ACTIVE_STATUSES, true)) push_queue(['plate' => $plate, 'type' => 'new', 'trip' => push_trip_text($pdo, $after)]);
        return;
    }
    // إرسال السيارة من «بانتظار التوزيع» (أو ضم ضيف استلمه السائق إلى رحلة جارية)
    if ($after && in_array($after['status'] ?? null, DRIVER_ACTIVE_STATUSES, true)
        && (($before['status'] ?? null) === 'بانتظار التوزيع' || ($before['vehiclePlate'] ?? null) !== $plate)) {
        push_queue(['plate' => $plate, 'type' => 'new', 'trip' => push_trip_text($pdo, $after)]);
        return;
    }
    // إلغاء طلب في طريق السيارة إلى الاستلام
    if ($after === null && in_array($before['status'] ?? null, ['تم إرسال السيارة', 'وصلت السيارة'], true)) {
        push_queue(['plate' => $plate, 'type' => 'cancel', 'trip' => push_trip_text($pdo, $before)]);
    }
}

/** رابط التطبيق على رحلة (الضغط على الإشعار ينقل إلى بطاقتها في «رحلاتي») */
function trip_url(array $trip): string
{
    $id = (string)($trip['id'] ?? '');
    return valid_doc_id($id) ? '/?trip=' . rawurlencode($id) : '/';
}

/** نص الإشعار لكل سيارة بلغة الهاتف: الرحلات الجديدة في إشعار واحد (رحلة مجمّعة)، وكل إلغاء أو نفي في إشعار. */
function push_messages(PDO $pdo, array $items, string $lang): array
{
    $text = PUSH_TEXT[$lang] ?? PUSH_TEXT['ar'];
    $messages = [];
    $join = fn(string ...$parts) => implode(' · ', array_filter(array_map('trim', $parts), fn($part) => $part !== ''));
    $new = array_values(array_filter($items, fn($item) => $item['type'] === 'new'));
    if ($new) {
        $trips = array_map(fn($item) => push_trip_parts($pdo, $item['trip'], $lang), $new);
        $messages[] = count($trips) > 1
            ? ['title' => sprintf($text['group'], count($trips)), 'body' => $join(...array_map(fn($trip) => "{$trip['time']} {$trip['name']}", $trips)), 'tag' => 'trip-new']
            : ['title' => $join($text['new'], $trips[0]['time']), 'body' => $join($trips[0]['name'], $trips[0]['route']), 'tag' => 'trip-new'];
        // الضغط على الإشعار يفتح التطبيق على الرحلة
        $messages[count($messages) - 1]['url'] = trip_url($new[0]['trip']);
    }
    foreach ($items as $item) {
        if ($item['type'] === 'new') continue;
        $trip = push_trip_parts($pdo, $item['trip'], $lang);
        if ($item['type'] === 'cancel') {
            $messages[] = ['title' => $text['cancel'], 'body' => $join($trip['name'], $trip['time'], $trip['route']), 'tag' => 'trip-cancel'];
        } elseif ($item['type'] === 'denied-arrival') {
            $messages[] = ['title' => $text['deniedArrival'], 'body' => sprintf($text['deniedArrivalBody'], $trip['name']), 'tag' => 'trip-denied', 'url' => trip_url($item['trip'])];
        } elseif ($item['type'] === 'denied-pickup') {
            $messages[] = ['title' => $text['deniedPickup'], 'body' => sprintf($text['deniedPickupBody'], $trip['name']), 'tag' => 'trip-denied', 'url' => trip_url($item['trip'])];
        }
    }
    return array_map(fn($message) => $message + ['lang' => $lang, 'dir' => $text['dir']], $messages);
}

/** يرسل الإشعارات المنتظرة إلى هواتف سائقي كل سيارة، ويحذف الاشتراكات المنتهية. */
function flush_pushes(PDO $pdo): void
{
    $queue = push_queue(null, false);
    push_queue(null, true);
    if (!$queue || !function_exists('curl_multi_init')) return;
    $byPlate = [];
    foreach ($queue as $item) $byPlate[$item['plate']][] = $item;
    $keys = vapid_keys($pdo);
    $host = preg_replace('/[^A-Za-z0-9.:-]/', '', (string)($_SERVER['HTTP_HOST'] ?? 'localhost'));
    $jobs = [];
    foreach ($byPlate as $plate => $items) {
        $stmt = $pdo->prepare("SELECT s.id, s.endpoint, s.p256dh, s.auth, s.lang FROM push_subscriptions s JOIN users u ON u.id = s.user_id
            WHERE u.role = 'driver' AND u.active = 1 AND u.vehicle_plate = ?");
        $stmt->execute([(string)$plate]);
        // كل هاتف بلغة سائقه
        $messages = [];
        foreach ($stmt->fetchAll() as $subscription) {
            $lang = isset(PUSH_TEXT[$subscription['lang']]) ? $subscription['lang'] : 'ar';
            $messages[$lang] ??= push_messages($pdo, $items, $lang);
            foreach ($messages[$lang] as $message) {
                $jobs[] = [$subscription, json_encode($message + ['url' => '/'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)];
            }
        }
    }
    if (!$jobs) return;
    $multi = curl_multi_init();
    $handles = [];
    foreach ($jobs as [$subscription, $payload]) {
        try {
            $body = encrypt_push($payload, $subscription['p256dh'], $subscription['auth']);
        } catch (Throwable $error) {
            error_log('[althumama push] ' . $error->getMessage());
            continue;
        }
        $parts = parse_url($subscription['endpoint']);
        $audience = ($parts['scheme'] ?? 'https') . '://' . ($parts['host'] ?? '') . (isset($parts['port']) ? ':' . $parts['port'] : '');
        $handle = curl_init($subscription['endpoint']);
        curl_setopt_array($handle, [
            CURLOPT_POST => true,
            CURLOPT_POSTFIELDS => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT => 8,
            CURLOPT_CONNECTTIMEOUT => 4,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/octet-stream',
                'Content-Encoding: aes128gcm',
                'TTL: ' . PUSH_TTL_SECONDS,
                'Urgency: high',
                'Authorization: vapid t=' . vapid_jwt($audience, $keys['private'], "https://$host") . ', k=' . $keys['public'],
            ],
        ]);
        curl_multi_add_handle($multi, $handle);
        $handles[] = [$handle, $subscription['id']];
    }
    do {
        $status = curl_multi_exec($multi, $running);
        if ($running) curl_multi_select($multi, 1.0);
    } while ($running && $status === CURLM_OK);
    foreach ($handles as [$handle, $id]) {
        $code = (int)curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
        // الاشتراك انتهى (أُلغي الإذن أو أُزيل التطبيق): لا يُرسل إليه بعد الآن
        if ($code === 404 || $code === 410) $pdo->prepare('DELETE FROM push_subscriptions WHERE id = ?')->execute([$id]);
        elseif ($code < 200 || $code >= 300) error_log("[althumama push] $code " . substr((string)curl_multi_getcontent($handle), 0, 200));
        curl_multi_remove_handle($multi, $handle);
        curl_close($handle);
    }
    curl_multi_close($multi);
}

// ————— المسارات: مفتاح الموقع، وتسجيل هاتف السائق، وإلغاؤه —————

function route_push_key(PDO $pdo): array
{
    require_role(current_user($pdo), ['driver']);
    return ['key' => vapid_keys($pdo)['public']];
}

function route_push_subscribe(PDO $pdo, array $body): array
{
    $user = current_user($pdo);
    require_role($user, ['driver']);
    $endpoint = (string)($body['endpoint'] ?? '');
    $p256dh = (string)($body['keys']['p256dh'] ?? '');
    $auth = (string)($body['keys']['auth'] ?? '');
    $point = b64url_decode($p256dh);
    if (!valid_push_endpoint($endpoint) || strlen($point) !== 65 || $point[0] !== "\x04" || strlen(b64url_decode($auth)) !== 16) {
        throw new ApiException(400, 'تعذر تفعيل الإشعارات على هذا الهاتف', 'invalid');
    }
    // لغة الإشعارات: لغة تطبيق السائق
    $lang = isset(PUSH_TEXT[$body['lang'] ?? '']) ? (string)$body['lang'] : 'ar';
    $id = hash('sha256', $endpoint);
    $stmt = $pdo->prepare('SELECT user_id FROM push_subscriptions WHERE id = ?');
    $stmt->execute([$id]);
    $owner = $stmt->fetchColumn();
    $pdo->prepare('REPLACE INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, lang, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        ->execute([$id, $user['id'], $endpoint, $p256dh, $auth, $lang, now_iso()]);
    if ((string)$owner !== (string)$user['id']) {
        log_activity($pdo, $user, 'location', 'push.subscribe', 'تفعيل إشعارات الرحلات على هاتف السائق' . ($user['vehicle_plate'] ? " (السيارة {$user['vehicle_plate']})" : ''), (string)($user['vehicle_plate'] ?? ''));
    }
    return ['ok' => true];
}

function route_push_unsubscribe(PDO $pdo, array $body): array
{
    $user = current_user($pdo);
    $endpoint = (string)($body['endpoint'] ?? '');
    if ($endpoint !== '') $pdo->prepare('DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?')->execute([hash('sha256', $endpoint), $user['id']]);
    return ['ok' => true];
}
