<?php
declare(strict_types=1);

/**
 * السائقون منفصلون عن السيارات: قائمة السائقين (المجموعة drivers) يكتبها المدير، ومشرف السيارات يخصص لكل سيارة
 * سائقها (driverId) في بداية الشفت، ويبقى آخر تخصيص محفوظًا. اسم السائق ورقمه يُنسخان في السيارة لكل الصفحات،
 * وحساب تطبيق السائق (uid في السائق) يتبع السيارة المخصصة لسائقه: users.vehicle_plate يُحسب هنا فقط،
 * ومنه رحلات السائق وموقعه وإشعاراته.
 */

/** كل مستندات المجموعة: الرقم ← المحتوى ($lock: حتى لا يخصص حفظان متزامنان نفس السائق لسيارتين) */
function docs_of(PDO $pdo, string $col, bool $lock = false): array
{
    $stmt = $pdo->prepare('SELECT id, data FROM docs WHERE col = ? AND data IS NOT NULL ORDER BY id' . ($lock ? ' FOR UPDATE' : ''));
    $stmt->execute([$col]);
    $docs = [];
    foreach ($stmt->fetchAll() as $row) {
        $data = decode_doc($row['data']);
        if ($data !== null) $docs[(string)$row['id']] = $data;
    }
    return $docs;
}

/** السائق المرتبط بحساب تطبيق السائق، أو null */
function account_driver(PDO $pdo, string $uid): ?array
{
    $stmt = $pdo->prepare("SELECT data FROM docs WHERE col = 'drivers' AND data LIKE ?");
    $stmt->execute(['%' . addcslashes('"uid":' . json_encode($uid), '%_\\') . '%']);
    foreach ($stmt->fetchAll() as $row) {
        $driver = decode_doc($row['data']);
        if ($driver && (string)($driver['uid'] ?? '') === $uid) return $driver;
    }
    return null;
}

/**
 * بعد كل حفظ يغيّر السيارات أو السائقين: اسم السائق ورقمه في كل سيارة كما في قائمة السائقين (وفارغان للسيارة
 * بلا سائق أو إن حُذف سائقها)، والسائق في سيارة واحدة فقط، وحسابات السائقين تتبع سياراتهم.
 */
function normalize_fleet_drivers(PDO $pdo, int $rev): void
{
    $drivers = docs_of($pdo, 'drivers', true);
    $plateOf = [];
    foreach (docs_of($pdo, 'fleet', true) as $plate => $vehicle) {
        $plate = (string)$plate;
        $driverId = $vehicle['driverId'] ?? null;
        $driver = is_string($driverId) ? ($drivers[$driverId] ?? null) : null;
        if ($driver !== null && isset($plateOf[$driverId])) {
            throw new ApiException(409, "السائق {$driver['name']} مخصص لسيارتين: {$plateOf[$driverId]} و$plate. اختر لإحداهما سائقًا آخر.", 'conflict');
        }
        $next = $vehicle;
        if ($driver !== null) {
            $plateOf[$driverId] = $plate;
            $next['driver'] = (string)$driver['name'];
            $next['phone'] = (string)($driver['phone'] ?? '');
        } else {
            unset($next['driverId'], $next['driverSince']);
            $next['driver'] = '';
            $next['phone'] = '';
        }
        if ($next !== $vehicle) save_doc($pdo, 'fleet', $plate, $next, $rev);
    }
    sync_driver_accounts($pdo, $drivers, $plateOf, $rev);
}

/**
 * سيارة كل حساب سائق = السيارة المخصصة لسائقه (أو بلا سيارة). إن تغيّرت سيارة الحساب تتوقف مشاركة الموقع
 * للسيارة السابقة، فلا يظهر عليها اسم سائق تركها (يبدأ سائقها الجديد مشاركة موقعه).
 */
function sync_driver_accounts(PDO $pdo, array $drivers, array $plateOf, int $rev): void
{
    $driverOf = [];
    foreach ($drivers as $id => $driver) {
        if (isset($driver['uid'])) $driverOf[(string)$driver['uid']] = (string)$id;
    }
    $update = $pdo->prepare('UPDATE users SET vehicle_plate = ? WHERE id = ?');
    foreach ($pdo->query('SELECT id, role, vehicle_plate FROM users')->fetchAll() as $user) {
        $driverId = $user['role'] === 'driver' ? ($driverOf[(string)$user['id']] ?? null) : null;
        $plate = $driverId !== null ? ($plateOf[$driverId] ?? null) : null;
        $current = $user['vehicle_plate'] === null ? null : (string)$user['vehicle_plate'];
        if ($plate === $current) continue;
        $update->execute([$plate, $user['id']]);
        if ($current !== null) stop_sharing($pdo, $current, $rev);
    }
}

function stop_sharing(PDO $pdo, string $plate, int $rev): void
{
    $stmt = $pdo->prepare("SELECT data FROM docs WHERE col = 'vehicleLocations' AND id = ? FOR UPDATE");
    $stmt->execute([$plate]);
    $location = decode_doc($stmt->fetchColumn() ?: null);
    if ($location && ($location['sharing'] ?? false)) save_doc($pdo, 'vehicleLocations', $plate, ['sharing' => false, 'updatedAt' => now_iso()] + $location, $rev);
}

/**
 * يربط حساب تطبيق السائق بسائق من القائمة، أو يلغي الربط (null). السائق المرتبط بحساب آخر لا يُربط بثانٍ.
 * يعيد اسم السائق السابق والجديد (للسجل). داخل معاملة المستدعي.
 */
function link_driver_account(PDO $pdo, string $uid, ?string $driverId, int $rev): array
{
    $drivers = docs_of($pdo, 'drivers', true);
    $target = $driverId !== null ? ($drivers[$driverId] ?? null) : null;
    if ($driverId !== null && $target === null) throw new ApiException(400, 'اختر سائقًا من قائمة السائقين', 'invalid');
    if ($target !== null && isset($target['uid']) && (string)$target['uid'] !== $uid) {
        throw new ApiException(409, "السائق {$target['name']} مرتبط بحساب آخر", 'conflict');
    }
    $previous = null;
    foreach ($drivers as $id => $driver) {
        $id = (string)$id;
        $linked = (string)($driver['uid'] ?? '') === $uid;
        $next = $driver;
        if ($linked && $id !== $driverId) {
            unset($next['uid']);
            $previous = $driver['name'];
        } elseif (!$linked && $id === $driverId) {
            $next['uid'] = $uid;
        } elseif ($linked) {
            $previous = $driver['name'];
        }
        if ($next !== $driver) save_doc($pdo, 'drivers', $id, $next, $rev);
    }
    normalize_fleet_drivers($pdo, $rev);
    return ['from' => $previous, 'to' => $target['name'] ?? null];
}

/** الاسم بلا مسافات زائدة (لمطابقة اسم حساب السائق باسم سائق السيارة) */
function plain_name(string $name): string
{
    return preg_replace('/\s+/u', ' ', trim($name));
}

/**
 * ترحيل مرة واحدة بعد فصل السائقين عن السيارات: سائق لكل سيارة من اسمه ورقمه المسجلين فيها، والسيارة مخصصة له.
 * حساب تطبيق السائق المرتبط بسيارة يُربط بسائقها (الحساب الوحيد للسيارة، أو الذي يطابق اسمه اسم السائق)،
 * وباقي الحسابات سائقون في القائمة بلا سيارة حتى يخصصها مشرف السيارات.
 */
function migrate_drivers(PDO $pdo): void
{
    $pdo->beginTransaction();
    try {
        if (docs_of($pdo, 'drivers')) {
            $pdo->commit();
            return;
        }
        $rev = next_revision($pdo);
        $fleet = docs_of($pdo, 'fleet', true);
        uasort($fleet, fn(array $a, array $b) => ((float)($a['_o'] ?? 0)) <=> ((float)($b['_o'] ?? 0)));
        $drivers = [];
        $driverOfPlate = [];
        $add = function (array $driver) use (&$drivers): string {
            $id = 'D-' . (count($drivers) + 1);
            $drivers[$id] = ['id' => $id] + $driver + ['_o' => count($drivers) + 1];
            return $id;
        };
        foreach ($fleet as $plate => $vehicle) {
            $name = mb_substr(plain_name((string)($vehicle['driver'] ?? '')), 0, 60);
            if (mb_strlen($name) < 2) continue;
            $phone = preg_replace('/[\s-]/', '', (string)($vehicle['phone'] ?? ''));
            $driverOfPlate[(string)$plate] = $add(['name' => $name] + (preg_match('/^\+?\d{8,15}$/', $phone) ? ['phone' => $phone] : []));
        }
        $byPlate = [];
        foreach ($pdo->query("SELECT id, display_name, vehicle_plate FROM users WHERE role = 'driver' ORDER BY id")->fetchAll() as $account) {
            $byPlate[(string)($account['vehicle_plate'] ?? '')][] = $account;
        }
        foreach ($byPlate as $plate => $accounts) {
            $plate = (string)$plate;
            $id = $driverOfPlate[$plate] ?? null;
            $match = null;
            if ($id !== null) {
                $named = array_values(array_filter($accounts, fn(array $account) => plain_name($account['display_name']) === $drivers[$id]['name']));
                $match = count($accounts) === 1 ? $accounts[0] : ($named[0] ?? null);
                if ($match) $drivers[$id]['uid'] = (string)$match['id'];
            }
            foreach ($accounts as $account) {
                if ($match && $account['id'] === $match['id']) continue;
                $newId = $add(['name' => mb_substr(plain_name($account['display_name']), 0, 60), 'uid' => (string)$account['id']]);
                // سيارة الحساب بلا سائق مسجل: يقودها سائق هذا الحساب
                if ($plate !== '' && isset($fleet[$plate]) && !isset($driverOfPlate[$plate])) $driverOfPlate[$plate] = $newId;
            }
        }
        foreach ($drivers as $id => $driver) save_doc($pdo, 'drivers', (string)$id, $driver, $rev);
        foreach ($fleet as $plate => $vehicle) {
            $id = $driverOfPlate[(string)$plate] ?? null;
            if ($id !== null) save_doc($pdo, 'fleet', (string)$plate, ['driverId' => $id] + $vehicle, $rev);
        }
        normalize_fleet_drivers($pdo, $rev);
        $pdo->commit();
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}
