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
    'returnOnly', '_o'];
/** موافقة مسؤول العيادة: بانتظار الموافقة، أو موافق عليه (باسمه ووقته)، أو مستبعد بلا حذف (باسمه ووقته) */
const APPROVAL_FIELDS = ['approval', 'approvedBy', 'approvedAt', 'excludedBy', 'excludedAt'];
/** بيانات الموعد نفسه: تعديل العيادة لها يعيد الموعد إلى انتظار موافقة مسؤولها */
const APPOINTMENT_CONTENT_FIELDS = ['guestId', 'patientName', 'clinic', 'buildingNumber', 'apartmentNumber', 'mobile', 'appointmentDate', 'appointmentAt',
    'hospitalId', 'category', 'kind', 'assistance', 'gender', 'cancer', 'returnOnly'];
/** الضيف عاد إلى المجمع بنفسه بلا سيارة عودة (يسجّله مشرف المبنى باسمه ووقته) */
const SELF_RETURN_FIELDS = ['returnedSelf', 'returnedSelfBy', 'returnedSelfAt'];
/** خانات إلغاء الموعد (السبب إلزامي، ومن ألغاه، ومتى) */
const CANCEL_FIELDS = ['cancelReason', 'cancelledBy', 'cancelledAt'];
const REQUEST_STATUSES = ['بانتظار التوزيع', 'تم إرسال السيارة', 'وصلت السيارة', 'تم استلام المريض', 'وصلت الوجهة'];
/** رد مشرف المبنى على ما سجّله السائق من تطبيقه (الوصول والاستلام) */
const CHECK_FIELDS = ['arrivalCheck', 'arrivalCheckBy', 'arrivalCheckAt', 'pickupCheck', 'pickupCheckBy', 'pickupCheckAt'];
/** مهلة رد مشرف المبنى بالثواني؛ بعدها يُعتبر ما سجّله السائق مقبولًا (نفس القيمة في shared/driverChecks.ts) */
const CHECK_SECONDS = 300;
const REQUEST_FIELDS = ['id', 'appointmentId', 'vehiclePlate', 'driver', 'direction', 'status', 'notificationMethod',
    'createdAt', 'groupId', 'notificationSentAt', 'requestedBy', 'pickedUpAt', 'etaAt', 'destLat', 'destLng', 'arrivedAt', 'arrivalSource',
    'fromAppointmentId', 'nurseOnly', 'driverArrivedAt', 'arrivalGps', 'pickupGps', ...CHECK_FIELDS, '_o'];
/** خانات مرحلة الطريق إلى الوجهة (تُكتب عند استلام المريض وعند الوصول) */
const TRIP_FIELDS = ['pickedUpAt', 'etaAt', 'destLat', 'destLng', 'arrivedAt', 'arrivalSource'];
const VEHICLE_FIELDS = ['plate', 'driver', 'phone', 'kind', 'available', 'busRole', 'fullCapacity', '_o'];
const VEHICLE_KINDS = ['سيدان', 'احتياجات خاصة', 'باص'];
/** تخصيص الباص: باص المجمع، أو باص الرحلات غير الطبية، أو باص العيادة (نفس القيم في shared/transport.ts) */
const BUS_ROLE_VALUES = ['shuttle', 'nonMedical', 'clinic'];
const BUS_ROLE_LABELS = ['shuttle' => 'باص المجمع', 'nonMedical' => 'باص الرحلات غير الطبية', 'clinic' => 'باص العيادة'];
/** إنهاء مشرف السيارات لرحلة عالقة يقدّم حالة الموعد كما عند استلام الضيف: [قبل => بعد] */
const TRIP_END_APPOINTMENT_STATUS = ['تم طلب السيارة' => 'تم استلام المريض', 'طلب عودة' => 'مكتملة', 'تم استلام المريض' => 'مكتملة'];
const HOSPITAL_FIELDS = ['id', 'name', 'nameEn', 'zone', 'lat', 'lng', 'aliases', 'verified', '_o'];
/**
 * قائمة ضيوف المجمع (يرفعها المدير). العمر والرقم الصحي لا يُرسلان مع القائمة (يظهران في الإحصائيات فقط عبر guests-stats).
 * المزامنة للمدير والعيادة ومسؤولها فقط.
 */
const GUEST_FIELDS = ['id', 'name', 'nameEn', 'gender', 'mobile', 'buildingNumber', 'apartmentNumber', 'age', 'healthNumber', '_o'];
const GUEST_PRIVATE_FIELDS = ['age', 'healthNumber'];
const GUEST_LIST_ROLES = ['admin', 'clinic', 'clinicLead'];
/** من يرى العمر والرقم الصحي (من يرى الإحصائيات) */
const GUEST_STATS_ROLES = ['admin', 'fleetSupervisor'];
/** بيانات الضيف في الموعد: يجب أن تطابق القائمة */
const APPOINTMENT_GUEST_FIELDS = ['guestId', 'patientName', 'buildingNumber', 'apartmentNumber'];
/** المجموعات التي تُزامن مع موظفي المكتب */
const SYNC_COLLECTIONS = ['appointments', 'requests', 'fleet', 'hospitals', 'vehicleLocations', 'meta', 'guests'];

/** مجموعات المزامنة لهذا المستخدم: قائمة الضيوف للمدير والعيادة فقط */
function sync_collections(array $user): array
{
    return array_values(array_filter(SYNC_COLLECTIONS, fn(string $col) => $col !== 'guests' || in_array($user['role'], GUEST_LIST_ROLES, true)));
}

/** المستند كما يُرسل في المزامنة: قائمة الضيوف بلا العمر والرقم الصحي */
function public_doc(string $col, ?array $data): ?array
{
    if ($col !== 'guests' || $data === null) return $data;
    foreach (GUEST_PRIVATE_FIELDS as $field) unset($data[$field]);
    return $data;
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
        && (!array_key_exists('healthNumber', $data) || is_text($data['healthNumber'], 30));
}

/**
 * موعد العيادة لضيف من قائمة ضيوف المجمع ولمستشفى من الدليل: الاسم والمبنى والشقة كما في القائمة،
 * والوجهة اسم المستشفى كما في الدليل. $changed = null عند الإضافة (يُفحص كل شيء)، وعند التعديل ما تغيّر فقط.
 * $docOf(col, id) يقرأ المستند المحفوظ، و$docOf(col, null) أي مستند من المجموعة (لمعرفة هل هي فارغة).
 */
function registry_error(array $appointment, callable $docOf, ?array $changed = null): ?string
{
    if ($changed === null || array_intersect($changed, APPOINTMENT_GUEST_FIELDS)) {
        $guestId = $appointment['guestId'] ?? null;
        $guest = is_string($guestId) && preg_match('/^[A-Za-z0-9._:-]{1,160}$/', $guestId) ? $docOf('guests', $guestId) : null;
        if ($guest === null) return 'الضيف غير موجود في قائمة ضيوف المجمع';
        foreach (['patientName' => 'name', 'buildingNumber' => 'buildingNumber', 'apartmentNumber' => 'apartmentNumber'] as $field => $source) {
            if (($appointment[$field] ?? null) !== ($guest[$source] ?? null)) return 'بيانات الضيف لا تطابق قائمة ضيوف المجمع';
        }
    }
    if ($changed === null || array_intersect($changed, ['hospitalId', 'clinic'])) {
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
 * الطلب (ذهابًا أو عودة) يتابعه مشرف المبنى الذي طلبه فقط، ومسؤول مشرفي المباني يتابع كل الطلبات.
 * الطلب القديم أو الذي أضافه مشرف السيارات بلا مالك يتابعه أي مشرف مبنى.
 */
function follows_request(array $user, ?array $request): bool
{
    if ($user['role'] === 'buildingLead') return true;
    $owner = $request['requestedBy'] ?? null;
    return $owner === null || $owner === (string)$user['id'];
}

/** الطاقة الكاملة (4 أشخاص بدل 3) للسيدان فقط، وقيمتها true/false. */
function valid_full_capacity(array $vehicle): bool
{
    return !array_key_exists('fullCapacity', $vehicle)
        || (is_bool($vehicle['fullCapacity']) && ($vehicle['kind'] ?? null) === 'سيدان');
}

/** تخصيص الباص صالح: غير موجود، أو قيمة معروفة لسيارة من نوع باص. */
function valid_bus_role(array $vehicle): bool
{
    return !array_key_exists('busRole', $vehicle)
        || (in_array($vehicle['busRole'], BUS_ROLE_VALUES, true) && ($vehicle['kind'] ?? null) === 'باص');
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
        && valid_approval($data);
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
                // موعد العيادة ينتظر موافقة مسؤولها، وما يضيفه المسؤول بنفسه موافق عليه باسمه
                if ($role === 'clinic') return ($after['approval'] ?? null) === 'pending' ? null : $denied;
                if ($role === 'clinicLead') {
                    $approval = $after['approval'] ?? null;
                    return $approval === 'pending' || ($approval === 'approved' && ($after['approvedBy'] ?? null) === $user['display_name']) ? null : $denied;
                }
                // مشرف السيارات يضيف رحلات غير طبية فقط (بلا موافقة العيادة)
                return ($role === 'fleetSupervisor' && ($after['category'] ?? '') === 'غير طبية' && !array_key_exists('approval', $after)) ? null : $denied;
            }
            if (!valid_approval($after)) return 'بيانات الموعد غير صالحة';
            if (has_role($user, ['admin', ...CLINIC_ROLES])) {
                $valid = only($changed, APPOINTMENT_FIELDS) && !in_array('id', $changed, true)
                    && in_array($after['status'] ?? null, APPOINTMENT_STATUSES, true)
                    && in_array($after['gender'] ?? 'ذكر', ['ذكر', 'أنثى'], true) && is_bool($after['cancer'] ?? false)
                    && ($after['returnOnly'] ?? true) === true;
                if (!$valid) return $denied;
                if ($role === 'admin') return null;
                // تغيير الضيف أو الوجهة: من قائمة المجمع ودليل المستشفيات
                if ($docOf && ($error = registry_error($after, $docOf, $changed))) return $error;
                $approvalChanged = (bool)array_intersect($changed, APPROVAL_FIELDS);
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
            // مشرف السيارات: عند إنهاء رحلة عالقة (لم يُسجَّل استلام ضيفها) تتقدم حالة الموعد كما عند الاستلام فقط
            if ($role === 'fleetSupervisor') {
                return only($changed, ['status'])
                    && (TRIP_END_APPOINTMENT_STATUS[$before['status'] ?? ''] ?? null) === ($after['status'] ?? null) ? null : $denied;
            }
            // مشرف المبنى (ومسؤولهم) لا يغيّر بيانات المريض ولا وقت الموعد، بل حالة الموعد فقط، أو يلغيه قبل استلام المريض مع ذكر السبب
            if (has_role($user, BUILDING_ROLES)) {
                if (($before['status'] ?? null) === 'ملغي') return $denied;
                if (($after['status'] ?? null) === 'ملغي') {
                    $reason = trim((string)($after['cancelReason'] ?? ''));
                    return only($changed, ['status', ...CANCEL_FIELDS])
                        && in_array($before['status'] ?? null, ['بانتظار طلب السيارة', 'تم طلب السيارة'], true)
                        && is_text($after['cancelReason'] ?? null, 300) && mb_strlen($reason) >= 3
                        && ($after['cancelledBy'] ?? null) === $user['display_name']
                        && is_text($after['cancelledAt'] ?? null, 40) && strtotime($after['cancelledAt']) !== false ? null : $denied;
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
            return $denied;

        case 'requests':
            if ($after === null) {
                if ($role === 'admin') return null;
                return has_role($user, BUILDING_ROLES) && follows_request($user, $before) ? null : $denied;
            }
            if ($before === null) {
                // الطلب الجديد يبدأ دائمًا بانتظار التوزيع، والسيارة يحددها مشرف السيارات لاحقًا
                if (!has_role($user, ['admin', ...BUILDING_ROLES, 'fleetSupervisor'])) return $denied;
                // طلب مشرف المبنى يُسجَّل باسمه (حتى يتابعه وحده)، والرحلة غير الطبية من مشرف السيارات بلا مالك
                $owner = $after['requestedBy'] ?? null;
                if (has_role($user, BUILDING_ROLES) && $owner !== (string)$user['id']) return 'بيانات الطلب غير صالحة';
                if ($role === 'fleetSupervisor' && $owner !== null) return 'بيانات الطلب غير صالحة';
                // مشرف المبنى يطلب سيارة لموعد وافق عليه مسؤول العيادة فقط
                if (has_role($user, BUILDING_ROLES) && $docOf) {
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
            // مشرف المبنى (لطلباته) ومسؤول مشرفي المباني (لكل الطلبات): تأكيد وصول السيارة واستلام المريض، ومعه
            // وقت الاستلام والوقت المتوقع للوصول، والرد على ما سجّله السائق (التأكيد، أو النفي الذي يعيد الطلب إلى المرحلة السابقة)
            if (has_role($user, BUILDING_ROLES)) {
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
                    && in_array($after['kind'] ?? null, VEHICLE_KINDS, true) && valid_bus_role($after) && valid_full_capacity($after) ? null : 'بيانات السيارة غير صالحة';
            }
            // مشرف السيارات يغيّر إتاحة السيارة، وتخصيص الباص (باص المجمع أو الرحلات غير الطبية أو العيادة)،
            // وتشغيل السيدان بطاقتها الكاملة (4 أشخاص)
            if ($role === 'fleetSupervisor' && $before !== null) {
                return only($changed, ['available', 'busRole', 'fullCapacity']) && is_bool($after['available'] ?? null)
                    && valid_bus_role($after) && valid_full_capacity($after) ? null : $denied;
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

        case 'guests':
            // قائمة ضيوف المجمع: المدير يضيف ضيفًا ويعدّل بياناته (المبنى والشقة) ويحذفه
            if ($role !== 'admin') return $denied;
            return $after === null || valid_guest($after, $id) ? null : 'بيانات الضيف غير صالحة';

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
