<?php
declare(strict_types=1);

// مواقع السيارات (من هاتف السائق أو جهاز التتبع): الحفظ، والوصول بالـ GPS، ورفض الموقع القديم.

/** السيارة تُعتبر واصلة إذا اقتربت من الوجهة هذه المسافة بالأمتار (نفس القيمة في shared/trips.ts). */
const ARRIVAL_RADIUS_M = 300;
/**
 * أعلى سرعة معقولة للسيارة (كم/س): موقع يبعد عن الموقع السابق أكثر مما تقطعه السيارة بهذه السرعة موقع قديم أعاده الهاتف
 * (مثل موقع الصباح المخزّن)، فلا يُحفظ ولا يُكتشف به الوصول؛ ولا يُعلَّم وصول قبل أن يمضي من الاستلام وقت يكفي لقطع المسافة.
 */
const MAX_PLAUSIBLE_KMH = 160;
/** القفزة التي تُفحص: أبعد من هذه المسافة عن الموقع السابق (الأقرب منها خطأ GPS عادي) */
const JUMP_CHECK_M = 1000;
/** موقع بدقة أسوأ من هذه (مثل تحديد الموقع من الشبكة بدل GPS) لا يُعتمد لاكتشاف الوصول. */
const ARRIVAL_MAX_ACCURACY_M = 200;

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
function detect_arrivals(PDO $pdo, string $plate, float $lat, float $lng, int $rev, ?array $user = null, ?string $by = null): int
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
        // لا وصول قبل أن يمضي من الاستلام وقت يكفي لقطع المسافة من مكان الاستلام إلى الوجهة
        if (implausible_trip($doc)) continue;
        $before = $doc;
        $doc['status'] = 'وصلت الوجهة';
        $doc['arrivedAt'] = now_iso();
        $doc['arrivalSource'] = 'gps';
        $entry = describe_write($pdo, 'requests', (string)$id, $before, $doc);
        save_doc($pdo, 'requests', (string)$id, $doc, $rev);
        if ($entry && ($user || $by)) log_activity($pdo, $user, $entry[0], $entry[1], $entry[2], (string)$id, $entry[3], $by);
        $arrived += 1;
    }
    return $arrived;
}

/** الوصول أسرع مما يمكن: المسافة من مكان استلام الضيف (موقع هاتف السائق) إلى الوجهة لا تُقطع في الوقت منذ الاستلام. */
function implausible_trip(array $request): bool
{
    $gps = $request['pickupGps'] ?? null;
    $since = strtotime((string)($request['pickedUpAt'] ?? ''));
    if (!is_array($gps) || !is_numeric($gps['lat'] ?? null) || !is_numeric($gps['lng'] ?? null) || !$since) return false;
    $meters = distance_m((float)$gps['lat'], (float)$gps['lng'], (float)$request['destLat'], (float)$request['destLng']);
    return $meters > JUMP_CHECK_M && $meters / max(1, time() - $since) * 3.6 > MAX_PLAUSIBLE_KMH;
}

/**
 * موقع قديم أعاده الهاتف: أبعد عن آخر موقع محفوظ (مع المشاركة) مما تقطعه السيارة في الوقت بينهما بسرعة MAX_PLAUSIBLE_KMH.
 * $at وقت تسجيل الموقع الجديد (لجهاز التتبع)، وإلا الآن.
 */
function implausible_jump(?array $before, float $lat, float $lng, ?int $at = null): bool
{
    if (!($before['sharing'] ?? false) || !is_numeric($before['lat'] ?? null) || !is_numeric($before['lng'] ?? null)) return false;
    $since = strtotime((string)($before['updatedAt'] ?? ''));
    if (!$since) return false;
    $meters = distance_m((float)$before['lat'], (float)$before['lng'], $lat, $lng);
    return $meters > JUMP_CHECK_M && $meters / max(1, ($at ?? time()) - $since) * 3.6 > MAX_PLAUSIBLE_KMH;
}

/**
 * يحفظ موقع السيارة (من هاتف السائق أو من جهاز التتبع) ويعمل به ما يعمله كل موقع: بداية وقوفها، والموقع الدقيق
 * لمسار رحلتها واكتشاف وصولها واقترابها من مكان الاستلام. يعيد عدد الطلبات التي وصلت.
 */
function apply_position(PDO $pdo, string $plate, ?array $before, array $after, bool $precise, int $rev, ?array $user, ?string $by = null, ?int $at = null): int
{
    // منذ متى لم تتحرك السيارة (تنبيه السيارة المتوقفة خارج المجمع لمشرف السيارات)
    $after = stamp_still($before, $after, $precise);
    save_doc($pdo, 'vehicleLocations', $plate, $after, $rev);
    if (!$precise) return 0;
    $lat = (float)$after['lat'];
    $lng = (float)$after['lng'];
    // مسار السيارة في رحلتها الجارية (يُمحى عند بداية رحلتها التالية)
    record_track($pdo, $plate, $lat, $lng, $rev, $at);
    $arrived = detect_arrivals($pdo, $plate, $lat, $lng, $rev, $user, $by);
    // سيارة العودة أو النقل وصلت قرب المستشفى ولم يُسجَّل وصولها بعد (لإحصائيات التأخير)
    detect_pickup_proximity($pdo, $plate, $lat, $lng, $rev);
    return $arrived;
}
