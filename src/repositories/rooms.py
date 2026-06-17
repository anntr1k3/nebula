def create_room(get_db_cursor, logger, Error, room_id, name, members):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "INSERT INTO rooms (room_id, name) VALUES (%s, %s)", (room_id, name)
            )
            member_rows = [(room_id, member) for member in members]
            if member_rows:
                cursor.executemany(
                    "INSERT INTO room_members (room_id, username) VALUES (%s, %s)",
                    member_rows,
                )
            logger.info(f"Комната создана: {room_id}, участников: {len(members)}")
            return True
    except Error as error:
        logger.error(f"Ошибка создания комнаты {room_id}: {error}")
        return False


def get_user_rooms(get_db_cursor, logger, Error, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                """
                SELECT r.room_id, r.name, r.created_at,
                       GROUP_CONCAT(rm.username) as members
                FROM rooms r
                JOIN room_members rm ON r.room_id = rm.room_id
                WHERE r.room_id IN (
                    SELECT room_id FROM room_members WHERE username = %s
                )
                GROUP BY r.room_id, r.name, r.created_at
                """,
                (username,),
            )
            rooms = cursor.fetchall()
            for room in rooms:
                room["members"] = room["members"].split(",") if room["members"] else []
            return rooms
    except Error as error:
        logger.error(f"Ошибка списка комнат для {username}: {error}")
        return []


def list_room_member_usernames(get_db_cursor, logger, Error, room_id):
    """Логины всех участников комнаты (для enter_room при отложенной отправке/TTL)."""
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "SELECT username FROM room_members WHERE room_id = %s",
                (room_id,),
            )
            return [row["username"] for row in cursor.fetchall()]
    except Error as error:
        logger.error(f"Ошибка списка участников комнаты {room_id}: {error}")
        return []


def list_room_audience_usernames(get_db_cursor, logger, Error, room_id):
    """Все пользователи, получающие сообщения групповой комнаты (участники)."""
    return list_room_member_usernames(get_db_cursor, logger, Error, room_id)


def is_room_member(get_db_cursor, logger, Error, room_id, username):
    try:
        with get_db_cursor() as (cursor, _):
            cursor.execute(
                "SELECT COUNT(*) as count FROM room_members WHERE room_id = %s AND username = %s",
                (room_id, username),
            )
            result = cursor.fetchone()
            return result["count"] > 0
    except Error as error:
        logger.error(f"Ошибка проверки членства в комнате: {error}")
        return False


def room_ids_where_user_is_member_cursor(cursor, username, room_ids):
    """Room ids where username is in room_members (same cursor/transaction)."""
    if not room_ids:
        return set()
    unique = list(dict.fromkeys(rid for rid in room_ids if rid))
    if not unique:
        return set()
    placeholders = ",".join(["%s"] * len(unique))
    cursor.execute(
        f"SELECT room_id FROM room_members WHERE username = %s AND room_id IN ({placeholders})",
        [username, *unique],
    )
    return {row["room_id"] for row in cursor.fetchall()}
