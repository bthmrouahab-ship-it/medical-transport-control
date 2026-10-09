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
        // مكان الاستلام مستشفى: العودة من مستشفى الموعد، والنقل من مستشفى الموعد الأول أو من مستشفى الاستلام
        $source = ($doc['direction'] ?? '') === 'عودة' ? null : transfer_source($pdo, $doc);
        if ($source !== null && hospital_transfer(appointment_doc($pdo, (string)($doc['appointmentId'] ?? '')))) {
            $point = hospital_point($pdo, (string)($source['hospitalId'] ?? ''));
        } else {
            $from = $doc['fromAppointmentId'] ?? (($doc['direction'] ?? '') === 'عودة' ? ($doc['appointmentId'] ?? null) : null);
            if (!is_string($from) || $from === '') continue;
            $point = pickup_point($pdo, $from);
        }
        if ($point === null || distance_m($lat, $lng, $point[0], $point[1]) > PICKUP_NEAR_RADIUS_M) continue;
        $doc['nearPickupAt'] = now_iso();
        save_doc($pdo, 'requests', (string)$id, $doc, $rev);
    }
}

/** مكان مستشفى من دليل المستشفيات المحفوظ، أو null */
function hospital_point(PDO $pdo, string $hospitalId): ?array
{
    if ($hospitalId === '') return null;
    $stmt = $pdo->prepare("SELECT data FROM docs WHERE col = 'hospitals' AND id = ?");
    $stmt->execute([$hospitalId]);
    $hospital = decode_doc($stmt->fetchColumn() ?: null);
    return is_numeric($hospital['lat'] ?? null) && is_numeric($hospital['lng'] ?? null) ? [(float)$hospital['lat'], (float)$hospital['lng']] : null;
}

/**
 * مكان المستشفى لموعد: من دليل المستشفيات المحفوظ، وإلا وجهة رحلة الذهاب إليه (تُحفظ عند استلام الضيف)،
 * لأن الدليل قد لا يُحفظ في قاعدة البيانات (يُستعمل الدليل الأولي في الصفحة).
 */
function pickup_point(PDO $pdo, string $appointmentId): ?array
{
    $appointment = appointment_doc($pdo, $appointmentId);
    $point = hospital_point($pdo, (string)($appointment['hospitalId'] ?? ''));
    if ($point !== null) return $point;
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

/** فترة الإحصائيات من الطلب (since وuntil بتوقيت UTC بصيغة ISO)، أو 400. */
function stats_range(): array
{
    $since = (string)($_GET['since'] ?? '');
    $until = (string)($_GET['until'] ?? '');
    foreach ([$since, $until] as $time) {
        if ($time !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/', $time)) throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
    }
    return [$since, $until];
}

/** ما يحتاجه حساب سير العمل في الإحصائيات من سجل العمليات: إلغاء طلب السيارة، وتغيير السيارة، وإزالة ضيف من رحلة */
const OPS_ACTIONS = ['request.cancel', 'request.change_car', 'request.remove_from_trip'];

/**
 * أحداث سير العمل لفترة الإحصائيات (المدير ومشرف السيارات)، بلا بيانات الضيف: رقم الموعد والطلب والاتجاه
 * والسيارة (والسابقة عند التغيير) والسبب وحالة الطلب عند إلغائه ومن نفّذها.
 */
function route_ops_log(PDO $pdo): array
{
    require_role(current_user($pdo), ['admin', 'fleetSupervisor']);
    [$since, $until] = stats_range();
    $marks = implode(', ', array_fill(0, count(OPS_ACTIONS), '?'));
    $stmt = $pdo->prepare("SELECT at, action, ref, user_name, details FROM activity
        WHERE action IN ($marks) AND (? = '' OR at >= ?) AND (? = '' OR at < ?) ORDER BY id LIMIT 50000");
    $stmt->execute([...OPS_ACTIONS, $since, $since, $until, $until]);
    $events = [];
    foreach ($stmt->fetchAll() as $row) {
        $details = $row['details'] ? (json_decode($row['details'], true) ?: []) : [];
        $text = fn(string $key) => is_scalar($details[$key] ?? null) ? (string)$details[$key] : '';
        $events[] = [
            'at' => (string)$row['at'],
            'action' => (string)$row['action'],
            'appointment' => $text('appointment'),
            'request' => (string)$row['ref'],
            'direction' => $text('direction'),
            'plate' => $text('plate'),
            'previous' => $text('previous'),
            'reason' => $text('reason'),
            'stage' => $text('stage'),
            'by' => (string)$row['user_name'],
        ];
    }
    return ['events' => $events];
}

/**
 * حالات السيارات في الخدمة لفترة الإحصائيات (المدير ومشرف السيارات): حالة كل سيارة قبل بداية الفترة،
 * ثم كل تغيير فيها، ومتى بدأ التسجيل.
 */
function route_service_log(PDO $pdo): array
{
    require_role(current_user($pdo), ['admin', 'fleetSupervisor']);
    [$since, $until] = stats_range();
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

// ————— مواقع السيارة في الرحلة، ووقوفها في مكانها —————

/** السيارة لم تتحرك ما دامت على هذا البعد بالأمتار من مكان وقوفها (STILL_RADIUS_KM في shared/trips.ts) */
const STILL_RADIUS_M = 100;
/** مسار الرحلة: نقطة جديدة كلما تحركت السيارة هذه المسافة بالأمتار */
const TRACK_STEP_M = 40;
/** أقصى عدد نقاط في مسار رحلة واحدة (بعده تُحذف نقطة من كل نقطتين، ويبقى شكل الطريق) */
const TRACK_MAX_POINTS = 600;
/** مراحل الرحلة الجارية للسيارة (من إرسالها حتى وصولها إلى الوجهة) */
const ACTIVE_TRIP_STATUSES = ['تم إرسال السيارة', 'وصلت السيارة', 'تم استلام المريض'];

/**
 * بداية وقوف السيارة في مكانها (stillLat/stillLng/stillSince في موقعها): تبقى ما دام موقعها الدقيق على بعد
 * STILL_RADIUS_M من مكان الوقوف، وتبدأ من جديد عند تحركها أو بدء مشاركة الموقع. الموقع غير الدقيق لا يغيّرها.
 */
function stamp_still(?array $before, array $after, bool $precise): array
{
    $anchored = ($before['sharing'] ?? false) && is_numeric($before['stillLat'] ?? null) && is_numeric($before['stillLng'] ?? null) && is_string($before['stillSince'] ?? null);
    if ($anchored && (!$precise || distance_m((float)$after['lat'], (float)$after['lng'], (float)$before['stillLat'], (float)$before['stillLng']) <= STILL_RADIUS_M)) {
        return ['stillLat' => $before['stillLat'], 'stillLng' => $before['stillLng'], 'stillSince' => $before['stillSince']] + $after;
    }
    return ['stillLat' => round((float)$after['lat'], 6), 'stillLng' => round((float)$after['lng'], 6), 'stillSince' => now_iso()] + $after;
}

/** طلبات السيارة الجارية الآن (أُرسلت ولم تصل إلى الوجهة)، مرتبة */
function active_trip_ids(PDO $pdo, string $plate): array
{
    $like = fn(string $text) => '%' . addcslashes($text, '%_\\') . '%';
    $stmt = $pdo->prepare("SELECT id, data FROM docs WHERE col = 'requests' AND data LIKE ?");
    $stmt->execute([$like('"vehiclePlate":' . json_encode($plate, JSON_UNESCAPED_UNICODE))]);
    $ids = [];
    foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
        $doc = decode_doc($row['data']);
        if ($doc && ($doc['vehiclePlate'] ?? null) === $plate && in_array($doc['status'] ?? null, ACTIVE_TRIP_STATUSES, true) && !isset($doc['arrivedAt'])) $ids[] = (string)$row['id'];
    }
    sort($ids);
    return $ids;
}

/**
 * مسار السيارة في رحلتها (vehicleTracks/{plate}): مواقعها الدقيقة من إرسالها حتى وصولها، لمشرف السيارات والمدير على الخريطة.
 * يبقى بعد الوصول حتى تبدأ رحلتها التالية فيُمحى ويبدأ من جديد. الرحلة نفسها إذا ضُم إليها ضيف أو وصل بعض ركابها.
 */
function record_track(PDO $pdo, string $plate, float $lat, float $lng, int $rev): void
{
    $active = active_trip_ids($pdo, $plate);
    if (!$active) return;
    $stmt = $pdo->prepare("SELECT data FROM docs WHERE col = 'vehicleTracks' AND id = ? FOR UPDATE");
    $stmt->execute([$plate]);
    $track = decode_doc($stmt->fetchColumn() ?: null);
    $previous = is_array($track['requestIds'] ?? null) ? $track['requestIds'] : [];
    if (!$track || !array_intersect($previous, $active)) {
        $track = ['plate' => $plate, 'requestIds' => $active, 'startedAt' => now_iso(), 'points' => []];
    }
    $points = is_array($track['points'] ?? null) ? $track['points'] : [];
    $last = $points ? $points[count($points) - 1] : null;
    $same = $previous === $active;
    if ($same && $last && distance_m((float)$last[0], (float)$last[1], $lat, $lng) < TRACK_STEP_M) return;
    $points[] = [round($lat, 5), round($lng, 5), time()];
    if (count($points) > TRACK_MAX_POINTS) {
        $kept = [];
        foreach ($points as $index => $point) if ($index % 2 === 0 || $index === count($points) - 1) $kept[] = $point;
        $points = $kept;
    }
    $track['requestIds'] = $active;
    $track['points'] = $points;
    $track['updatedAt'] = now_iso();
    save_doc($pdo, 'vehicleTracks', $plate, $track, $rev);
}

/**
 * انتظار السيارة في المستشفى (waiting في السيارة): الخادم يكتب وقته ومن اختاره، ويُمحى عند إرسال السيارة في رحلة.
 */
function stamp_waiting(array $user, ?array $before, ?array $after): ?array
{
    if ($after === null || !isset($after['waiting'])) return $after;
    $old = $before['waiting'] ?? null;
    $same = is_array($old) && ($old['place'] ?? null) === ($after['waiting']['place'] ?? null) && ($old['appointmentId'] ?? null) === ($after['waiting']['appointmentId'] ?? null)
        && isset($old['since']);
    $after['waiting']['since'] = $same ? $old['since'] : now_iso();
    $after['waiting']['by'] = $same && isset($old['by']) ? $old['by'] : (string)$user['display_name'];
    return $after;
}

/** أُرسلت السيارة في رحلة (طلب جديد لها): ينتهي انتظارها في المستشفى. داخل معاملة المستدعي. */
function end_waiting_on_dispatch(PDO $pdo, ?array $before, ?array $after, int $rev): void
{
    $plate = $after['vehiclePlate'] ?? null;
    if (!is_string($plate) || $plate === '' || ($after['status'] ?? null) !== 'تم إرسال السيارة') return;
    if (($before['vehiclePlate'] ?? null) === $plate && ($before['status'] ?? null) === 'تم إرسال السيارة') return;
    $stmt = $pdo->prepare("SELECT data FROM docs WHERE col = 'fleet' AND id = ? FOR UPDATE");
    $stmt->execute([$plate]);
    $vehicle = decode_doc($stmt->fetchColumn() ?: null);
    if (!$vehicle || !isset($vehicle['waiting'])) return;
    unset($vehicle['waiting']);
    save_doc($pdo, 'fleet', $plate, $vehicle, $rev);
}
