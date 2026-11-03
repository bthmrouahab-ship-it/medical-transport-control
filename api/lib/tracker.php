<?php
declare(strict_types=1);

/*
 * جهاز التتبع في السيارات (واجهة مزوّد التتبع): الخادم يسأل GET {url}/vehicle/tracks?time=<آخر ModifiedTime>
 * بترويسة api-key، مرة كل TRACKER_POLL_SECONDS على الأكثر: بعد مزامنة صفحات المكتب، ومن cron.php كل دقيقة.
 * الرد { S: "SUCCESS", D: [{ VehicleNo, Lat, Lon, Bearing, Speed, TrackTime, ModifiedTime, Status }] } لسيارات حسابنا فقط.
 * موقع كل سيارة من القائمة (VehicleNo = رقم السيارة) يُحفظ في vehicleLocations كموقع هاتف السائق (source: tracker)،
 * فيعمل به الوصول بالـ GPS ومسار الرحلة والسيارة المتوقفة والخريطة؛ والأحدث من الهاتف والجهاز هو الذي يبقى.
 * الإعداد في althumama-config.php: 'tracker' => ['url' => 'https://…', 'key' => '…'].
 */

/** أقل فترة بين سؤالين (يوصي المزوّد بـ 10 إلى 15 ثانية) */
const TRACKER_POLL_SECONDS = 15;
const TRACKER_TIMEOUT_SECONDS = 8;
/** موقع الجهاز أقدم من هذا بالثواني (السيارة مطفأة أو بلا إشارة) يُعرض فقط: لا يكتشف الوصول ولا يدخل المسار */
const TRACKER_FRESH_SECONDS = 120;
/** اسم المنفذ في سجل العمليات لوصول اكتشفه موقع الجهاز */
const TRACKER_ACTOR = 'جهاز التتبع';

/** عنوان الخدمة ومفتاحها من ملف الإعداد، أو null إن لم يُضبط. */
function tracker_config(): ?array
{
    $config = load_config()['tracker'] ?? null;
    if (!is_array($config)) return null;
    $url = rtrim(trim((string)($config['url'] ?? '')), '/');
    $key = trim((string)($config['key'] ?? ''));
    // https فقط، إلا خادمًا محليًا للتجربة
    $valid = preg_match('#^https://[^\s/?\#@]+(/[^\s?\#]*)?$#', $url) || preg_match('#^http://(localhost|127\.0\.0\.1)(:\d+)?(/[^\s?\#]*)?$#', $url);
    return $key !== '' && $valid ? ['url' => $url, 'key' => $key] : null;
}

/** رقم السيارة للمطابقة: أحرف وأرقام فقط، والأرقام بلا أصفار في البداية. */
function tracker_plate_key(string $value): string
{
    $key = strtoupper((string)preg_replace('/[^A-Za-z0-9]/', '', $value));
    return ctype_digit($key) ? (ltrim($key, '0') ?: '0') : $key;
}

function tracker_status(PDO $pdo): array
{
    $stmt = $pdo->prepare("SELECT v FROM settings WHERE k = 'tracker_status'");
    $stmt->execute();
    $status = json_decode((string)$stmt->fetchColumn(), true);
    return is_array($status) ? $status : [];
}

function save_tracker_status(PDO $pdo, array $status): void
{
    $pdo->prepare("INSERT INTO settings (k, v) VALUES ('tracker_status', ?) ON DUPLICATE KEY UPDATE v = VALUES(v)")
        ->execute([json_encode($status, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES)]);
}

/** يحجز دور السؤال الآن لطلب واحد فقط (مزامنة عدة صفحات وcron معًا). */
function claim_tracker_poll(PDO $pdo): bool
{
    $now = time();
    $pdo->exec("INSERT IGNORE INTO settings (k, v) VALUES ('tracker_poll', '0')");
    $stmt = $pdo->prepare("UPDATE settings SET v = ? WHERE k = 'tracker_poll' AND CAST(v AS UNSIGNED) <= ?");
    $stmt->execute([(string)$now, $now - TRACKER_POLL_SECONDS]);
    return $stmt->rowCount() === 1;
}

/** مواقع السيارات التي تغيّرت منذ $since من خدمة التتبع. */
function tracker_fetch(array $config, int $since): array
{
    $curl = curl_init($config['url'] . '/vehicle/tracks?time=' . max(0, $since));
    curl_setopt_array($curl, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_TIMEOUT => TRACKER_TIMEOUT_SECONDS,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => ['api-key: ' . $config['key'], 'Accept: application/json'],
    ]);
    $body = curl_exec($curl);
    $code = (int)curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
    $error = curl_error($curl);
    curl_close($curl);
    if (!is_string($body)) throw new RuntimeException("تعذر الاتصال بخدمة التتبع ($error)");
    $data = json_decode($body, true);
    if (!is_array($data)) throw new RuntimeException("رد غير مفهوم من خدمة التتبع (HTTP $code)");
    if (($data['S'] ?? null) !== 'SUCCESS') {
        $message = trim(implode(' · ', array_filter([$data['M'] ?? null, $data['E'] ?? null], 'is_string')));
        throw new RuntimeException('رفضت خدمة التتبع الطلب: ' . mb_substr($message !== '' ? $message : "HTTP $code", 0, 200));
    }
    return is_array($data['D'] ?? null) ? array_values($data['D']) : [];
}

/** يحفظ موقع سيارة من جهاز التتبع إن كان أحدث من آخر موقع لها (من الهاتف أو الجهاز). يعيد عدد الطلبات التي وصلت. */
function apply_tracker_fix(PDO $pdo, string $plate, array $fix, ?array $vehicle): int
{
    $lat = $fix['Lat'] ?? null;
    $lng = $fix['Lon'] ?? null;
    $at = is_numeric($fix['TrackTime'] ?? null) ? min((int)$fix['TrackTime'], time()) : 0;
    if (!is_numeric($lat) || !is_numeric($lng) || abs((float)$lat) > 90 || abs((float)$lng) > 180 || ((float)$lat == 0 && (float)$lng == 0) || $at <= 0) return 0;
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare("SELECT data FROM docs WHERE col = 'vehicleLocations' AND id = ? FOR UPDATE");
        $stmt->execute([$plate]);
        $before = decode_doc($stmt->fetchColumn() ?: null);
        $last = strtotime((string)($before['updatedAt'] ?? '')) ?: 0;
        if ($at <= $last || implausible_jump($before, (float)$lat, (float)$lng, $at)) {
            $pdo->commit();
            return 0;
        }
        $number = fn($value) => is_numeric($value) ? round((float)$value) : null;
        $status = is_string($fix['Status'] ?? null) ? mb_substr(trim($fix['Status']), 0, 30) : '';
        $after = array_filter([
            'plate' => $plate,
            'lat' => (float)$lat,
            'lng' => (float)$lng,
            'speed' => $number($fix['Speed'] ?? null),
            'heading' => $number($fix['Bearing'] ?? null),
            // الجهاز لا يعرف السائق: من يقود السيارة الآن حسب تخصيص مشرف السيارات
            'driver' => (string)($vehicle['driver'] ?? '') ?: ($before['driver'] ?? null),
            'sharing' => true,
            'source' => 'tracker',
            'trackerStatus' => $status,
            'updatedAt' => gmdate('Y-m-d\TH:i:s.000\Z', $at),
        ], fn($value) => $value !== null && $value !== '');
        $rev = next_revision($pdo);
        $arrived = apply_position($pdo, $plate, $before, $after, time() - $at <= TRACKER_FRESH_SECONDS, $rev, null, TRACKER_ACTOR, $at);
        $pdo->commit();
        return $arrived;
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}

/** يسأل خدمة التتبع (إن ضُبطت وحان دورها) ويحفظ المواقع. لا يرمي خطأ: يحفظه في حالة الربط. */
function poll_tracker(PDO $pdo): void
{
    $config = tracker_config();
    if (!$config || !claim_tracker_poll($pdo)) return;
    $status = tracker_status($pdo);
    $cursor = (int)($status['cursor'] ?? 0);
    try {
        $fixes = tracker_fetch($config, $cursor);
    } catch (RuntimeException $error) {
        save_tracker_status($pdo, ['ok' => false, 'error' => $error->getMessage(), 'checkedAt' => now_iso()] + $status);
        return;
    }
    $fleet = docs_of($pdo, 'fleet');
    $plates = [];
    foreach ($fleet as $plate => $vehicle) $plates[tracker_plate_key((string)$plate)] = (string)$plate;
    $matched = $status['matched'] ?? [];
    $unmatched = $status['unmatched'] ?? [];
    $next = $cursor;
    $error = null;
    foreach ($fixes as $fix) {
        if (!is_array($fix)) continue;
        if (is_numeric($fix['ModifiedTime'] ?? null)) $next = max($next, min((int)$fix['ModifiedTime'], time()));
        $number = trim((string)($fix['VehicleNo'] ?? ''));
        if ($number === '' || mb_strlen($number) > 30) continue;
        $plate = $plates[tracker_plate_key($number)] ?? null;
        if ($plate === null) {
            $unmatched[$number] = now_iso();
            continue;
        }
        unset($unmatched[$number]);
        $matched[$plate] = now_iso();
        try {
            apply_tracker_fix($pdo, $plate, $fix, $fleet[$plate] ?? null);
        } catch (Throwable $exception) {
            error_log('[tracker] ' . $exception);
            $error = 'تعذر حفظ موقع السيارة ' . $plate;
        }
    }
    // السيارات التي حُذفت من القائمة لا تبقى، وأرقام الجهاز غير المعروفة آخر 50
    $matched = array_intersect_key($matched, array_flip(array_values($plates)));
    arsort($unmatched);
    save_tracker_status($pdo, [
        'ok' => $error === null,
        'error' => $error,
        'checkedAt' => now_iso(),
        'cursor' => $next,
        'received' => count($fixes),
        'matched' => $matched,
        'unmatched' => array_slice($unmatched, 0, 50, true),
    ]);
}

/** حالة الربط بجهاز التتبع للمدير ومشرف السيارات (بلا المفتاح ولا العنوان). */
function route_tracker_status(PDO $pdo): array
{
    require_role(current_user($pdo), ['admin', 'fleetSupervisor']);
    if (!tracker_config()) return ['configured' => false];
    $status = tracker_status($pdo);
    return [
        'configured' => true,
        'ok' => $status['ok'] ?? null,
        'error' => $status['error'] ?? null,
        'checkedAt' => $status['checkedAt'] ?? null,
        'received' => $status['received'] ?? 0,
        'matched' => (object)($status['matched'] ?? []),
        'unmatched' => (object)($status['unmatched'] ?? []),
    ];
}
