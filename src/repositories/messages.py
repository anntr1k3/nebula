import json
from datetime import UTC, datetime, timedelta

from repositories.rooms import room_ids_where_user_is_member_cursor
from utils.json_helpers import parse_json_field
from utils.room_access import (
    can_access_room_with_member_set,
    private_room_peer_username,
)
from utils.time_format import isoformat_utc_z


def add_message_read(get_db_cursor, logger, Error, message_id, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "INSERT IGNORE INTO message_reads (message_id, username) VALUES (%s, %s)",
                (message_id, username),
            )
            return True
    except Error as error:
        logger.error(f"Ошибка записи прочтения: {error}")
        return False


def get_message_reads(get_db_cursor, logger, Error, message_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "SELECT username FROM message_reads WHERE message_id = %s",
                (message_id,),
            )
            return [row["username"] for row in cursor.fetchall()]
    except Error as error:
        logger.error(f"Ошибка чтения прочтений сообщения {message_id}: {error}")
        return []


def add_message_reads_for_room(
    get_db_cursor, logger, Error, message_ids, username, room_id, limit=80
):
    unique_ids = list(dict.fromkeys(mid for mid in message_ids if mid))[:limit]
    if not unique_ids or not username or not room_id:
        return {}

    try:
        with get_db_cursor() as (cursor, _):
            placeholders = _placeholders(unique_ids)
            cursor.execute(
                f"""
                SELECT message_id
                FROM messages
                WHERE room_id = %s
                  AND username != %s
                  AND message_id IN ({placeholders})
                """,
                (room_id, username, *unique_ids),
            )
            valid_ids = [row["message_id"] for row in cursor.fetchall()]
            if not valid_ids:
                return {}

            cursor.execute(
                f"""
                SELECT message_id
                FROM message_reads
                WHERE username = %s
                  AND message_id IN ({_placeholders(valid_ids)})
                """,
                (username, *valid_ids),
            )
            existing_ids = {row["message_id"] for row in cursor.fetchall()}
            new_ids = [mid for mid in valid_ids if mid not in existing_ids]
            if not new_ids:
                return {}

            cursor.executemany(
                "INSERT IGNORE INTO message_reads (message_id, username) VALUES (%s, %s)",
                [(mid, username) for mid in new_ids],
            )

            cursor.execute(
                f"""
                SELECT message_id, username
                FROM message_reads
                WHERE message_id IN ({_placeholders(new_ids)})
                """,
                new_ids,
            )
            reads = {}
            for row in cursor.fetchall():
                reads.setdefault(row["message_id"], []).append(row["username"])
            return reads
    except Error as error:
        logger.error(f"РћС€РёР±РєР° Р±Р°С‚С‡-Р·Р°РїРёСЃРё РїСЂРѕС‡С‚РµРЅРёР№: {error}")
        return {}


def toggle_reaction(get_db_cursor, logger, Error, message_id, username, emoji):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "SELECT id FROM reactions WHERE message_id = %s AND username = %s AND emoji = %s",
                (message_id, username, emoji),
            )
            existing = cursor.fetchone()
            if existing:
                cursor.execute("DELETE FROM reactions WHERE id = %s", (existing["id"],))
                logger.debug(f"Реакция снята: {emoji}, {username}, сообщение {message_id}")
            else:
                cursor.execute(
                    "INSERT INTO reactions (message_id, username, emoji) VALUES (%s, %s, %s)",
                    (message_id, username, emoji),
                )
                logger.debug(f"Реакция добавлена: {emoji}, {username}, сообщение {message_id}")
            return True
    except Error as error:
        logger.error(f"Ошибка переключения реакции: {error}")
        return False


def get_message_reactions(get_db_cursor, logger, Error, message_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "SELECT emoji, username FROM reactions WHERE message_id = %s",
                (message_id,),
            )
            reactions_data = cursor.fetchall()
            reactions = {}
            for row in reactions_data:
                emoji = row["emoji"]
                reactions.setdefault(emoji, []).append(row["username"])
            return reactions
    except Error as error:
        logger.error(f"Ошибка получения реакций для {message_id}: {error}")
        return {}


def get_message_by_id(get_db_cursor, logger, Error, message_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "SELECT * FROM messages WHERE message_id = %s", (message_id,)
            )
            return cursor.fetchone()
    except Error as error:
        logger.error(f"Ошибка получения сообщения {message_id}: {error}")
        return None


def _placeholders(values):
    return ",".join(["%s"] * len(values))


def _list_reactions_for_messages(cursor, message_ids):
    if not message_ids:
        return {}
    cursor.execute(
        f"SELECT message_id, emoji, username FROM reactions WHERE message_id IN ({_placeholders(message_ids)})",
        message_ids,
    )
    reactions = {}
    for row in cursor.fetchall():
        message_reactions = reactions.setdefault(row["message_id"], {})
        message_reactions.setdefault(row["emoji"], []).append(row["username"])
    return reactions


def _list_reads_for_messages(cursor, message_ids):
    if not message_ids:
        return {}
    cursor.execute(
        f"SELECT message_id, username FROM message_reads WHERE message_id IN ({_placeholders(message_ids)})",
        message_ids,
    )
    reads = {}
    for row in cursor.fetchall():
        reads.setdefault(row["message_id"], []).append(row["username"])
    return reads


def _list_messages_by_ids(cursor, message_ids):
    unique = list(dict.fromkeys(mid for mid in message_ids if mid))
    if not unique:
        return {}
    cursor.execute(
        f"SELECT * FROM messages WHERE message_id IN ({_placeholders(unique)})",
        unique,
    )
    return {row["message_id"]: row for row in cursor.fetchall()}


def create_message(get_db_cursor, logger, Error, message_data):
    try:
        with get_db_cursor() as (cursor, _):
            media = message_data.get("media", {})
            reply_to = message_data.get("replyTo", {})
            forwarded = message_data.get("forwarded", {})

            ttl_seconds = message_data.get("ttl_seconds")
            expires_at = None
            if ttl_seconds:
                try:
                    ttl_seconds = int(ttl_seconds)
                    if ttl_seconds > 0:
                        expires_at = datetime.now(UTC) + timedelta(seconds=ttl_seconds)
                        expires_at = expires_at.replace(tzinfo=None)
                except (TypeError, ValueError):
                    expires_at = None

            media_meta = message_data.get("media_meta")
            if isinstance(media_meta, dict):
                media_meta = json.dumps(media_meta)
            elif media_meta is not None and not isinstance(media_meta, str):
                media_meta = None

            cursor.execute(
                """
                INSERT INTO messages
                (message_id, room_id, username, text, media_type, media_data, media_name,
                 reply_to_id, forwarded_from, forwarded_message_id, expires_at, media_meta)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    message_data["id"],
                    message_data["room"],
                    message_data["username"],
                    message_data.get("text", ""),
                    media.get("type") if media else None,
                    media.get("data") if media else None,
                    media.get("name") if media else None,
                    reply_to.get("id") if reply_to else None,
                    forwarded.get("from") if forwarded else None,
                    forwarded.get("originalId") if forwarded else None,
                    expires_at,
                    media_meta,
                ),
            )
            cursor.execute(
                "INSERT IGNORE INTO message_reads (message_id, username) VALUES (%s, %s)",
                (message_data["id"], message_data["username"]),
            )
        logger.info(
            f'Сообщение создано: {message_data["id"]}, комната {message_data["room"]}'
        )
        return True
    except Error as error:
        logger.error(f"Ошибка создания сообщения: {error}")
        return False


def get_messages(
    get_db_cursor,
    logger,
    Error,
    room_id,
    limit=50,
    before_id=None,
    excluded_usernames=None,
):
    try:
        excluded = list(dict.fromkeys(un for un in (excluded_usernames or []) if un))
        excluded_sql = ""
        excluded_params = []
        if excluded:
            excluded_sql = f"AND username NOT IN ({_placeholders(excluded)})"
            excluded_params = excluded

        with get_db_cursor() as (cursor, _):
            if before_id:
                cursor.execute(
                    "SELECT created_at FROM messages WHERE message_id = %s",
                    (before_id,),
                )
                before_row = cursor.fetchone()
                if not before_row or not before_row.get("created_at"):
                    return []

                cursor.execute(
                    f"""
                    SELECT * FROM messages
                    WHERE room_id = %s
                    AND created_at < %s
                    AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                    {excluded_sql}
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (room_id, before_row["created_at"], *excluded_params, limit),
                )
            else:
                cursor.execute(
                    f"""
                    SELECT * FROM messages
                    WHERE room_id = %s
                    AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                    {excluded_sql}
                    ORDER BY created_at DESC
                    LIMIT %s
                    """,
                    (room_id, *excluded_params, limit),
                )

            messages = cursor.fetchall()
            messages.reverse()
            message_ids = [msg["message_id"] for msg in messages]
            reactions_by_message = _list_reactions_for_messages(cursor, message_ids)
            reads_by_message = _list_reads_for_messages(cursor, message_ids)
            reply_messages_by_id = _list_messages_by_ids(
                cursor,
                [msg.get("reply_to_id") for msg in messages],
            )

        for msg in messages:
            msg["reactions"] = reactions_by_message.get(msg["message_id"], {})
            msg["read_by"] = reads_by_message.get(msg["message_id"], [])

            if msg.get("media_type"):
                msg["media"] = {
                    "type": msg["media_type"],
                    "data": msg["media_data"],
                    "name": msg["media_name"],
                }
                mm = parse_json_field(msg.get("media_meta"))
                if isinstance(mm, dict):
                    msg["media"]["meta"] = mm

            if msg.get("reply_to_id"):
                reply_msg = reply_messages_by_id.get(msg["reply_to_id"])
                if reply_msg:
                    msg["replyTo"] = {
                        "id": reply_msg["message_id"],
                        "username": reply_msg["username"],
                        "text": reply_msg["text"],
                    }

            if msg.get("forwarded_from"):
                msg["forwarded"] = {
                    "from": msg["forwarded_from"],
                    "originalId": msg["forwarded_message_id"],
                }

            msg["timestamp"] = isoformat_utc_z(msg["created_at"])
            if msg.get("expires_at"):
                msg["expires_at"] = isoformat_utc_z(msg["expires_at"])
            del msg["created_at"]
            if msg.get("edited_at"):
                msg["edited_at"] = isoformat_utc_z(msg["edited_at"])

        return messages
    except Error as error:
        logger.error(f"Ошибка загрузки сообщений комнаты {room_id}: {error}")
        return []


def cleanup_expired_messages(get_db_cursor, logger, Error):
    """Delete expired messages; return list of {message_id, room_id} for Socket.IO notify."""
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT message_id, room_id FROM messages
                WHERE expires_at IS NOT NULL AND expires_at <= CURRENT_TIMESTAMP
                """
            )
            expired_rows = [
                {"message_id": row["message_id"], "room_id": row["room_id"]}
                for row in cursor.fetchall()
            ]
            if not expired_rows:
                return []

            expired_ids = [r["message_id"] for r in expired_rows]
            placeholders = ",".join(["%s"] * len(expired_ids))
            cursor.execute(
                f"UPDATE messages SET reply_to_id = NULL WHERE reply_to_id IN ({placeholders})",
                expired_ids,
            )
            cursor.execute(
                f"DELETE FROM reactions WHERE message_id IN ({placeholders})",
                expired_ids,
            )
            cursor.execute(
                f"DELETE FROM message_reads WHERE message_id IN ({placeholders})",
                expired_ids,
            )
            cursor.execute(
                f"DELETE FROM pinned_messages WHERE message_id IN ({placeholders})",
                expired_ids,
            )
            cursor.execute(
                f"DELETE FROM messages WHERE message_id IN ({placeholders})",
                expired_ids,
            )
            return expired_rows
    except Error as error:
        logger.error(f"Ошибка удаления просроченных сообщений: {error}")
        return []


def search_messages_global(
    get_db_cursor, logger, Error, username, query_text, limit=50
):
    try:
        like_query = f"%{query_text}%"
        fetch_limit = min(max(int(limit), 1), 200) * 4

        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT message_id, room_id, username, text, created_at
                FROM messages
                WHERE text IS NOT NULL
                  AND text != ''
                  AND text LIKE %s
                  AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                ORDER BY created_at DESC
                LIMIT %s
                """,
                (like_query, fetch_limit),
            )
            rows = cursor.fetchall()
            group_room_ids = [
                r["room_id"] for r in rows if r.get("room_id", "").startswith("room_")
            ]
            member_ok = room_ids_where_user_is_member_cursor(cursor, username, group_room_ids)

        results = []
        for row in rows:
            room_id = row.get("room_id", "")
            if not can_access_room_with_member_set(member_ok, username, room_id):
                continue

            results.append(
                {
                    "id": row["message_id"],
                    "room": room_id,
                    "username": row["username"],
                    "text": row["text"],
                    "timestamp": isoformat_utc_z(row["created_at"])
                    if row.get("created_at")
                    else None,
                }
            )
            if len(results) >= min(max(int(limit), 1), 200):
                break

        return results
    except Error as error:
        logger.error(f"Ошибка глобального поиска ({username}): {error}")
        return []


def search_messages_advanced(
    get_db_cursor,
    logger,
    Error,
    username,
    query_text,
    *,
    room_id=None,
    date_from=None,
    date_to=None,
    author=None,
    media_kind=None,
    limit=50,
):
    """Filtered search; empty query_text matches any (with other filters)."""
    try:
        lim = min(max(int(limit), 1), 200)
        fetch_limit = lim * 4
        clauses = [
            "(expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)",
        ]
        params = []

        if room_id:
            clauses.append("room_id = %s")
            params.append(room_id)

        q = (query_text or "").strip()
        if q:
            clauses.append("text IS NOT NULL AND text LIKE %s")
            params.append(f"%{q}%")

        if date_from:
            clauses.append("created_at >= %s")
            params.append(date_from)
        if date_to:
            clauses.append("created_at <= %s")
            params.append(date_to)

        if author:
            clauses.append("username = %s")
            params.append(author)

        mk = (media_kind or "").strip().lower()
        if mk and mk != "any":
            if mk == "photo":
                clauses.append("media_type IN ('image', 'gif', 'sticker')")
            elif mk == "video":
                clauses.append("media_type = 'video'")
            elif mk == "file":
                clauses.append("media_type = 'file'")
            elif mk == "voice":
                clauses.append("media_type IN ('voice', 'audio')")
            elif mk == "link":
                clauses.append("text LIKE %s")
                params.append("%http%")

        where_sql = " AND ".join(clauses)
        params.append(fetch_limit)

        with get_db_cursor() as (cursor, _):
            cursor.execute(
                f"""
                SELECT message_id, room_id, username, text, created_at, media_type
                FROM messages
                WHERE {where_sql}
                ORDER BY created_at DESC
                LIMIT %s
                """,
                tuple(params),
            )
            rows = cursor.fetchall()
            group_room_ids = [
                r["room_id"] for r in rows if r.get("room_id", "").startswith("room_")
            ]
            access_ok = room_ids_where_user_is_member_cursor(cursor, username, group_room_ids)

        results = []
        for row in rows:
            rid = row.get("room_id", "")
            if not can_access_room_with_member_set(access_ok, username, rid):
                continue
            results.append(
                {
                    "id": row["message_id"],
                    "room": rid,
                    "username": row["username"],
                    "text": row["text"],
                    "media_type": row.get("media_type"),
                    "timestamp": isoformat_utc_z(row["created_at"])
                    if row.get("created_at")
                    else None,
                }
            )
            if len(results) >= lim:
                break

        return results
    except Error as error:
        logger.error(f"Ошибка расширенного поиска: {error}")
        return []


def update_message(get_db_cursor, logger, Error, message_id, new_text):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                UPDATE messages
                SET text = %s, edited = TRUE, edited_at = CURRENT_TIMESTAMP
                WHERE message_id = %s
                """,
                (new_text, message_id),
            )
            logger.info(f"Сообщение обновлено: {message_id}")
            return True
    except Error as error:
        logger.error(f"Ошибка обновления сообщения {message_id}: {error}")
        return False


def delete_message(get_db_cursor, logger, Error, message_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "DELETE FROM pinned_messages WHERE message_id = %s", (message_id,)
            )
            cursor.execute("DELETE FROM reactions WHERE message_id = %s", (message_id,))
            cursor.execute(
                "DELETE FROM message_reads WHERE message_id = %s", (message_id,)
            )
            cursor.execute(
                "UPDATE messages SET reply_to_id = NULL WHERE reply_to_id = %s",
                (message_id,),
            )
            cursor.execute("DELETE FROM messages WHERE message_id = %s", (message_id,))
            logger.info(f"Сообщение удалено из БД: {message_id}")
            return True
    except Error as error:
        logger.error(f"Ошибка удаления сообщения {message_id}: {error}")
        return False


def pin_message(get_db_cursor, logger, Error, room_id, message_id, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "INSERT IGNORE INTO pinned_messages (room_id, message_id, pinned_by) VALUES (%s, %s, %s)",
                (room_id, message_id, username),
            )
            logger.info(f"Закреплено сообщение {message_id} в {room_id} пользователем {username}")
            return True
    except Error as error:
        logger.error(f"Ошибка закрепления сообщения: {error}")
        return False


def unpin_message(get_db_cursor, logger, Error, room_id, message_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "DELETE FROM pinned_messages WHERE room_id = %s AND message_id = %s",
                (room_id, message_id),
            )
            logger.info(f"Откреплено сообщение {message_id} в комнате {room_id}")
            return True
    except Error as error:
        logger.error(f"Ошибка открепления сообщения: {error}")
        return False


def get_pinned_messages(get_db_cursor, logger, Error, room_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT m.*, p.pinned_by, p.pinned_at
                FROM pinned_messages p
                JOIN messages m ON p.message_id = m.message_id
                WHERE p.room_id = %s
                ORDER BY p.pinned_at DESC
                """,
                (room_id,),
            )
            messages = cursor.fetchall()

        for msg in messages:
            if msg.get("media_type"):
                msg["media"] = {
                    "type": msg["media_type"],
                    "data": msg["media_data"],
                    "name": msg["media_name"],
                }
            msg["timestamp"] = isoformat_utc_z(msg["created_at"])
            msg["pinned_at"] = isoformat_utc_z(msg["pinned_at"])
            if msg.get("expires_at"):
                msg["expires_at"] = isoformat_utc_z(msg["expires_at"])
            if msg.get("edited_at"):
                msg["edited_at"] = isoformat_utc_z(msg["edited_at"])
            del msg["created_at"]
        return messages
    except Error as error:
        logger.error(f"Ошибка списка закреплённых для {room_id}: {error}")
        return []


def is_message_pinned(get_db_cursor, logger, Error, room_id, message_id):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT COUNT(*) as count FROM pinned_messages
                WHERE room_id = %s AND message_id = %s
                """,
                (room_id, message_id),
            )
            result = cursor.fetchone()
            return result["count"] > 0
    except Error as error:
        logger.error(f"Ошибка проверки закрепления: {error}")
        return False


def list_private_room_ids_for_user(get_db_cursor, logger, Error, username):
    """Distinct private_* room ids where the user is a participant (by room_id naming)."""
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT DISTINCT room_id FROM messages
                WHERE room_id LIKE %s
                AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                """,
                (f"private_%{username}%",),
            )
            rows = cursor.fetchall()
        prefix = "private_"
        out = []
        for row in rows:
            rid = row["room_id"]
            if not rid.startswith(prefix):
                continue
            parts = rid[len(prefix) :].split("_")
            if username not in parts:
                continue
            peer = private_room_peer_username(rid, username)
            if not peer:
                continue
            out.append(rid)
        return out
    except Error as error:
        logger.error(f"Ошибка списка личных комнат для {username}: {error}")
        return []


def get_latest_message_per_room(get_db_cursor, logger, Error, room_ids):
    """Map room_id -> latest message row (message_id, room_id, username, text, media_type, created_at)."""
    if not room_ids:
        return {}
    unique = list(dict.fromkeys(rid for rid in room_ids if rid))
    if not unique:
        return {}
    placeholders = _placeholders(unique)
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                f"""
                SELECT m.message_id, m.room_id, m.username, m.text, m.media_type, m.created_at
                FROM messages m
                JOIN (
                    SELECT room_id, MAX(created_at) AS max_created_at
                    FROM messages
                    WHERE room_id IN ({placeholders})
                      AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
                    GROUP BY room_id
                ) latest
                  ON latest.room_id = m.room_id
                 AND latest.max_created_at = m.created_at
                WHERE (m.expires_at IS NULL OR m.expires_at > CURRENT_TIMESTAMP)
                ORDER BY m.room_id ASC, m.created_at DESC, m.message_id DESC
                """,
                unique,
            )
            rows = cursor.fetchall()
        result = {}
        for row in rows:
            rid = row.get("room_id")
            if rid and rid not in result:
                result[rid] = row
        return result
    except Error as error:
        logger.error(f"Ошибка последних сообщений по комнатам: {error}")
        return {}
