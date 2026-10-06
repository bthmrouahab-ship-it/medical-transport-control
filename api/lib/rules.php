<?php
declare(strict_types=1);

/**
 * صلاحيات الكتابة حسب الدور (كانت في firestore.rules).
 * كل عملية تُفحص قبل الحفظ: $before المستند الحالي أو null، و$after المستند بعد التعديل أو null عند الحذف.
 */

const APPOINTMENT_STATUSES = ['بانتظار طلب السيارة', 'تم طلب السيارة', 'تم استلام المريض', 'طلب عودة', 'مكتملة', 'ملغي'];
const APPOINTMENT_FIELDS = ['id', 'guestId', 'patientName', 'clinic', 'buildingNumber', 'apartmentNumber', 'mobile', 'appointmentDate',
    'appointmentAt', 'hospitalId', 'category', 'kind', 'assistance', 'status', 'cancelReason', 'cancelledBy', 'cancelledAt',
    'gender', 'cancer', 'returnedSelf', 'returnedSelfBy', 'returnedSelfAt', 'approval', 'approvedBy', 'approvedAt', 'excludedBy', 'excludedAt',
    'returnOnly', 'nurse', 'appointmentType', 'seriesId', 'returnAt', 'addedAt', '_o'];
/** موافقة مسؤول العيادة: بانتظار الموافقة، أو موافق عليه (باسمه ووقته)، أو مستبعد بلا حذف (باسمه ووقته) */
const APPROVAL_FIELDS = ['approval', 'approvedBy', 'approvedAt', 'excludedBy', 'excludedAt'];
/** بيانات الموعد نفسه: تعديل العيادة لها يعيد الموعد إلى انتظار موافقة مسؤولها */
const APPOINTMENT_CONTENT_FIELDS = ['guestId', 'patientName', 'clinic', 'buildingNumber', 'apartmentNumber', 'mobile', 'appointmentDate', 'appointmentAt',
    'hospitalId', 'category', 'kind', 'assistance', 'gender', 'cancer', 'returnOnly', 'nurse', 'appointmentType'];
/** الضيف عاد إلى المجمع بنفسه بلا سيارة عودة (يسجّله مشرف المبنى باسمه ووقته) */
const SELF_RETURN_FIELDS = ['returnedSelf', 'returnedSelfBy', 'returnedSelfAt'];
/** خانات إلغاء الموعد (السبب إلزامي، ومن ألغاه، ومتى) */
const CANCEL_FIELDS = ['cancelReason', 'cancelledBy', 'cancelledAt'];
const REQUEST_STATUSES = ['بانتظار التوزيع', 'تم إرسال السيارة', 'وصلت السيارة', 'تم استلام المريض', 'وصلت الوجهة'];
/** رد مشرف المبنى على ما سجّله السائق من تطبيقه (الوصول والاستلام) */
const CHECK_FIELDS = ['arrivalCheck', 'arrivalCheckBy', 'arrivalCheckAt', 'pickupCheck', 'pickupCheckBy', 'pickupCheckAt'];
/** مهلة رد مشرف المبنى بالثواني؛ بعدها يُعتبر ما سجّله السائق مقبولًا (نفس القيمة في shared/driverChecks.ts) */
const CHECK_SECONDS = 300;
/** تغيير السيارة بعد إرسالها (عطل أو حادث أو تأخر): السيارة السابقة، والسبب، ووقت التغيير */
const VEHICLE_CHANGE_FIELDS = ['previousPlate', 'changeReason', 'changedAt'];
/** إزالة ضيف من رحلة جارية (لم يركب، أو سُجّل استلامه خطأً): السيارة التي أُزيل منها، والسبب، والوقت */
const TRIP_REMOVAL_FIELDS = ['removedFrom', 'removeReason', 'removedAt'];
/** ما يُمحى من الطلب حين يعود إلى «بانتظار التوزيع» بعد إزالته من رحلة: السيارة وكل مراحل الرحلة */
const TRIP_RESET_FIELDS = ['vehiclePlate', 'driver', 'groupId', 'notificationSentAt', 'pickedUpAt', 'etaAt', 'destLat', 'destLng', 'arrivedAt', 'arrivalSource',
    'driverArrivedAt', 'arrivalGps', 'pickupGps', 'arrivalCheck', 'arrivalCheckBy', 'arrivalCheckAt', 'pickupCheck', 'pickupCheckBy', 'pickupCheckAt',
    'previousPlate', 'changeReason', 'changedAt'];
/** حالة الموعد قبل استلام الضيف: إزالة ضيف سُجّل استلامه من الرحلة تعيدها (الذهاب، والعودة، والموعد الأول في النقل) */
const TRIP_UNDO_APPOINTMENT_STATUS = [['تم استلام المريض', 'تم طلب السيارة'], ['مكتملة', 'طلب عودة'], ['مكتملة', 'تم استلام المريض']];
const REQUEST_FIELDS = ['id', 'appointmentId', 'vehiclePlate', 'driver', 'direction', 'status', 'notificationMethod',
    'createdAt', 'requestedOn', 'autoReturn', 'groupId', 'notificationSentAt', 'requestedBy', 'pickedUpAt', 'etaAt', 'destLat', 'destLng', 'arrivedAt', 'arrivalSource',
    'fromAppointmentId', 'nurseOnly', 'driverArrivedAt', 'arrivalGps', 'pickupGps', ...CHECK_FIELDS, ...VEHICLE_CHANGE_FIELDS, ...TRIP_REMOVAL_FIELDS,
    // يكتبها الخادم وحده للإحصائيات (stamp_tracking في tracking.php)
    'pickupArrivedAt', 'nearPickupAt', '_o'];
/** خانات مرحلة الطريق إلى الوجهة (تُكتب عند استلام المريض وعند الوصول) */
const TRIP_FIELDS = ['pickedUpAt', 'etaAt', 'destLat', 'destLng', 'arrivedAt', 'arrivalSource'];
/** driver وphone: اسم السائق المخصص للسيارة ورقمه، منسوخان من قائمة السائقين (driverId) ويحدّثهما الخادم */
const VEHICLE_FIELDS = ['plate', 'driver', 'phone', 'kind', 'available', 'busRole', 'fullCapacity', 'driverId', 'driverSince', '_o'];
/** تخصيص السائق للسيارة (مشرف السيارات في بداية الشفت) */
const VEHICLE_DRIVER_FIELDS = ['driverId', 'driver', 'phone', 'driverSince'];
/** قائمة السائقين (المدير): uid حساب تطبيق السائق المرتبط به، يربطه المدير من «المستخدمين» فقط */
const DRIVER_FIELDS = ['id', 'name', 'phone', 'uid', '_o'];
/** من يرى قائمة السائقين: المدير ومشرف السيارات (يخصصهم للسيارات) */
const DRIVER_LIST_ROLES = ['admin', 'fleetSupervisor'];
const VEHICLE_KINDS = ['سيدان', 'احتياجات خاصة', 'باص'];
/**
 * تخصيص السيارة (نفس القيم في shared/transport.ts): للباص باص المجمع أو باص الجامعة (الرحلات غير الطبية) أو باص العيادة،
 * ولسيارة الاحتياجات الخاصة «سيارة المدارس» (محجوزة في أوقات المدارس وتبقى في الخدمة)
 */
const BUS_ROLE_VALUES = ['shuttle', 'nonMedical', 'clinic'];
const SCHOOL_ROLE = 'school';
const BUS_ROLE_LABELS = ['shuttle' => 'باص المجمع', 'nonMedical' => 'باص الجامعة', 'clinic' => 'باص العيادة', 'school' => 'سيارة المدارس'];
/** إنهاء مشرف السيارات لرحلة عالقة يقدّم حالة الموعد كما عند استلام الضيف: [قبل => بعد] */
const TRIP_END_APPOINTMENT_STATUS = ['تم طلب السيارة' => 'تم استلام المريض', 'طلب عودة' => 'مكتملة', 'تم استلام المريض' => 'مكتملة'];
const HOSPITAL_FIELDS = ['id', 'name', 'nameEn', 'zone', 'lat', 'lng', 'aliases', 'verified', '_o'];
/**
 * قائمة ضيوف المجمع (يرفعها المدير). العمر والرقم الصحي لا يُرسلان مع القائمة (يظهران في الإحصائيات فقط عبر guests-stats).
 * المزامنة للمدير والعيادة ومسؤولها فقط.
 */
/** nurse: ممرضة من قائمة الممرضات (يُطلب لها سيارة مثل الضيف)، organization: جهة عملها */
const GUEST_FIELDS = ['id', 'name', 'nameEn', 'gender', 'mobile', 'buildingNumber', 'apartmentNumber', 'age', 'healthNumber', 'nurse', 'organization', '_o'];
const GUEST_PRIVATE_FIELDS = ['age', 'healthNumber'];
/** أقل من هذا العمر: المرافق إلزامي في الموعد الطبي إلا مع Nurse (نفس MINOR_AGE في shared/guests.ts) */
const MINOR_AGE = 18;
/** من يرى قائمة الضيوف: المدير والعيادة ومسؤولها، ومشرف السيارات (الرحلات غير الطبية من القائمة) */
const GUEST_LIST_ROLES = ['admin', 'clinic', 'clinicLead', 'fleetSupervisor'];
/** من يرى العمر والرقم الصحي (من يرى الإحصائيات) */
const GUEST_STATS_ROLES = ['admin', 'fleetSupervisor'];
/** بيانات الضيف في الموعد: يجب أن تطابق القائمة */
const APPOINTMENT_GUEST_FIELDS = ['guestId', 'patientName', 'buildingNumber', 'apartmentNumber', 'nurse'];
/**
 * السيارات الخاصة (يرفعها المدير): ضيوف الشقة التي لها سيارة خاصة (صاحبها وعائلته) لا يُضاف لهم موعد ولا رحلة.
 * القائمة نفسها (اسم المالك ورقم المركبة) للمدير فقط، وتصل علامة privateCar مع كل ضيف في الشقة (public_doc).
 */
const PRIVATE_CAR_FIELDS = ['id', 'name', 'plate', 'buildingNumber', 'apartmentNumber', '_o'];
const PRIVATE_CAR_MESSAGE = 'هذا الشخص يمتلك سيارة خاصة ولا يمكنه استخدام سيارات المجمع';
/**
 * ذوو الاحتياجات الخاصة (يرفعهم المدير، مثل قائمة مستخدمي الكرسي المتحرك): يُستثنى الشخص نفسه من منع السيارات الخاصة،
 * وتظهر ملاحظة «احتياجات خاصة» عند تسجيل موعده. الضيف برقم guestId المطابق، أو برقمه الصحي. القائمة للمدير فقط.
 */
const SPECIAL_NEED_FIELDS = ['id', 'name', 'gender', 'healthNumber', 'buildingNumber', 'apartmentNumber', 'mobile', 'guestId', '_o'];
/** المجموعات التي تُزامن مع موظفي المكتب */
const SYNC_COLLECTIONS = ['appointments', 'requests', 'fleet', 'hospitals', 'vehicleLocations', 'meta', 'guests', 'drivers', 'privateCars', 'specialNeeds'];

/**
 * مجموعات المزامنة لهذا المستخدم: قائمة الضيوف للمدير والعيادة ومشرف السيارات، وقائمة السائقين للمدير ومشرف السيارات،
 * وقائمة السيارات الخاصة للمدير فقط
 */
function sync_collections(array $user): array
{
    return array_values(array_filter(SYNC_COLLECTIONS, fn(string $col) => ($col !== 'guests' || in_array($user['role'], GUEST_LIST_ROLES, true))
        && ($col !== 'drivers' || in_array($user['role'], DRIVER_LIST_ROLES, true))
        && (!in_array($col, ['privateCars', 'specialNeeds'], true) || $user['role'] === 'admin')));
}

/** المبنى والشقة للمطابقة: بأحرف كبيرة وبلا أصفار في البداية (03 = 3، و001 = 1) — نفس unitKey في shared/guests.ts */
function unit_key($building, $apartment): string
{
    $part = fn($value) => (string)preg_replace('/^0+(?=\d)/', '', strtoupper(trim((string)$value)));
    return $part($building) . '/' . $part($apartment);
}

/** شقق السيارات الخاصة (مفتاح unit_key ← true). $refresh بعد تغيير القائمة في نفس الطلب */
function private_car_units(bool $refresh = false): array
{
    static $units = null;
    if ($units !== null && !$refresh) return $units;
    $units = [];
    foreach (db()->query("SELECT data FROM docs WHERE col = 'privateCars' AND data IS NOT NULL") as $row) {
        $car = decode_doc($row['data']);
        if ($car) $units[unit_key($car['buildingNumber'] ?? '', $car['apartmentNumber'] ?? '')] = true;
    }
    return $units;
}

/**
 * الأرقام الصحية للمطابقة: الأرقام فقط بلا أصفار في البداية. الخانة قد تحوي أكثر من رقم («08828393/08815535»):
 * كل رقم من 5 خانات فأكثر وحده، وإلا الخانة كلها رقم واحد.
 */
function health_keys($value): array
{
    $keys = [];
    foreach (preg_split('/[\/,;|&\s]+/', (string)$value, -1, PREG_SPLIT_NO_EMPTY) ?: [] as $part) {
        $key = ltrim((string)preg_replace('/\D+/', '', $part), '0');
        if (strlen($key) >= 5) $keys[$key] = true;
    }
    if (!$keys) {
        $key = ltrim((string)preg_replace('/\D+/', '', (string)$value), '0');
        if ($key !== '') $keys[$key] = true;
    }
    return array_keys($keys);
}

/** ذوو الاحتياجات الخاصة: أرقام الضيوف المطابقين، وأرقامهم الصحية (لمن أُضيف إلى قائمة الضيوف بعدها) */
function special_needs_index(bool $refresh = false): array
{
    static $index = null;
    if ($index !== null && !$refresh) return $index;
    $index = ['ids' => [], 'health' => []];
    foreach (db()->query("SELECT data FROM docs WHERE col = 'specialNeeds' AND data IS NOT NULL") as $row) {
        $entry = decode_doc($row['data']);
        if (!$entry) continue;
        if (!empty($entry['guestId'])) $index['ids'][(string)$entry['guestId']] = true;
        foreach (health_keys($entry['healthNumber'] ?? '') as $health) $index['health'][$health] = true;
    }
    return $index;
}

/** الضيف في قائمة ذوي الاحتياجات الخاصة (بالرقم المطابق أو الرقم الصحي) */
function guest_special_needs(?array $guest, ?array $index = null): bool
{
    if (!$guest) return false;
    $index ??= special_needs_index();
    if (isset($index['ids'][(string)($guest['id'] ?? '')])) return true;
    foreach (health_keys($guest['healthNumber'] ?? '') as $health) if (isset($index['health'][$health])) return true;
    return false;
}

/**
 * الضيف يسكن في شقة لها سيارة خاصة (الممرضات خارج هذا الشرط: سكنهن مشترك). صاحب الاحتياجات الخاصة نفسه مستثنى
 * (ويبقى المنع لباقي من يسكن معه).
 */
function guest_has_private_car(?array $guest, ?array $units = null, ?array $special = null): bool
{
    if (!$guest || ($guest['nurse'] ?? null) === true) return false;
    if (guest_special_needs($guest, $special)) return false;
    $units ??= private_car_units();
    return isset($units[unit_key($guest['buildingNumber'] ?? '', $guest['apartmentNumber'] ?? '')]);
}

/** شخص من ذوي الاحتياجات الخاصة: الاسم أو الرقم الصحي أو الضيف المطابق، وبقية الخانات نصوص قصيرة */
function valid_special_need(array $data, string $id): bool
{
    $text = fn(string $field, int $max) => !array_key_exists($field, $data) || is_text($data[$field], $max);
    return only(array_keys($data), SPECIAL_NEED_FIELDS)
        && ($data['id'] ?? null) === $id
        && $text('name', 120) && $text('healthNumber', 30) && $text('buildingNumber', 20) && $text('apartmentNumber', 20) && $text('mobile', 20)
        && in_array($data['gender'] ?? 'ذكر', ['ذكر', 'أنثى'], true)
        && (!array_key_exists('guestId', $data) || (is_string($data['guestId']) && valid_doc_id($data['guestId'])))
        && (trim((string)($data['name'] ?? '')) !== '' || health_keys($data['healthNumber'] ?? '') || !empty($data['guestId']));
}

/** يعيد إرسال ضيوف بأرقامهم أو أرقامهم الصحية في المزامنة القادمة (تغيّرت علامة الاحتياجات الخاصة) */
function touch_guests(PDO $pdo, array $ids, array $health, int $rev): void
{
    if (!$ids && !$health) return;
    $update = $pdo->prepare("UPDATE docs SET rev = ? WHERE col = 'guests' AND id = ?");
    foreach ($pdo->query("SELECT id, data FROM docs WHERE col = 'guests' AND data IS NOT NULL") as $row) {
        $guest = decode_doc($row['data']);
        if (!$guest) continue;
        $match = isset($ids[(string)$row['id']]);
        foreach (health_keys($guest['healthNumber'] ?? '') as $key) $match = $match || isset($health[$key]);
        if ($match) $update->execute([$rev, $row['id']]);
    }
}

/** سيارة خاصة لشقة: المبنى والشقة إلزاميان، واسم المالك ورقم المركبة اختياريان */
function valid_private_car(array $data, string $id): bool
{
    $unit = fn($value) => is_text($value, 20) && trim($value) !== '';
    return only(array_keys($data), PRIVATE_CAR_FIELDS)
        && ($data['id'] ?? null) === $id
        && $unit($data['buildingNumber'] ?? null) && $unit($data['apartmentNumber'] ?? null)
        && (!array_key_exists('name', $data) || is_text($data['name'], 120))
        && (!array_key_exists('plate', $data) || is_text($data['plate'], 20));
}

/**
 * يعيد إرسال ضيوف الشقق التي تغيّرت سيارتها الخاصة في المزامنة القادمة (رقم مراجعة جديد بلا تغيير في البيانات)،
 * فتتحدث علامة privateCar عند العيادة فورًا.
 */
function touch_unit_guests(PDO $pdo, array $unitKeys, int $rev): void
{
    if (!$unitKeys) return;
    $update = $pdo->prepare("UPDATE docs SET rev = ? WHERE col = 'guests' AND id = ?");
    foreach ($pdo->query("SELECT id, data FROM docs WHERE col = 'guests' AND data IS NOT NULL") as $row) {
        $guest = decode_doc($row['data']);
        if ($guest && isset($unitKeys[unit_key($guest['buildingNumber'] ?? '', $guest['apartmentNumber'] ?? '')])) $update->execute([$rev, $row['id']]);
    }
}

/** سائق من قائمة السائقين: الاسم إلزامي، والرقم 8 إلى 15 رقمًا إن وُجد، وحساب التطبيق لا يتغير هنا (يربطه المدير من «المستخدمين») */
function valid_driver(array $data, string $id, ?array $before): bool
{
    return only(array_keys($data), DRIVER_FIELDS)
        && ($data['id'] ?? null) === $id
        && is_text($data['name'] ?? null, 60) && mb_strlen(trim($data['name'])) >= 2
        && (!array_key_exists('phone', $data) || (is_string($data['phone']) && preg_match('/^\+?\d{8,15}$/', $data['phone'])))
        && ($data['uid'] ?? null) === ($before['uid'] ?? null);
}

/** السائق المخصص للسيارة موجود في قائمة السائقين (أو بلا سائق)، ووقت تخصيصه نص قصير */
function valid_vehicle_driver(array $vehicle, ?callable $docOf): bool
{
    $driverId = $vehicle['driverId'] ?? null;
    if ($driverId !== null && (!is_string($driverId) || !preg_match('/^[A-Za-z0-9._:-]{1,160}$/', $driverId) || !$docOf || $docOf('drivers', $driverId) === null)) return false;
    return (!array_key_exists('driverSince', $vehicle) || is_text($vehicle['driverSince'], 30))
        && is_text($vehicle['driver'] ?? '', 60) && is_text($vehicle['phone'] ?? '', 20);
}

/**
 * المستند كما يُرسل في المزامنة: قائمة الضيوف بلا العمر والرقم الصحي، ومعها علامة minor لمن هو أقل من 18 سنة
 * (حتى يضيف نموذج الموعد المرافق تلقائيًا دون أن يصل العمر نفسه).
 */
function public_doc(string $col, ?array $data, ?array $privateUnits = null): ?array
{
    if ($col !== 'guests' || $data === null) return $data;
    $minor = guest_is_minor($data);
    // قبل حذف الرقم الصحي: به يُعرف صاحب الاحتياجات الخاصة
    $special = guest_special_needs($data);
    $privateCar = !$special && guest_has_private_car($data, $privateUnits);
    foreach (GUEST_PRIVATE_FIELDS as $field) unset($data[$field]);
    if ($minor) $data['minor'] = true;
    // صاحب احتياجات خاصة: ملاحظة عند تسجيل الموعد، ومستثنى من منع السيارات الخاصة
    if ($special) $data['specialNeeds'] = true;
    // يسكن في شقة لها سيارة خاصة: لا يُضاف له موعد
    if ($privateCar) $data['privateCar'] = true;
    return $data;
}

function guest_is_minor(?array $guest): bool
{
    return is_int($guest['age'] ?? null) && $guest['age'] < MINOR_AGE;
}

function valid_guest(array $data, string $id): bool
{
    $unit = fn($value) => is_text($value, 20) && trim($value) !== '';
    return only(array_keys($data), GUEST_FIELDS)
        && ($data['id'] ?? null) === $id
        && is_text($data['name'] ?? null, 120) && trim($data['name']) !== ''
        && (!array_key_exists('nameEn', $data) || is_text($data['nameEn'], 120))
        && in_array($data['gender'] ?? 'ذكر', ['ذكر', 'أنثى'], true)
        && (!array_key_exists('mobile', $data) || (is_string($data['mobile']) && preg_match('/^\+?\d{7,15}$/', $data['mobile'])))
        && $unit($data['buildingNumber'] ?? null) && $unit($data['apartmentNumber'] ?? null)
        && (!array_key_exists('age', $data) || (is_int($data['age']) && $data['age'] >= 0 && $data['age'] <= 130))
        && (!array_key_exists('healthNumber', $data) || is_text($data['healthNumber'], 30))
        && ($data['nurse'] ?? true) === true
        && (!array_key_exists('organization', $data) || is_text($data['organization'], 120));
}

/**
 * موعد العيادة لضيف من قائمة ضيوف المجمع ولمستشفى من الدليل: الاسم والمبنى والشقة كما في القائمة،
 * والوجهة اسم المستشفى كما في الدليل. $changed = null عند الإضافة (يُفحص كل شيء)، وعند التعديل ما تغيّر فقط.
 * $docOf(col, id) يقرأ المستند المحفوظ، و$docOf(col, null) أي مستند من المجموعة (لمعرفة هل هي فارغة).
 */
function registry_error(array $appointment, callable $docOf, ?array $changed = null, bool $hospital = true): ?string
{
    $guestChanged = $changed === null || (bool)array_intersect($changed, APPOINTMENT_GUEST_FIELDS);
    // الضيف أقل من 18 سنة: يُفحص عند تغيّر الضيف أو احتياجاته
    $needsChanged = $changed === null || (bool)array_intersect($changed, ['guestId', 'assistance']);
    if ($guestChanged || $needsChanged) {
        $guestId = $appointment['guestId'] ?? null;
        $guest = is_string($guestId) && preg_match('/^[A-Za-z0-9._:-]{1,160}$/', $guestId) ? $docOf('guests', $guestId) : null;
        if ($guestChanged) {
            if ($guest === null) return 'الضيف غير موجود في قائمة ضيوف المجمع';
            foreach (['patientName' => 'name', 'buildingNumber' => 'buildingNumber', 'apartmentNumber' => 'apartmentNumber'] as $field => $source) {
                if (($appointment[$field] ?? null) !== ($guest[$source] ?? null)) return 'بيانات الضيف لا تطابق قائمة ضيوف المجمع';
            }
            // موعد الممرضة يحمل علامتها كما في القائمة
            if ((($appointment['nurse'] ?? null) === true) !== (($guest['nurse'] ?? null) === true)) return 'بيانات الضيف لا تطابق قائمة ضيوف المجمع';
            // صاحب سيارة خاصة أو من يسكن معه في نفس الشقة
            if (guest_has_private_car($guest)) return PRIVATE_CAR_MESSAGE;
        }
        $assistance = is_array($appointment['assistance'] ?? null) ? $appointment['assistance'] : [];
        // في الموعد الطبي فقط: الرحلة غير الطبية بلا مرافق إلزامي
        $medical = ($appointment['category'] ?? null) !== 'غير طبية';
        if ($medical && guest_is_minor($guest) && !in_array('يحتاج مرافق', $assistance, true) && !in_array('يحتاج Nurse', $assistance, true)) {
            return 'الضيف أقل من 18 سنة: يحتاج مرافقًا (إلا إن كان معه Nurse)';
        }
    }
    // الرحلة غير الطبية: الضيف من القائمة، والوجهة ليست مستشفى
    if ($hospital && ($changed === null || array_intersect($changed, ['hospitalId', 'clinic']))) {
        $hospitalId = $appointment['hospitalId'] ?? null;
        if (!is_string($hospitalId) || !preg_match('/^[A-Za-z0-9._:-]{1,160}$/', $hospitalId)) return 'المستشفى غير موجود في دليل المستشفيات';
        $hospital = $docOf('hospitals', $hospitalId);
        // قبل أن يُحفظ الدليل في قاعدة البيانات (عند أول دخول للمدير) يُقبل مستشفى من الدليل الأولي في الصفحة
        if ($hospital === null) return $docOf('hospitals', null) === null ? null : 'المستشفى غير موجود في دليل المستشفيات';
        if (($appointment['clinic'] ?? null) !== ($hospital['name'] ?? null)) return 'المستشفى غير موجود في دليل المستشفيات';
    }
    return null;
}

/** الخانات التي تغيّرت بين نسختين من المستند */
function changed_keys(array $before, array $after): array
{
    $keys = [];
    foreach (array_unique(array_merge(array_keys($before), array_keys($after))) as $key) {
        if (!array_key_exists($key, $before) || !array_key_exists($key, $after) || $before[$key] !== $after[$key]) $keys[] = $key;
    }
    return $keys;
}

function only(array $keys, array $allowed): bool
{
    return !array_diff($keys, $allowed);
}

function is_text($value, int $max): bool
{
    return is_string($value) && mb_strlen($value) <= $max;
}

function has_role(array $user, array $roles): bool
{
    return in_array($user['role'], $roles, true);
}

/**
 * الطلب (ذهابًا أو عودة) يتابعه مشرف المبنى الذي طلبه فقط، ومسؤول مشرفي المباني يتابع كل الطلبات
 * (ومسؤول العيادة كل طلبات الممرضات).
 * الطلب القديم أو الذي أضافه مشرف السيارات بلا مالك يتابعه أي مشرف مبنى.
 */
function follows_request(array $user, ?array $request): bool
{
    // مسؤول العيادة يتابع كل طلبات الممرضات (يُستدعى لها فقط)
    if ($user['role'] === 'buildingLead' || $user['role'] === 'clinicLead') return true;
    $owner = $request['requestedBy'] ?? null;
    return $owner === null || $owner === (string)$user['id'];
}

/** رقم هاتف صالح: 8 إلى 15 رقمًا، ويمكن أن يبدأ بـ + */
function valid_mobile($value): bool
{
    return is_string($value) && preg_match('/^\+?\d{8,15}$/', $value) === 1;
}

/**
 * مسؤول العيادة يطلب سيارة للممرضات (مبنى 03) ويتابعها كمشرف المبنى: موعد ممرضة من قائمة الممرضات.
 * $appointment الموعد المحفوظ المرتبط بالطلب.
 */
function nurse_lead(array $user, ?array $appointment): bool
{
    return $user['role'] === 'clinicLead' && ($appointment['nurse'] ?? null) === true;
}

/**
 * مشرف المبنى (ومسؤولهم، ومسؤول العيادة لمواعيد الممرضات) لا يغيّر بيانات الضيف ولا وقت الموعد، بل حالة الموعد،
 * أو يلغيه قبل استلام الضيف مع ذكر السبب، أو يسجّل أنه عاد بنفسه، أو يصحح رقم هاتفه قبل طلب السيارة.
 */
function building_appointment_error(array $user, array $before, array $after, array $changed): ?string
{
    $denied = 'ليست لديك صلاحية لتنفيذ هذا الإجراء.';
    if (($before['status'] ?? null) === 'ملغي') return $denied;
    // رقم هاتف الضيف خطأ: يصححه قبل طلب السيارة (لموعد وافق عليه مسؤول العيادة)
    if ($changed === ['mobile']) {
        if (($before['status'] ?? null) !== 'بانتظار طلب السيارة' || approval_of($before) !== 'approved') return $denied;
        return valid_mobile($after['mobile'] ?? null) ? null : 'رقم الهاتف غير صالح';
    }
    if (($after['status'] ?? null) === 'ملغي') {
        return in_array($before['status'] ?? null, ['بانتظار طلب السيارة', 'تم طلب السيارة'], true) && valid_cancel($user, $after, $changed) ? null : $denied;
    }
    // الضيف عاد بنفسه: ينتهي الموعد بعد ذهابه (أو طلب العودة فقط قبل طلب سيارته)، باسم المشرف ووقته
    if (array_intersect($changed, SELF_RETURN_FIELDS)) {
        $waitingReturn = ($before['returnOnly'] ?? null) === true && ($before['status'] ?? null) === 'بانتظار طلب السيارة';
        return only($changed, ['status', ...SELF_RETURN_FIELDS])
            && (in_array($before['status'] ?? null, ['تم استلام المريض', 'تم طلب السيارة'], true) || $waitingReturn)
            && ($after['status'] ?? null) === 'مكتملة' && ($after['returnedSelf'] ?? null) === true
            && ($after['returnedSelfBy'] ?? null) === $user['display_name'] && is_iso($after['returnedSelfAt'] ?? null) ? null : $denied;
    }
    return only($changed, ['status']) && in_array($after['status'] ?? null, APPOINTMENT_STATUSES, true) ? null : $denied;
}

/** الطاقة الكاملة (4 أشخاص بدل 3) للسيدان فقط، وقيمتها true/false. */
function valid_full_capacity(array $vehicle): bool
{
    return !array_key_exists('fullCapacity', $vehicle)
        || (is_bool($vehicle['fullCapacity']) && ($vehicle['kind'] ?? null) === 'سيدان');
}

/** تخصيص السيارة صالح: غير موجود، أو تخصيص باص لسيارة من نوع باص، أو سيارة المدارس لسيارة احتياجات خاصة. */
function valid_bus_role(array $vehicle): bool
{
    if (!array_key_exists('busRole', $vehicle)) return true;
    $kind = $vehicle['kind'] ?? null;
    return (in_array($vehicle['busRole'], BUS_ROLE_VALUES, true) && $kind === 'باص')
        || ($vehicle['busRole'] === SCHOOL_ROLE && $kind === 'احتياجات خاصة');
}

function is_iso($value): bool
{
    return is_text($value, 40) && strtotime($value) !== false;
}

/** أوقات بصيغة ISO، وإحداثيات الوجهة داخل قطر، ومصدر وصول معروف، وردود مشرف المبنى المعروفة. */
function valid_trip_fields(array $data): bool
{
    foreach (['pickedUpAt', 'etaAt', 'arrivedAt', 'driverArrivedAt', 'arrivalCheckAt', 'pickupCheckAt'] as $field) {
        if (array_key_exists($field, $data) && !is_iso($data[$field])) return false;
    }
    foreach (['arrivalCheck', 'pickupCheck'] as $field) {
        if (array_key_exists($field, $data) && !in_array($data[$field], ['pending', 'confirmed', 'denied'], true)) return false;
    }
    if (array_key_exists('destLat', $data) && !(is_numeric($data['destLat']) && $data['destLat'] > 24 && $data['destLat'] < 27)) return false;
    if (array_key_exists('destLng', $data) && !(is_numeric($data['destLng']) && $data['destLng'] > 50 && $data['destLng'] < 52.5)) return false;
    return !array_key_exists('arrivalSource', $data) || in_array($data['arrivalSource'], ['gps', 'estimate', 'manual'], true);
}

/**
 * رد مشرف المبنى على ما سجّله السائق: يؤكده (في أي وقت ما دام ينتظر الرد) أو ينفيه خلال المهلة
 * (مع دقيقة سماح). الرد باسمه ووقته، ولا يُغيَّر رد سابق.
 */
function valid_check_replies(array $user, array $before, array $after, array $changed): bool
{
    foreach (['arrival' => 'driverArrivedAt', 'pickup' => 'pickedUpAt'] as $kind => $since) {
        $field = $kind . 'Check';
        if (!in_array($field, $changed, true)) {
            if (array_intersect($changed, [$field . 'By', $field . 'At'])) return false;
            continue;
        }
        $reply = $after[$field] ?? null;
        if (($before[$field] ?? null) !== 'pending' || !in_array($reply, ['confirmed', 'denied'], true)) return false;
        if (($after[$field . 'By'] ?? null) !== $user['display_name'] || !is_iso($after[$field . 'At'] ?? null)) return false;
        $at = strtotime((string)($before[$since] ?? ''));
        if ($reply === 'denied' && ($at === false || time() - $at > CHECK_SECONDS + 60)) return false;
    }
    return true;
}

/** حالة الموافقة (الموعد القديم بلا حالة يُعتبر موافقًا عليه) */
function approval_of(array $appointment): string
{
    return (string)($appointment['approval'] ?? 'approved');
}

/** الموافقة باسم ووقت، والاستبعاد باسم ووقت، وبانتظار الموافقة بلا أسماء. */
function valid_approval(array $data): bool
{
    $keys = array_keys($data);
    $approvedKeys = ['approvedBy', 'approvedAt'];
    $excludedKeys = ['excludedBy', 'excludedAt'];
    switch ($data['approval'] ?? null) {
        case null:
        case 'pending':
            return !array_intersect($keys, [...$approvedKeys, ...$excludedKeys]);
        case 'approved':
            return is_text($data['approvedBy'] ?? null, 120) && is_iso($data['approvedAt'] ?? null) && !array_intersect($keys, $excludedKeys);
        case 'excluded':
            return is_text($data['excludedBy'] ?? null, 120) && is_iso($data['excludedAt'] ?? null) && !array_intersect($keys, $approvedKeys);
    }
    return false;
}

function valid_appointment(array $data, string $id): bool
{
    return only(array_keys($data), APPOINTMENT_FIELDS)
        && !array_diff(['id', 'patientName', 'clinic', 'appointmentDate', 'appointmentAt', 'kind', 'status'], array_keys($data))
        && $data['id'] === $id
        && is_text($data['patientName'], 120)
        && is_text($data['clinic'], 160)
        && is_string($data['appointmentDate']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $data['appointmentDate'])
        && is_string($data['appointmentAt']) && preg_match('/^\d{2}:\d{2}$/', $data['appointmentAt'])
        && in_array($data['kind'], ['عادي', 'احتياجات خاصة'], true)
        && in_array($data['status'], APPOINTMENT_STATUSES, true)
        && ($data['category'] ?? 'غير طبية') === 'غير طبية'
        && is_array($data['assistance'] ?? []) && count($data['assistance'] ?? []) <= 4
        && in_array($data['gender'] ?? 'ذكر', ['ذكر', 'أنثى'], true)
        && is_bool($data['cancer'] ?? false)
        && is_bool($data['returnedSelf'] ?? false)
        // طلب عودة فقط من المستشفى: true أو بلا الخانة
        && ($data['returnOnly'] ?? true) === true
        // موعد ممرضة من قائمة الممرضات: true أو بلا الخانة
        && ($data['nurse'] ?? true) === true
        && valid_appointment_type($data)
        // رحلة غير طبية متكررة: رقم سلسلتها
        && (!array_key_exists('seriesId', $data) || (is_text($data['seriesId'], 40) && $data['seriesId'] !== '' && ($data['category'] ?? '') === 'غير طبية'))
        // العودة التلقائية للرحلة غير الطبية: وقتها بعد وقت الذهاب في نفس اليوم (auto_returns في index.php)
        && (!array_key_exists('returnAt', $data) || (is_string($data['returnAt']) && preg_match('/^([01]\d|2[0-3]):[0-5]\d$/', $data['returnAt'])
            && ($data['category'] ?? '') === 'غير طبية' && $data['returnAt'] > (string)($data['appointmentAt'] ?? '')))
        && valid_approval($data);
}

/** إلغاء الموعد بسبب (3 أحرف فأكثر) باسم من ألغاه ووقته، ولا يتغير معه غير الحالة */
function valid_cancel(array $user, array $after, array $changed): bool
{
    $reason = trim((string)($after['cancelReason'] ?? ''));
    return only($changed, ['status', ...CANCEL_FIELDS])
        && is_text($after['cancelReason'] ?? null, 300) && mb_strlen($reason) >= 3
        && ($after['cancelledBy'] ?? null) === $user['display_name']
        && is_text($after['cancelledAt'] ?? null, 40) && strtotime($after['cancelledAt']) !== false;
}

/** نوع الموعد (اختياري): نص قصير غير فارغ، أو بلا الخانة */
function valid_appointment_type(array $data): bool
{
    return !array_key_exists('appointmentType', $data) || (is_text($data['appointmentType'], 60) && trim($data['appointmentType']) !== '');
}

/**
 * يعيد سبب الرفض، أو null إن كانت العملية مسموحة.
 * $docOf (اختياري): يقرأ مستندًا محفوظًا ($docOf('appointments', $id))، للموعد المرتبط بطلب السيارة الجديد
 * وللضيف والمستشفى في موعد العيادة. $docOf($col, null): أي مستند من المجموعة أو null إن كانت فارغة.
 */
function authorize_write(array $user, string $col, string $id, ?array $before, ?array $after, ?callable $docOf = null): ?string
{
    $denied = 'ليست لديك صلاحية لتنفيذ هذا الإجراء.';
    $role = $user['role'];
    if ($after !== null && count($after) > 40 && $col !== 'meta') return 'بيانات غير صالحة';
    $changed = ($before !== null && $after !== null) ? changed_keys($before, $after) : [];

    switch ($col) {
        case 'appointments':
            if ($after === null) return has_role($user, ['admin', ...CLINIC_ROLES]) ? null : $denied;
            if ($before === null) {
                if (!valid_appointment($after, $id)) return 'بيانات الموعد غير صالحة';
                if ($role === 'admin') return null;
                // موعد العيادة لضيف من قائمة المجمع ولمستشفى من الدليل
                if (has_role($user, CLINIC_ROLES) && $docOf && ($error = registry_error($after, $docOf))) return $error;
                // طلب العودة فقط من المستشفى يذهب مباشرة إلى مشرف السيارات: بلا موافقة، ومعه طلب سيارة العودة
                if (has_role($user, CLINIC_ROLES) && ($after['returnOnly'] ?? null) === true) {
                    return !array_intersect(array_keys($after), APPROVAL_FIELDS) && ($after['status'] ?? null) === 'طلب عودة' ? null : $denied;
                }
                // موعد العيادة ينتظر موافقة مسؤولها، وما يضيفه المسؤول بنفسه موافق عليه باسمه
                if ($role === 'clinic') return ($after['approval'] ?? null) === 'pending' ? null : $denied;
                if ($role === 'clinicLead') {
                    $approval = $after['approval'] ?? null;
                    return $approval === 'pending' || ($approval === 'approved' && ($after['approvedBy'] ?? null) === $user['display_name']) ? null : $denied;
                }
                // مشرف السيارات يضيف رحلات غير طبية فقط (بلا موافقة العيادة)، لضيف من قائمة ضيوف المجمع
                if (!($role === 'fleetSupervisor' && ($after['category'] ?? '') === 'غير طبية' && !array_key_exists('approval', $after))) return $denied;
                return $docOf ? registry_error($after, $docOf, null, false) : null;
            }
            if (!valid_approval($after)) return 'بيانات الموعد غير صالحة';
            // مسؤول العيادة يتابع رحلات الممرضات كمشرف المبنى: حالة الموعد وإلغاؤه وعودتها بنفسها
            if (nurse_lead($user, $before) && $changed && only($changed, ['status', ...CANCEL_FIELDS, ...SELF_RETURN_FIELDS])) {
                return building_appointment_error($user, $before, $after, $changed);
            }
            if (has_role($user, ['admin', ...CLINIC_ROLES])) {
                $valid = only($changed, APPOINTMENT_FIELDS) && !in_array('id', $changed, true)
                    && in_array($after['status'] ?? null, APPOINTMENT_STATUSES, true)
                    && in_array($after['gender'] ?? 'ذكر', ['ذكر', 'أنثى'], true) && is_bool($after['cancer'] ?? false)
                    && ($after['returnOnly'] ?? true) === true && ($after['nurse'] ?? true) === true && valid_appointment_type($after);
                if (!$valid) return $denied;
                if ($role === 'admin') return null;
                // تغيير الضيف أو الوجهة: من قائمة المجمع ودليل المستشفيات
                if ($docOf && ($error = registry_error($after, $docOf, $changed))) return $error;
                $approvalChanged = (bool)array_intersect($changed, APPROVAL_FIELDS);
                // الموعد لا يصير طلب عودة ولا العكس، وطلب العودة بلا موافقة: تُعدَّل بياناته فقط
                if (in_array('returnOnly', $changed, true)) return $denied;
                if (($before['returnOnly'] ?? null) === true) {
                    return !array_intersect(array_keys($after), APPROVAL_FIELDS) && !in_array('status', $changed, true) ? null : $denied;
                }
                if ($role === 'clinic') {
                    // العيادة لا توافق ولا تستبعد. الموعد المستبعد يبقى مستبعدًا، وتعديل غيره يعيده إلى انتظار الموافقة
                    if (approval_of($before) === 'excluded') return $approvalChanged ? $denied : null;
                    if ($approvalChanged && ($after['approval'] ?? null) !== 'pending') return $denied;
                    if (array_intersect($changed, APPOINTMENT_CONTENT_FIELDS) && ($after['approval'] ?? null) !== 'pending') {
                        return 'تعديل الموعد يعيده إلى انتظار موافقة مسؤول العيادة';
                    }
                    return null;
                }
                // مسؤول العيادة: الموافقة والاستبعاد والإرجاع باسمه، لموعد لم يُطلب له سيارة بعد
                if ($approvalChanged) {
                    if (($before['status'] ?? null) !== 'بانتظار طلب السيارة' || ($after['status'] ?? null) !== 'بانتظار طلب السيارة') return $denied;
                    $to = $after['approval'] ?? null;
                    if ($to === 'approved' && ($after['approvedBy'] ?? null) !== $user['display_name']) return $denied;
                    if ($to === 'excluded' && ($after['excludedBy'] ?? null) !== $user['display_name']) return $denied;
                }
                return null;
            }
            // مشرف السيارات: حالة الموعد فقط، تتقدم كما عند الاستلام (إنهاء رحلة عالقة، أو ضم ضيف استلمه السائق إلى رحلة)،
            // أو تعود إلى ما قبل الاستلام (إزالة ضيف سُجّل استلامه من الرحلة)
            if ($role === 'fleetSupervisor') {
                // إيقاف رحلة غير طبية متكررة قبل طلب سيارتها أو قبل إرسالها: ملغي بسبب باسمه (وطلبها يُحذف قبله)
                if (($after['status'] ?? null) === 'ملغي') {
                    return ($before['category'] ?? '') === 'غير طبية' && !empty($before['seriesId'])
                        && in_array($before['status'] ?? null, ['بانتظار طلب السيارة', 'تم طلب السيارة'], true)
                        && valid_cancel($user, $after, $changed) ? null : $denied;
                }
                $move = [$before['status'] ?? null, $after['status'] ?? null];
                return only($changed, ['status'])
                    && ((TRIP_END_APPOINTMENT_STATUS[$move[0] ?? ''] ?? null) === $move[1] || in_array($move, TRIP_UNDO_APPOINTMENT_STATUS, true)) ? null : $denied;
            }
            // مشرف المبنى (ومسؤولهم): حالة الموعد، وإلغاؤه بسبب، وعودة الضيف بنفسه، وتصحيح رقم هاتفه قبل طلب السيارة
            if (has_role($user, BUILDING_ROLES)) return building_appointment_error($user, $before, $after, $changed);
            return $denied;

        case 'requests':
            if ($after === null) {
                if ($role === 'admin') return null;
                // العيادة تحذف طلب سيارة العودة مع طلب العودة الذي أضافته، قبل إرسال السيارة فقط،
                // ومسؤول العيادة يلغي طلب سيارة الممرضة كمشرف المبنى
                if (has_role($user, CLINIC_ROLES)) {
                    $linked = $docOf ? $docOf('appointments', (string)($before['appointmentId'] ?? '')) : null;
                    if (nurse_lead($user, $linked)) return null;
                    return $linked !== null && ($linked['returnOnly'] ?? null) === true && ($before['status'] ?? null) === 'بانتظار التوزيع' ? null : $denied;
                }
                // مشرف السيارات يحذف طلب رحلة متكررة يوقفها، ما دامت سيارتها لم تُرسل
                if ($role === 'fleetSupervisor') {
                    $linked = $docOf ? $docOf('appointments', (string)($before['appointmentId'] ?? '')) : null;
                    return $linked !== null && ($linked['category'] ?? '') === 'غير طبية' && !empty($linked['seriesId'])
                        && ($before['status'] ?? null) === 'بانتظار التوزيع' ? null : $denied;
                }
                return has_role($user, BUILDING_ROLES) && follows_request($user, $before) ? null : $denied;
            }
            if ($before === null) {
                // الطلب الجديد يبدأ دائمًا بانتظار التوزيع، والسيارة يحددها مشرف السيارات لاحقًا
                if (!has_role($user, ['admin', ...BUILDING_ROLES, 'fleetSupervisor', ...CLINIC_ROLES])) return $denied;
                // مسؤول العيادة يطلب سيارة الممرضة باسمه كمشرف المبنى (طلب فيه requestedBy)
                $nurseLead = $docOf && array_key_exists('requestedBy', $after)
                    && nurse_lead($user, $docOf('appointments', (string)($after['appointmentId'] ?? '')));
                // العيادة ومسؤولها: سيارة العودة لطلب العودة من المستشفى الذي تضيفه (محفوظ قبله في نفس الدفعة)،
                // بلا مالك فيتابعه كل مشرفي المباني، ويصل مباشرة إلى مشرف السيارات
                if (has_role($user, CLINIC_ROLES) && !$nurseLead) {
                    $linked = $docOf ? $docOf('appointments', (string)($after['appointmentId'] ?? '')) : null;
                    if ($linked === null || ($linked['returnOnly'] ?? null) !== true || ($after['direction'] ?? null) !== 'عودة'
                        || array_intersect(array_keys($after), ['requestedBy', 'nurseOnly', 'fromAppointmentId'])) return $denied;
                }
                // طلب مشرف المبنى يُسجَّل باسمه (حتى يتابعه وحده)، والرحلة غير الطبية من مشرف السيارات بلا مالك
                $owner = $after['requestedBy'] ?? null;
                $building = has_role($user, BUILDING_ROLES) || $nurseLead;
                if ($building && $owner !== (string)$user['id']) return 'بيانات الطلب غير صالحة';
                if ($role === 'fleetSupervisor' && $owner !== null) return 'بيانات الطلب غير صالحة';
                // مشرف المبنى يطلب سيارة لموعد وافق عليه مسؤول العيادة فقط
                if ($building && $docOf) {
                    $linked = $docOf('appointments', (string)($after['appointmentId'] ?? ''));
                    if ($linked !== null && approval_of($linked) !== 'approved') return 'لم يوافق مسؤول العيادة على هذا الموعد بعد';
                    // طلب العودة فقط من المستشفى: سيارة عودة فقط (لا ذهاب ولا نقل إليه)
                    if ($linked !== null && ($linked['returnOnly'] ?? null) === true && ($after['direction'] ?? null) !== 'عودة') {
                        return 'هذا طلب عودة فقط من المستشفى: يُطلب له سيارة عودة';
                    }
                }
                // مشرف السيارات يرى المواعيد الطبية ولا يطلب لها سيارة (يطلبها مشرف المبنى)، بل يضيف الرحلات غير الطبية.
                // الموعد غير المحفوظ بعد هو رحلة غير طبية يضيفها معه في نفس اللحظة
                if ($role === 'fleetSupervisor' && $docOf) {
                    $linked = $docOf('appointments', (string)($after['appointmentId'] ?? ''));
                    if ($linked !== null && ($linked['category'] ?? '') !== 'غير طبية') return $denied;
                }
                $valid = only(array_keys($after), REQUEST_FIELDS)
                    && ($after['id'] ?? null) === $id
                    && is_text($after['appointmentId'] ?? null, 160)
                    && in_array($after['direction'] ?? null, ['ذهاب', 'عودة'], true)
                    && ($after['status'] ?? null) === 'بانتظار التوزيع'
                    && in_array($after['notificationMethod'] ?? null, ['whatsapp', 'call'], true)
                    // النقل بين موعدين: طلب ذهاب للموعد الثاني يبدأ من مستشفى موعد آخر
                    && (!array_key_exists('fromAppointmentId', $after)
                        || (is_text($after['fromAppointmentId'], 160) && $after['fromAppointmentId'] !== '' && $after['fromAppointmentId'] !== $after['appointmentId']
                            && $after['direction'] === 'ذهاب'))
                    // عودة الـ Nurse فقط: طلب عودة (لا نقل بين موعدين)
                    && (!array_key_exists('nurseOnly', $after)
                        || ($after['nurseOnly'] === true && $after['direction'] === 'عودة' && !array_key_exists('fromAppointmentId', $after)))
                    // طلب العودة التلقائي ينشئه الخادم وحده
                    && !array_key_exists('autoReturn', $after)
                    // حجز مسبق (يوم الطلب قبل يوم الرحلة)
                    && (!array_key_exists('requestedOn', $after) || (is_string($after['requestedOn']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', $after['requestedOn'])))
                    && !array_intersect(array_keys($after), ['vehiclePlate', 'driver', 'groupId', 'notificationSentAt', ...TRIP_FIELDS]);
                return $valid ? null : 'بيانات الطلب غير صالحة';
            }
            if (!valid_trip_fields($after)) return 'بيانات الطلب غير صالحة';
            if ($role === 'admin') {
                return only($changed, REQUEST_FIELDS) && !array_intersect($changed, ['id', 'appointmentId', 'fromAppointmentId', 'nurseOnly'])
                    && in_array($after['status'] ?? null, REQUEST_STATUSES, true) ? null : $denied;
            }
            // مشرف السيارات: إرسال السيارة وجمع الرحلات، وتأكيد وصولها إلى الوجهة (يدويًا أو بانتهاء المدة التقديرية)،
            // وإنهاء رحلة عالقة قبل تسجيل الاستلام (يدويًا فقط) حتى تتفرغ السيارة
            if ($role === 'fleetSupervisor') {
                // إزالة ضيف من رحلة جارية: يعود طلبه إلى «بانتظار التوزيع» بلا سيارة ولا مراحل الرحلة، ومعه السيارة والسبب ووقته
                if (($after['status'] ?? null) === 'بانتظار التوزيع' && !empty($before['vehiclePlate'])) {
                    $valid = in_array($before['status'] ?? null, ['تم إرسال السيارة', 'وصلت السيارة', 'تم استلام المريض'], true)
                        && only($changed, ['status', ...TRIP_RESET_FIELDS, ...TRIP_REMOVAL_FIELDS])
                        && !array_intersect(array_keys($after), TRIP_RESET_FIELDS)
                        && ($after['removedFrom'] ?? null) === $before['vehiclePlate']
                        && is_text($after['removeReason'] ?? null, 120) && trim($after['removeReason']) !== ''
                        && is_iso($after['removedAt'] ?? null);
                    return $valid ? null : $denied;
                }
                // ضم ضيف استلمه السائق إلى رحلة جارية: من «بانتظار التوزيع» مباشرة إلى «تم استلام المريض» في سيارة موجودة،
                // ومعه وقت الاستلام والوقت المتوقع للوصول وإحداثيات الوجهة
                if (($before['status'] ?? null) === 'بانتظار التوزيع' && ($after['status'] ?? null) === 'تم استلام المريض') {
                    $plate = $after['vehiclePlate'] ?? null;
                    $valid = only($changed, ['vehiclePlate', 'driver', 'status', 'groupId', 'notificationSentAt', 'pickedUpAt', 'etaAt', 'destLat', 'destLng'])
                        && is_string($plate) && valid_doc_id($plate) && $docOf && $docOf('fleet', $plate) !== null
                        && is_iso($after['pickedUpAt'] ?? null) && is_iso($after['etaAt'] ?? null);
                    return $valid ? null : $denied;
                }
                // تغيير السيارة بعد إرسالها وقبل وصولها إلى الوجهة: سيارة موجودة أخرى ومعها السيارة السابقة والسبب ووقته.
                // قبل استلام الضيف تعود الرحلة إلى «تم إرسال السيارة» ويُمحى ما سجّله سائق السيارة السابقة عند الاستلام،
                // وبعد الاستلام تبقى «تم استلام المريض» (تكمل السيارة الجديدة الطريق)
                if (in_array('vehiclePlate', $changed, true) && !empty($before['vehiclePlate'])) {
                    $from = $before['status'] ?? null;
                    $beforePickup = in_array($from, ['تم إرسال السيارة', 'وصلت السيارة'], true);
                    $arrivalFields = ['driverArrivedAt', 'arrivalGps', 'arrivalCheck', 'arrivalCheckBy', 'arrivalCheckAt'];
                    $allowed = ['vehiclePlate', 'driver', 'notificationSentAt', ...VEHICLE_CHANGE_FIELDS, ...($beforePickup ? ['status', ...$arrivalFields] : [])];
                    $plate = $after['vehiclePlate'] ?? null;
                    $valid = ($beforePickup || $from === 'تم استلام المريض')
                        && only($changed, $allowed)
                        && ($after['status'] ?? null) === ($beforePickup ? 'تم إرسال السيارة' : $from)
                        && !array_intersect(array_keys($after), $beforePickup ? $arrivalFields : [])
                        && is_string($plate) && valid_doc_id($plate) && $plate !== $before['vehiclePlate'] && $docOf && $docOf('fleet', $plate) !== null
                        && ($after['previousPlate'] ?? null) === $before['vehiclePlate']
                        && is_text($after['changeReason'] ?? null, 120) && trim($after['changeReason']) !== ''
                        && is_iso($after['changedAt'] ?? null);
                    return $valid ? null : $denied;
                }
                if (!only($changed, ['vehiclePlate', 'driver', 'status', 'groupId', 'notificationSentAt', 'arrivedAt', 'arrivalSource'])) return $denied;
                $to = $after['status'] ?? null;
                $from = $before['status'] ?? null;
                $ending = in_array($from, ['تم إرسال السيارة', 'وصلت السيارة'], true)
                    && ($after['arrivalSource'] ?? null) === 'manual' && is_iso($after['arrivedAt'] ?? null);
                $arriving = $to === 'وصلت الوجهة' && ($from === 'تم استلام المريض' || $ending);
                if (in_array('status', $changed, true) && $to !== 'تم إرسال السيارة' && !$arriving) return $denied;
                // بيانات الوصول تُكتب مرة واحدة عند الوصول، ولا تُغيَّر بعده (مثل وصول سجّله GPS)
                return !array_intersect($changed, ['arrivedAt', 'arrivalSource']) || $arriving ? null : $denied;
            }
            // مشرف المبنى (لطلباته) ومسؤول مشرفي المباني (لكل الطلبات) ومسؤول العيادة (لطلبات الممرضات): تأكيد وصول السيارة
            // واستلام المريض، ومعه وقت الاستلام والوقت المتوقع للوصول، والرد على ما سجّله السائق (التأكيد، أو النفي الذي يعيد الطلب إلى المرحلة السابقة)
            if (has_role($user, BUILDING_ROLES) || ($role === 'clinicLead' && $docOf && nurse_lead($user, $docOf('appointments', (string)($before['appointmentId'] ?? ''))))) {
                // أي مشرف مبنى يطلب عودة الضيف مع الـ Nurse التي تنتظر سيارتها: يصبح طلب عودتها طلب عودة لهما
                if ($changed === ['nurseOnly'] && ($before['nurseOnly'] ?? null) === true && !array_key_exists('nurseOnly', $after)) {
                    return in_array($before['status'] ?? null, ['بانتظار التوزيع', 'تم إرسال السيارة', 'وصلت السيارة'], true) ? null : $denied;
                }
                if (!follows_request($user, $before)) return $denied;
                if (!only($changed, ['status', 'pickedUpAt', 'etaAt', 'destLat', 'destLng', 'pickupGps', ...CHECK_FIELDS])) return $denied;
                if (!valid_check_replies($user, $before, $after, $changed)) return $denied;
                $from = $before['status'] ?? null;
                $to = $after['status'] ?? null;
                $denies = fn(string $field) => in_array($field, $changed, true) && ($after[$field] ?? null) === 'denied';
                // النفي يعيد الطلب خطوة واحدة فقط: الوصول من «وصلت السيارة» إلى «تم إرسال السيارة»
                if ($denies('arrivalCheck')) return $from === 'وصلت السيارة' && $to === 'تم إرسال السيارة' && !$denies('pickupCheck') ? null : $denied;
                // والاستلام إلى «وصلت السيارة» بلا وقت استلام ولا وصول متوقع
                if ($denies('pickupCheck')) {
                    return $from === 'تم استلام المريض' && $to === 'وصلت السيارة'
                        && !array_intersect(array_keys($after), ['pickedUpAt', 'etaAt', 'destLat', 'destLng', 'pickupGps']) ? null : $denied;
                }
                if (!in_array('status', $changed, true)) {
                    return array_intersect($changed, [...TRIP_FIELDS, 'pickupGps']) ? $denied : null;
                }
                // موقع السائق يكتبه السائق وحده (يُحذف فقط مع نفي الاستلام)
                if (in_array('pickupGps', $changed, true)) return $denied;
                return in_array($to, ['وصلت السيارة', 'تم استلام المريض'], true) ? null : $denied;
            }
            return $denied;

        case 'fleet':
            // المدير يعدّل كل البيانات، ومشرف السيارات يغيّر حالة الإتاحة وتخصيص الباص فقط
            if ($after === null) return $role === 'admin' ? null : $denied;
            if ($role === 'admin') {
                return only(array_keys($after), VEHICLE_FIELDS) && ($after['plate'] ?? null) === $id
                    && in_array($after['kind'] ?? null, VEHICLE_KINDS, true) && valid_bus_role($after) && valid_full_capacity($after)
                    && valid_vehicle_driver($after, $docOf) ? null : 'بيانات السيارة غير صالحة';
            }
            // مشرف السيارات يغيّر إتاحة السيارة، وتخصيصها (باص المجمع أو الجامعة أو العيادة، أو سيارة المدارس)،
            // وتشغيل السيدان بطاقتها الكاملة (4 أشخاص)، والسائق الذي يقودها (في بداية الشفت)
            if ($role === 'fleetSupervisor' && $before !== null) {
                return only($changed, ['available', 'busRole', 'fullCapacity', ...VEHICLE_DRIVER_FIELDS]) && is_bool($after['available'] ?? null)
                    && valid_bus_role($after) && valid_full_capacity($after)
                    && (!array_intersect($changed, VEHICLE_DRIVER_FIELDS) || valid_vehicle_driver($after, $docOf)) ? null : $denied;
            }
            return $denied;

        case 'hospitals':
            if ($role !== 'admin') return $denied;
            if ($after === null) return null;
            $valid = only(array_keys($after), HOSPITAL_FIELDS)
                && ($after['id'] ?? null) === $id
                && is_text($after['name'] ?? null, 120)
                && is_numeric($after['lat'] ?? null) && $after['lat'] > 24 && $after['lat'] < 27
                && is_numeric($after['lng'] ?? null) && $after['lng'] > 50 && $after['lng'] < 52.5
                && is_array($after['aliases'] ?? null) && count($after['aliases']) <= 40;
            return $valid ? null : 'بيانات المستشفى غير صالحة';

        case 'drivers':
            // قائمة السائقين: المدير يضيف السائق ويعدّل اسمه ورقمه ويحذفه
            if ($role !== 'admin') return $denied;
            return $after === null || valid_driver($after, $id, $before) ? null : 'بيانات السائق غير صالحة';

        case 'guests':
            // قائمة ضيوف المجمع: المدير يضيف ضيفًا ويعدّل بياناته (المبنى والشقة) ويحذفه
            if ($role !== 'admin') return $denied;
            return $after === null || valid_guest($after, $id) ? null : 'بيانات الضيف غير صالحة';

        case 'privateCars':
            // السيارات الخاصة: المدير يضيف شقة ويحذفها (أو يرفع القائمة كاملة: private-cars.import)
            if ($role !== 'admin') return $denied;
            return $after === null || valid_private_car($after, $id) ? null : 'بيانات السيارة الخاصة غير صالحة';

        case 'specialNeeds':
            // ذوو الاحتياجات الخاصة: المدير يربط الشخص بضيف ويحذفه (أو يرفع القائمة كاملة: special-needs.import)
            if ($role !== 'admin') return $denied;
            return $after === null || valid_special_need($after, $id) ? null : 'بيانات صاحب الاحتياجات الخاصة غير صالحة';

        case 'vehicleLocations':
            // السائق يرسل موقعه من صفحة السائق فقط؛ هنا الحذف للمدير
            return ($after === null && $role === 'admin') ? null : $denied;

        case 'meta':
            if ($id === 'audit') {
                return has_role($user, OFFICE_ROLES) && $after !== null && only(array_keys($after), ['items'])
                    && is_array($after['items'] ?? null) && count($after['items']) <= 50 ? null : $denied;
            }
            // ملخص الإحصائيات القديم (إجماليات فقط، بلا بيانات مرضى)
            if ($id === 'history') {
                return $role === 'admin' && $after !== null && only(array_keys($after), ['data']) ? null : $denied;
            }
            return $denied;
    }
    return $denied;
}
