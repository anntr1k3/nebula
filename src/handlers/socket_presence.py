import time
from datetime import datetime
from typing import Any

from flask_socketio import emit, join_room

from handlers.socket_runtime import (
    SocketRuntime,
    assert_socket_identity,
    payload_str,
    socket_sid,
)


def register_presence_handlers(rt: SocketRuntime) -> None:
    socketio = rt.socketio
    app = rt.app
    db = rt.db
    auth_token_store = rt.auth_token_store
    user_sessions = rt.user_sessions
    user_connections = rt.user_connections
    auth_token_lifetime = rt.auth_token_lifetime

    @socketio.on("connect")
    def handle_connect():
        app.logger.info(f"Клиент подключён: {socket_sid()}")

    @socketio.on_error_default
    def default_error_handler(error):
        app.logger.error(f"Ошибка сокета: {error}", exc_info=True)
        emit("error", {"message": "Server error"})

    @socketio.on("user_online")
    def handle_user_online(data: dict[str, Any]):
        username = payload_str(data, "username")
        token = payload_str(data, "token")

        token_data = auth_token_store.get(token) if token else None
        if not username or not token or not token_data:
            emit("error", {"message": "Authentication required. Please log in again."})
            return
        if token_data["username"] != username:
            emit("error", {"message": "Authentication error"})
            return
        if time.time() - token_data["created_at"] > auth_token_lifetime:
            auth_token_store.delete(token)
            emit("error", {"message": "Token expired, please log in again"})
            return
        if not db.get_user(username):
            emit("error", {"message": "User not found"})
            return

        sid = socket_sid()
        user_sessions[sid] = username
        if username not in user_connections:
            user_connections[username] = set()

        was_offline = len(user_connections[username]) == 0
        user_connections[username].add(sid)

        db.update_last_seen(username)
        if was_offline:
            emit(
                "user_status_changed",
                {
                    "username": username,
                    "status": "online",
                    "timestamp": datetime.now().isoformat(),
                },
                broadcast=True,
            )

        app.logger.info(
            f"{username} в сети (соединений: {len(user_connections[username])})"
        )

        # Подписываем sid сразу на все доступные комнаты (приватные и группы).
        try:
            rooms_to_join: set[str] = set()
            for rid in db.list_private_room_ids_for_user(username):
                if rid:
                    rooms_to_join.add(rid)
            for row in db.get_user_rooms(username) or []:
                room_id_value = row.get("room_id") if isinstance(row, dict) else None
                if isinstance(room_id_value, str) and room_id_value:
                    rooms_to_join.add(room_id_value)
            for rid in rooms_to_join:
                join_room(rid)
        except Exception as exc:
            app.logger.warning(
                "Не удалось подключить сокет к комнатам %s: %s", username, exc
            )

    @socketio.on("typing")
    def handle_typing(data: dict[str, Any]):
        room = payload_str(data, "room")
        username = payload_str(data, "username")
        if not room or not username:
            return
        if not assert_socket_identity(user_sessions, username):
            return
        if not db.user_can_access_room(username, room):
            return
        emit(
            "user_typing",
            {"username": username, "room": room},
            room=room,
            include_self=False,
        )

    @socketio.on("stop_typing")
    def handle_stop_typing(data: dict[str, Any]):
        room = payload_str(data, "room")
        username = payload_str(data, "username")
        if not room or not username:
            return
        if not assert_socket_identity(user_sessions, username):
            return
        if not db.user_can_access_room(username, room):
            return
        emit(
            "user_stop_typing",
            {"username": username, "room": room},
            room=room,
            include_self=False,
        )

    @socketio.on("join")
    def handle_join(data: dict[str, Any]):
        username = payload_str(data, "username")
        room = payload_str(data, "room")
        if not room or not username:
            emit("error", {"message": "Missing required fields"})
            return
        if not assert_socket_identity(user_sessions, username):
            return
        if not db.user_can_access_room(username, room):
            emit("error", {"message": "No access to this chat"})
            return
        join_room(room)

        blocked_users = db.get_blocked_users(username)
        filtered_messages = db.get_messages(
            room,
            limit=100,
            excluded_usernames=blocked_users,
        )

        emit(
            "message_history",
            {"room": room, "messages": filtered_messages},
        )

    @socketio.on("disconnect")
    def handle_disconnect(_reason=None):
        """``_reason`` is sent by python-socketio / Flask-SocketIO 5.6+."""
        sid = socket_sid()
        if sid in user_sessions:
            username = user_sessions[sid]
            del user_sessions[sid]

            if username in user_connections:
                user_connections[username].discard(sid)
                if len(user_connections[username]) == 0:
                    del user_connections[username]
                    db.update_last_seen(username)
                    emit(
                        "user_status_changed",
                        {
                            "username": username,
                            "status": "offline",
                            "timestamp": datetime.now().isoformat(),
                            "last_seen": db.get_last_seen(username),
                        },
                        broadcast=True,
                    )
                    app.logger.info(f"{username} вышел из сети")
