<?php
declare(strict_types=1);

/*
 * يعمل من cron في hPanel كل دقيقة (سطر الأوامر فقط):
 *   /usr/bin/php /home/<المستخدم>/domains/althumamacar.sifr-qr.com/public_html/api/cron.php
 * يسأل خدمة التتبع أربع مرات في الدقيقة، فتصل مواقع السيارات ويُكتشف وصولها ولو لم تكن صفحة مفتوحة.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require __DIR__ . '/lib/bootstrap.php';
require __DIR__ . '/lib/docs.php';
require __DIR__ . '/lib/rules.php';
require __DIR__ . '/lib/activity.php';
require __DIR__ . '/lib/push.php';
require __DIR__ . '/lib/driver.php';
require __DIR__ . '/lib/drivers.php';
require __DIR__ . '/lib/tracking.php';
require __DIR__ . '/lib/positions.php';
require __DIR__ . '/lib/tracker.php';

if (!tracker_config()) {
    fwrite(STDERR, "tracker is not configured in althumama-config.php\n");
    exit(1);
}
$started = time();
for ($round = 0; $round < 4; $round++) {
    if ($round > 0) sleep(max(0, $started + $round * TRACKER_POLL_SECONDS - time()));
    try {
        poll_tracker(db());
    } catch (Throwable $error) {
        error_log('[althumama cron] ' . $error);
    }
}
