<?php
declare(strict_types=1);

/**
 * سجل العمليات: كل عملية في النظام يسجّلها الخادم نفسه مع اسم من نفّذها ووقتها،
 * فلا يستطيع المتصفح تزويرها أو حذفها. يظهر في الإحصائيات ولوحة المدير ويُصدَّر إلى Excel وHTML.
 */

const ACTIVITY_ROLE_LABELS = [
    'admin' => 'مدير النظام',
    'clinic' => 'العيادة',
    'buildingSupervisor' => 'مشرف المبنى',
    'buildingLead' => 'مسؤول مشرفي المباني',
    'fleetSupervisor' => 'مشرف السيارات',
    'driver' => 'سائق',
];

const APPOINTMENT_FIELD_LABELS = [
    'patientName' => 'اسم الضيف',
    'clinic' => 'الوجهة',
    'buildingNumber' => 'المبنى',
    'apartmentNumber' => 'الشقة',
    'mobile' => 'الموبايل',
    'appointmentDate' => 'التاريخ',
    'appointmentAt' => 'الوقت',
    'kind' => 'نوع الرحلة',
    'assistance' => 'الاحتياجات',
    'gender' => 'الجنس',
    'cancer' => 'حالة سرطان',
];

const VEHICLE_FIELD_LABELS = ['plate' => 'رقم السيارة', 'driver' => 'السائق', 'phone' => 'الهاتف', 'kind' => 'النوع', 'busRole' => 'تخصيص الباص'];

const REQUEST_FIELD_LABELS = [
    'vehiclePlate' => 'السيارة',
    'driver' => 'السائق',
    'notificationMethod' => 'طريقة التنبيه',
    'etaAt' => 'الوصول المتوقع',
    'arrivedAt' => 'وقت الوصول',
];

const HOSPITAL_FIELD_LABELS = ['name' => 'الاسم', 'nameEn' => 'الاسم بالإنجليزية', 'zone' => 'المنطقة', 'lat' => 'خط العرض', 'lng' => 'خط الطول', 'aliases' => 'الأسماء البديلة'];

/** الوقت بتوقيت قطر (HH:MM) من وقت ISO. */
function qatar_time(?string $iso): string
{
    if (!is_string($iso) || $iso === '' || strtotime($iso) === false) return '';
    return (new DateTimeImmutable($iso))->setTimezone(new DateTimeZone('Asia/Qatar'))->format('H:i');
}

function text_value($value): string
{
    if (is_array($value)) return implode('، ', array_map('text_value', $value));
    if (is_bool($value)) return $value ? 'نعم' : 'لا';
    return trim((string)($value ?? ''));
}

function clip(string $text, int $max = 500): string
{
    return mb_strlen($text) > $max ? mb_substr($text, 0, $max - 1) . '…' : $text;
}

/**
 * يسجّل عملية. $user صف المستخدم (أو null للنظام)، و$details بيانات إضافية تظهر في التصدير
 * (المريض، المبنى، الوجهة، السيارة، السائق، السبب، التغييرات...).
 */
function log_activity(PDO $pdo, ?array $user, string $type, string $action, string $summary, string $ref = '', array $details = [], ?string $name = null): void
{
    $details = array_filter($details, fn($value) => $value !== null && $value !== '' && $value !== []);
    $pdo->prepare('INSERT INTO activity (at, user_id, user_name, user_role, type, action, ref, summary, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([
            now_iso(),
            $user ? (int)$user['id'] : null,
            mb_substr($name ?? ($user['display_name'] ?? 'النظام'), 0, 60),
            $user['role'] ?? '',
            $type,
            $action,
            mb_substr($ref, 0, 160),
            clip($summary),
            $details ? json_encode($details, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) : null,
        ]);
}

/** الموعد المرتبط بطلب (لاسم المريض والوجهة في السجل). */
function appointment_doc(PDO $pdo, string $id): ?array
{
    static $cache = [];
    if (!array_key_exists($id, $cache)) {
        $stmt = $pdo->prepare("SELECT data FROM docs WHERE col = 'appointments' AND id = ?");
        $stmt->execute([$id]);
        $cache[$id] = decode_doc($stmt->fetchColumn() ?: null);
    }
    return $cache[$id];
}

/** بيانات الموعد التي تظهر مع كل عملية عليه. */
function appointment_details(?array $appointment, string $id = ''): array
{
    if (!$appointment) return ['appointment' => $id];
    return [
        'appointment' => $appointment['id'] ?? $id,
        'patient' => $appointment['patientName'] ?? '',
        'building' => $appointment['buildingNumber'] ?? '',
        'apartment' => $appointment['apartmentNumber'] ?? '',
        'destination' => $appointment['clinic'] ?? '',
        'date' => $appointment['appointmentDate'] ?? '',
        'time' => $appointment['appointmentAt'] ?? '',
        'category' => $appointment['category'] ?? '',
    ];
}

/** التغييرات بين نسختين لخانات محددة: [الخانة => [قبل، بعد]] بأسماء عربية. */
function field_changes(?array $before, ?array $after, array $labels): array
{
    $changes = [];
    foreach ($labels as $field => $label) {
        $old = text_value($before[$field] ?? '');
        $new = text_value($after[$field] ?? '');
        if ($old !== $new) $changes[$label] = [$old, $new];
    }
    return $changes;
}

function changes_text(array $changes): string
{
    return implode('، ', array_map(fn($label, $pair) => "$label: {$pair[0]} ← {$pair[1]}", array_keys($changes), $changes));
}

/**
 * وصف عملية كتابة واحدة على البيانات المشتركة: [النوع، العملية، الملخص، البيانات، تلقائية؟]،
 * أو null إن لم تكن تستحق التسجيل. العملية التلقائية تُسجَّل باسم «النظام».
 */
function describe_write(PDO $pdo, string $col, string $id, ?array $before, ?array $after): ?array
{
    $changed = ($before !== null && $after !== null) ? array_values(array_diff(changed_keys($before, $after), ['_o'])) : [];
    if ($before !== null && $after !== null && !$changed) return null;

    switch ($col) {
        case 'appointments':
            $doc = $after ?? $before;
            $details = appointment_details($doc, $id);
            $who = $details['patient'] ?? $id;
            $when = trim(($details['date'] ?? '') . ' ' . ($details['time'] ?? ''));
            $nonMedical = ($doc['category'] ?? '') === 'غير طبية';
            if ($before === null) {
                return ['appointment', 'appointment.create', ($nonMedical ? 'إضافة رحلة غير طبية لـ ' : 'إضافة موعد ') . "$who إلى {$details['destination']} ($when)", $details];
            }
            if ($after === null) return ['appointment', 'appointment.delete', "حذف موعد $who ({$details['destination']}، $when)", $details];
            if (($after['status'] ?? null) === 'ملغي' && ($before['status'] ?? null) !== 'ملغي') {
                $details['reason'] = $after['cancelReason'] ?? '';
                return ['appointment', 'appointment.cancel', "إلغاء موعد $who ({$details['destination']}، $when): " . ($after['cancelReason'] ?? ''), $details];
            }
            // تغيّر الحالة وحده نتيجة طلب السيارة أو استلام المريض، ويُسجَّل مع الطلب نفسه
            if (!array_diff($changed, ['status'])) return null;
            $changes = field_changes($before, $after, APPOINTMENT_FIELD_LABELS);
            if (!$changes) return null;
            $details['changes'] = changes_text($changes);
            return ['appointment', 'appointment.update', "تعديل موعد $who: " . changes_text($changes), $details];

        case 'requests':
            $request = $after ?? $before;
            $details = appointment_details(appointment_doc($pdo, (string)($request['appointmentId'] ?? '')), (string)($request['appointmentId'] ?? ''));
            $details += [
                'request' => $id,
                'direction' => $request['direction'] ?? '',
                'plate' => $request['vehiclePlate'] ?? '',
                'driver' => $request['driver'] ?? '',
            ];
            $who = $details['patient'] ?? '';
            $direction = $request['direction'] ?? 'ذهاب';
            $plate = $request['vehiclePlate'] ?? '';
            if ($before === null) {
                $details['status'] = 'بانتظار التوزيع';
                if (!empty($request['fromAppointmentId'])) {
                    $first = appointment_doc($pdo, (string)$request['fromAppointmentId']);
                    $details['from'] = $first['clinic'] ?? '';
                    return ['request', 'request.create', "طلب نقل $who من {$details['from']} إلى {$details['destination']} (موعد " . ($details['time'] ?? '') . ') بدل العودة إلى المجمع', $details];
                }
                return ['request', 'request.create', "طلب سيارة $direction لـ $who (مبنى {$details['building']} ← {$details['destination']}، " . ($details['time'] ?? '') . ')', $details];
            }
            if ($after === null) {
                return ['request', 'request.cancel', "إلغاء طلب السيارة ($direction) لـ $who" . ($plate ? " وكانت السيارة $plate قد أُرسلت" : ''), $details];
            }
            $status = $after['status'] ?? '';
            // «تم استلام المريض» تُعرض «تم استلام الضيف»
            $details['status'] = str_replace('المريض', 'الضيف', $status);
            // رد مشرف المبنى على ما سجّله السائق من تطبيقه (الاستلام أولًا: تأكيده يؤكد الوصول معه)
            $checks = ['pickup' => "استلام $who في السيارة $plate", 'arrival' => "وصول السيارة $plate لاستلام $who"];
            foreach ($checks as $kind => $what) {
                if (in_array("{$kind}Check", $changed, true) && ($after["{$kind}Check"] ?? null) === 'denied') {
                    return ['request', 'request.check_denied', "نفي $what ($direction) كما سجّله السائق · عادت الرحلة إلى «{$details['status']}»", $details];
                }
            }
            // ما يسجّله السائق من تطبيقه (بموقع هاتفه لحظتها)
            $byDriver = fn(string $field) => in_array($field, $changed, true) ? ' · سجّله السائق من التطبيق' : '';
            if (in_array('status', $changed, true)) {
                if ($status === 'تم إرسال السيارة') {
                    $group = !empty($after['groupId']) ? ' ضمن رحلة مجمّعة' : '';
                    return ['request', 'request.dispatch', "إرسال السيارة $plate (" . ($after['driver'] ?? '') . ") لـ $who ($direction)$group", $details];
                }
                if ($status === 'وصلت السيارة') return ['request', 'request.car_arrived', "وصول السيارة $plate لاستلام $who ($direction)" . $byDriver('driverArrivedAt'), $details];
                if ($status === 'تم استلام المريض') {
                    $details['eta'] = qatar_time($after['etaAt'] ?? null);
                    return ['request', 'request.pickup', "استلام $who في السيارة $plate ($direction)" . ($details['eta'] ? " · الوصول المتوقع {$details['eta']}" : '') . $byDriver('pickupGps'), $details];
                }
                // مشرف السيارات أنهى رحلة عالقة لم يُسجَّل فيها استلام الضيف (حتى تتفرغ السيارة)
                if ($status === 'وصلت الوجهة' && in_array($before['status'] ?? null, ['تم إرسال السيارة', 'وصلت السيارة'], true)) {
                    $details['arrivedAt'] = qatar_time($after['arrivedAt'] ?? null);
                    $details['source'] = 'إنهاء يدوي';
                    return ['request', 'request.ended', "إنهاء رحلة السيارة $plate لـ $who ($direction) قبل تسجيل الاستلام · أصبحت السيارة متاحة", $details];
                }
                if ($status === 'وصلت الوجهة') {
                    $source = ['gps' => 'GPS', 'estimate' => 'انتهاء المدة التقديرية', 'manual' => 'تأكيد يدوي'][$after['arrivalSource'] ?? ''] ?? '';
                    $details['source'] = $source;
                    $details['arrivedAt'] = qatar_time($after['arrivedAt'] ?? null);
                    $to = $direction === 'عودة' ? 'مجمع الثمامة' : ($details['destination'] ?? '');
                    // انتهاء المدة التقديرية يسجّله النظام تلقائيًا (من صفحة مشرف السيارات المفتوحة)، لا المشرف نفسه
                    $automatic = ($after['arrivalSource'] ?? '') === 'estimate';
                    return ['request', 'request.arrived', "وصول السيارة $plate بـ $who إلى $to" . ($source ? " ($source)" : ''), $details, $automatic];
                }
            }
            if (in_array('groupId', $changed, true)) return ['request', 'request.group', "ضم طلب $who إلى رحلة السيارة $plate", $details];
            foreach ($checks as $kind => $what) {
                if (in_array("{$kind}Check", $changed, true) && ($after["{$kind}Check"] ?? null) === 'confirmed') {
                    return ['request', 'request.check_confirmed', "تأكيد $what ($direction) كما سجّله السائق", $details];
                }
            }
            $times = fn(?array $doc) => $doc ? ['etaAt' => qatar_time($doc['etaAt'] ?? null), 'arrivedAt' => qatar_time($doc['arrivedAt'] ?? null)] + $doc : null;
            $changes = changes_text(field_changes($times($before), $times($after), REQUEST_FIELD_LABELS));
            $details['changes'] = $changes;
            return ['request', 'request.update', "تعديل طلب $who ($direction): " . ($changes ?: implode('، ', $changed)), $details];

        case 'fleet':
            $vehicle = $after ?? $before;
            $plate = $vehicle['plate'] ?? $id;
            $details = ['plate' => $plate, 'driver' => $vehicle['driver'] ?? '', 'kind' => $vehicle['kind'] ?? ''];
            if ($before === null) return ['vehicle', 'vehicle.create', "إضافة السيارة $plate (" . ($vehicle['driver'] ?? '') . '، ' . ($vehicle['kind'] ?? '') . ')', $details];
            if ($after === null) return ['vehicle', 'vehicle.delete', "حذف السيارة $plate (" . ($before['driver'] ?? '') . ')', $details];
            if ($changed === ['available']) {
                return ['vehicle', 'vehicle.availability', !empty($after['available']) ? "إتاحة السيارة $plate للخدمة" : "إيقاف السيارة $plate عن الخدمة", $details];
            }
            $withRole = fn(?array $doc) => $doc ? ['busRole' => BUS_ROLE_LABELS[$doc['busRole'] ?? ''] ?? ''] + $doc : null;
            if ($changed === ['busRole']) {
                $label = BUS_ROLE_LABELS[$after['busRole'] ?? ''] ?? '';
                return ['vehicle', 'vehicle.bus_role', $label ? "تخصيص الباص $plate: $label" : "إلغاء تخصيص الباص $plate (باص عادي)", $details];
            }
            $changes = field_changes($withRole($before), $withRole($after), VEHICLE_FIELD_LABELS);
            $details['changes'] = changes_text($changes);
            return ['vehicle', 'vehicle.update', "تعديل بيانات السيارة $plate: " . changes_text($changes), $details];

        case 'hospitals':
            $name = ($after ?? $before)['name'] ?? $id;
            if ($before === null) return ['hospital', 'hospital.create', "إضافة $name إلى دليل المستشفيات", ['destination' => $name]];
            if ($after === null) return ['hospital', 'hospital.delete', "حذف $name من دليل المستشفيات", ['destination' => $name]];
            $changes = changes_text(field_changes($before, $after, HOSPITAL_FIELD_LABELS));
            return ['hospital', 'hospital.update', "تعديل $name في دليل المستشفيات: " . ($changes ?: implode('، ', $changed)), ['destination' => $name, 'changes' => $changes]];

        case 'vehicleLocations':
            return ['location', 'location.delete', "حذف آخر موقع للسيارة $id", ['plate' => $id]];

        case 'meta':
            // سجل العمليات القديم (قبل هذا السجل) لا يُسجَّل
            if ($id === 'history') return ['stats', 'stats.history', 'حفظ ملخص الإحصائيات السابقة', []];
            return null;
    }
    return null;
}
