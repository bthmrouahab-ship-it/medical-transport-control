<?php
declare(strict_types=1);

/**
 * صلاحيات الكتابة حسب الدور (كانت في firestore.rules).
 * كل عملية تُفحص قبل الحفظ: $before المستند الحالي أو null، و$after المستند بعد التعديل أو null عند الحذف.
 */

const APPOINTMENT_STATUSES = ['بانتظار طلب السيارة', 'تم طلب السيارة', 'تم استلام المريض', 'طلب عودة', 'مكتملة'];
const APPOINTMENT_FIELDS = ['id', 'patientName', 'clinic', 'buildingNumber', 'apartmentNumber', 'mobile', 'appointmentDate',
    'appointmentAt', 'hospitalId', 'category', 'kind', 'assistance', 'status', '_o'];
const REQUEST_STATUSES = ['بانتظار التوزيع', 'تم إرسال السيارة', 'وصلت السيارة', 'تم استلام المريض'];
const REQUEST_FIELDS = ['id', 'appointmentId', 'vehiclePlate', 'driver', 'direction', 'status', 'notificationMethod',
    'createdAt', 'groupId', 'notificationSentAt', '_o'];
const VEHICLE_FIELDS = ['plate', 'driver', 'phone', 'kind', 'available', '_o'];
const VEHICLE_KINDS = ['سيدان', 'احتياجات خاصة', 'باص'];
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
        && is_array($data['assistance'] ?? []) && count($data['assistance'] ?? []) <= 4;
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
                    && in_array($after['status'] ?? null, APPOINTMENT_STATUSES, true) ? null : $denied;
            }
            // مشرف المبنى لا يغيّر بيانات المريض ولا وقت الموعد، بل حالة الموعد فقط
            if ($role === 'buildingSupervisor') {
                return only($changed, ['status']) && in_array($after['status'] ?? null, APPOINTMENT_STATUSES, true) ? null : $denied;
            }
            return $denied;

        case 'requests':
            if ($after === null) return has_role($user, ['admin', 'buildingSupervisor']) ? null : $denied;
            if ($before === null) {
                // الطلب الجديد يبدأ دائمًا بانتظار التوزيع، والسيارة يحددها مشرف السيارات لاحقًا
                if (!has_role($user, ['admin', 'buildingSupervisor', 'fleetSupervisor'])) return $denied;
                $valid = only(array_keys($after), REQUEST_FIELDS)
                    && ($after['id'] ?? null) === $id
                    && is_text($after['appointmentId'] ?? null, 160)
                    && in_array($after['direction'] ?? null, ['ذهاب', 'عودة'], true)
                    && ($after['status'] ?? null) === 'بانتظار التوزيع'
                    && in_array($after['notificationMethod'] ?? null, ['whatsapp', 'call'], true)
                    && !array_intersect(array_keys($after), ['vehiclePlate', 'driver', 'groupId', 'notificationSentAt']);
                return $valid ? null : 'بيانات الطلب غير صالحة';
            }
            if ($role === 'admin') {
                return only($changed, REQUEST_FIELDS) && !array_intersect($changed, ['id', 'appointmentId'])
                    && in_array($after['status'] ?? null, REQUEST_STATUSES, true) ? null : $denied;
            }
            // مشرف السيارات: إرسال السيارة وجمع الرحلات
            if ($role === 'fleetSupervisor') {
                return only($changed, ['vehiclePlate', 'driver', 'status', 'groupId', 'notificationSentAt'])
                    && (!in_array('status', $changed, true) || ($after['status'] ?? null) === 'تم إرسال السيارة') ? null : $denied;
            }
            // مشرف المبنى: تأكيد وصول السيارة واستلام المريض فقط
            if ($role === 'buildingSupervisor') {
                return only($changed, ['status']) && in_array($after['status'] ?? null, ['وصلت السيارة', 'تم استلام المريض'], true) ? null : $denied;
            }
            return $denied;

        case 'fleet':
            // المدير يعدّل كل البيانات، ومشرف السيارات يغيّر حالة الإتاحة فقط
            if ($after === null) return $role === 'admin' ? null : $denied;
            if ($role === 'admin') {
                return only(array_keys($after), VEHICLE_FIELDS) && ($after['plate'] ?? null) === $id
                    && in_array($after['kind'] ?? null, VEHICLE_KINDS, true) ? null : 'بيانات السيارة غير صالحة';
            }
            if ($role === 'fleetSupervisor' && $before !== null) {
                return only($changed, ['available']) && is_bool($after['available'] ?? null) ? null : $denied;
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
