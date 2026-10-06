<?php
/**
 * ما يسجّله الخادم للإحصائيات (لا يكتبه أي مستخدم):
 * - حالة كل سيارة في الخدمة (متاحة، ولها سائق، وتخصيص الباص) في الجدول vehicle_events عند كل تغيير، فيُحسب
 *   وقت توفر السيارة في الخدمة، والباصات المخصصة (العيادة والرحلات غير الطبية والمجمع) سيارات عاملة.
 * - وقت تسجيل الموعد (addedAt في الموعد): مجدول قبل يومه أو عاجل في يومه نفسه.
 * - وقت وصول السيارة إلى نقطة الاستلام (pickupArrivedAt) عند تسجيله من مشرف المبنى، ووقت اقتراب سيارة
 *   العودة أو النقل من المستشفى بالـ GPS (nearPickupAt)، لمراحل تأخير الرحلات.
 */

/** السيارة قرب مكان الاستلام في المستشفى على هذه المسافة بالأمتار (مثل الوصول إلى الوجهة) */
const PICKUP_NEAR_RADIUS_M = 300;

/** حالة السيارة في الخدمة كما في مستندها. */
function vehicle_service_state(array $vehicle): array
{
    $driver = trim((string)($vehicle['driver'] ?? ''));
    return [
        'kind' => mb_substr((string)($vehicle['kind'] ?? ''), 0, 30),
        'available' => ($vehicle['available'] ?? true) === false ? 0 : 1,
        'has_driver' => $driver !== '' ? 1 : 0,
        'bus_role' => mb_substr((string)($vehicle['busRole'] ?? ''), 0, 20),
        'driver' => mb_substr($driver, 0, 80),
    ];
}

/**
 * بعد كل تغيير في السيارات أو السائقين: حالة جديدة لكل سيارة تغيّرت حالتها في الخدمة (والسيارة المحذوفة خارج الخدمة).
 * داخل معاملة المستدعي.
 */
function record_vehicle_states(PDO $pdo): void
{
    $last = [];
    $rows = $pdo->query('SELECT e.plate, e.kind, e.available, e.has_driver, e.bus_role, e.driver FROM vehicle_events e
        JOIN (SELECT plate, MAX(id) AS id FROM vehicle_events GROUP BY plate) latest ON latest.id = e.id');
    foreach ($rows as $row) {
        $last[(string)$row['plate']] = ['kind' => (string)$row['kind'], 'available' => (int)$row['available'], 'has_driver' => (int)$row['has_driver'], 'bus_role' => (string)$row['bus_role'], 'driver' => (string)$row['driver']];
    }
    $insert = $pdo->prepare('INSERT INTO vehicle_events (at, plate, kind, available, has_driver, bus_role, driver) VALUES (?, ?, ?, ?, ?, ?, ?)');
    $at = now_iso();
    $seen = [];
    foreach ($pdo->query("SELECT id, data FROM docs WHERE col = 'fleet' AND data IS NOT NULL") as $row) {
        $vehicle = decode_doc($row['data']);
        if (!$vehicle) continue;
        $plate = (string)$row['id'];
        $seen[$plate] = true;
        $state = vehicle_service_state($vehicle);
        if (($last[$plate] ?? null) === $state) continue;
        $insert->execute([$at, $plate, $state['kind'], $state['available'], $state['has_driver'], $state['bus_role'], $state['driver']]);
    }
    foreach ($last as $plate => $state) {
        if (isset($seen[$plate]) || (!$state['available'] && !$state['has_driver'])) continue;
        $insert->execute([$at, $plate, $state['kind'], 0, 0, '', '']);
    }
}

/**
 * الخانات التي يكتبها الخادم وحده في الموعد والطلب (قبل الحفظ مباشرة، بعد فحص الصلاحيات ووصف السجل):
 * ما يرسله المستخدم منها يُتجاهل، وتبقى كما كانت ما لم تتغير الحالة.
 */
function stamp_tracking(string $col, ?array $before, ?array $after): ?array
{
    if ($after === null) return null;
    if ($col === 'appointments') {
        $added = $before === null ? now_iso() : ($before['addedAt'] ?? null);
        if ($added) $after['addedAt'] = $added;
        else unset($after['addedAt']);
        return $after;
    }
    if ($col !== 'requests') return $after;
    $status = (string)($after['status'] ?? '');
    $previous = (string)($before['status'] ?? '');
    $reset = in_array($status, ['بانتظار التوزيع', 'تم إرسال السيارة'], true);
    // وصول السيارة إلى نقطة الاستلام كما سجّله مشرف المبنى (والسائق يسجّل driverArrivedAt من تطبيقه)
    if ($status === 'وصلت السيارة' && $previous !== 'وصلت السيارة') $after['pickupArrivedAt'] = now_iso();
    elseif (!$reset && isset($before['pickupArrivedAt'])) $after['pickupArrivedAt'] = $before['pickupArrivedAt'];
    else unset($after['pickupArrivedAt']);
    // اقتراب السيارة من المستشفى (GPS): يُمحى إن أُعيد الطلب إلى التوزيع أو تغيّرت السيارة
    $sameCar = ($after['vehiclePlate'] ?? null) === ($before['vehiclePlate'] ?? null);
    if ($status !== 'بانتظار التوزيع' && $sameCar && isset($before['nearPickupAt'])) $after['nearPickupAt'] = $before['nearPickupAt'];
    else unset($after['nearPickupAt']);
    return $after;
}

/**
 * موقع السائق قرب مكان استلام رحلة عودة أو نقل (المستشفى) والسيارة لم تُسجَّل واصلة بعد: يُحفظ وقته،
 * فتعرف الإحصائيات أن السائق وصل قبل أن يُسجَّل وصوله.
 */
function detect_pickup_proximity(PDO $pdo, string $plate, float $lat, float $lng, int $rev): void
{
    $like = fn(string $text) => '%' . addcslashes($text, '%_\\') . '%';
    $candidates = $pdo->prepare("SELECT id FROM docs WHERE col = 'requests' AND data LIKE ? AND data LIKE ?");
    $candidates->execute([$like('"vehiclePlate":' . json_encode($plate, JSON_UNESCAPED_UNICODE)), $like('"status":"تم إرسال السيارة"')]);
    foreach ($candidates->fetchAll(PDO::FETCH_COLUMN) as $id) {
        $lock = $pdo->prepare("SELECT data FROM docs WHERE col = 'requests' AND id = ? FOR UPDATE");
        $lock->execute([$id]);
        $doc = decode_doc($lock->fetchColumn() ?: null);
        if (!$doc || ($doc['vehiclePlate'] ?? null) !== $plate || ($doc['status'] ?? null) !== 'تم إرسال السيارة' || isset($doc['nearPickupAt'])) continue;
        // مكان الاستلام مستشفى: العودة من مستشفى الموعد، والنقل من مستشفى الموعد الأول
        $from = $doc['fromAppointmentId'] ?? (($doc['direction'] ?? '') === 'عودة' ? ($doc['appointmentId'] ?? null) : null);
        if (!is_string($from) || $from === '') continue;
        $point = pickup_point($pdo, $from);
        if ($point === null || distance_m($lat, $lng, $point[0], $point[1]) > PICKUP_NEAR_RADIUS_M) continue;
        $doc['nearPickupAt'] = now_iso();
        save_doc($pdo, 'requests', (string)$id, $doc, $rev);
    }
}

/**
 * مكان المستشفى لموعد: من دليل المستشفيات المحفوظ، وإلا وجهة رحلة الذهاب إليه (تُحفظ عند استلام الضيف)،
 * لأن الدليل قد لا يُحفظ في قاعدة البيانات (يُستعمل الدليل الأولي في الصفحة).
 */
function pickup_point(PDO $pdo, string $appointmentId): ?array
{
    $appointment = appointment_doc($pdo, $appointmentId);
    $hospitalId = $appointment['hospitalId'] ?? null;
    if (is_string($hospitalId) && $hospitalId !== '') {
        $stmt = $pdo->prepare("SELECT data FROM docs WHERE col = 'hospitals' AND id = ?");
        $stmt->execute([$hospitalId]);
        $hospital = decode_doc($stmt->fetchColumn() ?: null);
        if (is_numeric($hospital['lat'] ?? null) && is_numeric($hospital['lng'] ?? null)) return [(float)$hospital['lat'], (float)$hospital['lng']];
    }
    $like = '%' . addcslashes('"appointmentId":' . json_encode($appointmentId, JSON_UNESCAPED_UNICODE), '%_\\') . '%';
    $stmt = $pdo->prepare("SELECT data FROM docs WHERE col = 'requests' AND data LIKE ?");
    $stmt->execute([$like]);
    foreach ($stmt->fetchAll(PDO::FETCH_COLUMN) as $raw) {
        $request = decode_doc($raw);
        if (($request['appointmentId'] ?? null) !== $appointmentId || ($request['direction'] ?? '') !== 'ذهاب') continue;
        if (is_numeric($request['destLat'] ?? null) && is_numeric($request['destLng'] ?? null)) return [(float)$request['destLat'], (float)$request['destLng']];
    }
    return null;
}

/**
 * ترحيل مرة واحدة (النسخة 3): حالة كل سيارة الآن بداية سجل التوفر في الخدمة، ووقت تسجيل المواعيد السابقة
 * من سجل العمليات (أول «إضافة موعد» لكل موعد).
 */
function migrate_tracking(PDO $pdo): void
{
    $pdo->beginTransaction();
    try {
        record_vehicle_states($pdo);
        $first = [];
        foreach ($pdo->query("SELECT ref, MIN(at) AS at FROM activity WHERE action = 'appointment.create' AND ref <> '' GROUP BY ref") as $row) {
            $first[(string)$row['ref']] = (string)$row['at'];
        }
        if ($first) {
            $rev = null;
            foreach ($pdo->query("SELECT id, data FROM docs WHERE col = 'appointments' AND data IS NOT NULL")->fetchAll() as $row) {
                $doc = decode_doc($row['data']);
                $id = (string)$row['id'];
                if (!$doc || isset($doc['addedAt']) || !isset($first[$id])) continue;
                $rev ??= next_revision($pdo);
                $doc['addedAt'] = $first[$id];
                save_doc($pdo, 'appointments', $id, $doc, $rev);
            }
        }
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}

/**
 * حالات السيارات في الخدمة لفترة الإحصائيات (المدير ومشرف السيارات): حالة كل سيارة قبل بداية الفترة،
 * ثم كل تغيير فيها، ومتى بدأ التسجيل.
 */
function route_service_log(PDO $pdo): array
{
    require_role(current_user($pdo), ['admin', 'fleetSupervisor']);
    $since = (string)($_GET['since'] ?? '');
    $until = (string)($_GET['until'] ?? '');
    foreach ([$since, $until] as $time) {
        if ($time !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/', $time)) throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
    }
    $columns = 'e.at, e.plate, e.kind, e.available, e.has_driver, e.bus_role, e.driver';
    $events = [];
    if ($since !== '') {
        $stmt = $pdo->prepare("SELECT $columns FROM vehicle_events e
            JOIN (SELECT plate, MAX(id) AS id FROM vehicle_events WHERE at < ? GROUP BY plate) latest ON latest.id = e.id");
        $stmt->execute([$since]);
        $events = $stmt->fetchAll();
    }
    $stmt = $pdo->prepare("SELECT $columns FROM vehicle_events e WHERE (? = '' OR e.at >= ?) AND (? = '' OR e.at < ?) ORDER BY e.id LIMIT 50000");
    $stmt->execute([$since, $since, $until, $until]);
    $events = array_merge($events, $stmt->fetchAll());
    return [
        'events' => array_map(fn(array $row) => [
            'at' => (string)$row['at'],
            'plate' => (string)$row['plate'],
            'kind' => (string)$row['kind'],
            'available' => (bool)$row['available'],
            'hasDriver' => (bool)$row['has_driver'],
            'busRole' => (string)$row['bus_role'],
            'driver' => (string)$row['driver'],
        ], $events),
        'trackedSince' => $pdo->query('SELECT MIN(at) FROM vehicle_events')->fetchColumn() ?: null,
        'serverTime' => now_iso(),
    ];
}
