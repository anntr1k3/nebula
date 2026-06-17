def create_user(get_db_cursor, logger, Error, username, password_hash):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "INSERT INTO users (username, password_hash) VALUES (%s, %s)",
                (username, password_hash),
            )
            logger.info(f"РЎРѕР·РґР°РЅ РїРѕР»СЊР·РѕРІР°С‚РµР»СЊ: {username}")
            return True
    except Error as error:
        logger.error(f"РћС€РёР±РєР° СЃРѕР·РґР°РЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ {username}: {error}")
        return False


def get_user(get_db_cursor, logger, Error, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute("SELECT * FROM users WHERE username = %s", (username,))
            return cursor.fetchone()
    except Error as error:
        logger.error(f"РћС€РёР±РєР° РїРѕР»СѓС‡РµРЅРёСЏ РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ {username}: {error}")
        return None


def update_last_seen(get_db_cursor, logger, Error, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE username = %s",
                (username,),
            )
            return True
    except Error as error:
        logger.error(f"РћС€РёР±РєР° РѕР±РЅРѕРІР»РµРЅРёСЏ last_seen РґР»СЏ {username}: {error}")
        return False


def get_last_seen(get_db_cursor, logger, Error, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "SELECT last_seen FROM users WHERE username = %s", (username,)
            )
            result = cursor.fetchone()
            if result and result["last_seen"]:
                return result["last_seen"].isoformat()
            return None
    except Error as error:
        logger.error(f"РћС€РёР±РєР° РїРѕР»СѓС‡РµРЅРёСЏ last_seen РґР»СЏ {username}: {error}")
        return None


def get_user_profile(get_db_cursor, logger, Error, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "SELECT bio, avatar, avatar_type, nickname FROM user_profiles WHERE username = %s",
                (username,),
            )
            return cursor.fetchone()
    except Error as error:
        logger.error(f"РћС€РёР±РєР° РїРѕР»СѓС‡РµРЅРёСЏ РїСЂРѕС„РёР»СЏ {username}: {error}")
        return None


def upsert_user_profile(
    get_db_cursor,
    logger,
    Error,
    username,
    bio=None,
    avatar=None,
    avatar_type="emoji",
    nickname=None,
):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                INSERT INTO user_profiles (username, bio, avatar, avatar_type, nickname)
                VALUES (%s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE
                    bio = COALESCE(VALUES(bio), bio),
                    avatar = COALESCE(VALUES(avatar), avatar),
                    avatar_type = COALESCE(VALUES(avatar_type), avatar_type),
                    nickname = COALESCE(VALUES(nickname), nickname)
                """,
                (
                    username,
                    bio or "",
                    avatar or "",
                    avatar_type or "emoji",
                    nickname or username,
                ),
            )
            return True
    except Error as error:
        logger.error(f"РћС€РёР±РєР° СЃРѕС…СЂР°РЅРµРЅРёСЏ РїСЂРѕС„РёР»СЏ {username}: {error}")
        return False


def get_all_users(get_db_cursor, logger, Error, exclude_username=None):
    try:
        with get_db_cursor() as (cursor, _):
            if exclude_username:
                cursor.execute(
                    "SELECT username FROM users WHERE username != %s ORDER BY username",
                    (exclude_username,),
                )
            else:
                cursor.execute("SELECT username FROM users ORDER BY username")
            return [row["username"] for row in cursor.fetchall()]
    except Error as error:
        logger.error(f"РћС€РёР±РєР° РїРѕР»СѓС‡РµРЅРёСЏ СЃРїРёСЃРєР° РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№: {error}")
        return []


def list_users_with_nicknames(
    get_db_cursor,
    logger,
    Error,
    *,
    exclude_username=None,
    query=None,
    limit=80,
):
    """Directory rows with optional substring filter on username or profile nickname (case-insensitive)."""
    q = (query or "").strip()
    cap = max(1, min(int(limit), 500))
    try:
        with get_db_cursor() as (cursor, _):
            if not q:
                if exclude_username:
                    cursor.execute(
                        """
                        SELECT u.username, p.nickname, p.avatar, p.avatar_type
                        FROM users u
                        LEFT JOIN user_profiles p ON p.username = u.username
                        WHERE u.username != %s
                        ORDER BY u.username ASC
                        LIMIT %s
                        """,
                        (exclude_username, cap),
                    )
                else:
                    cursor.execute(
                        """
                        SELECT u.username, p.nickname, p.avatar, p.avatar_type
                        FROM users u
                        LEFT JOIN user_profiles p ON p.username = u.username
                        ORDER BY u.username ASC
                        LIMIT %s
                        """,
                        (cap,),
                    )
            elif exclude_username:
                cursor.execute(
                    """
                    SELECT u.username, p.nickname, p.avatar, p.avatar_type
                    FROM users u
                    LEFT JOIN user_profiles p ON p.username = u.username
                    WHERE u.username != %s
                      AND (
                        INSTR(LOWER(u.username), LOWER(%s)) > 0
                        OR INSTR(
                            LOWER(TRIM(COALESCE(p.nickname, ''))),
                            LOWER(%s)
                        ) > 0
                      )
                    ORDER BY u.username ASC
                    LIMIT %s
                    """,
                    (exclude_username, q, q, cap),
                )
            else:
                cursor.execute(
                    """
                    SELECT u.username, p.nickname, p.avatar, p.avatar_type
                    FROM users u
                    LEFT JOIN user_profiles p ON p.username = u.username
                    WHERE INSTR(LOWER(u.username), LOWER(%s)) > 0
                       OR INSTR(
                            LOWER(TRIM(COALESCE(p.nickname, ''))),
                            LOWER(%s)
                        ) > 0
                    ORDER BY u.username ASC
                    LIMIT %s
                    """,
                    (q, q, cap),
                )
            rows = cursor.fetchall()
            out = []
            for row in rows:
                nick = row.get("nickname")
                cleaned = (nick or "").strip()
                raw_av = (row.get("avatar") or "").strip()
                av_type = (row.get("avatar_type") or "emoji").strip().lower()
                if av_type not in ("emoji", "image"):
                    av_type = "emoji"
                if not raw_av:
                    av_out = "user"
                    av_type = "emoji"
                else:
                    av_out = raw_av
                out.append(
                    {
                        "username": row["username"],
                        "nickname": cleaned or None,
                        "avatar": av_out,
                        "avatarType": av_type,
                    }
                )
            return out
    except Error as error:
        logger.error(f"РћС€РёР±РєР° СЃРїРёСЃРєР° РїРѕР»СЊР·РѕРІР°С‚РµР»РµР№ СЃ РЅРёРєР°РјРё: {error}")
        return []


def block_user(get_db_cursor, logger, Error, blocker_username, blocked_username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                INSERT IGNORE INTO blocked_users (blocker_username, blocked_username)
                VALUES (%s, %s)
                """,
                (blocker_username, blocked_username),
            )
            logger.info(f"{blocker_username} Р·Р°Р±Р»РѕРєРёСЂРѕРІР°Р» {blocked_username}")
            return True
    except Error as error:
        logger.error(f"РћС€РёР±РєР° Р±Р»РѕРєРёСЂРѕРІРєРё: {error}")
        return False


def unblock_user(get_db_cursor, logger, Error, blocker_username, blocked_username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "DELETE FROM blocked_users WHERE blocker_username = %s AND blocked_username = %s",
                (blocker_username, blocked_username),
            )
            logger.info(f"{blocker_username} СЂР°Р·Р±Р»РѕРєРёСЂРѕРІР°Р» {blocked_username}")
            return True
    except Error as error:
        logger.error(f"РћС€РёР±РєР° СЂР°Р·Р±Р»РѕРєРёСЂРѕРІРєРё: {error}")
        return False


def get_blocked_users(get_db_cursor, logger, Error, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "SELECT blocked_username FROM blocked_users WHERE blocker_username = %s",
                (username,),
            )
            return [row["blocked_username"] for row in cursor.fetchall()]
    except Error as error:
        logger.error(f"РћС€РёР±РєР° СЃРїРёСЃРєР° Р±Р»РѕРєРёСЂРѕРІРѕРє РґР»СЏ {username}: {error}")
        return []

