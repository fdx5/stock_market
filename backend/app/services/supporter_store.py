"""Monthly donor acknowledgements entered by an authenticated administrator."""
from app.services.support_comment_store import _run


def _item(row):
    return dict(zip(('id', 'month', 'nickname', 'color'), row))


def list_supporters(month):
    return [_item(row) for row in _run(lambda conn: conn.execute(
        'SELECT id, month, nickname, color FROM support_monthly_donors WHERE month = ? ORDER BY id', (month,)
    ).fetchall())]


def save_supporter(month, nickname, color, supporter_id=None):
    nickname_key = ''.join(nickname.casefold().split())

    def save(conn):
        if supporter_id is None:
            row = conn.execute(
                'INSERT INTO support_monthly_donors(month, nickname, nickname_key, color) VALUES (?, ?, ?, ?) '
                'ON CONFLICT(month, nickname_key) DO UPDATE SET nickname = excluded.nickname, color = excluded.color, updated_at = CURRENT_TIMESTAMP '
                'RETURNING id, month, nickname, color', (month, nickname, nickname_key, color)
            ).fetchone()
        else:
            row = conn.execute(
                'UPDATE support_monthly_donors SET month = ?, nickname = ?, nickname_key = ?, color = ?, updated_at = CURRENT_TIMESTAMP '
                'WHERE id = ? AND NOT EXISTS (SELECT 1 FROM support_monthly_donors WHERE month = ? AND nickname_key = ? AND id != ?) '
                'RETURNING id, month, nickname, color',
                (month, nickname, nickname_key, color, supporter_id, month, nickname_key, supporter_id)
            ).fetchone()
        conn.commit()
        return _item(row) if row else None
    return _run(save)


def delete_supporter(supporter_id):
    def remove(conn):
        cursor = conn.execute('DELETE FROM support_monthly_donors WHERE id = ?', (supporter_id,))
        conn.commit()
        return cursor.rowcount > 0
    return _run(remove)
