"""Drafts, chat mute, scheduled messages."""

import json


def upsert_draft(get_db_cursor, logger, Error, username, room_id, draft_text):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                INSERT INTO message_drafts (username, room_id, draft_text)
                VALUES (%s, %s, %s)
                ON DUPLICATE KEY UPDATE draft_text = VALUES(draft_text)
                """,
                (username, room_id, draft_text or ""),
            )
            return True
    except Error as error:
        logger.error(f"Ошибка сохранения черновика: {error}")
        return False


def delete_draft(get_db_cursor, logger, Error, username, room_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "DELETE FROM message_drafts WHERE username = %s AND room_id = %s",
                (username, room_id),
            )
            return True
    except Error as error:
        logger.error(f"Ошибка удаления черновика: {error}")
        return False


def get_draft(get_db_cursor, logger, Error, username, room_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT draft_text FROM message_drafts
                WHERE username = %s AND room_id = %s
                """,
                (username, room_id),
            )
            row = cursor.fetchone()
            return (row or {}).get("draft_text") or ""
    except Error as error:
        logger.error(f"Ошибка чтения черновика: {error}")
        return ""


def list_drafts_for_user(get_db_cursor, logger, Error, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT room_id, draft_text, updated_at FROM message_drafts
                WHERE username = %s AND draft_text IS NOT NULL AND TRIM(draft_text) != ''
                """,
                (username,),
            )
            rows = cursor.fetchall()
        for r in rows:
            if r.get("updated_at"):
                r["updated_at"] = r["updated_at"].isoformat()
        return rows
    except Error as error:
        logger.error(f"Ошибка списка черновиков: {error}")
        return []


def set_chat_mute(get_db_cursor, logger, Error, username, room_id, muted):
    try:
        with get_db_cursor() as (cursor, _):
            if muted:
                cursor.execute(
                    """
                    INSERT INTO chat_mute (username, room_id) VALUES (%s, %s)
                    ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP
                    """,
                    (username, room_id),
                )
            else:
                cursor.execute(
                    "DELETE FROM chat_mute WHERE username = %s AND room_id = %s",
                    (username, room_id),
                )
            return True
    except Error as error:
        logger.error(f"Ошибка настройки «не беспокоить»: {error}")
        return False


def list_muted_rooms(get_db_cursor, logger, Error, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "SELECT room_id FROM chat_mute WHERE username = %s",
                (username,),
            )
            return [row["room_id"] for row in cursor.fetchall()]
    except Error as error:
        logger.error(f"Ошибка списка заглушённых чатов: {error}")
        return []


def insert_scheduled_message(get_db_cursor, logger, Error, row):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                INSERT INTO scheduled_messages
                (room_id, username, text, media_type, media_path, media_name,
                 media_meta, reply_to_json, scheduled_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    row["room_id"],
                    row["username"],
                    row.get("text") or "",
                    row.get("media_type"),
                    row.get("media_path"),
                    row.get("media_name"),
                    json.dumps(row["media_meta"]) if row.get("media_meta") else None,
                    json.dumps(row["reply_to_json"]) if row.get("reply_to_json") else None,
                    row["scheduled_at"],
                ),
            )
            lid = cursor.lastrowid
            return int(lid) if lid else None
    except Error as error:
        logger.error(f"Ошибка вставки отложенного сообщения: {error}")
        return None


def fetch_due_scheduled(get_db_cursor, logger, Error, limit=20):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT * FROM scheduled_messages
                WHERE sent_message_id IS NULL AND scheduled_at <= UTC_TIMESTAMP()
                ORDER BY scheduled_at ASC
                LIMIT %s
                """,
                (limit,),
            )
            return cursor.fetchall()
    except Error as error:
        logger.error(f"Ошибка выборки отложенных: {error}")
        return []


def mark_scheduled_sent(get_db_cursor, logger, Error, sched_id, sent_message_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                UPDATE scheduled_messages
                SET sent_message_id = %s
                WHERE id = %s AND (sent_message_id IS NULL OR sent_message_id = %s)
                """,
                (sent_message_id, sched_id, sent_message_id),
            )
            return True
    except Error as error:
        logger.error(f"Ошибка отметки отложенного как отправленного: {error}")
        return False


def delete_scheduled_message(get_db_cursor, logger, Error, sched_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute("DELETE FROM scheduled_messages WHERE id = %s", (sched_id,))
            return True
    except Error as error:
        logger.error(f"Ошибка удаления строки отложенного: {error}")
        return False


def _row_to_scheduled_dict(row):
    if not row:
        return None
    out = dict(row)
    for key in ("scheduled_at", "created_at"):
        if out.get(key) is not None and hasattr(out[key], "isoformat"):
            out[key] = out[key].isoformat()
    meta = out.get("media_meta")
    if isinstance(meta, (bytes, str)):
        try:
            out["media_meta"] = json.loads(meta)
        except (json.JSONDecodeError, TypeError):
            out["media_meta"] = None
    reply = out.get("reply_to_json")
    if isinstance(reply, (bytes, str)):
        try:
            out["reply_to_json"] = json.loads(reply)
        except (json.JSONDecodeError, TypeError):
            out["reply_to_json"] = None
    return out


def list_pending_scheduled_for_room(
    get_db_cursor, logger, Error, username, room_id
):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT * FROM scheduled_messages
                WHERE room_id = %s AND username = %s AND sent_message_id IS NULL
                ORDER BY scheduled_at ASC
                """,
                (room_id, username),
            )
            return [_row_to_scheduled_dict(r) for r in cursor.fetchall()]
    except Error as error:
        logger.error(f"Ошибка списка отложенных: {error}")
        return []


def get_pending_scheduled(
    get_db_cursor, logger, Error, sched_id, username
):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT * FROM scheduled_messages
                WHERE id = %s AND username = %s AND sent_message_id IS NULL
                """,
                (sched_id, username),
            )
            return _row_to_scheduled_dict(cursor.fetchone())
    except Error as error:
        logger.error(f"Ошибка чтения отложенного: {error}")
        return None


def update_pending_scheduled(
    get_db_cursor, logger, Error, sched_id, username, updates
):
    if not updates:
        return False
    allowed = {
        "text",
        "scheduled_at",
        "media_type",
        "media_path",
        "media_name",
        "media_meta",
        "reply_to_json",
    }
    parts = []
    params = []
    for key, val in updates.items():
        if key not in allowed:
            continue
        if key in ("media_meta", "reply_to_json"):
            val = json.dumps(val) if val is not None else None
        parts.append(f"{key} = %s")
        params.append(val)
    if not parts:
        return False
    params.extend([sched_id, username])
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                f"""
                UPDATE scheduled_messages
                SET {", ".join(parts)}
                WHERE id = %s AND username = %s AND sent_message_id IS NULL
                """,
                tuple(params),
            )
            return cursor.rowcount > 0
    except Error as error:
        logger.error(f"Ошибка обновления отложенного: {error}")
        return False


def delete_pending_scheduled(get_db_cursor, logger, Error, sched_id, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                DELETE FROM scheduled_messages
                WHERE id = %s AND username = %s AND sent_message_id IS NULL
                """,
                (sched_id, username),
            )
            return cursor.rowcount > 0
    except Error as error:
        logger.error(f"Ошибка удаления отложенного: {error}")
        return False


def get_room_row(get_db_cursor, logger, Error, room_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute("SELECT * FROM rooms WHERE room_id = %s", (room_id,))
            return cursor.fetchone()
    except Error as error:
        logger.error(f"Ошибка get_room_row: {error}")
        return None


def list_room_rows(get_db_cursor, logger, Error, room_ids):
    unique = list(dict.fromkeys(rid for rid in room_ids if rid))
    if not unique:
        return {}
    placeholders = ",".join(["%s"] * len(unique))
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                f"SELECT * FROM rooms WHERE room_id IN ({placeholders})",
                unique,
            )
            return {row["room_id"]: row for row in cursor.fetchall()}
    except Error as error:
        logger.error(f"Ошибка list_room_rows: {error}")
        return {}
