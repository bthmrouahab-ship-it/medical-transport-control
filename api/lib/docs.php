<?php
declare(strict_types=1);

// البيانات المشتركة: كل عنصر في docs بمجموعته ورقمه ومحتواه JSON، ورقم مراجعة للمزامنة.

function current_revision(PDO $pdo): int
{
    return (int)$pdo->query('SELECT value FROM revision WHERE id = 1')->fetchColumn();
}

/** رقم مراجعة جديد لكل عملية حفظ؛ يرتّب الكتابات فتعرف المزامنة ما تغيّر منذ آخر مرة. */
function next_revision(PDO $pdo): int
{
    $pdo->exec('UPDATE revision SET value = value + 1 WHERE id = 1');
    return current_revision($pdo);
}

function encode_doc(array $data): string
{
    return json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
}

function decode_doc(?string $data): ?array
{
    if ($data === null) return null;
    $value = json_decode($data, true);
    return is_array($value) ? $value : null;
}

function valid_doc_id(string $id): bool
{
    return (bool)preg_match('/^[A-Za-z0-9._:-]{1,160}$/', $id);
}

function save_doc(PDO $pdo, string $col, string $id, ?array $data, int $rev): void
{
    $pdo->prepare('INSERT INTO docs (col, id, data, rev) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE data = VALUES(data), rev = VALUES(rev)')
        ->execute([$col, $id, $data === null ? null : encode_doc($data), $rev]);
}
