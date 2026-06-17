"""Background delivery of scheduled messages (Socket.IO broadcast)."""

import os
import threading
import time

import db
from utils.json_helpers import parse_json_field
from utils.message_payload import serialize_saved_message
from utils.room_delivery import ensure_online_members_in_room


def _emit_saved_message(socketio, app, saved_msg, sender_username):
    room = saved_msg["room_id"]
    ensure_online_members_in_room(socketio, app, room)
    message_to_send = serialize_saved_message(
        saved_msg,
        read_by_username=sender_username,
        get_message_by_id=db.get_message_by_id,
    )

    socketio.emit(
        "receive_message", message_to_send, room=room, namespace="/"
    )


def _process_one_scheduled(app, socketio, row):
    sched_id = row["id"]
    if row.get("sent_message_id"):
        return
    room_id = row["room_id"]
    username = row["username"]
    message_id = f"msg_scheduled_{sched_id}"
    if not db.can_user_post_in_room(username, room_id):
        db.delete_scheduled_message(sched_id)
        app.logger.warning(
            "Отложенное сообщение %s отброшено: пользователь не может писать в %s",
            sched_id,
            room_id,
        )
        return

    message_data = {
        "id": message_id,
        "room": room_id,
        "username": username,
        "text": row.get("text") or "",
    }
    if row.get("media_type") and row.get("media_path"):
        message_data["media"] = {
            "type": row["media_type"],
            "data": row["media_path"],
            "name": row.get("media_name"),
        }
    meta = parse_json_field(row.get("media_meta"))
    if meta:
        message_data["media_meta"] = meta
    rj = parse_json_field(row.get("reply_to_json"))
    if rj and isinstance(rj, dict) and rj.get("id"):
        message_data["replyTo"] = {
            "id": rj["id"],
            "username": rj.get("username", ""),
            "text": rj.get("text", ""),
        }

    if not db.create_message(message_data):
        existing_msg = db.get_message_by_id(message_id)
        if existing_msg:
            db.mark_scheduled_sent(sched_id, message_id)
            app.logger.info(
                "Отложенное сообщение %s уже было создано другим воркером",
                sched_id,
            )
            return
        app.logger.error("Не удалось создать отложенное сообщение, id=%s", sched_id)
        return

    saved_msg = db.get_message_by_id(message_id)
    if not saved_msg:
        return
    _emit_saved_message(socketio, app, saved_msg, username)
    db.mark_scheduled_sent(sched_id, message_id)


def start_scheduled_worker(app, socketio, interval_sec=12):
    """Run periodic checks in a daemon thread."""

    # В debug-режиме Werkzeug перезапускает процесс (reloader) — без этой защиты
    # воркер запустится и в родителе, и в ребёнке, что приводит к двойной обработке
    # очереди и дубликатам сообщений.
    if app.debug and os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        return

    def loop():
        first = True
        while True:
            try:
                if not first:
                    time.sleep(interval_sec)
                first = False
                with app.app_context():
                    removed = db.cleanup_expired_messages()
                    for row in removed:
                        rid = row.get("room_id")
                        if rid:
                            ensure_online_members_in_room(socketio, app, rid)
                        socketio.emit(
                            "message_deleted",
                            {
                                "message_id": row["message_id"],
                                "room": rid,
                            },
                            room=rid,
                            namespace="/",
                        )
                    rows = db.fetch_due_scheduled(25)
                    for row in rows:
                        try:
                            _process_one_scheduled(app, socketio, row)
                        except Exception as exc:
                            app.logger.error(
                                "Ошибка воркера отложенных сообщений: %s", exc, exc_info=True
                            )
            except Exception as exc:
                app.logger.error("Цикл воркера отложенных сообщений: %s", exc, exc_info=True)

    thread = threading.Thread(target=loop, daemon=True, name="nebula-scheduled")
    thread.start()
    app.logger.info("Запущен фоновый воркер отложенных сообщений")
