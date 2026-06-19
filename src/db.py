"""Database facade: connection pool and repository-facing helpers.

DB settings come from Config (BaseConfig); get_config() uses the same env vars for app.config.
"""

import logging
from contextlib import contextmanager

from mysql.connector import Error, pooling

from config import Config
from repositories import extra_features as extra_repo
from repositories import messages as messages_repo
from repositories import moderation as moderation_repo
from repositories import rooms as rooms_repo
from repositories import users as users_repo
from utils.room_access import private_chat_access, private_room_peer_username

logger = logging.getLogger(__name__)

DB_CONFIG = {
    "host": Config.DB_HOST,
    "port": Config.DB_PORT,
    "user": Config.DB_USER,
    "password": Config.DB_PASSWORD,
    "database": Config.DB_NAME,
    "charset": "utf8mb4",
    "collation": "utf8mb4_unicode_ci",
    "autocommit": False,
    # Pure-Python driver uses the standard socket module, which gevent can
    # monkey-patch. The C extension would block the whole gevent event loop on
    # every query under the gevent-websocket worker. See NEBULA_SOCKETIO_ASYNC_MODE.
    "use_pure": True,
}

connection_pool = None


def init_connection_pool():
    global connection_pool
    try:
        connection_pool = pooling.MySQLConnectionPool(
            pool_name="messenger_pool",
            pool_size=Config.DB_POOL_SIZE,
            pool_reset_session=True,
            **DB_CONFIG,
        )
        logger.info("РџСѓР» СЃРѕРµРґРёРЅРµРЅРёР№ СЃ Р±Р°Р·РѕР№ РґР°РЅРЅС‹С… РёРЅРёС†РёР°Р»РёР·РёСЂРѕРІР°РЅ")
        return True
    except Error as error:
        logger.error(f"РћС€РёР±РєР° СЃРѕР·РґР°РЅРёСЏ РїСѓР»Р° СЃРѕРµРґРёРЅРµРЅРёР№: {error}", exc_info=True)
        return False


@contextmanager
def get_db_connection():
    connection = None
    try:
        if connection_pool is None:
            raise Error("Database connection pool is not initialized")
        connection = connection_pool.get_connection()
        try:
            cur = connection.cursor()
            cur.execute("SET SESSION time_zone = '+00:00'")
            cur.close()
        except Exception:
            pass
        yield connection
    except Error as error:
        logger.error(f"РћС€РёР±РєР° СЃРѕРµРґРёРЅРµРЅРёСЏ СЃ Р‘Р”: {error}", exc_info=True)
        if connection:
            connection.rollback()
        raise
    finally:
        if connection and connection.is_connected():
            connection.close()


@contextmanager
def get_db_cursor(dictionary=True, buffered=True):
    with get_db_connection() as connection:
        cursor = connection.cursor(dictionary=dictionary, buffered=buffered)
        try:
            yield cursor, connection
            connection.commit()
        except Error as error:
            connection.rollback()
            logger.error(f"РћС€РёР±РєР° SQL-Р·Р°РїСЂРѕСЃР°: {error}", exc_info=True)
            raise
        finally:
            cursor.close()


# Users
def create_user(username, password_hash):
    return users_repo.create_user(get_db_cursor, logger, Error, username, password_hash)


def get_user(username):
    return users_repo.get_user(get_db_cursor, logger, Error, username)


def update_last_seen(username):
    return users_repo.update_last_seen(get_db_cursor, logger, Error, username)


def get_last_seen(username):
    return users_repo.get_last_seen(get_db_cursor, logger, Error, username)


def get_user_profile(username):
    return users_repo.get_user_profile(get_db_cursor, logger, Error, username)


def upsert_user_profile(
    username, bio=None, avatar=None, avatar_type="emoji", nickname=None
):
    return users_repo.upsert_user_profile(
        get_db_cursor,
        logger,
        Error,
        username,
        bio=bio,
        avatar=avatar,
        avatar_type=avatar_type,
        nickname=nickname,
    )


def get_all_users(exclude_username=None):
    return users_repo.get_all_users(
        get_db_cursor, logger, Error, exclude_username=exclude_username
    )


def list_users_with_nicknames(
    *, exclude_username=None, query=None, limit=80
):
    return users_repo.list_users_with_nicknames(
        get_db_cursor,
        logger,
        Error,
        exclude_username=exclude_username,
        query=query,
        limit=limit,
    )


def block_user(blocker_username, blocked_username):
    return users_repo.block_user(
        get_db_cursor, logger, Error, blocker_username, blocked_username
    )


def unblock_user(blocker_username, blocked_username):
    return users_repo.unblock_user(
        get_db_cursor, logger, Error, blocker_username, blocked_username
    )


def get_blocked_users(username):
    return users_repo.get_blocked_users(get_db_cursor, logger, Error, username)


# Rooms
def create_room(room_id, name, members):
    return rooms_repo.create_room(get_db_cursor, logger, Error, room_id, name, members)


def get_user_rooms(username):
    return rooms_repo.get_user_rooms(get_db_cursor, logger, Error, username)


def is_room_member(room_id, username):
    return rooms_repo.is_room_member(get_db_cursor, logger, Error, room_id, username)


def list_room_member_usernames(room_id):
    return rooms_repo.list_room_member_usernames(
        get_db_cursor, logger, Error, room_id
    )


def list_room_audience_usernames(room_id):
    return rooms_repo.list_room_audience_usernames(
        get_db_cursor, logger, Error, room_id
    )


def user_can_access_room(username, room_id):
    """Р›РёС‡РЅС‹Р№ С‡Р°С‚ private_* РёР»Рё С‡Р»РµРЅСЃС‚РІРѕ РІ РіСЂСѓРїРїРѕРІРѕР№ room_*."""
    if not username or not room_id:
        return False
    priv = private_chat_access(room_id, username)
    if priv is not None:
        return priv
    if room_id.startswith("room_"):
        return is_room_member(room_id, username)
    return False


def can_user_post_in_room(username, room_id):
    """РџРёСЃР°С‚СЊ РјРѕРіСѓС‚ С‚РѕР»СЊРєРѕ СѓС‡Р°СЃС‚РЅРёРєРё РґРѕСЃС‚СѓРїРЅРѕР№ РєРѕРјРЅР°С‚С‹ (РїСЂРёРІР°С‚ вЂ” РѕР±С‹С‡РЅРѕ РѕР±Рµ СЃС‚РѕСЂРѕРЅС‹)."""
    if not user_can_access_room(username, room_id):
        return False
    priv = private_chat_access(room_id, username)
    if priv is not None:
        return priv
    return is_room_member(room_id, username)


# Messages
def create_message(message_data):
    return messages_repo.create_message(get_db_cursor, logger, Error, message_data)


def get_messages(room_id, limit=50, before_id=None, excluded_usernames=None):
    return messages_repo.get_messages(
        get_db_cursor,
        logger,
        Error,
        room_id,
        limit=limit,
        before_id=before_id,
        excluded_usernames=excluded_usernames,
    )


def list_room_messages_for_viewer(room_id, viewer_username, limit=50, before_id=None):
    """Messages in room excluding senders blocked by the viewer."""
    blocked = set(get_blocked_users(viewer_username))
    return get_messages(
        room_id,
        limit=limit,
        before_id=before_id,
        excluded_usernames=blocked,
    )


def cleanup_expired_messages():
    return messages_repo.cleanup_expired_messages(get_db_cursor, logger, Error)


def search_messages_global(username, query_text, limit=50):
    return messages_repo.search_messages_global(
        get_db_cursor, logger, Error, username, query_text, limit=limit
    )


def search_messages_advanced(username, query_text, **kwargs):
    return messages_repo.search_messages_advanced(
        get_db_cursor, logger, Error, username, query_text, **kwargs
    )


def _inbox_preview_from_draft_text(text):
    """РЎС‚СЂРѕРєР° С‡РµСЂРЅРѕРІРёРєР° РІ РїСЂРµРІСЊСЋ СЃРїРёСЃРєР° С‡Р°С‚РѕРІ (С‚РѕС‚ Р¶Рµ Р»РёРјРёС‚ РґР»РёРЅС‹, С‡С‚Рѕ Сѓ С‚РµРєСЃС‚Р° СЃРѕРѕР±С‰РµРЅРёСЏ)."""
    t = (text or "").strip()
    if not t:
        return ""
    return t if len(t) <= 120 else f"{t[:117]}..."


def _inbox_preview_from_row(row):
    if not row:
        return ""
    text = (row.get("text") or "").strip()
    if text:
        return text if len(text) <= 120 else f"{text[:117]}..."
    mt = row.get("media_type")
    if mt == "image":
        return "[image]"
    if mt == "video":
        return "[video]"
    if mt in ("audio", "voice"):
        return "[audio]"
    if mt == "file":
        return "[file]"
    if mt == "sticker":
        return "[sticker]"
    if mt == "gif":
        return "GIF"
    return ""


def get_inbox_summary(username):
    """Rooms the user can access with last message preview and time (for inbox sorting)."""
    groups = get_user_rooms(username)

    private_ids = messages_repo.list_private_room_ids_for_user(
        get_db_cursor, logger, Error, username
    )
    group_ids = [g["room_id"] for g in groups]
    all_ids = list(dict.fromkeys(group_ids + private_ids))
    latest = messages_repo.get_latest_message_per_room(
        get_db_cursor, logger, Error, all_ids
    )

    items = []
    seen = set()
    draft_rows = extra_repo.list_drafts_for_user(get_db_cursor, logger, Error, username)
    draft_by_room = {d["room_id"]: d.get("draft_text", "") for d in draft_rows}
    room_meta_by_id = extra_repo.list_room_rows(get_db_cursor, logger, Error, group_ids)

    for g in groups:
        rid = g["room_id"]
        seen.add(rid)
        lm = latest.get(rid)
        last_at = lm["created_at"].isoformat() if lm and lm.get("created_at") else None
        row_meta = room_meta_by_id.get(rid)
        display_name = (row_meta.get("name") if row_meta else None) or g.get("name") or rid
        draft_plain = (draft_by_room.get(rid) or "").strip()
        has_draft = bool(draft_plain)
        last_preview = (
            _inbox_preview_from_draft_text(draft_plain)
            if has_draft
            else _inbox_preview_from_row(lm)
        )
        items.append(
            {
                "room_id": rid,
                "kind": "group",
                "title": display_name,
                "last_preview": last_preview,
                "last_at": last_at,
                "has_draft": has_draft,
            }
        )

    for rid in private_ids:
        if rid in seen:
            continue
        seen.add(rid)
        lm = latest.get(rid)
        peer = private_room_peer_username(rid, username)
        last_at = lm["created_at"].isoformat() if lm and lm.get("created_at") else None
        draft_plain = (draft_by_room.get(rid) or "").strip()
        has_draft = bool(draft_plain)
        last_preview = (
            _inbox_preview_from_draft_text(draft_plain)
            if has_draft
            else _inbox_preview_from_row(lm)
        )
        items.append(
            {
                "room_id": rid,
                "kind": "private",
                "title": peer or rid,
                "last_preview": last_preview,
                "last_at": last_at,
                "has_draft": has_draft,
            }
        )

    items.sort(key=lambda x: x["last_at"] or "", reverse=True)
    return items


def list_private_room_ids_for_user(username):
    """РљРѕРјРЅР°С‚С‹ private_* РёР· РёСЃС‚РѕСЂРёРё СЃРѕРѕР±С‰РµРЅРёР№, РіРґРµ СѓС‡Р°СЃС‚РІСѓРµС‚ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ."""
    return messages_repo.list_private_room_ids_for_user(
        get_db_cursor, logger, Error, username
    )


def get_message_by_id(message_id):
    return messages_repo.get_message_by_id(get_db_cursor, logger, Error, message_id)


def update_message(message_id, new_text):
    return messages_repo.update_message(
        get_db_cursor, logger, Error, message_id, new_text
    )


def delete_message(message_id):
    return messages_repo.delete_message(get_db_cursor, logger, Error, message_id)


def toggle_reaction(message_id, username, emoji):
    return messages_repo.toggle_reaction(
        get_db_cursor, logger, Error, message_id, username, emoji
    )


def get_message_reactions(message_id):
    return messages_repo.get_message_reactions(get_db_cursor, logger, Error, message_id)


def add_message_read(message_id, username):
    return messages_repo.add_message_read(
        get_db_cursor, logger, Error, message_id, username
    )


def add_message_reads_for_room(message_ids, username, room_id, limit=80):
    return messages_repo.add_message_reads_for_room(
        get_db_cursor,
        logger,
        Error,
        message_ids,
        username,
        room_id,
        limit=limit,
    )


def get_message_reads(message_id):
    return messages_repo.get_message_reads(get_db_cursor, logger, Error, message_id)


def pin_message(room_id, message_id, username):
    return messages_repo.pin_message(
        get_db_cursor, logger, Error, room_id, message_id, username
    )


def unpin_message(room_id, message_id):
    return messages_repo.unpin_message(
        get_db_cursor, logger, Error, room_id, message_id
    )


def get_pinned_messages(room_id):
    return messages_repo.get_pinned_messages(get_db_cursor, logger, Error, room_id)


def is_message_pinned(room_id, message_id):
    return messages_repo.is_message_pinned(
        get_db_cursor, logger, Error, room_id, message_id
    )


# Moderation
def get_user_role(username):
    return moderation_repo.get_user_role(get_db_cursor, logger, Error, username)


def ban_user(username, banned_by, reason, duration_hours=None):
    return moderation_repo.ban_user(
        get_db_cursor,
        logger,
        Error,
        username,
        banned_by,
        reason,
        duration_hours,
        log_moderation_action,
    )


def unban_user(username, unbanned_by):
    return moderation_repo.unban_user(
        get_db_cursor, logger, Error, username, unbanned_by, log_moderation_action
    )


def is_user_banned(username):
    return moderation_repo.is_user_banned(
        get_db_cursor, logger, Error, username, unban_user
    )


def add_warning(username, issued_by, reason, message_id=None):
    return moderation_repo.add_warning(
        get_db_cursor,
        logger,
        Error,
        username,
        issued_by,
        reason,
        message_id,
        log_moderation_action,
    )


def log_moderation_action(
    moderator, action_type, target_username, target_message_id, reason, details
):
    return moderation_repo.log_moderation_action(
        get_db_cursor,
        logger,
        Error,
        moderator,
        action_type,
        target_username,
        target_message_id,
        reason,
        details,
    )


def get_moderation_logs(limit=100, moderator=None, action_type=None):
    return moderation_repo.get_moderation_logs(
        get_db_cursor,
        logger,
        Error,
        limit=limit,
        moderator=moderator,
        action_type=action_type,
    )


def create_report(
    message_id, reported_by, reported_user, reason, report_type=None, room_id=None
):
    if room_id is None:
        msg = get_message_by_id(message_id)
        room_id = msg.get("room_id") if msg else None
    return moderation_repo.create_report(
        get_db_cursor,
        logger,
        Error,
        message_id,
        reported_by,
        reported_user,
        reason,
        room_id=room_id,
        report_type=report_type or "other",
    )


def list_reports_filtered(**kwargs):
    return moderation_repo.list_reports_filtered(get_db_cursor, logger, Error, **kwargs)


def group_reports_by_room(reports, room_titles):
    return moderation_repo.group_reports_by_room(reports, room_titles)


def get_report_by_id(report_id):
    return moderation_repo.get_report_by_id(
        get_db_cursor, logger, Error, report_id
    )


def get_room_title(room_id):
    row = extra_repo.get_room_row(get_db_cursor, logger, Error, room_id)
    return (row or {}).get("name") or room_id


def resolve_report(report_id, reviewed_by, status, resolution_note=None):
    return moderation_repo.resolve_report(
        get_db_cursor,
        logger,
        Error,
        report_id,
        reviewed_by,
        status,
        resolution_note=resolution_note,
    )


# Drafts, mute, scheduled
def upsert_message_draft(username, room_id, text):
    return extra_repo.upsert_draft(
        get_db_cursor, logger, Error, username, room_id, text
    )


def delete_message_draft(username, room_id):
    return extra_repo.delete_draft(get_db_cursor, logger, Error, username, room_id)


def get_message_draft(username, room_id):
    return extra_repo.get_draft(get_db_cursor, logger, Error, username, room_id)


def list_drafts_for_user(username):
    return extra_repo.list_drafts_for_user(get_db_cursor, logger, Error, username)


def set_chat_mute(username, room_id, muted):
    return extra_repo.set_chat_mute(
        get_db_cursor, logger, Error, username, room_id, muted
    )


def list_muted_rooms(username):
    return extra_repo.list_muted_rooms(get_db_cursor, logger, Error, username)


def insert_scheduled_message(row):
    return extra_repo.insert_scheduled_message(
        get_db_cursor, logger, Error, row
    )


def fetch_due_scheduled(limit=20):
    return extra_repo.fetch_due_scheduled(get_db_cursor, logger, Error, limit)


def mark_scheduled_sent(sched_id, sent_message_id):
    return extra_repo.mark_scheduled_sent(
        get_db_cursor, logger, Error, sched_id, sent_message_id
    )


def delete_scheduled_message(sched_id):
    return extra_repo.delete_scheduled_message(
        get_db_cursor, logger, Error, sched_id
    )


def list_pending_scheduled_for_room(username, room_id):
    return extra_repo.list_pending_scheduled_for_room(
        get_db_cursor, logger, Error, username, room_id
    )


def get_pending_scheduled(sched_id, username):
    return extra_repo.get_pending_scheduled(
        get_db_cursor, logger, Error, sched_id, username
    )


def update_pending_scheduled(sched_id, username, updates):
    return extra_repo.update_pending_scheduled(
        get_db_cursor, logger, Error, sched_id, username, updates
    )


def delete_pending_scheduled(sched_id, username):
    return extra_repo.delete_pending_scheduled(
        get_db_cursor, logger, Error, sched_id, username
    )


def get_room_row(room_id):
    return extra_repo.get_room_row(get_db_cursor, logger, Error, room_id)


def list_room_rows(room_ids):
    return extra_repo.list_room_rows(get_db_cursor, logger, Error, room_ids)
