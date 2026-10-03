<?php
declare(strict_types=1);

/**
 * تطبيق السائق: رحلات سيارته فقط (لا يرى بيانات باقي الضيوف)، وتسجيل وصوله إلى نقطة الاستلام
 * واستلام الضيف بموقع هاتفه لحظتها. ما يسجّله ينتظر تأكيد مشرف المبنى (أو يُقبل تلقائيًا بعد المهلة).
 */

/** خانات الموعد التي يحتاجها السائق (بلا حالة السرطان ولا بيانات الإلغاء) */
const DRIVER_APPOINTMENT_FIELDS = ['id', 'patientName', 'clinic', 'buildingNumber', 'apartmentNumber', 'mobile', 'appointmentDate',
    'appointmentAt', 'hospitalId', 'category', 'kind', 'assistance', 'status', 'gender'];
/** رحلات لم تنتهِ بعد: تظهر للسائق ولو كان موعدها أمس (مثل عودة بعد منتصف الليل) */
const DRIVER_ACTIVE_STATUSES = ['تم إرسال السيارة', 'وصلت السيارة', 'تم استلام المريض'];

function qatar_today(): string
{
    return (new DateTimeImmutable('now', new DateTimeZone('Asia/Qatar')))->format('Y-m-d');
}

/** حساب السائق بلا سيارة: لم يُربط بسائق، أو لم يخصص مشرف السيارات لسائقه سيارة */
const NO_VEHICLE_MESSAGE = 'لا توجد سيارة مخصصة لك الآن. يختار مشرف السيارات السائق لكل سيارة في بداية الشفت.';

/** السيارة المخصصة لسائق الحساب الآن (users.vehicle_plate يحسبه drivers.php) */
function driver_plate(array $user): string
{
    $plate = (string)($user['vehicle_plate'] ?? '');
    if ($plate === '' || !valid_doc_id($plate)) throw new ApiException(400, NO_VEHICLE_MESSAGE, 'no_vehicle');
    return $plate;
}

/** كل طلبات السيارة (البحث في JSON ثم التأكد من رقم السيارة نفسه). */
function plate_requests(PDO $pdo, string $plate): array
{
    $stmt = $pdo->prepare("SELECT id, data FROM docs WHERE col = 'requests' AND data LIKE ?");
    $stmt->execute(['%' . addcslashes('"vehiclePlate":' . json_encode($plate, JSON_UNESCAPED_UNICODE), '%_\\') . '%']);
    $requests = [];
    foreach ($stmt as $row) {
        $request = decode_doc($row['data']);
        if ($request && ($request['vehiclePlate'] ?? null) === $plate) $requests[] = $request;
    }
    return $requests;
}

/** للموعد طلب «عودة الـ Nurse فقط» (الـ Nurse عادت أو تعود وحدها قبل الضيف). */
function nurse_went_back(PDO $pdo, string $appointmentId): bool
{
    $key = '%"appointmentId":' . json_encode($appointmentId, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . '%';
    $stmt = $pdo->prepare("SELECT 1 FROM docs WHERE col = 'requests' AND data IS NOT NULL AND data LIKE ? AND data LIKE '%\"nurseOnly\":true%' LIMIT 1");
    $stmt->execute([$key]);
    return (bool)$stmt->fetchColumn();
}

function route_driver_trips(PDO $pdo): array
{
    $user = current_user($pdo);
    require_role($user, ['driver']);
    $plate = driver_plate($user);
    $today = qatar_today();
    $requests = [];
    $appointments = [];
    // اسم الضيف الإنجليزي من قائمة ضيوف المجمع (لواجهة السائق بالإنجليزية والأردية)، برقم الموعد
    $namesEn = [];
    $pick = function (array $appointment) use ($pdo, &$namesEn): array {
        $english = guest_name($pdo, $appointment, 'en');
        if ($english !== trim((string)($appointment['patientName'] ?? ''))) $namesEn[(string)$appointment['id']] = $english;
        return array_intersect_key($appointment, array_flip(DRIVER_APPOINTMENT_FIELDS));
    };
    foreach (plate_requests($pdo, $plate) as $request) {
        $appointment = appointment_doc($pdo, (string)($request['appointmentId'] ?? ''));
        if (!$appointment) continue;
        $active = in_array($request['status'] ?? null, DRIVER_ACTIVE_STATUSES, true) && empty($request['arrivedAt']);
        if (($appointment['appointmentDate'] ?? '') !== $today && !$active) continue;
        unset($request['requestedBy']);
        // عودة الضيف بعد أن عادت الـ Nurse وحدها: لا تُحسب الـ Nurse في عدد الأشخاص
        if (($request['direction'] ?? '') === 'عودة' && empty($request['nurseOnly']) && nurse_went_back($pdo, (string)($request['appointmentId'] ?? ''))) {
            $request['nurseBack'] = true;
        }
        $requests[] = $request;
        $appointments[$appointment['id']] = $pick($appointment);
        if (!empty($request['fromAppointmentId']) && ($first = appointment_doc($pdo, (string)$request['fromAppointmentId']))) {
            $appointments[$first['id']] = $pick($first);
        }
    }
    $hospitals = [];
    foreach ($pdo->query("SELECT data FROM docs WHERE col = 'hospitals' AND data IS NOT NULL") as $row) {
        if ($hospital = decode_doc($row['data'])) $hospitals[] = $hospital;
    }
    $stmt = $pdo->prepare("SELECT data FROM docs WHERE col = 'vehicleLocations' AND id = ?");
    $stmt->execute([$plate]);
    $location = decode_doc($stmt->fetchColumn() ?: null);
    return [
        'plate' => $plate,
        'requests' => $requests,
        'appointments' => array_values($appointments),
        'namesEn' => (object)$namesEn,
        'hospitals' => $hospitals,
        'sharing' => (bool)($location['sharing'] ?? false),
        'serverTime' => now_iso(),
    ];
}

/**
 * السائق يسجّل وصوله إلى نقطة الاستلام (arrived) أو استلام الضيف (pickedUp). شرطه أن تكون مشاركة
 * الموقع مفعّلة، ومعه موقع الهاتف لحظة الضغط (يُحفظ مع الطلب ليراه مشرف المبنى).
 */
function route_driver_action(PDO $pdo, array $body): array
{
    $user = current_user($pdo);
    require_role($user, ['driver']);
    $plate = driver_plate($user);
    $id = (string)($body['id'] ?? '');
    $action = (string)($body['action'] ?? '');
    if (!valid_doc_id($id) || !in_array($action, ['arrived', 'pickedUp'], true)) throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
    $lat = $body['lat'] ?? null;
    $lng = $body['lng'] ?? null;
    if (!is_numeric($lat) || !is_numeric($lng) || $lat < 24 || $lat > 27 || $lng < 50 || $lng > 52.5) {
        throw new ApiException(400, 'تعذر تحديد موقعك. تأكد من تشغيل الموقع (GPS) ثم حاول مرة أخرى.', 'location_required');
    }
    $accuracy = is_numeric($body['accuracy'] ?? null) ? (int)round((float)$body['accuracy']) : null;
    $point = ['lat' => round((float)$lat, 6), 'lng' => round((float)$lng, 6), 'accuracy' => $accuracy];

    $pdo->beginTransaction();
    try {
        $lock = function (string $col, string $docId) use ($pdo): ?array {
            $stmt = $pdo->prepare('SELECT data FROM docs WHERE col = ? AND id = ? FOR UPDATE');
            $stmt->execute([$col, $docId]);
            return decode_doc($stmt->fetchColumn() ?: null);
        };
        $location = $lock('vehicleLocations', $plate);
        if (!($location['sharing'] ?? false)) throw new ApiException(409, 'شغّل مشاركة الموقع أولًا، ثم أعد المحاولة.', 'location_required');
        $request = $lock('requests', $id);
        if (!$request || ($request['vehiclePlate'] ?? null) !== $plate) throw new ApiException(404, 'هذه الرحلة ليست لسيارتك.', 'not_found');
        $before = $request;
        $now = now_iso();
        $changedAppointments = [];
        if ($action === 'arrived') {
            if (($request['status'] ?? null) !== 'تم إرسال السيارة') throw new ApiException(409, 'تغيّرت حالة الرحلة. حدّث الصفحة.', 'conflict');
            $request = ['status' => 'وصلت السيارة', 'driverArrivedAt' => $now, 'arrivalGps' => $point, 'arrivalCheck' => 'pending'] + $request;
            unset($request['arrivalCheckBy'], $request['arrivalCheckAt']);
        } else {
            if (($request['status'] ?? null) !== 'وصلت السيارة') throw new ApiException(409, 'تغيّرت حالة الرحلة. حدّث الصفحة.', 'conflict');
            // مدة الطريق يحسبها التطبيق كما يحسبها مشرف المبنى (shared/trips.ts)، والوقت من ساعة الخادم
            $minutes = $body['etaMinutes'] ?? null;
            if (!is_int($minutes) || $minutes < 1 || $minutes > 360) throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
            $eta = gmdate('Y-m-d\TH:i:s.v\Z', time() + $minutes * 60);
            $request = ['status' => 'تم استلام المريض', 'pickedUpAt' => $now, 'etaAt' => $eta, 'pickupGps' => $point, 'pickupCheck' => 'pending'] + $request;
            unset($request['pickupCheckBy'], $request['pickupCheckAt'], $request['destLat'], $request['destLng']);
            if (is_numeric($body['destLat'] ?? null) && is_numeric($body['destLng'] ?? null)) {
                $request['destLat'] = round((float)$body['destLat'], 6);
                $request['destLng'] = round((float)$body['destLng'], 6);
            }
            if (!valid_trip_fields($request)) throw new ApiException(400, 'بيانات غير صالحة', 'bad_request');
            // حالة الموعد كما عند تأكيد مشرف المبنى: العودة تنتهي، والموعد الأول في النقل بين موعدين ينتهي.
            // عودة الـ Nurse فقط لا تغيّر موعد الضيف (يبقى في موعده)
            $appointmentId = (string)($request['appointmentId'] ?? '');
            if (empty($request['nurseOnly']) && ($appointment = $lock('appointments', $appointmentId))) {
                $changedAppointments[$appointmentId] = ['status' => ($request['direction'] ?? '') === 'عودة' ? 'مكتملة' : 'تم استلام المريض'] + $appointment;
            }
            $firstId = (string)($request['fromAppointmentId'] ?? '');
            if ($firstId !== '' && ($first = $lock('appointments', $firstId))) $changedAppointments[$firstId] = ['status' => 'مكتملة'] + $first;
        }
        $rev = next_revision($pdo);
        $entry = describe_write($pdo, 'requests', $id, $before, $request);
        save_doc($pdo, 'requests', $id, $request, $rev);
        if ($entry) log_activity($pdo, $user, $entry[0], $entry[1], $entry[2], $id, $entry[3] + ['gps' => "{$point['lat']},{$point['lng']}" . ($accuracy !== null ? " ±{$accuracy}م" : '')]);
        foreach ($changedAppointments as $appointmentId => $appointment) save_doc($pdo, 'appointments', (string)$appointmentId, $appointment, $rev);
        // الموقع نفسه يحدّث مكان السيارة على الخريطة
        save_doc($pdo, 'vehicleLocations', $plate, ['lat' => $point['lat'], 'lng' => $point['lng'], 'accuracy' => $accuracy, 'updatedAt' => $now, 'driver' => $user['display_name']] + $location, $rev);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
    return ['ok' => true, 'request' => $request];
}
