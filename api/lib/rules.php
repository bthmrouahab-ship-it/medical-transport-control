<?php
declare(strict_types=1);

/**
 * صلاحيات الكتابة حسب الدور (كانت في firestore.rules).
 * كل عملية تُفحص قبل الحفظ: $before المستند الحالي أو null، و$after المستند بعد التعديل أو null عند الحذف.
 */

const APPOINTMENT_STATUSES = ['بانتظار طلب السيارة', 'تم طلب السيارة', 'تم استلام المريض', 'طلب عودة', 'مكتملة', 'ملغي'];
const APPOINTMENT_FIELDS = ['id', 'patientName', 'clinic', 'buildingNumber', 'apartmentNumber', 'mobile', 'appointmentDate',
    'appointmentAt', 'hospitalId', 'category', 'kind', 'assistance', 'status', 'cancelReason', 'cancelledBy', 'cancelledAt',
    'gender', 'cancer', '_o'];
/** خانات إلغاء الموعد (السبب إلزامي، ومن ألغاه، ومتى) */
const CANCEL_FIELDS = ['cancelReason', 'cancelledBy', 'cancelledAt'];
const REQUEST_STATUSES = ['بانتظار التوزيع', 'تم إرسال السيارة', 'وصلت السيارة', 'تم استلام المريض', 'وصلت الوجهة'];
/** رد مشرف المبنى على ما سجّله السائق من تطبيقه (الوصول والاستلام) */
const CHECK_FIELDS = ['arrivalCheck', 'arrivalCheckBy', 'arrivalCheckAt', 'pickupCheck', 'pickupCheckBy', 'pickupCheckAt'];
/** مهلة رد مشرف المبنى بالثواني؛ بعدها يُعتبر ما سجّله السائق مقبولًا (نفس القيمة في shared/driverChecks.ts) */
const CHECK_SECONDS = 300;
const REQUEST_FIELDS = ['id', 'appointmentId', 'vehiclePlate', 'driver', 'direction', 'status', 'notificationMethod',
    'createdAt', 'groupId', 'notificationSentAt', 'requestedBy', 'pickedUpAt', 'etaAt', 'destLat', 'destLng', 'arrivedAt', 'arrivalSource',
    'fromAppointmentId', 'driverArrivedAt', 'arrivalGps', 'pickupGps', ...CHECK_FIELDS, '_o'];
/** خانات مرحلة الطريق إلى الوجهة (تُكتب عند استلام المريض وعند الوصول) */
const TRIP_FIELDS = ['pickedUpAt', 'etaAt', 'destLat', 'destLng', 'arrivedAt', 'arrivalSource'];
const VEHICLE_FIELDS = ['plate', 'driver', 'phone', 'kind', 'available', 'busRole', '_o'];
const VEHICLE_KINDS = ['سيدان', 'احتياجات خاصة', 'باص'];
/** تخصيص الباص: باص المجمع، أو باص الرحلات غير الطبية (نفس القيم في shared/transport.ts) */
const BUS_ROLE_VALUES = ['shuttle', 'nonMedical'];
const BUS_ROLE_LABELS = ['shuttle' => 'باص المجمع', 'nonMedical' => 'باص الرحلات غير الطبية'];
/** إنهاء مشرف السيارات لرحلة عالقة يقدّم حالة الموعد كما عند استلام الضيف: [قبل => بعد] */
const TRIP_END_APPOINTMENT_STATUS = ['تم طلب السيارة' => 'تم استلام المريض', 'طلب عودة' => 'مكتملة', 'تم استلام المريض' => 'مكتملة'];
const HOSPITAL_FIELDS = ['id', 'name', 'nameEn', 'zone', 'lat', 'lng', 'aliases', 'verified', '_o'];
/** المجموعات التي تُزامن مع موظفي المكتب */
const SYNC_COLLECTIONS = ['appointments', 'requests', 'fleet', 'hospitals', 'vehicleLocations', 'meta'];

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
        && is_bool($data['cancer'] ?? false);
}

/** يعيد سبب الرفض، أو null إن كانت العملية مسموحة. */
function authorize_write(array $user, string $col, string $id, ?array $before, ?array $after): ?string
{
    $denied = 'ليست لديك صلاحية لتنفيذ هذا الإجراء.';
    $role = $user['role'];
    if ($after !== null && count($after) > 40 && $col !== 'meta') return 'بيانات غير صالحة';
    $changed = ($before !== null && $after !== null) ? changed_keys($before, $after) : [];

    switch ($col) {
        case 'appointments':
            if ($after === null) return has_role($user, ['admin', 'clinic']) ? null : $denied;
            if ($before === null) {
                if (!valid_appointment($after, $id)) return 'بيانات الموعد غير صالحة';
                if (has_role($user, ['admin', 'clinic'])) return null;
                // مشرف السيارات يضيف رحلات غير طبية فقط
                return ($role === 'fleetSupervisor' && ($after['category'] ?? '') === 'غير طبية') ? null : $denied;
            }
            if (has_role($user, ['admin', 'clinic'])) {
                return only($changed, APPOINTMENT_FIELDS) && !in_array('id', $changed, true)
                    && in_array($after['status'] ?? null, APPOINTMENT_STATUSES, true)
                    && in_array($after['gender'] ?? 'ذكر', ['ذكر', 'أنثى'], true) && is_bool($after['cancer'] ?? false) ? null : $denied;
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
                    && !array_intersect(array_keys($after), ['vehiclePlate', 'driver', 'groupId', 'notificationSentAt', ...TRIP_FIELDS]);
                return $valid ? null : 'بيانات الطلب غير صالحة';
            }
            if (!valid_trip_fields($after)) return 'بيانات الطلب غير صالحة';
            if ($role === 'admin') {
                return only($changed, REQUEST_FIELDS) && !array_intersect($changed, ['id', 'appointmentId', 'fromAppointmentId'])
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
                    && in_array($after['kind'] ?? null, VEHICLE_KINDS, true) && valid_bus_role($after) ? null : 'بيانات السيارة غير صالحة';
            }
            // مشرف السيارات يغيّر إتاحة السيارة، وتخصيص الباص (باص المجمع أو الرحلات غير الطبية)
            if ($role === 'fleetSupervisor' && $before !== null) {
                return only($changed, ['available', 'busRole']) && is_bool($after['available'] ?? null) && valid_bus_role($after) ? null : $denied;
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
