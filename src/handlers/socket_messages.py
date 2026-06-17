import uuid
from typing import Any

from flask_socketio import emit

from handlers.socket_runtime import (
    SendMessagePayload,
    SocketRuntime,
    assert_socket_identity,
    payload_str,
)
from utils.message_payload import serialize_saved_message
from utils.room_access import private_two_party_counterparty
from utils.room_delivery import ensure_online_members_in_room

ALLOWED_MEDIA_TYPES = {
    "image",
    "video",
    "audio",
    "voice",
    "file",
    "sticker",
    "gif",
}


def register_message_handlers(rt: SocketRuntime) -> None:
    socketio = rt.socketio
    app = rt.app
    db = rt.db
    user_sessions = rt.user_sessions
    check_rate_limit = rt.check_rate_limit
    sanitize_text = rt.sanitize_text
    validate_mime_type = rt.validate_mime_type
    save_media_file = rt.save_media_file
    max_message_length = rt.max_message_length
    max_media_file_size = rt.max_media_file_size

    @socketio.on("send_message")
    def handle_message(data: SendMessagePayload):
        try:
            room = data.get("room")
            username = data.get("username")
            client_id = data.get("client_id")

            if not room or not username:
                emit("error", {"message": "Missing required fields"})
                return

            if not assert_socket_identity(user_sessions, username):
                return

            if db.is_user_banned(username):
                emit(
                    "error",
                    {"message": "Your account is banned. You cannot send messages."},
                )
                return

            if not check_rate_limit(username):
                emit("error", {"message": "Too many messages. Please wait a moment."})
                return

            if not db.can_user_post_in_room(username, room):
                emit("error", {"message": "No access to this chat"})
                return

            recipient = private_two_party_counterparty(room, username)
            if recipient:
                blocked_users = db.get_blocked_users(recipient)
                if username in blocked_users:
                    app.logger.info(
                        f"Сообщение от {username} не доставлено: заблокировано пользователем {recipient}"
                    )
                    return

            text = sanitize_text(data.get("message", ""))
            if len(text) > max_message_length:
                emit("error", {"message": "Message too long"})
                return

            media = data.get("media")
            if media and media.get("data"):
                if len(media["data"]) > max_media_file_size * 1.37:
                    emit("error", {"message": "Media file too large"})
                    return

                if media.get("type") not in ALLOWED_MEDIA_TYPES:
                    emit("error", {"message": "Media type not allowed"})
                    return

                if media.get("type") not in ["sticker", "gif"] and media[
                    "data"
                ].startswith("data:"):
                    is_valid, mime_type, error_msg = validate_mime_type(
                        media["data"], [media.get("type")]
                    )
                    if not is_valid:
                        emit("error", {"message": error_msg})
                        app.logger.warning(
                            f"Недопустимый MIME от {username}: {error_msg}"
                        )
                        return
                    app.logger.info(
                        f"Проверен тип медиа: {mime_type}, пользователь {username}"
                    )

                saved_path = save_media_file(media["data"], media.get("type"))
                if saved_path is None:
                    emit("error", {"message": "Media file too large"})
                    return
                media["data"] = saved_path

            message_id = f"msg_{uuid.uuid4().hex}"
            message_data: dict[str, Any] = {
                "id": message_id,
                "room": room,
                "username": username,
                "text": text,
            }

            if media:
                message_data["media"] = media
            meta = data.get("media_meta")
            if isinstance(meta, dict) and meta:
                message_data["media_meta"] = meta
            if "replyTo" in data and data["replyTo"]:
                message_data["replyTo"] = data["replyTo"]
            if "forwarded" in data and data["forwarded"]:
                message_data["forwarded"] = data["forwarded"]
            if data.get("ttl_seconds"):
                message_data["ttl_seconds"] = data.get("ttl_seconds")

            if not db.create_message(message_data):
                emit("error", {"message": "Could not save message"})
                return

            saved_msg = db.get_message_by_id(message_id)
            if saved_msg:
                message_to_send = serialize_saved_message(
                    saved_msg,
                    read_by_username=username,
                    client_id=client_id,
                    reply_to=message_data.get("replyTo"),
                    forwarded=message_data.get("forwarded"),
                )

                ensure_online_members_in_room(socketio, app, room)
                emit("receive_message", message_to_send, room=room)
                app.logger.info(f"Сообщение отправлено: {username}, комната {room}")
        except Exception as error:
            app.logger.error(f"Ошибка обработки сообщения: {error}", exc_info=True)
            emit("error", {"message": "Failed to send message"})

    @socketio.on("add_reaction")
    def handle_add_reaction(data: dict[str, Any]):
        try:
            room = payload_str(data, "room")
            message_id = payload_str(data, "message_id")
            emoji = payload_str(data, "emoji")
            username = payload_str(data, "username")

            if room is None or message_id is None or emoji is None or username is None:
                emit("error", {"message": "Missing required fields"})
                return

            if not assert_socket_identity(user_sessions, username):
                return

            message = db.get_message_by_id(message_id)
            if not message or message.get("room_id") != room:
                emit("error", {"message": "Message not found in this room"})
                return
            if not db.user_can_access_room(username, room):
                emit("error", {"message": "No access to this chat"})
                return

            if db.toggle_reaction(message_id, username, emoji):
                reactions = db.get_message_reactions(message_id)
                emit(
                    "reaction_updated",
                    {"message_id": message_id, "reactions": reactions},
                    room=room,
                )
                app.logger.debug(
                    f"Реакция {emoji} переключена: {username}, сообщение {message_id}"
                )
        except Exception as error:
            app.logger.error(f"Ошибка обработки реакции: {error}", exc_info=True)
            emit("error", {"message": "Failed to add reaction"})

    @socketio.on("mark_as_read")
    def handle_mark_as_read(data: dict[str, Any]):
        room = payload_str(data, "room")
        message_id = payload_str(data, "message_id")
        username = payload_str(data, "username")
        if room is None or message_id is None or username is None:
            return
        if not assert_socket_identity(user_sessions, username):
            return

        message = db.get_message_by_id(message_id)
        if not message or message.get("room_id") != room:
            return
        if not db.user_can_access_room(username, room):
            return

        if db.add_message_read(message_id, username):
            read_by = db.get_message_reads(message_id)
            emit(
                "message_read",
                {"message_id": message_id, "username": username, "read_by": read_by},
                room=room,
            )

    @socketio.on("mark_read_batch")
    def handle_mark_read_batch(data: dict[str, Any]):
        room = payload_str(data, "room")
        username = payload_str(data, "username")
        raw_ids = data.get("message_ids")
        if room is None or username is None or not isinstance(raw_ids, list):
            return
        if not assert_socket_identity(user_sessions, username):
            return
        if not db.user_can_access_room(username, room):
            return

        message_ids = [str(mid) for mid in raw_ids if mid is not None and str(mid)]
        reads_by_message = db.add_message_reads_for_room(message_ids, username, room)
        if not reads_by_message:
            return

        emit(
            "message_read_batch",
            {
                "room": room,
                "username": username,
                "reads": [
                    {"message_id": mid, "read_by": read_by}
                    for mid, read_by in reads_by_message.items()
                ],
            },
            room=room,
        )

    @socketio.on("edit_message")
    def handle_edit_message(data: dict[str, Any]):
        try:
            room = payload_str(data, "room")
            message_id = payload_str(data, "message_id")
            raw_text = data.get("new_text", "")
            new_text = raw_text.strip() if isinstance(raw_text, str) else ""
            username = payload_str(data, "username")

            if room is None or message_id is None or username is None:
                emit("error", {"message": "Missing required fields"})
                return

            if not assert_socket_identity(user_sessions, username):
                return

            if not new_text or len(new_text) > max_message_length:
                emit("error", {"message": "Invalid text length"})
                return

            message = db.get_message_by_id(message_id)
            if not message or message["username"] != username:
                emit("error", {"message": "You cannot edit someone else's messages"})
                return
            if message.get("room_id") != room:
                emit("error", {"message": "Room does not match message"})
                return
            if not db.user_can_access_room(username, room):
                emit("error", {"message": "No access to this chat"})
                return

            if db.update_message(message_id, new_text):
                emit(
                    "message_edited",
                    {"message_id": message_id, "new_text": new_text},
                    room=room,
                )
                app.logger.info(
                    f"Сообщение {message_id} изменено пользователем {username}"
                )
        except Exception as error:
            app.logger.error(f"Ошибка редактирования сообщения: {error}", exc_info=True)
            emit("error", {"message": "Failed to edit message"})

    @socketio.on("delete_message")
    def handle_delete_message(data: dict[str, Any]):
        try:
            room = payload_str(data, "room")
            message_id = payload_str(data, "message_id")
            username = payload_str(data, "username")

            if room is None or message_id is None or username is None:
                emit("error", {"message": "Missing required fields"})
                return

            if not assert_socket_identity(user_sessions, username):
                return

            message = db.get_message_by_id(message_id)
            if not message or message["username"] != username:
                emit("error", {"message": "You cannot delete someone else's messages"})
                return
            if message.get("room_id") != room:
                emit("error", {"message": "Room does not match message"})
                return
            if not db.user_can_access_room(username, room):
                emit("error", {"message": "No access to this chat"})
                return

            if db.delete_message(message_id):
                ensure_online_members_in_room(socketio, app, room)
                emit(
                    "message_deleted",
                    {"message_id": message_id, "room": room},
                    room=room,
                )
                app.logger.info(
                    f"Сообщение {message_id} удалено пользователем {username}"
                )
        except Exception as error:
            app.logger.error(f"Ошибка удаления сообщения: {error}", exc_info=True)
            emit("error", {"message": "Failed to delete message"})

    @socketio.on("pin_message")
    def handle_pin_message(data: dict[str, Any]):
        try:
            room_id = payload_str(data, "room_id")
            message_id = payload_str(data, "message_id")
            username = payload_str(data, "username")

            if room_id is None or message_id is None or username is None:
                emit("error", {"message": "Missing required fields"})
                return

            if not assert_socket_identity(user_sessions, username):
                return

            if not db.user_can_access_room(username, room_id):
                emit("error", {"message": "No access to this chat"})
                return

            msg = db.get_message_by_id(message_id)
            if not msg or msg.get("room_id") != room_id:
                emit("error", {"message": "Message does not belong to this room"})
                return

            if db.pin_message(room_id, message_id, username):
                emit(
                    "message_pinned",
                    {
                        "room_id": room_id,
                        "message_id": message_id,
                        "pinned_by": username,
                    },
                    room=room_id,
                )
                app.logger.info(
                    f"Сообщение {message_id} закреплено пользователем {username}"
                )
        except Exception as error:
            app.logger.error(f"Ошибка закрепления сообщения: {error}", exc_info=True)
            emit("error", {"message": "Failed to pin message"})

    @socketio.on("unpin_message")
    def handle_unpin_message(data: dict[str, Any]):
        try:
            room_id = payload_str(data, "room_id")
            message_id = payload_str(data, "message_id")
            username = payload_str(data, "username")

            if room_id is None or message_id is None or username is None:
                emit("error", {"message": "Missing required fields"})
                return

            if not assert_socket_identity(user_sessions, username):
                return

            if not db.user_can_access_room(username, room_id):
                emit("error", {"message": "No access to this chat"})
                return

            msg = db.get_message_by_id(message_id)
            if not msg or msg.get("room_id") != room_id:
                emit("error", {"message": "Message does not belong to this room"})
                return

            if db.unpin_message(room_id, message_id):
                emit(
                    "message_unpinned",
                    {"room_id": room_id, "message_id": message_id},
                    room=room_id,
                )
                app.logger.info(f"Сообщение {message_id} откреплено")
        except Exception as error:
            app.logger.error(f"Ошибка открепления сообщения: {error}", exc_info=True)
            emit("error", {"message": "Failed to unpin message"})
